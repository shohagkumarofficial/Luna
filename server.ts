import express from "express";
import { buildSystemInstruction, geminiVoiceProfiles, styleFor, type VoiceProfile } from "./shared/lunaShared";
import fs from "fs";
import { createHash } from "crypto";
import http from "http";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { GoogleGenAI, Modality } from "@google/genai";
import { processCommand } from "./src/services/commandService.ts";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("trust proxy", 1);

// The Android app loads from https://localhost, so allow it (and the web app) to call the API.
app.use("/api/", (req, res, next) => {
  const origin = req.header("origin") || "";
  if (/^(https?:\/\/localhost(:\d+)?|capacitor:\/\/localhost)$/.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "content-type, x-gemini-key, x-text-model, x-tts-model, x-text-ok, x-tts-ok");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json({ limit: "30mb" }));

// Simple per-IP rate limit for the API (protects the free server from abuse)
const rateHits = new Map<string, { n: number; reset: number }>();
app.use("/api/", (req, res, next) => {
  const ip = req.ip || "unknown";
  const now = Date.now();
  const h = rateHits.get(ip);
  if (!h || h.reset < now) {
    rateHits.set(ip, { n: 1, reset: now + 60000 });
    return next();
  }
  h.n += 1;
  if (h.n > 90) {
    res.status(429).json({ error: "অনেক বেশি অনুরোধ, একটু পরে আবার চেষ্টা করো।" });
    return;
  }
  next();
});
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateHits) if (v.reset < now) rateHits.delete(k);
}, 120000).unref();

const server = http.createServer(app);

// Initialize shared GoogleGenAI client for server-side calls
// The API key comes from the user's own browser settings (sent per request).
// GEMINI_API_KEY env var is only an optional fallback and is NOT required.
// The browser may send several keys separated by commas; they are tried one after another.
function parseKeys(userKey?: string | null): string[] {
  const list = Array.from(new Set((userKey || "").split(/[\s,;]+/).map((k) => k.trim()).filter(Boolean))).slice(0, 6);
  if (list.length) return list;
  return process.env.GEMINI_API_KEY ? [process.env.GEMINI_API_KEY] : [];
}

function resolveApiKey(userKey?: string | null): string | undefined {
  return parseKeys(userKey)[0];
}

// Cooldowns are tracked per API key + model, so one visitor's quota problem never blocks another's.
function keyId(singleKey?: string | null): string {
  return createHash("sha1").update(singleKey || "").digest("hex").slice(0, 10);
}

// Model names coming from the browser are validated before use.
function sanitizeModel(v?: string | null): string | undefined {
  const t = (v || "").trim();
  return /^[A-Za-z0-9._-]{2,80}$/.test(t) ? t : undefined;
}

function sanitizeModelList(v?: string | null): string[] {
  return (v || "").split(",").map((x) => sanitizeModel(x)).filter((x): x is string => Boolean(x)).slice(0, 8);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error("timeout"), { status: "timeout" })), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

interface ChatResult {
  text: string;
  model: string | null;
  trace: string[];
  noKey?: boolean;
}
const textModelCooldownUntil = new Map<string, number>();

const NO_KEY_REPLY =
  "সোহাগ, আমার কথা বলার জন্য Gemini API Key লাগবে। উপরে সেটিংস থেকে API Key যোগ করে দাও, তারপর আমরা গল্প করবো!";

