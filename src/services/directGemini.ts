// Direct mode (used by the Android app): the app talks to Google itself, so no Luna server is needed.
// Same behaviour as the server: best model first, then the same model on the next key, then weaker models.
import { buildSystemInstruction, geminiVoiceProfiles, styleFor } from "../../shared/lunaShared";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface DirectChat { text: string; model: string | null; trace: string[]; noKey?: boolean }
export interface DirectAudio { audioBase64: string | null; engine: string | null; voiceUsed: string | null; trace: string[] }

const cooldown = new Map<string, number>();
const kid = (key: string) => key.slice(-6);

async function callGemini(key: string, model: string, body: any, timeoutMs: number): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const txt = await r.text();
    let j: any = null;
    try { j = JSON.parse(txt); } catch {}
    if (!r.ok) {
      const e: any = new Error(j?.error?.message || txt.slice(0, 160) || `HTTP ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return j;
  } catch (e: any) {
    if (e?.name === "AbortError") {
      const t: any = new Error("timeout");
      t.status = "timeout";
      throw t;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Quota errors say how long to wait ("retryDelay": "23s"); use that instead of a fixed long rest.
function quotaCool(msg: string): number {
  const m = msg.match(/retry(?:Delay)?[^0-9]{0,12}(\d+(?:\.\d+)?)\s*s/i) || msg.match(/retry in (\d+(?:\.\d+)?)s/i);
  const sec = m ? Math.ceil(parseFloat(m[1])) : 30;
  return Math.min(Math.max(sec, 10), 90) * 1000;
}

function coolFor(status: any): number {
  return status === "timeout" ? 2 * 60000
    : status === 403 || status === 404 ? 10 * 60000
    : status === 429 ? 30000
    : typeof status === "number" && status >= 500 ? 60000
    : 0;
}

export async function directChat(
  prompt: string,
  history: { sender: "user" | "luna"; text: string }[],
  imageBase64: string | undefined,
  personality: string,
  keys: string[],
  preferred?: string,
  okModels: string[] = []
): Promise<DirectChat> {
  if (!keys.length) return { text: "", model: null, trace: ["Gemini Key নেই"], noKey: true };

  const merged: { role: string; text: string }[] = [];
  for (const m of history.slice(-20)) {
    const role = m.sender === "user" ? "user" : "model";
    const last = merged[merged.length - 1];
    if (last && last.role === role) last.text += "\n" + m.text;
    else merged.push({ role, text: m.text });
  }
  while (merged.length && merged[0].role !== "user") merged.shift();
  const current = prompt || "What do you see?";
  const last = merged[merged.length - 1];
  if (last && last.role === "user" && last.text.trim() === current.trim()) merged.pop(); // current message already in history

  const contents: any[] = merged.map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
  const userParts: any[] = [{ text: current }];
  if (imageBase64) userParts.push({ inlineData: { mimeType: "image/jpeg", data: imageBase64 } });
  if (contents.length && contents[contents.length - 1].role === "user") {
    contents[contents.length - 1].parts = [...contents[contents.length - 1].parts, ...userParts];
  } else {
    contents.push({ role: "user", parts: userParts });
  }

  const defaults = ["gemini-4-hydrogen", "gemini-2.5-flash", "gemini-3.1-flash-lite", "gemini-3.8-flash"];
  const models = Array.from(new Set([...(preferred ? [preferred] : []), ...okModels, ...defaults]));
  const systemInstruction = { parts: [{ text: buildSystemInstruction(personality) }] };
  const trace: string[] = [];
  const deadline = Date.now() + 45000;

  let attempted = 0;
  outer: for (let pass = 0; pass < 2; pass++) {
   if (pass === 1) {
     if (attempted > 0) break;
     trace.push("সব মডেল বিশ্রামে ছিল, তাই বিশ্রাম উপেক্ষা করে আবার চেষ্টা");
   }
   for (const model of models) {
    for (let ki = 0; ki < keys.length; ki++) {
      const tag = keys.length > 1 ? ` [Key ${ki + 1}]` : "";
      const remaining = deadline - Date.now();
      if (remaining < 3000) {
        trace.push("সময়সীমা শেষ (৪৫ সেকেন্ড)");
        break outer;
      }
      const until = cooldown.get(`${kid(keys[ki])}:${model}`) || 0;
      if (pass === 0 && until > Date.now()) {
        trace.push(`${model}${tag}: বাদ (বিশ্রামে)`);
        continue;
      }
      attempted++;
      const t0 = Date.now();
      try {
        const j = await callGemini(keys[ki], model, { contents, systemInstruction }, Math.min(20000, remaining));
        const text = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("").trim();
        if (text) {
          trace.push(`${model}${tag}: OK (${Date.now() - t0}ms)`);
          return { text, model, trace };
        }
        trace.push(`${model}${tag}: খালি উত্তর`);
      } catch (e: any) {
        trace.push(`${model}${tag}: ব্যর্থ (${e?.status || "error"}) ${String(e?.message || e).replace(/\s+/g, " ").slice(0, 110)}`);
        const c = e?.status === 429 ? quotaCool(String(e?.message || "")) : coolFor(e?.status);
        if (c) cooldown.set(`${kid(keys[ki])}:${model}`, Date.now() + c);
      }
    }
   }
  }
  return { text: "", model: null, trace };
}

function cleanSpeech(text: string): string {
  return text
    .replace(/\*[^*]+\*/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[#*_~`]/g, "")
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/।+/g, "। ")
    .trim();
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function wrapWav(b64: string, mime?: string): string {
  const pcm = b64ToBytes(b64);
  if (pcm.length >= 12 && String.fromCharCode(...pcm.subarray(0, 4)) === "RIFF") return b64;
  let rate = 24000;
  const m = mime?.match(/rate=(\d+)/i);
  if (m) rate = parseInt(m[1], 10) || 24000;
  const h = new DataView(new ArrayBuffer(44));
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) h.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); h.setUint32(4, 36 + pcm.length, true); w(8, "WAVE"); w(12, "fmt ");
  h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true);
  w(36, "data"); h.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(h.buffer), 0);
  out.set(pcm, 44);
  return bytesToB64(out);
}

