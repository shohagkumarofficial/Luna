import { modelHeaders } from "./modelPrefs";
// Gemini API key is stored only in this browser (localStorage) and sent to the
// Luna server with each request. It is never saved on the server.
const STORAGE_KEY = "luna_gemini_api_key";

// Several keys can be saved (one per line). When a model's quota ends on one key,
// Luna automatically moves to the next key.
export function parseKeys(text: string): string[] {
  return Array.from(new Set((text || "").split(/[\s,;]+/).map((k) => k.trim()).filter(Boolean))).slice(0, 6);
}

export function getApiKeys(): string[] {
  try {
    return parseKeys(localStorage.getItem(STORAGE_KEY) || "");
  } catch {
    return [];
  }
}

// First key (used for existence checks and the Model Lab)
export function getApiKey(): string {
  return getApiKeys()[0] || "";
}

export function getApiKeyText(): string {
  return getApiKeys().join("\n");
}

export function setApiKey(text: string): void {
  try {
    const keys = parseKeys(text);
    if (keys.length) localStorage.setItem(STORAGE_KEY, keys.join("\n"));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function clearApiKey(): void {
  setApiKey("");
}

// ---- ElevenLabs (optional, used first when a key is set) ----
const EL_KEY = "luna_elevenlabs_api_key";
const EL_VOICE = "luna_elevenlabs_voice_id";
const EL_MODEL = "luna_elevenlabs_model";

// Bengali is supported by Eleven v3 (multilingual_v2 / flash_v2_5 do not list Bengali).
export const DEFAULT_ELEVEN_MODEL = "eleven_v3";
export const DEFAULT_ELEVEN_VOICE = "21m00Tcm4TlvDq8ikWAM";

function readLS(k: string): string {
  try {
    return localStorage.getItem(k) || "";
  } catch {
    return "";
  }
}

function writeLS(k: string, v: string) {
  try {
    const t = v.trim();
    if (t) localStorage.setItem(k, t);
    else localStorage.removeItem(k);
  } catch {}
}

export const getElevenKey = () => readLS(EL_KEY);
export const getElevenVoiceId = () => readLS(EL_VOICE);
export const getElevenModel = () => readLS(EL_MODEL);

export function setElevenSettings(key: string, voiceId: string, model: string) {
  writeLS(EL_KEY, key);
  writeLS(EL_VOICE, voiceId);
  writeLS(EL_MODEL, model);
}

export function clearElevenSettings() {
  setElevenSettings("", "", "");
}

// HTTP header values must be plain ASCII.
const ascii = (v: string) => v.replace(/[^\x21-\x7E]/g, "");

export function apiKeyHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const keys = getApiKeys();
  if (keys.length) headers["x-gemini-key"] = keys.map(ascii).join(",");
  const elKey = getElevenKey();
  if (elKey) {
    headers["x-elevenlabs-key"] = ascii(elKey);
    const v = ascii(getElevenVoiceId());
    const m = ascii(getElevenModel());
    if (v) headers["x-elevenlabs-voice"] = v;
    if (m) headers["x-elevenlabs-model"] = m;
  }
  return { ...headers, ...modelHeaders() };
}
