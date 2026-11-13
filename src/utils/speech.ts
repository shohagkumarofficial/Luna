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

  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      playOfflineVoiceCadence(spokenText, effectiveRate, onStart, onEnd).then(resolve);
      return;
    }

    try {
      window.speechSynthesis.cancel();
      stopAudio();
      stopOfflineCadence();

      const voices = window.speechSynthesis.getVoices();
      const hasLocalVoices = voices.some((v) => v.localService);

      // When offline with no locally installed OS voices, use Web Audio cadence fallback immediately
      if (isOffline && voices.length > 0 && !hasLocalVoices) {
        playOfflineVoiceCadence(spokenText, effectiveRate, onStart, onEnd).then(resolve);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(spokenText);
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
        onEnd?.();
        resolve();
      };

      const fallbackToCadence = () => {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimer);
        clearTimeout(startWatchdog);
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

      // If browser has no offline engine and fails to start speaking within 650ms, fall back to cadence audio
      const startWatchdog = setTimeout(() => {
        if (!started && isOffline) {
          fallbackToCadence();
        }
      }, 650);

      const wordCount = spokenText.split(/\s+/).length;
      const timeoutMs = Math.max(2500, (wordCount * 450) / effectiveRate);
      const safetyTimer = setTimeout(finish, timeoutMs + 1500);

      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn("Speech playback error:", err);
      playOfflineVoiceCadence(spokenText, effectiveRate, onStart, onEnd).then(resolve);
    }
  });
}

export function stopLunaSpeech() {
  stopAudio();
  stopOfflineCadence();
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
}