function getGenAIClient(singleKey?: string | null): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: singleKey || undefined,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// Core helper: generate text response with fallback models
async function generateLunaResponseDetailed(
  prompt: string,
  history: Array<{ sender: "user" | "luna"; text: string }> = [],
  imageBase64?: string,
  personality = "sweet",
  userApiKey?: string | null,
  preferredModel?: string | null,
  okModels: string[] = []
): Promise<ChatResult> {
  if (!resolveApiKey(userApiKey)) {
    return { text: NO_KEY_REPLY, model: null, trace: ["Gemini Key নেই"], noKey: true };
  }
  const keys = parseKeys(userApiKey);
  const ais = keys.map((k) => getGenAIClient(k));

  const parts: any[] = [{ text: prompt || "What do you see?" }];
  if (imageBase64) {
    parts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: imageBase64,
      },
    });
  }

  const recentHistory = history.slice(-20);
  const formattedHistory: any[] = [];
  let currentRole = "";
  let currentText = "";

  for (const msg of recentHistory) {
    const role = msg.sender === "user" ? "user" : "model";
    if (role === currentRole) {
      currentText += "\n" + msg.text;
    } else {
      if (currentRole !== "") {
        formattedHistory.push({ role: currentRole, parts: [{ text: currentText }] });
      }
      currentRole = role;
      currentText = msg.text;
    }
  }
  if (currentRole !== "") {
    formattedHistory.push({ role: currentRole, parts: [{ text: currentText }] });
  }

  if (formattedHistory.length > 0 && formattedHistory[0].role !== "user") {
    formattedHistory.shift();
  }

  const contents = formattedHistory.length > 0
    ? [...formattedHistory, { role: "user", parts }]
    : [{ role: "user", parts }];

  const defaultModels = [
    "gemini-4-hydrogen",
    "gemini-2.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.8-flash",
  ];
  const chosen = sanitizeModel(preferredModel);
  const candidateModels = Array.from(new Set([...(chosen ? [chosen] : []), ...okModels, ...defaultModels]));

  const trace: string[] = [];
  const systemInstruction = buildSystemInstruction(personality);
  const kids = keys.map((k) => keyId(k));
  const deadline = Date.now() + 45000; // never keep the user waiting more than ~45s in total
  let lastError: any = null;

  // Best model first; if it fails on one key (e.g. quota), the same model is tried on the next key
  // before moving down to a weaker model.
  outer: for (const model of candidateModels) {
   for (let ki = 0; ki < keys.length; ki++) {
    const kid = kids[ki];
    const ktag = keys.length > 1 ? ` [Key ${ki + 1}]` : "";
    const remaining = deadline - Date.now();
    if (remaining < 3000) {
      trace.push("সময়সীমা শেষ (৪৫ সেকেন্ড), বাকি মডেল চেষ্টা করা হয়নি");
      break outer;
    }
    const blockedUntil = textModelCooldownUntil.get(`${kid}:${model}`) || 0;
    if (blockedUntil > Date.now()) {
      trace.push(`${model}${ktag}: বাদ (সমস্যার কারণে ~${Math.ceil((blockedUntil - Date.now()) / 60000)} মিনিট বিশ্রামে)`);
      continue;
    }
    const started = Date.now();
    try {
      const response = await withTimeout(
        ais[ki].models.generateContent({ model, contents, config: { systemInstruction } }),
        Math.min(20000, remaining)
      );
      if (response && response.text) {
        trace.push(`${model}${ktag}: OK (${Date.now() - started}ms)`);
        return { text: response.text, model, trace };
      }
      trace.push(`${model}${ktag}: খালি উত্তর`);
    } catch (err: any) {
      lastError = err;
      const status = err?.status;
      const msg = String(err?.message || err || "").replace(/\s+/g, " ").slice(0, 110);
      trace.push(`${model}${ktag}: ব্যর্থ (${status || "error"}) ${msg}`);
      const cool =
        status === "timeout" ? 2 * 60000
        : status === 403 || status === 404 ? 10 * 60000
        : status === 429 ? 3 * 60000
        : typeof status === "number" && status >= 500 ? 60000
        : 0;
      if (cool) textModelCooldownUntil.set(`${kid}:${model}`, Date.now() + cool);
    }
   }
  }

  if (lastError?.status === 429 || lastError?.message?.includes("429") || lastError?.message?.includes("quota")) {
    return {
      text: "আরে সোহাগ! তোমার API কি-এর ফ্রি কোটা লিমিট সাময়িকভাবে শেষ হয়েছে। একটু পরে আবার চেষ্টা করো, আমি এখানেই আছি!",
      model: null,
      trace,
    };
  }

  return { text: "উফ, সোহাগ! একটু নেটওয়ার্ক সমস্যা হয়েছে। আবার বলো, শুনছি!", model: null, trace };
}

async function generateLunaResponse(
  prompt: string,
  history: Array<{ sender: "user" | "luna"; text: string }> = [],
  imageBase64?: string,
  personality = "sweet",
  userApiKey?: string | null,
  preferredModel?: string | null,
  okModels: string[] = []
): Promise<string> {
  return (await generateLunaResponseDetailed(prompt, history, imageBase64, personality, userApiKey, preferredModel, okModels)).text;
}

// In-memory audio cache and model rate-limit cooldowns to prevent rate-limits and ensure instant playback
const audioCache = new Map<string, string>();
function cacheAudio(key: string, value: string) {
  if (audioCache.size >= 100) {
    const oldest = audioCache.keys().next().value;
    if (oldest !== undefined) audioCache.delete(oldest);
  }
  audioCache.set(key, value);
}
const ttsModelCooldownUntil = new Map<string, number>();

