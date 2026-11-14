import { getOfflineLunaResponse } from "../utils/offlineFallback";
import { apiKeyHeaders } from "../utils/apiKey";

export function resetLunaSession() {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  fetch("/api/gemini/reset", { method: "POST" }).catch(() => {});
}

export async function getLunaResponse(
  prompt: string,
  history: { sender: "user" | "luna"; text: string }[] = [],
  imageBase64?: string,
  personality = "sweet"
): Promise<string> {
  // Fast offline path: immediately serve local personality-aware fallback response
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return getOfflineLunaResponse(prompt, personality);
  }

  try {
    const response = await fetch("/api/gemini/response", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...apiKeyHeaders(),
      },
      body: JSON.stringify({
        prompt,
        history,
        imageBase64,
        personality,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }

    const data = await response.json();
    return data.text || getOfflineLunaResponse(prompt, personality);
  } catch (error) {
    console.warn("Network/server unavailable, using offline response fallback:", error);
    return getOfflineLunaResponse(prompt, personality);
  }
}

export async function getLunaAudio(
  text: string,
  voice?: string,
  personality?: string
): Promise<string | null> {
  // Skip cloud TTS request immediately when offline so local/fallback TTS responds without delay
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return null;
  }

  // One retry: the server-side TTS engines occasionally fail on a single attempt, and
  // without a retry Luna would show the message but stay silent (or use a different voice).
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch("/api/gemini/audio", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...apiKeyHeaders(),
        },
        body: JSON.stringify({ text, voice, personality }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`TTS HTTP error ${response.status}`);
      }

      const data = await response.json();
      if (data.audioBase64) return data.audioBase64;
    } catch (error) {
      console.warn(`Cloud TTS attempt ${attempt + 1} failed:`, error);
      if (typeof navigator !== "undefined" && !navigator.onLine) return null;
    } finally {
      clearTimeout(timer);
    }
  }

  console.warn("Cloud TTS unavailable, falling back to device speech");
  return null;
}
