let currentAudioElement: HTMLAudioElement | null = null;
let sharedAudioElement: HTMLAudioElement | null = null;
let chimeAudioCtx: AudioContext | null = null;

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
    if (sharedAudioElement.paused && !sharedAudioElement.src) {
      // Minimal silent WAV (44-byte header + 2 samples) to unlock mobile autoplay
      sharedAudioElement.src =
        "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
      sharedAudioElement.volume = 0;
      sharedAudioElement.play().then(() => {
        if (sharedAudioElement) {
          sharedAudioElement.pause();
          sharedAudioElement.volume = 1;
          sharedAudioElement.removeAttribute("src");
        }
      }).catch(() => {
        if (sharedAudioElement) {
          sharedAudioElement.volume = 1;
          sharedAudioElement.removeAttribute("src");
        }
      });
    }
  } catch {}
}

export function stopAudio(): void {
  if (currentAudioElement) {
    try {
      currentAudioElement.pause();
      currentAudioElement.currentTime = 0;
      currentAudioElement.removeAttribute("src");
    } catch {}
    currentAudioElement = null;
  }
}

export async function playPCM(
  base64Data: string,
  format: "mp3" | "wav" | "pcm" = "mp3",
  playbackRate = 1.0
): Promise<void> {
  stopAudio();

  try {
    const isWav = base64Data.startsWith("UklGR") || format === "wav";
    const mime = isWav ? "audio/wav" : "audio/mp3";
    const src = base64Data.startsWith("data:") ? base64Data : `data:${mime};base64,${base64Data}`;

    const audio = sharedAudioElement || new Audio();
    audio.setAttribute("playsinline", "true");
    audio.volume = 1;
    audio.src = src;
    audio.playbackRate = Math.min(2.0, Math.max(0.5, playbackRate || 1.0));
    audio.preservesPitch = true;
    (audio as any).webkitPreservesPitch = true;
    currentAudioElement = audio;

    return await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        audio.onended = null;
        audio.onerror = null;
        currentAudioElement = null;
      };
      audio.onended = () => {
        cleanup();
        resolve();
      };
      audio.onerror = (e) => {
        console.warn("HTML5 Audio playback notice:", e);
        cleanup();
        reject(new Error("Audio playback error"));
      };
      audio.play().catch((err) => {
        console.warn("HTML5 Audio play rejected or blocked:", err);
        cleanup();
        reject(err);
      });
    });
  } catch (error) {
    console.error("Error playing audio stream:", error);
    currentAudioElement = null;
    throw error;
  }
}
