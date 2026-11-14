import { getOfflineLunaResponse } from "../utils/offlineFallback";
import { apiKeyHeaders, getApiKey, getElevenKey } from "../utils/apiKey";
import { addLog } from "../utils/voiceLog";

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
    addLog(
      data.noKey ? "warn" : data.text ? "ok" : "warn",
      data.noKey ? "উত্তর: Gemini Key নেই, তাই Key চাওয়ার বার্তা দেখানো হলো" : data.text ? `উত্তর: ${data.model || "Gemini"} থেকে এসেছে` : "উত্তর খালি, অফলাইন উত্তর ব্যবহার হলো",
      [getApiKey() ? "API Key যোগ করা আছে" : "API Key যোগ করা নেই", ...(Array.isArray(data.trace) ? data.trace : [])]
    );
    return data.text || getOfflineLunaResponse(prompt, personality);
  } catch (error: any) {
    addLog("error", "উত্তর আনতে ব্যর্থ, অফলাইন উত্তর ব্যবহার হলো", [String(error?.message || error)]);
    console.warn("Network/server unavailable, using offline response fallback:", error);
    return getOfflineLunaResponse(prompt, personality);
  }
}

// Which server engine produced the most recent clip (e.g. a Gemini TTS model or "edge-tts").
export let lastAudioEngine: string | null = null;

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
    const startedAt = performance.now();
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
      const ms = Math.round(performance.now() - startedAt);
      const trace: string[] = Array.isArray(data.trace) ? data.trace : [];
      if (data.audioBase64) {
        lastAudioEngine = data.engine || null;
        const isGemini = /^(gemini|eleven)/.test(String(data.engine || ""));
        addLog(
          isGemini || data.engine === "cache" ? "ok" : "warn",
          `ভয়েস: ${data.engine || "?"} · ${ms}ms`,
          [`অনুরোধ করা ভয়েস: ${voice || "default"}`, `ব্যবহৃত ভয়েস: ${data.voiceUsed || "?"}`, ...trace]
        );
        return data.audioBase64;
      }
      addLog("error", `ভয়েস তৈরি হয়নি · ${ms}ms`, [`অনুরোধ করা ভয়েস: ${voice || "default"}`, ...trace, data.error ? `সার্ভার: ${data.error}` : ""].filter(Boolean));
    } catch (error: any) {
      addLog("error", `ভয়েস রিকোয়েস্ট ব্যর্থ (চেষ্টা ${attempt + 1})`, [String(error?.message || error)]);
      console.warn(`Cloud TTS attempt ${attempt + 1} failed:`, error);
      if (typeof navigator !== "undefined" && !navigator.onLine) return null;
    } finally {
      clearTimeout(timer);
    }
  }

  addLog("warn", "ক্লাউড ভয়েস পাওয়া যায়নি, ফোন/ব্রাউজারের ভয়েস ব্যবহার হবে", [
    getApiKey() ? "Gemini Key যোগ করা আছে" : "Gemini Key যোগ করা নেই (সেটিংস থেকে দাও)",
    getElevenKey() ? "ElevenLabs Key যোগ করা আছে" : "ElevenLabs Key যোগ করা নেই",
  ]);
  console.warn("Cloud TTS unavailable, falling back to device speech");
  return null;
}
