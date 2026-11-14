// Web Speech & Offline TTS Fallback utility for Luna
import { stopAudio } from "./audioUtils";
import { playOfflineVoiceCadence, stopOfflineCadence } from "./offlineFallback";

const isExplicitlyMale = (name: string): boolean => {
  const lower = name.toLowerCase();
  return (
    lower.includes("prosenjit") ||
    lower.includes(" male") ||
    lower.includes("male ") ||
    lower.includes("(male)") ||
    lower.includes("man") ||
    lower.includes("boy") ||
    lower.includes("ravi") ||
    lower.includes("madhav") ||
    lower.includes("hemant") ||
    lower.includes("george") ||
    lower.includes("david") ||
    lower.includes("mark") ||
    lower.includes("guy")
  );
};

const isFemaleVoice = (name: string): boolean => {
  const lower = name.toLowerCase();
  return (
    lower.includes("female") ||
    lower.includes("girl") ||
    lower.includes("woman") ||
    lower.includes("nabanita") ||
    lower.includes("tanishaa") ||
    lower.includes("swara") ||
    lower.includes("heera") ||
    lower.includes("priya") ||
    lower.includes("aditi") ||
    lower.includes("raveena") ||
    lower.includes("zira") ||
    lower.includes("samantha") ||
    lower.includes("neerja") ||
    lower.includes("kalyani") ||
    lower.includes("veena") ||
    lower.includes("sunita") ||
    lower.includes("sheetal") ||
    lower.includes("karen") ||
    lower.includes("victoria")
  );
};

function selectBestVoice(voices: SpeechSynthesisVoice[], preferLocalOnly: boolean): SpeechSynthesisVoice | undefined {
  const pool = preferLocalOnly ? voices.filter((v) => v.localService) : voices;
  const candidates = pool.length > 0 ? pool : voices;

  // 1. Bengali Female voice
  const bnFemale = candidates.find((v) => v.lang.startsWith("bn") && isFemaleVoice(v.name));
  // 2. Bengali non-male voice
  const bnNonMale = candidates.find((v) => v.lang.startsWith("bn") && !isExplicitlyMale(v.name));
  // 3. Regional Indian/Hindi Female voice
  const regionalFemale = candidates.find(
    (v) => (v.lang.startsWith("hi") || v.lang === "en-IN" || v.name.toLowerCase().includes("india")) && isFemaleVoice(v.name)
  );
  // 4. Any clean Female voice
  const anyFemale = candidates.find((v) => isFemaleVoice(v.name));
  // 5. Any Bengali or local fallback voice
  const anyBn = candidates.find((v) => v.lang.startsWith("bn"));
  const anyLocal = preferLocalOnly ? pool[0] : undefined;

  return bnFemale || bnNonMale || regionalFemale || anyFemale || anyBn || anyLocal;
}

// Chrome/Android populate speechSynthesis voices asynchronously. Calling getVoices() too early
// returns [] and Luna would pick no voice (and stay silent or use the wrong one).
function loadVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const now = synth.getVoices();
    if (now.length > 0) {
      resolve(now);
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      synth.removeEventListener?.("voiceschanged", finish);
      resolve(synth.getVoices());
    };
    const timer = setTimeout(finish, timeoutMs);
    synth.addEventListener?.("voiceschanged", finish);
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Keep a reference to the active utterance: Chrome can garbage-collect it mid-speech,
// which silently drops the voice and never fires onend.
let activeUtterance: SpeechSynthesisUtterance | null = null;
// Incremented on every call/stop so an older, still-waiting call never speaks late.
let speakToken = 0;

export function speakLuna(
  text: string,
  onStart?: () => void,
  onEnd?: () => void,
  rate?: number
): Promise<void> {
  const cleanText = text
    .replace(/\*[^*]+\*/g, "")
    .replace(/[\#\*\_\~\`]/g, "")
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "")
    .trim();

  const spokenText = cleanText || text;
  const effectiveRate =
    typeof rate === "number" && !Number.isNaN(rate)
      ? Math.min(2.0, Math.max(0.5, rate))
      : 0.98;

  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
  const myToken = ++speakToken;

  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      playOfflineVoiceCadence(spokenText, effectiveRate, onStart, onEnd).then(resolve);
      return;
    }

    (async () => {
      try {
        window.speechSynthesis.cancel();
        stopAudio();
        stopOfflineCadence();

        const voices = await loadVoices();
        // Chrome drops a speak() issued in the same tick as cancel(); give it a moment.
        await sleep(60);
        if (myToken !== speakToken) {
          onEnd?.(); // superseded by a newer call or by stopLunaSpeech(); let the caller reset its state
          resolve();
          return;
        }

        const hasLocalVoices = voices.some((v) => v.localService);

        // When offline with no locally installed OS voices, use Web Audio cadence fallback immediately
        if (isOffline && voices.length > 0 && !hasLocalVoices) {
          playOfflineVoiceCadence(spokenText, effectiveRate, onStart, onEnd).then(resolve);
          return;
        }

        const utterance = new SpeechSynthesisUtterance(spokenText);
        activeUtterance = utterance;
        const chosenVoice = selectBestVoice(voices, isOffline);

        if (chosenVoice) {
          utterance.voice = chosenVoice;
          utterance.lang = chosenVoice.lang;
          utterance.pitch = isExplicitlyMale(chosenVoice.name) ? 1.3 : 1.05;
          utterance.rate = effectiveRate;
        } else {
          utterance.lang = "bn-BD";
          utterance.pitch = 1.05;
          utterance.rate = effectiveRate;
        }

        let settled = false;
        let started = false;

        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(safetyTimer);
          clearTimeout(startWatchdog);
          if (activeUtterance === utterance) activeUtterance = null;
          onEnd?.();
          resolve();
        };

        const fallbackToCadence = () => {
          if (settled) return;
          settled = true;
          clearTimeout(safetyTimer);
          clearTimeout(startWatchdog);
          if (activeUtterance === utterance) activeUtterance = null;
          try {
            window.speechSynthesis.cancel();
          } catch {}
          playOfflineVoiceCadence(spokenText, effectiveRate, onStart, onEnd).then(resolve);
        };

        utterance.onstart = () => {
          started = true;
          clearTimeout(startWatchdog);
          onStart?.();
        };

        utterance.onend = finish;

        utterance.onerror = (e) => {
          console.warn("Speech synthesis notice:", e);
          if (!started && isOffline) {
            fallbackToCadence();
          } else {
            finish();
          }
        };

        // Offline without a working engine: fall back to cadence audio quickly.
        // Online with no usable voice (e.g. no Bengali voice installed): give up after a few
        // seconds instead of leaving the app stuck in the "speaking" state.
        const startWatchdog = setTimeout(
          () => {
            if (started) return;
            if (isOffline) {
              fallbackToCadence();
            } else {
              console.warn("Speech synthesis did not start; no usable device voice for this language.");
              try {
                window.speechSynthesis.cancel();
              } catch {}
              finish();
            }
          },
          isOffline ? 650 : 4000
        );

        const wordCount = spokenText.split(/\s+/).length;
        const timeoutMs = Math.max(4000, (wordCount * 700) / effectiveRate);
        const safetyTimer = setTimeout(() => {
          try {
            window.speechSynthesis.cancel();
          } catch {}
          finish();
        }, timeoutMs + 4000);

        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn("Speech playback error:", err);
        playOfflineVoiceCadence(spokenText, effectiveRate, onStart, onEnd).then(resolve);
      }
    })();
  });
}

export function stopLunaSpeech() {
  speakToken++;
  stopAudio();
  stopOfflineCadence();
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
}
