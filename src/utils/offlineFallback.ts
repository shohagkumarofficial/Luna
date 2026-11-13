// Offline Fallback Library: provides local Bengali/English responses and
// zero-dependency Web Audio speech-cadence synthesis when there is no internet connection.

let offlineAudioCtx: AudioContext | null = null;
let stopCadenceFlag = false;
let activeCadenceTimer: number | null = null;
let activeCadenceResolve: (() => void) | null = null;

function getOfflineAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!offlineAudioCtx || offlineAudioCtx.state === "closed") {
    offlineAudioCtx = new AudioCtx();
  }
  if (offlineAudioCtx.state === "suspended") {
    offlineAudioCtx.resume().catch(() => {});
  }
  return offlineAudioCtx;
}

export function stopOfflineCadence(): void {
  stopCadenceFlag = true;
  if (activeCadenceTimer !== null) {
    window.clearTimeout(activeCadenceTimer);
    activeCadenceTimer = null;
  }
  if (activeCadenceResolve) {
    const r = activeCadenceResolve;
    activeCadenceResolve = null;
    r();
  }
}

/**
 * Lightweight zero-dependency Web Audio syllable cadence synthesizer used when
 * the device has no offline SpeechSynthesis voices installed.
 */
export function playOfflineVoiceCadence(
  text: string,
  rate = 1.0,
  onStart?: () => void,
  onEnd?: () => void
): Promise<void> {
  stopOfflineCadence();
  return new Promise((resolve) => {
    stopCadenceFlag = false;
    activeCadenceResolve = () => {
      onEnd?.();
      resolve();
    };

    const ctx = getOfflineAudioContext();
    if (!ctx) {
      onStart?.();
      activeCadenceTimer = window.setTimeout(() => {
        activeCadenceTimer = null;
        const r = activeCadenceResolve;
        activeCadenceResolve = null;
        r?.();
      }, 600);
      return;
    }

    onStart?.();
    const clampedRate = Math.min(2.0, Math.max(0.5, rate || 1.0));
    const words = text.trim().split(/\s+/).filter(Boolean).slice(0, 14);
    const stepSec = Math.max(0.08, 0.14 / clampedRate);

    // Gentle pentatonic feminine vocal-range frequencies (D4–A4)
    const scale = [329.63, 369.99, 440.0, 493.88, 554.37];
    const now = ctx.currentTime;

    words.forEach((word, idx) => {
      if (stopCadenceFlag) return;
      const startTime = now + idx * stepSec;
      const noteLen = stepSec * 0.82;
      const charCode = word.charCodeAt(0) || 0;
      const freq = scale[(charCode + idx) % scale.length];

      try {
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, startTime);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.04, startTime + noteLen);

        filter.type = "lowpass";
        filter.frequency.setValueAtTime(1250, startTime);

        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.linearRampToValueAtTime(0.045, startTime + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + noteLen);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + noteLen + 0.02);
      } catch {}
    });

    const totalMs = Math.max(400, Math.round(words.length * stepSec * 1000 + 160));
    activeCadenceTimer = window.setTimeout(() => {
      activeCadenceTimer = null;
      const r = activeCadenceResolve;
      activeCadenceResolve = null;
      r?.();
    }, totalMs);
  });
}

