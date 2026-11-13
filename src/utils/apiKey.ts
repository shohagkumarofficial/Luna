// Gemini API key is stored only in this browser (localStorage) and sent to the
// Luna server with each request. It is never saved on the server.
const STORAGE_KEY = "luna_gemini_api_key";

export function getApiKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function setApiKey(key: string): void {
  try {
    const trimmed = key.trim();
    if (trimmed) localStorage.setItem(STORAGE_KEY, trimmed);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function clearApiKey(): void {
  setApiKey("");
}

export function apiKeyHeaders(): Record<string, string> {
  const key = getApiKey();
  return key ? { "x-gemini-key": key } : {};
}
