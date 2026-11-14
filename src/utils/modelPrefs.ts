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

export function modelHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  const t = getModelPref("text");
  const s = getModelPref("tts");
  if (t) h["x-text-model"] = t;
  if (s) h["x-tts-model"] = s;
  return h;
}
