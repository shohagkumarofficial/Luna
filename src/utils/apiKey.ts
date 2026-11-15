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

// HTTP header values must be plain ASCII.
const ascii = (v: string) => v.replace(/[^\x21-\x7E]/g, "");

export function apiKeyHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const keys = getApiKeys();
  if (keys.length) headers["x-gemini-key"] = keys.map(ascii).join(",");
  return { ...headers, ...modelHeaders() };
}
