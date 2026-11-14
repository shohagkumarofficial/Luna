// Models chosen by the user in the Model Lab. Stored only in this browser and sent
// to the server as request headers; empty means "use the built-in default order".
export type ModelKind = "text" | "tts" | "live";

const KEYS: Record<ModelKind, string> = {
  text: "luna_model_text",
  tts: "luna_model_tts",
  live: "luna_model_live",
};

const VALID = /^[A-Za-z0-9._-]{2,80}$/;

export function getModelPref(kind: ModelKind): string {
  try {
    const v = localStorage.getItem(KEYS[kind]) || "";
    return VALID.test(v) ? v : "";
  } catch {
    return "";
  }
}

export function setModelPref(kind: ModelKind, model: string) {
  try {
    if (model && VALID.test(model)) localStorage.setItem(KEYS[kind], model);
    else localStorage.removeItem(KEYS[kind]);
  } catch {}
}

// Models that passed a Lab test (per kind). The server tries them right after the chosen one,
// before the built-in list, so a quota-exhausted favourite falls back to another *working* model.
const OK_KEYS: Record<"text" | "tts", string> = { text: "luna_ok_text", tts: "luna_ok_tts" };

export function getOkModels(kind: "text" | "tts"): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(OK_KEYS[kind]) || "[]");
    return Array.isArray(arr) ? arr.filter((m) => typeof m === "string" && VALID.test(m)).slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function markModelResult(kind: ModelKind, model: string, ok: boolean) {
  if (kind === "live" || !VALID.test(model)) return;
  try {
    const rest = getOkModels(kind).filter((m) => m !== model);
    localStorage.setItem(OK_KEYS[kind], JSON.stringify(ok ? [...rest, model] : rest));
  } catch {}
}

export function modelHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  const t = getModelPref("text");
  const s = getModelPref("tts");
  if (t) h["x-text-model"] = t;
  if (s) h["x-tts-model"] = s;
  const to = getOkModels("text").join(",");
  const so = getOkModels("tts").join(",");
  if (to) h["x-text-ok"] = to;
  if (so) h["x-tts-ok"] = so;
  return h;
}
