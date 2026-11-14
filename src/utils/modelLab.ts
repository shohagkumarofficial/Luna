// Direct browser -> Google calls used by the Model Lab to test a user's own API key and models.
// The key goes only to generativelanguage.googleapis.com, never to the Luna server.
const API = "https://generativelanguage.googleapis.com";

export type ModelKindLab = "text" | "tts" | "live";

export interface LabModel {
  id: string;
  kind: ModelKindLab;
  displayName?: string;
}

export interface LabResult {
  ok: boolean | null; // null = connected but something odd (e.g. no audio)
  ms: number;
  message: string;
  audio?: Blob;
}

export const LAB_VOICES = [
  "Kore", "Leda", "Zephyr", "Aoede", "Puck", "Charon", "Fenrir", "Orus", "Callirrhoe", "Autonoe",
  "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi",
  "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
  "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
];

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function rateFromMime(mime?: string): number {
  const m = /rate=(\d+)/i.exec(mime || "");
  return m ? parseInt(m[1], 10) : 24000;
}

function pcmToWav(pcm: Uint8Array, rate: number): Blob {
  const h = new ArrayBuffer(44);
  const v = new DataView(h);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, pcm.length, true);
  return new Blob([h, pcm], { type: "audio/wav" });
}

// Turn Google's raw error into a short Bengali hint.
export function explainError(status: number, msg: string): string {
  const m = String(msg || "");
  if (/free tier/i.test(m)) return "এই মডেল আপনার প্রজেক্টে ফ্রিতে বন্ধ (বিলিং লাগবে)";
  if (status === 404 || /not found|not supported/i.test(m)) return "মডেলের নাম ভুল বা এই Key-তে নেই";
  if (status === 429 || /quota|exhausted/i.test(m)) return "ফ্রি সীমা শেষ, একটু পরে চেষ্টা করুন";
  if (status === 400 && /api key/i.test(m)) return "API Key ভুল বা অকার্যকর";
  if (status === 401 || status === 403) return "অনুমতি নেই (Key ভুল বা মডেল বন্ধ)";
  return "";
}

function failure(status: number, msg: string, ms: number): LabResult {
  const hint = explainError(status, msg);
  return { ok: false, ms, message: `${status ? status + " · " : ""}${hint ? hint + " · " : ""}${String(msg).slice(0, 140)}` };
}

export async function listModels(key: string): Promise<{ models: LabModel[]; error?: string }> {
  try {
    const r = await fetch(`${API}/v1beta/models?pageSize=1000&key=${encodeURIComponent(key)}`);
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j?.error?.message || r.statusText;
      return { models: [], error: `${r.status} · ${explainError(r.status, msg) || msg}` };
    }
    const out: LabModel[] = [];
    for (const m of j.models || []) {
      const id = String(m.name || "").replace(/^models\//, "");
      const methods: string[] = m.supportedGenerationMethods || [];
      let kind: ModelKindLab | null = null;
      if (methods.includes("bidiGenerateContent")) kind = "live";
      else if (/tts/i.test(id)) kind = "tts";
      else if (methods.includes("generateContent")) kind = "text";
      if (kind && id) out.push({ id, kind, displayName: m.displayName });
    }
    return { models: out };
  } catch (e: any) {
    return { models: [], error: "নেটওয়ার্ক সমস্যা: " + (e?.message || e) };
  }
}