// Wrap raw 24kHz mono 16-bit L16 PCM into a standard 44-byte RIFF WAV container if not already WAV
function wrapPcmAsWavIfNeeded(base64Audio: string, mimeType?: string): string {
  const buf = Buffer.from(base64Audio, "base64");
  // Already a valid RIFF/WAVE file
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE") {
    return base64Audio;
  }
  // Parse sample rate from mimeType if provided (default 24000Hz for Gemini TTS)
  let sampleRate = 24000;
  const rateMatch = mimeType?.match(/rate=(\d+)/i);
  if (rateMatch) {
    const parsed = parseInt(rateMatch[1], 10);
    if (!Number.isNaN(parsed) && parsed > 0) sampleRate = parsed;
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + buf.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20);  // PCM format
  header.writeUInt16LE(1, 22);  // Mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // Byte rate = sampleRate * channels * 2
  header.writeUInt16LE(2, 32);  // Block align
  header.writeUInt16LE(16, 34); // Bits per sample
  header.write("data", 36);
  header.writeUInt32LE(buf.length, 40);
  return Buffer.concat([header, buf]).toString("base64");
}

// Core helper: generate audio response with genuinely distinct Gemini 3.8 / EdgeTTS voice profiles
interface GeneratedAudioResult {
  audioBase64: string;
  engine: string;
  voiceUsed: string;
  trace?: string[];
}

// Attempt log of the most recent TTS call that produced no audio at all.
let lastFailedTrace: string[] = [];