const audioCache = new Map<string, string>();

export async function directAudio(
  text: string,
  voice: string,
  personality: string,
  keys: string[],
  preferred?: string,
  okModels: string[] = []
): Promise<DirectAudio> {
  const trace: string[] = [];
  const clean = cleanSpeech(text);
  if (!clean) return { audioBase64: null, engine: null, voiceUsed: null, trace };
  if (!keys.length) {
    trace.push("Gemini: API Key নেই (সেটিংসে Key দাও)");
    return { audioBase64: null, engine: null, voiceUsed: null, trace };
  }
  const ck = `${voice}:${personality}:${preferred || ""}:${clean}`;
  const cached = audioCache.get(ck);
  if (cached) return { audioBase64: cached, engine: "cache", voiceUsed: voice, trace: ["cache: আগের তৈরি অডিও"] };

  const profile = geminiVoiceProfiles[voice] || geminiVoiceProfiles["maya-zephyr"];
  if (!geminiVoiceProfiles[voice]) trace.push(`Gemini: "${voice}" ভয়েসের প্রোফাইল নেই, ডিফল্ট ভয়েস ব্যবহার হলো`);

  const defaults = profile.only25
    ? ["gemini-2.5-flash-preview-tts"]
    : profile.preferFlagship38
      ? ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts", "gemini-2.5-flash-preview-tts"]
      : ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts"];
  const usable = (m: string) => !(profile.only25 && m.startsWith("gemini-3.8"));
  // Last resort for voices that only exist on the 2.5 model: a stand-in voice on the 3.8 models is
  // better than falling back to the robotic device voice when the 2.5 quota is used up.
  const standIn = profile.only25 ? ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"] : [];
  const models = Array.from(new Set([...(preferred && usable(preferred) ? [preferred] : []), ...okModels.filter(usable), ...defaults, ...standIn]));
  const style = styleFor(profile, personality);

  let attempted = 0;
  for (let pass = 0; pass < 2; pass++) {
   if (pass === 1) {
     if (attempted > 0) break;
     trace.push("সব মডেল বিশ্রামে ছিল, তাই বিশ্রাম উপেক্ষা করে আবার চেষ্টা");
   }
   for (const model of models) {
    for (let ki = 0; ki < keys.length; ki++) {
      const tag = keys.length > 1 ? ` [Key ${ki + 1}]` : "";
      const until = cooldown.get(`${kid(keys[ki])}:${model}`) || 0;
      if (pass === 0 && until > Date.now() && model !== preferred) {
        trace.push(`${model}${tag}: বাদ (বিশ্রামে)`);
        continue;
      }
      attempted++;
      const is38 = model.startsWith("gemini-3.8");
      const vname = is38 ? profile.voice38 : profile.voice25;
      const part = is38 ? { text: clean, speechMetadata: { style } } : { text: `Say in a ${style}: ${clean}` };
      const t0 = Date.now();
      try {
        const j = await callGemini(keys[ki], model, {
          contents: [{ role: "user", parts: [part] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: vname } } },
          },
        }, 25000);
        const inline = j?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (inline?.data) {
          const wav = wrapWav(inline.data, inline.mimeType);
          if (audioCache.size > 40) audioCache.delete(audioCache.keys().next().value as string);
          audioCache.set(ck, wav);
          trace.push(`${model}${tag}: OK (${vname}${profile.only25 && is38 ? ", বিকল্প কণ্ঠ: 2.5-এর কোটা শেষ" : ""}, ${Date.now() - t0}ms)`);
          return { audioBase64: wav, engine: model, voiceUsed: vname, trace };
        }
        trace.push(`${model}${tag}: অডিও ডেটা আসেনি`);
      } catch (e: any) {
        trace.push(`${model}${tag}: ব্যর্থ (${e?.status || "error"}) ${String(e?.message || e).replace(/\s+/g, " ").slice(0, 120)}`);
        const quota = e?.status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(String(e?.message));
        const c = quota ? quotaCool(String(e?.message || "")) : coolFor(e?.status);
        if (c) cooldown.set(`${kid(keys[ki])}:${model}`, Date.now() + c);
      }
    }
   }
  }
  return { audioBase64: null, engine: null, voiceUsed: null, trace };
}