export async function testText(key: string, model: string, prompt: string): Promise<LabResult> {
  const t0 = performance.now();
  try {
    const r = await fetch(`${API}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
    });
    const ms = Math.round(performance.now() - t0);
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) return failure(r.status, j?.error?.message || r.statusText, ms);
    const text = (j.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("").trim();
    return { ok: true, ms, message: text ? text.slice(0, 160) : "(খালি উত্তর)" };
  } catch (e: any) {
    return { ok: false, ms: Math.round(performance.now() - t0), message: "নেটওয়ার্ক সমস্যা: " + (e?.message || e) };
  }
}

export async function testTTS(key: string, model: string, voice: string, prompt: string): Promise<LabResult> {
  const t0 = performance.now();
  try {
    const r = await fetch(`${API}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
    });
    const ms = Math.round(performance.now() - t0);
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) return failure(r.status, j?.error?.message || r.statusText, ms);
    const inline = (j.candidates?.[0]?.content?.parts || []).find((p: any) => p.inlineData)?.inlineData;
    if (!inline?.data) return { ok: null, ms, message: "সংযোগ হলো কিন্তু অডিও আসেনি" };
    return { ok: true, ms, message: `কণ্ঠ তৈরি হয়েছে (${voice})`, audio: pcmToWav(b64ToBytes(inline.data), rateFromMime(inline.mimeType)) };
  } catch (e: any) {
    return { ok: false, ms: Math.round(performance.now() - t0), message: "নেটওয়ার্ক সমস্যা: " + (e?.message || e) };
  }
}

export type LiveMethod = "clientContent" | "realtimeInput";

export function testLive(key: string, model: string, voice: string, prompt: string, method: LiveMethod): Promise<LabResult> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const chunks: Uint8Array[] = [];
    let rate = 24000;
    let transcript = "";
    let done = false;
    let gotSetup = false;
    let ws: WebSocket;
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(key)}`;
    try {
      ws = new WebSocket(url);
    } catch (e: any) {
      return resolve({ ok: false, ms: 0, message: "WebSocket খোলা যায়নি: " + (e?.message || e) });
    }
    const finish = (ok: boolean, text: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      const ms = Math.round(performance.now() - t0);
      if (ok && chunks.length) {
        resolve({ ok: true, ms, message: transcript ? "লুনা: " + transcript : `কণ্ঠ তৈরি হয়েছে (${voice})`, audio: pcmToWav(concatBytes(chunks), rate) });
      } else if (ok) {
        resolve({ ok: null, ms, message: "সংযোগ হলো কিন্তু অডিও আসেনি" });
      } else {
        const hint = explainError(0, text);
        resolve({ ok: false, ms, message: `${hint ? hint + " · " : ""}${text}`.slice(0, 200) });
      }
    };
    const timer = setTimeout(() => finish(chunks.length > 0, gotSetup ? "সময় শেষ (25s), উত্তর আসেনি" : "সময় শেষ (25s), সংযোগ/setup হয়নি"), 25000);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        setup: {
          model: "models/" + model,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
          outputAudioTranscription: {},
        },
      }));
    };
    // Messages can arrive as Blobs; decode them one by one so order is preserved.
    let queue: Promise<void> = Promise.resolve();
    const handle = async (ev: MessageEvent) => {
      let txt: any = ev.data;
      if (txt instanceof Blob) txt = await txt.text();
      let m: any;
      try {
        m = JSON.parse(txt);
      } catch {
        return;
      }
      if (m.setupComplete !== undefined && !gotSetup) {
        gotSetup = true;
        if (method === "realtimeInput") ws.send(JSON.stringify({ realtimeInput: { text: prompt } }));
        else ws.send(JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text: prompt }] }], turnComplete: true } }));
        return;
      }
      const sc = m.serverContent;
      if (sc) {
        for (const p of sc.modelTurn?.parts || []) {
          if (p.inlineData?.data) {
            rate = rateFromMime(p.inlineData.mimeType);
            chunks.push(b64ToBytes(p.inlineData.data));
          }
        }
        if (sc.outputTranscription?.text) transcript += sc.outputTranscription.text;
        if (sc.turnComplete || sc.generationComplete) finish(true, "");
      }
      if (m.error) finish(false, JSON.stringify(m.error));
    };
    ws.onmessage = (ev) => {
      queue = queue.then(() => handle(ev)).catch(() => {});
    };
    ws.onclose = (ev) => {
      if (!done) finish(chunks.length > 0, `সংযোগ বন্ধ (কোড ${ev.code}) ${ev.reason || "কারণ দেওয়া হয়নি"}`);
    };
  });
}