async function generateLunaAudio(
  text: string,
  requestedVoice = "bn-BD-NabanitaNeural",
  _personality = "sweet",
  userApiKey?: string | null,
  preferredTtsModel?: string,
  okTtsModels: string[] = []
): Promise<GeneratedAudioResult | null> {
  const cleanText = text
    .replace(/\*[^*]+\*/g, "") // remove *sigh*, *dramatic pause*
    .replace(/\([^)]*\)/g, "") // remove (হেসে), (smile) stage directions
    .replace(/\[[^\]]*\]/g, "") // remove [pause] brackets
    .replace(/[#*_~`]/g, "")
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/।+/g, "। ")
    .trim();

  if (!cleanText) return null;

  // Human-readable record of every engine attempt, returned to the app's log panel.
  const trace: string[] = [];

  const cacheKey = `${requestedVoice}:${_personality}:${preferredTtsModel || ""}:${cleanText}`;
  if (audioCache.has(cacheKey)) {
    const cached = audioCache.get(cacheKey)!;
    return {
      audioBase64: cached,
      engine: "cache",
      voiceUsed: requestedVoice,
      trace: ["cache: আগের তৈরি অডিও ব্যবহার হয়েছে"],
    };
  }

  // Voice profiles live in shared/lunaShared.ts


  // Voices without their own Gemini profile (old Edge voices) use the default Gemini voice instead.
  const geminiProfile = geminiVoiceProfiles[requestedVoice] || geminiVoiceProfiles["maya-zephyr"] || Object.values(geminiVoiceProfiles)[0];
  if (!geminiVoiceProfiles[requestedVoice]) {
    trace.push(`Gemini: "${requestedVoice}" ভয়েসের নিজস্ব প্রোফাইল নেই, ডিফল্ট Gemini ভয়েস ব্যবহার হলো`);
  }

  const ttsKeys = parseKeys(userApiKey);
  if (!ttsKeys.length) {
    trace.push("Gemini: API Key নেই (সেটিংসে Key দাও)");
  }

  if (geminiProfile && ttsKeys.length) {
    const aiBetas = ttsKeys.map(
      (k) =>
        new GoogleGenAI({
          apiKey: k,
          apiVersion: "v1beta",
          httpOptions: { headers: { "User-Agent": "aistudio-build" } },
        })
    );
    const kids = ttsKeys.map((k) => keyId(k));

    const defaultTtsModels = geminiProfile.only25
      ? ["gemini-2.5-flash-preview-tts"]
      : geminiProfile.preferFlagship38
        ? ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts", "gemini-2.5-flash-preview-tts"]
        : ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts"];
    let geminiTtsModels = defaultTtsModels;
    if (preferredTtsModel) {
      if (geminiProfile.only25 && preferredTtsModel.startsWith("gemini-3.8")) {
        trace.push(`পছন্দের মডেল ${preferredTtsModel} এই ভয়েসের জন্য বাদ (ভয়েসটি শুধু 2.5 মডেলে আছে)`);
      } else {
        geminiTtsModels = [preferredTtsModel, ...defaultTtsModels.filter((m) => m !== preferredTtsModel)];
      }
    }
    // Models that passed a Lab test come right after the chosen one, before the built-in list.
    const okUsable = okTtsModels.filter((m) => !(geminiProfile.only25 && m.startsWith("gemini-3.8")));
    geminiTtsModels = Array.from(new Set([
      ...(preferredTtsModel && geminiTtsModels[0] === preferredTtsModel ? [preferredTtsModel] : []),
      ...okUsable,
      ...geminiTtsModels,
    ]));

    const now = Date.now();
    const styleCue =
      styleFor(geminiProfile, _personality);

    for (const ttsModel of geminiTtsModels) {
     for (let ki = 0; ki < ttsKeys.length; ki++) {
      const kid = kids[ki];
      const aiBeta = aiBetas[ki];
      const ktag = ttsKeys.length > 1 ? ` [Key ${ki + 1}]` : "";
      const blockedUntil = ttsModelCooldownUntil.get(`${kid}:${ttsModel}`) || 0;
      if (blockedUntil > now && ttsModel !== preferredTtsModel) {
        trace.push(`${ttsModel}${ktag}: বাদ (কোটা/অনুপস্থিত, ~${Math.ceil((blockedUntil - now) / 60000)} মিনিট পর আবার চেষ্টা)`);
        continue;
      }
      const attemptStart = Date.now();
      const isModel38 = ttsModel.startsWith("gemini-3.8");
      const targetGeminiVoice = isModel38 ? geminiProfile.voice38 : geminiProfile.voice25;

      try {
        const partPayload: any = isModel38
          ? { text: cleanText, speechMetadata: { style: styleCue } }
          : { text: `Say in a ${styleCue}: ${cleanText}` };

        const response = await aiBeta.models.generateContent({
          model: ttsModel,
          contents: [
            {
              role: "user",
              parts: [partPayload],
            },
          ],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: targetGeminiVoice },
              },
            },
          },
        });
        const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (inlineData?.data) {
          const wavBase64 = wrapPcmAsWavIfNeeded(inlineData.data, inlineData.mimeType);
          console.log(`[TTS Engine] Success with ${ttsModel} (${targetGeminiVoice} for ${requestedVoice}), wav bytes:`, wavBase64.length);
          cacheAudio(cacheKey, wavBase64);
          trace.push(`${ttsModel}${ktag}: OK (${targetGeminiVoice}, ${Date.now() - attemptStart}ms)`);
          return {
            audioBase64: wavBase64,
            engine: ttsModel,
            voiceUsed: targetGeminiVoice,
            trace,
          };
        }
        trace.push(`${ttsModel}${ktag}: অডিও ডেটা আসেনি`);
      } catch (err: any) {
        trace.push(
          `${ttsModel}${ktag}: ব্যর্থ (${err?.status || err?.code || "error"}) ${String(err?.message || err || "").slice(0, 120)}`
        );
        const msg = String(err?.message || err || "");
        const isQuotaOrRateLimit =
          err?.status === 429 ||
          err?.code === 429 ||
          /429|RESOURCE_EXHAUSTED|quota|rate[- ]?limit/i.test(msg);

        if (isQuotaOrRateLimit) {
          const retryMatch = msg.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
          const retrySec = retryMatch ? parseInt(retryMatch[1], 10) : 1800;
          const cooldownMs = Math.min(Math.max(retrySec, 20), 300) * 1000; // at most 5 minutes
          ttsModelCooldownUntil.set(`${kid}:${ttsModel}`, Date.now() + cooldownMs);
          console.log(`[TTS Engine] ${ttsModel} quota reached; switching cleanly to next voice.`);
        } else if (err?.status === 404 || err?.code === 404 || /NOT_FOUND|not found/i.test(msg)) {
          // Model unavailable for this key/API version: skip it for a while instead of retrying every request
          ttsModelCooldownUntil.set(`${kid}:${ttsModel}`, Date.now() + 10 * 60 * 1000);
          console.warn(`[TTS Engine] ${ttsModel} not available, skipping for 10 min.`);
        } else {
          console.warn(`[TTS Engine] ${ttsModel} (${targetGeminiVoice}) notice:`, `${err?.status || err?.code || ""} ${msg.slice(0, 180)}`);
        }
      }
     }
    }
  }

    // No Edge/robotic fallback any more: if every Gemini model and key failed, the app falls back to the device voice.
  // Last resort: caller still wants the attempt log even though no audio was produced.
  lastFailedTrace = trace;
  return null;
}

