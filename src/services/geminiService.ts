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

  try {
    const response = await fetch("/api/gemini/audio", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...apiKeyHeaders(),
      },
      body: JSON.stringify({ text, voice, personality }),
    });

    if (!response.ok) {
      throw new Error(`TTS HTTP error ${response.status}`);
    }

    const data = await response.json();
    return data.audioBase64 || null;
  } catch (error) {
    console.warn("Cloud TTS unavailable, falling back to offline speech:", error);
    return null;
  }
}