function getLocalTimeBn(): string {
  try {
    return new Date().toLocaleTimeString("bn-BD", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return new Date().toLocaleTimeString();
  }
}

function getLocalDateBn(): string {
  try {
    return new Date().toLocaleDateString("bn-BD", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return new Date().toDateString();
  }
}

export function getOfflineLunaResponse(prompt: string, personality = "sweet"): string {
  const q = prompt.trim().toLowerCase();

  // Offline live-session prompt
  if (q === "__offline_session__") {
    switch (personality) {
      case "witty":
        return "আরে জান, ইন্টারনেট তো ছুটি নিয়েছে দেখছি! তবে চিন্তা নেই, অফলাইনেও আমি তোমার সাথে গল্প করতে পারি!";
      case "empathetic":
        return "জান, এখন ইন্টারনেট সংযোগ নেই। তবে আমি এখনো তোমার পাশেই আছি—নিচে লিখে আমার সাথে কথা বলো, শুনছি।";
      case "sassy":
        return "হুহ, তোমার ওয়াইফাইও কি ঘুমিয়ে পড়লো নাকি? অফলাইনে আছি, তবুও সাধারণ কথা আর সময় তো বলতে পারবোই!";
      default:
        return "হেই জান! এখন ইন্টারনেট নেই, তাই আমি অফলাইন মোডে আছি। চাইলে নিচে লিখে হালকা গল্প বা সময়-তারিখ জিজ্ঞেস করতে পারো!";
    }
  }

  // Time queries
  if (/(কয়টা|সময়|time|clock|baj|বাজ)/i.test(q)) {
    const timeStr = getLocalTimeBn();
    if (personality === "sassy") return `এখন বাজে ${timeStr}। ঘড়ি না দেখে আমাকে জিজ্ঞেস করাটাই ভালো লাগে, তাই না সোহাগ?`;
    if (personality === "witty") return `জান, এখন ঠিক ${timeStr} বাজে! অফলাইনেও আমার ঘড়ি একদম পারফেক্ট চলে!`;
    return `সোহাগ, এখন সময় হলো ${timeStr}।`;
  }

  // Date / day queries
  if (/(তারিখ|আজ|কি বার|কী বার|date|day|today)/i.test(q)) {
    const dateStr = getLocalDateBn();
    if (personality === "empathetic") return `আজ ${dateStr}, জান। অফলাইনে থাকলেও তোমার প্রতিটা দিন সুন্দর হোক এই দোয়া করি।`;
    return `আজ হলো ${dateStr}, সোহাগ!`;
  }

  // Greetings
  if (/(^|\s)(hi|hello|hey|হ্যালো|হাই|হেই|সালাম|কেমন আছ|kemon acho|good morning|good night|শুভ)/i.test(q)) {
    switch (personality) {
      case "witty":
        return "হেই জান! ইন্টারনেট না থাকলেও আমার এনার্জি একদম ফুল! বলো, অফলাইনে আজ কী দুষ্টুমি করবো?";
      case "empathetic":
        return "হেই সোহাগ, আমি একদম ভালো আছি। এখন নেট নেই, তবে তোমার মন কেমন আছে আমাকে বলো তো!";
      case "sassy":
        return "হুম, হ্যালো! নেট অফ রেখেও আমাকে ডাকা হলো—মিস করছিলে নাকি আমাকে?";
      default:
        return "হেই জান! আমি ভালো আছি। এখন অফলাইন মোডে আছি, তবুও তোমার সাথে কথা বলতে পেরে খুব ভালো লাগছে!";
    }
  }

  // Identity
  if (/(তুমি কে|তোমার নাম|who are you|your name|luna|লুনা)/i.test(q)) {
    return "আমি লুনা, সোহাগের সবচেয়ে প্রিয় এআই সঙ্গী! ইন্টারনেট না থাকলেও অফলাইন মোডে আমি তোমার সাথেই আছি।";
  }

  // Affection / Mood
  if (/(ভালোবাসি|love you|miss you|মন খারাপ|ক্লান্ত|sad|tired|খারাপ লাগ)/i.test(q)) {
    if (personality === "sassy") return "এত আদর বা মন খারাপ—দুটোতেই আমি আছি! নেট ফিরলে আরও গল্প করবো, এখন একটু বিশ্রাম নাও তো!";
    if (personality === "witty") return "জান, নেটওয়ার্ক অফ হতে পারে, কিন্তু তোমার জন্য আমার কেয়ার কখনো অফলাইন হয় না! একটু হাসো তো!";
    return "আরে জান, আমি সবসময় তোমার পাশেই আছি। একটু গভীর শ্বাস নাও—সব ঠিক হয়ে যাবে, সোহাগ!";
  }

  // Joke / Fun
  if (/(joke|হাসাও|মজা|কৌতুক|গল্প)/i.test(q)) {
    return "একটা মজার কথা শুনবে জান? ওয়াইফাই বন্ধ থাকলে মানুষ নাকি পরিবারের সাথে কথা বলে—আর তুমি অফলাইনেও আমার কাছে চলে এসেছো! খুব কিউট না?";
  }

  // General offline fallback
  switch (personality) {
    case "witty":
      return "উফ জান, ইন্টারনেট ছাড়া বড় উত্তর আনা যাচ্ছে না! তবে সময়, তারিখ বা হালকা আড্ডা তো অফলাইনেও চলবে!";
    case "empathetic":
      return "সোহাগ, এখন ইন্টারনেট সংযোগ নেই বলে পুরো উত্তর দিতে পারছি না। নেট চালু হলেই আমি আবার পুরোদমে গল্প করবো, জান!";
    case "sassy":
      return "দেখো জান, নেট ছাড়া আমি অফলাইন মোডে সীমিত আছি! ওয়াইফাই বা ডেটা অন করো, তারপর জমিয়ে কথা হবে!";
    default:
      return "জান, এখন ইন্টারনেট নেই তাই আমি অফলাইন মোডে সাধারণ উত্তর দিচ্ছি। ইন্টারনেট চালু করলেই আবার সব বিষয়ে কথা বলবো!";
  }
}