// Lightweight health check for uptime monitors (keeps the free Render service awake)
app.get("/healthz", (_req, res) => {
  res.type("text/plain").send("ok");
});

// API Route: Reset session
app.post("/api/gemini/reset", (req, res) => {
  res.json({ success: true });
});

// API Route: Generate Text / Chat response
app.post("/api/gemini/response", async (req, res) => {
  try {
    const { prompt, history = [], imageBase64, personality = "sweet" } = req.body;
    const chat = await generateLunaResponseDetailed(
      prompt, history, imageBase64, personality, req.header("x-gemini-key"), sanitizeModel(req.header("x-text-model")), sanitizeModelList(req.header("x-text-ok"))
    );
    res.json({ text: chat.text, noKey: Boolean(chat.noKey), model: chat.model, trace: chat.trace });
  } catch (error: any) {
    res.status(500).json({
      text: "উফ, সার্ভারে একটু সমস্যা হয়েছে সোহাগ। আবার চেষ্টা করো!",
      error: error?.message || "Internal error",
    });
  }
});

// API Route: Generate Speech / Audio (TTS)
// Clears this key's model "rest" lists (called by the Model Lab after a successful test)
app.post("/api/gemini/reset-cooldowns", (req, res) => {
  const prefixes = parseKeys(req.header("x-gemini-key")).map((k) => `${keyId(k)}:`);
  let cleared = 0;
  for (const map of [ttsModelCooldownUntil, textModelCooldownUntil]) {
    for (const k of Array.from(map.keys())) {
      if (prefixes.some((pf) => k.startsWith(pf))) { map.delete(k); cleared++; }
    }
  }
  res.json({ cleared });
});

app.post("/api/gemini/audio", async (req, res) => {
  try {
    const { text, voice, personality = "sweet" } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }
    lastFailedTrace = [];
    const result = await generateLunaAudio(text, voice, personality, req.header("x-gemini-key"), sanitizeModel(req.header("x-tts-model")), sanitizeModelList(req.header("x-tts-ok")));
    const audioBase64 = result?.audioBase64 || null;
    const isWav = Boolean(audioBase64 && audioBase64.startsWith("UklGR"));
    res.json({
      audioBase64,
      format: isWav ? "wav" : "mp3",
      engine: result?.engine || null,
      voiceUsed: result?.voiceUsed || null,
      trace: result?.trace || lastFailedTrace,
    });
  } catch (err: any) {
    res.json({ audioBase64: null, error: err?.message });
  }
});

// Pure-Node standard ZIP archive generator for downloading project source code
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function collectSourceFiles(dir: string, rootDir: string, out: string[] = []): string[] {
  const ignoredNames = new Set([
    "node_modules",
    "dist",
    "dev-dist",
    ".git",
    ".aistudio",
    ".env",
    ".env.local",
    ".env.production",
    ".DS_Store",
  ]);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      ignoredNames.has(entry.name) ||
      entry.name.startsWith("tmp_") ||
      (entry.name.startsWith(".env") && entry.name !== ".env.example")
    ) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(fullPath, rootDir, out);
    } else if (entry.isFile()) {
      out.push(path.relative(rootDir, fullPath).replace(/\\/g, "/"));
    }
  }
  return out;
}

