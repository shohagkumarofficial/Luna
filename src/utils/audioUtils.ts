let currentAudioElement: HTMLAudioElement | null = null;
let sharedAudioElement: HTMLAudioElement | null = null;
let chimeAudioCtx: AudioContext | null = null;
let currentWebSource: AudioBufferSourceNode | null = null;
// Settles (resolves) whichever playback is currently pending, so callers awaiting
// playPCM() never hang when playback is stopped or replaced by a newer one.
let currentSettle: (() => void) | null = null;

const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

function getChimeContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!chimeAudioCtx || chimeAudioCtx.state === "closed") {
    chimeAudioCtx = new AudioCtx();
  }
  if (chimeAudioCtx.state === "suspended") {
    chimeAudioCtx.resume().catch(() => {});
  }
  return chimeAudioCtx;
}

/**
 * Plays a short, subtle, pleasant harmonic chime when a live session starts or stops.
 */
export function playSessionChime(type: "start" | "stop"): void {
  try {
    const ctx = getChimeContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    // Ascending open fifth (G5 -> D6) for start, gentle descending (D6 -> G5) for stop
    const notes = type === "start" ? [783.99, 1174.66] : [1174.66, 783.99];
    const peakGain = type === "start" ? 0.065 : 0.055;

    notes.forEach((freq, idx) => {
      const startTime = now + idx * 0.085;
      const duration = type === "start" ? 0.28 : 0.24;

      const osc = ctx.createOscillator();
      const harmonicOsc = ctx.createOscillator();
      const gain = ctx.createGain();
      const harmonicGain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime);

      // Subtle warm overtone for a soft crystal bell texture
      harmonicOsc.type = "sine";
      harmonicOsc.frequency.setValueAtTime(freq * 2, startTime);
      harmonicGain.gain.setValueAtTime(0.16, startTime);

      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.014);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      osc.connect(gain);
      harmonicOsc.connect(harmonicGain);
      harmonicGain.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      harmonicOsc.start(startTime);
      osc.stop(startTime + duration + 0.02);
      harmonicOsc.stop(startTime + duration + 0.02);
    });
  } catch {
    // Ignore audio context errors on restricted devices
  }
}

// Unlock a reusable HTMLAudioElement on user tap so mobile browsers allow async voice playback
export function unlockAudio(): void {
  if (typeof window === "undefined") return;
  try {
    getChimeContext();
    if (!sharedAudioElement) {
      sharedAudioElement = new Audio();
      sharedAudioElement.setAttribute("playsinline", "true");
    }
    const el = sharedAudioElement;
    // Only unlock when nothing is playing / loaded, otherwise we would clobber real audio
    if (el.paused && !el.getAttribute("src")) {
      // Minimal silent WAV (44-byte header + 2 samples) to unlock mobile autoplay
      el.src = SILENT_WAV;
      el.volume = 0;
      const restore = () => {
        // Only reset if a real voice clip has not been loaded in the meantime
        if (el.getAttribute("src") === SILENT_WAV) {
          el.removeAttribute("src");
        }
        el.volume = 1;
      };
      el.play()
        .then(() => {
          if (el.getAttribute("src") === SILENT_WAV) el.pause();
          restore();
        })
        .catch(restore);
    }
  } catch {}
}

export function stopAudio(): void {
  // Settle the pending playPCM() promise first (this also detaches its handlers)
  const settle = currentSettle;
  currentSettle = null;
  settle?.();

  if (currentWebSource) {
    try {
      currentWebSource.onended = null;
      currentWebSource.stop();
    } catch {}
    currentWebSource = null;
  }

  if (currentAudioElement) {
    try {
      currentAudioElement.onended = null;
      currentAudioElement.onerror = null;
      currentAudioElement.pause();
      currentAudioElement.currentTime = 0;
      currentAudioElement.removeAttribute("src");
    } catch {}
    currentAudioElement = null;
  }
}

function clampRate(rate: number): number {
  return Math.min(2.0, Math.max(0.5, rate || 1.0));
}

function playWithElement(src: string, playbackRate: number): Promise<void> {
  const audio = sharedAudioElement || (sharedAudioElement = new Audio());
  audio.setAttribute("playsinline", "true");
  audio.volume = 1;
  audio.src = src;
  audio.playbackRate = playbackRate;
  audio.preservesPitch = true;
  (audio as any).webkitPreservesPitch = true;
  currentAudioElement = audio;

  return new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = (err?: unknown) => {
      if (finished) return;
      finished = true;
      // Only touch shared state if we are still the active playback; a newer
      // playback may already own the shared element and its handlers.
      if (currentSettle === finish) {
        audio.onended = null;
        audio.onerror = null;
        currentSettle = null;
        if (currentAudioElement === audio) currentAudioElement = null;
      }
      if (err) reject(err);
      else resolve();
    };
    currentSettle = finish as () => void;
    audio.onended = () => finish();
    audio.onerror = (e) => {
      console.warn("HTML5 Audio playback notice:", e);
      finish(new Error("Audio playback error"));
    };
    audio.play().catch((err) => {
      console.warn("HTML5 Audio play rejected or blocked:", err);
      finish(err);
    });
  });
}

function base64ToArrayBuffer(base64Data: string): ArrayBuffer {
  const raw = base64Data.includes(",") ? base64Data.slice(base64Data.indexOf(",") + 1) : base64Data;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Fallback path used when <audio> autoplay is blocked: the AudioContext is resumed on the
// user's first tap (unlockAudio), so decoded playback through it still works.
async function playWithWebAudio(base64Data: string, playbackRate: number): Promise<void> {
  const ctx = getChimeContext();
  if (!ctx) throw new Error("Web Audio is not available");
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  const audioBuffer = await ctx.decodeAudioData(base64ToArrayBuffer(base64Data));
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.playbackRate.value = playbackRate;
  source.connect(ctx.destination);

  return new Promise<void>((resolve) => {
    let finished = false;
    let safety: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (safety) clearTimeout(safety);
      if (currentSettle === finish) currentSettle = null;
      if (currentWebSource === source) currentWebSource = null;
      resolve();
    };
    currentSettle = finish;
    currentWebSource = source;
    source.onended = finish;
    // Guard against a suspended context that would never fire `ended`
    safety = setTimeout(finish, (audioBuffer.duration / playbackRate) * 1000 + 1500);
    source.start();
  });
}

export async function playPCM(
  base64Data: string,
  format: "mp3" | "wav" | "pcm" = "mp3",
  playbackRate = 1.0
): Promise<void> {
  stopAudio();

  const rate = clampRate(playbackRate);
  const isWav = base64Data.startsWith("UklGR") || format === "wav";
  const mime = isWav ? "audio/wav" : "audio/mpeg";
  const src = base64Data.startsWith("data:") ? base64Data : `data:${mime};base64,${base64Data}`;

  try {
    await playWithElement(src, rate);
  } catch (elementError) {
    // Autoplay/decoder problems with <audio>: retry through Web Audio before giving up,
    // so a reply is not silently dropped.
    console.warn("Falling back to Web Audio playback:", elementError);
    stopAudio();
    await playWithWebAudio(base64Data, rate);
  }
}
