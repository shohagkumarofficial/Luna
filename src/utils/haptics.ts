// Lightweight Vibration API helper for subtle tactile haptic feedback on supported mobile devices

export type HapticKind = "sessionOn" | "sessionOff" | "listening" | "wake";

const HAPTIC_PATTERNS: Record<HapticKind, number | number[]> = {
  sessionOn: [16, 32, 24],
  sessionOff: [22],
  listening: [12],
  wake: [10, 22, 10],
};

let lastListeningHapticAt = 0;

export function triggerHaptic(kind: HapticKind): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return;
  }

  // Prevent rapid consecutive listening state transitions from buzzing twice
  if (kind === "listening") {
    const now = Date.now();
    if (now - lastListeningHapticAt < 500) {
      return;
    }
    lastListeningHapticAt = now;
  }

  try {
    navigator.vibrate(HAPTIC_PATTERNS[kind]);
  } catch {
    // Ignore vibration errors on restricted devices or desktop browsers
  }
}