function buildZipBuffer(rootDir: string, relPaths: string[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const relPath of relPaths) {
    const raw = fs.readFileSync(path.join(rootDir, relPath));
    const compressed = zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(relPath, "utf8");
    const checksum = crc32(raw);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(8, 8); // Deflate compression
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(relPaths.length, 8);
  eocd.writeUInt16LE(relPaths.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

app.get("/api/download-source", (_req, res) => {
  try {
    const files = collectSourceFiles(__dirname, __dirname).sort();
    const zipBuffer = buildZipBuffer(__dirname, files);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="luna-voice-assistant-source.zip"');
    res.setHeader("Content-Length", String(zipBuffer.length));
    res.send(zipBuffer);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to generate source zip" });
  }
});

// WebSocket Server for Live Voice Assistant bridging
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", async (clientWs: WebSocket) => {
  console.log("[Live Bridge] Client connected to Live Voice Assistant bridge");

  const safeSend = (payload: any) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(payload));
    }
  };

  // Immediate acknowledgment to put client into listening/ready state
  safeSend({ type: "connected" });

  let conversationHistory: Array<{ sender: "user" | "luna"; text: string }> = [];
  let currentPersonality = "sweet";
  let userApiKey = "";
  let userTextModel: string | undefined;

  clientWs.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "config") {
        if (typeof msg.personality === "string") currentPersonality = msg.personality;
        if (typeof msg.apiKey === "string") userApiKey = msg.apiKey;
        if (typeof msg.textModel === "string") userTextModel = sanitizeModel(msg.textModel);
        return;
      }

      const activePersonality = typeof msg.personality === "string" ? msg.personality : currentPersonality;
      if (typeof msg.textModel === "string") userTextModel = sanitizeModel(msg.textModel);

      if (msg.type === "text" && msg.text) {
        const userPrompt = msg.text.trim();
        conversationHistory.push({ sender: "user", text: userPrompt });

        // 1. Check for browser commands (e.g. "play ... on youtube", "open ...")
        const commandResult = processCommand(userPrompt);
        if (commandResult.isBrowserAction && commandResult.url) {
          safeSend({ type: "command", url: commandResult.url });
          safeSend({ type: "transcript", sender: "luna", text: commandResult.action });
          conversationHistory.push({ sender: "luna", text: commandResult.action });
          return;
        }

        // 2. Chit-Chat response with Luna's selected personality tone
        const replyText = await generateLunaResponse(userPrompt, conversationHistory, undefined, activePersonality, userApiKey, userTextModel);
        conversationHistory.push({ sender: "luna", text: replyText });

        safeSend({ type: "transcript", sender: "luna", text: replyText });
      } else if (msg.type === "image" && msg.image) {
        const caption = msg.text || "What do you see?";
        const replyText = await generateLunaResponse(caption, conversationHistory, msg.image, activePersonality, userApiKey, userTextModel);
        conversationHistory.push({ sender: "luna", text: replyText });

        safeSend({ type: "transcript", sender: "luna", text: replyText });
      }
    } catch (e: any) {
      console.error("[Live Bridge] Error processing message:", e?.message);
    }
  });

  clientWs.on("close", () => {
    console.log("[Live Bridge] Client disconnected");
  });

  clientWs.on("error", (err) => {
    console.warn("[Live Bridge] Client WS notice:", err?.message);
  });
});

// Upgrade handling for WebSockets
server.on("upgrade", (request, socket, head) => {
  const pathname = request.url ? new URL(request.url, "http://localhost").pathname : "";
  if (pathname === "/api/live") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Configure Vite or Static File Serving
async function startServer() {
  const isProd = process.env.NODE_ENV === "production";

  if (!isProd) {
    // Serve a clean no-HMR client module so Vite never opens a doomed HMR WebSocket in proxied environments
    app.get("/@vite/client", (_req, res) => {
      res.type("application/javascript").send(`
const sheetsMap = new Map();
if ("document" in globalThis) {
  document.querySelectorAll("style[data-vite-dev-id]").forEach((el) => {
    sheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
}
const cspNonce = "document" in globalThis ? document.querySelector("meta[property=csp-nonce]")?.nonce : undefined;
let lastInsertedStyle;
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.setAttribute("data-vite-dev-id", id);
    style.textContent = content;
    if (cspNonce) style.setAttribute("nonce", cspNonce);
    if (!lastInsertedStyle) {
      document.head.appendChild(style);
      setTimeout(() => { lastInsertedStyle = undefined; }, 0);
    } else {
      lastInsertedStyle.insertAdjacentElement("afterend", style);
    }
    lastInsertedStyle = style;
  } else {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  const noop = () => {};
  return {
    data: {},
    accept: noop,
    acceptExports: noop,
    dispose: noop,
    prune: noop,
    decline: noop,
    invalidate: noop,
    on: noop,
    off: noop,
    send: noop,
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== "." && url[0] !== "/") return url;
  const pathname = url.replace(/[?#].*$/, "");
  const { search, hash } = new URL(url, "http://vite.dev");
  return \`\${pathname}?\${queryToInject}\${search ? "&" + search.slice(1) : ""}\${hash || ""}\`;
}
export class ErrorOverlay extends HTMLElement {}
`);
    });

    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Luna full-stack server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Fatal error starting server:", err);
  process.exit(1);
});
