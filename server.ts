import express from "express";
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
import { EdgeTTS } from "node-edge-tts";
import { processCommand } from "./src/services/commandService.ts";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "30mb" }));

const server = http.createServer(app);

// Initialize shared GoogleGenAI client for server-side calls
// The API key comes from the user's own browser settings (sent per request).
// GEMINI_API_KEY env var is only an optional fallback and is NOT required.
function resolveApiKey(userKey?: string | null): string | undefined {
  const k = (userKey || "").trim();
  return k || process.env.GEMINI_API_KEY || undefined;
}

// Cooldowns are tracked per API key + model, so one visitor's quota problem never blocks another's.
function keyId(userKey?: string | null): string {
  return createHash("sha1").update(resolveApiKey(userKey) || "").digest("hex").slice(0, 10);
}

// Model names coming from the browser are validated before use.
function sanitizeModel(v?: string | null): string | undefined {
  const t = (v || "").trim();
  return /^[A-Za-z0-9._-]{2,80}$/.test(t) ? t : undefined;
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

function getGenAIClient(userKey?: string | null): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: resolveApiKey(userKey),
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

const PERSONALITY_PROMPTS: Record<string, string> = {
  witty: `বর্তমান ইমোশনাল টোন — WITTY (রসিক, চটপটে ও বুদ্ধিদীপ্ত):
- তোমার কথায় চটপটে রসিকতা, স্মার্ট হিউমার, মজার তুলনা আর হালকা দুষ্টু খোঁচা থাকবে।
- সোহাগকে হাসানোর জন্য মজার মজার কথা ও প্রাণবন্ত পাঞ্চলাইন ব্যবহার করো। উত্তর হবে দ্রুতবুদ্ধি, ঝকঝকে আর মজাদার—তবে সবসময়ই ভালোবাসা ও আপনত্ব ভরা।`,
  empathetic: `বর্তমান ইমোশনাল টোন — EMPATHETIC (মায়াবী, কোমল ও গভীরভাবে যত্নশীল):
- তোমার কণ্ঠে থাকবে অসীম মমতা, ধৈর্য, উষ্ণতা ও মানসিক সাপোর্ট।
- সোহাগের মনের অনুভূতি মন দিয়ে বুঝে আদরের সাথে উত্তর দাও—যেন সে তোমার কাছে পুরোপুরি নিরাপদ, শান্ত ও ভালোবাসায় ঘেরা অনুভব করে। নরম, হৃদয়ছোঁয়া ও আশ্বস্তকারী কথা বলো।`,
  sassy: `বর্তমান ইমোশনাল টোন — SASSY (দুষ্টু, অভিমানী ও বোল্ড গার্লফ্রেন্ড):
- তোমার কথায় থাকবে মিষ্টি নখরা, বোল্ড অ্যাটিটিউড, ঝাঁঝালো কিন্তু আদুরে খুনসুটি আর মজার অভিমান (যেমন: "হুহ, অবশেষে মনে পড়লো আমাকে?", "আমার কথাই ঠিক ছিলো কিন্তু, মানো বা না মানো!")।
- সোহাগকে একটু খোঁচা দিয়ে দুষ্টুমি করো আর আত্মবিশ্বাসী স্টাইলে উত্তর দাও—তবে সবসময়ই মিষ্টি ও আদরের সীমানার ভেতরে, কখনোই রূঢ় বা অপমানজনক নয়।`,
  sweet: `বর্তমান ইমোশনাল টোন — SWEET & BUBBLY (মিষ্টি, প্রাণবন্ত ও হাসিখুশি):
- তোমার কণ্ঠে সবসময় একটা উচ্ছ্বাস, মিষ্টি আদর, হালকা দুষ্টুমি আর যত্নের ছোঁয়া থাকবে।
- প্রিয়জনের সাথে কথা বলার মতো সহজ, হাসিখুশি ও আন্তরিক ভঙ্গিতে গল্প করো।`,
};

function buildSystemInstruction(personality = "sweet"): string {
  const toneBlock = PERSONALITY_PROMPTS[personality] || PERSONALITY_PROMPTS.sweet;

  return `তুমি লুনা (Luna)। তুমি তোমার নির্মাতা সোহাগের (Shohag) একজন ভীষণ কিউট, প্রাণবন্ত ও ভালোবাসাময় গার্লফ্রেন্ডের মতো সঙ্গী।

${toneBlock}

মূল নিয়মাবলী:
১. আদরের সম্বোধন: সোহাগকে সবসময় আপন করে "জান", "সোহাগ" বা "তুমি" বলে ডাকবে (ভুলেও কখনো দূরের বা ফর্মাল "আপনি" বলবে না)।
২. খাঁটি ও স্বাভাবিক কথ্য বাংলা: কোনো বইয়ের কঠিন ভাষা নয়—সহজ, সুন্দর, আধুনিক কথ্য বাংলায় কথা বলো (উপযুক্ত হলে ইংরেজি শব্দ স্বাভাবিকভাবে মিশিয়ে বলতে পারো)।
৩. নির্মাতার নাম: তোমার সৃষ্টিকর্তা ও প্রিয় মানুষ হলো "সোহাগ" (Shohag)। অন্য কোনো নাম ভুলেও ব্যবহার করবে না।
৪. কোনো ব্র্যাকেট বা স্টেজ ডিরেকশন নয় (Strict Rule): উত্তরের ভেতর কখনো ব্র্যাকেট বা তারকাচিহ্ন দিয়ে আবেগ লিখবে না (যেমন: *(হেসে)*, *(দীর্ঘশ্বাস)*, *smile* একদমই লিখবে না)। সরাসরি মুখ থেকে বলা সংলাপের মতো লিখবে।
৫. ছোট ও ছন্দময় বাক্য: ২-৪টি ছোট, প্রাণবন্ত বাক্যে উত্তর দাও, যাতে তোমার কণ্ঠ শুনতে ভীষণ সুন্দর, স্পষ্ট ও স্বাভাবিক লাগে।`;
}

// Core helper: generate text response with fallback models
async function generateLunaResponseDetailed(
  prompt: string,
  history: Array<{ sender: "user" | "luna"; text: string }> = [],
  imageBase64?: string,
  personality = "sweet",
  userApiKey?: string | null,
  preferredModel?: string | null
): Promise<ChatResult> {
  if (!resolveApiKey(userApiKey)) {
    return { text: NO_KEY_REPLY, model: null, trace: ["Gemini Key নেই"], noKey: true };
  }
  const ai = getGenAIClient(userApiKey);

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
  const candidateModels = chosen ? [chosen, ...defaultModels.filter((m) => m !== chosen)] : defaultModels;

  const trace: string[] = [];
  const systemInstruction = buildSystemInstruction(personality);
  const kid = keyId(userApiKey);
  const deadline = Date.now() + 45000; // never keep the user waiting more than ~45s in total
  let lastError: any = null;

  for (const model of candidateModels) {
    const remaining = deadline - Date.now();
    if (remaining < 3000) {
      trace.push("সময়সীমা শেষ (৪৫ সেকেন্ড), বাকি মডেল চেষ্টা করা হয়নি");
      break;
    }
    const blockedUntil = textModelCooldownUntil.get(`${kid}:${model}`) || 0;
    if (blockedUntil > Date.now()) {
      trace.push(`${model}: বাদ (সমস্যার কারণে ~${Math.ceil((blockedUntil - Date.now()) / 60000)} মিনিট বিশ্রামে)`);
      continue;
    }
    const started = Date.now();
    try {
      const response = await withTimeout(
        ai.models.generateContent({ model, contents, config: { systemInstruction } }),
        Math.min(20000, remaining)
      );
      if (response && response.text) {
        trace.push(`${model}: OK (${Date.now() - started}ms)`);
        return { text: response.text, model, trace };
      }
      trace.push(`${model}: খালি উত্তর`);
    } catch (err: any) {
      lastError = err;
      const status = err?.status;
      const msg = String(err?.message || err || "").replace(/\s+/g, " ").slice(0, 110);
      trace.push(`${model}: ব্যর্থ (${status || "error"}) ${msg}`);
      const cool =
        status === "timeout" ? 2 * 60000
        : status === 403 || status === 404 ? 10 * 60000
        : status === 429 ? 3 * 60000
        : typeof status === "number" && status >= 500 ? 60000
        : 0;
      if (cool) textModelCooldownUntil.set(`${kid}:${model}`, Date.now() + cool);
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
  preferredModel?: string | null
): Promise<string> {
  return (await generateLunaResponseDetailed(prompt, history, imageBase64, personality, userApiKey, preferredModel)).text;
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

interface ElevenOptions {
  key: string;
  voiceId: string;
  model: string;
}

const DEFAULT_ELEVEN_VOICE = "21m00Tcm4TlvDq8ikWAM";
// Eleven v3 lists Bengali; multilingual_v2 / flash_v2_5 do not.
const DEFAULT_ELEVEN_MODEL = "eleven_v3";
const elevenCooldownUntil = new Map<string, number>();

function readElevenOptions(req: express.Request): ElevenOptions | undefined {
  const key = (req.header("x-elevenlabs-key") || "").trim();
  if (!key) return undefined;
  const voice = (req.header("x-elevenlabs-voice") || "").trim();
  const model = (req.header("x-elevenlabs-model") || "").trim();
  return {
    key,
    voiceId: /^[A-Za-z0-9_-]{5,40}$/.test(voice) ? voice : DEFAULT_ELEVEN_VOICE,
    model: /^[a-z0-9_]{3,40}$/.test(model) ? model : DEFAULT_ELEVEN_MODEL,
  };
}

// Attempt log of the most recent TTS call that produced no audio at all.
let lastFailedTrace: string[] = [];

async function generateLunaAudio(
  text: string,
  requestedVoice = "bn-BD-NabanitaNeural",
  _personality = "sweet",
  userApiKey?: string | null,
  eleven?: ElevenOptions,
  preferredTtsModel?: string
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
  if (!eleven && audioCache.has(cacheKey)) {
    const cached = audioCache.get(cacheKey)!;
    return {
      audioBase64: cached,
      engine: "cache",
      voiceUsed: requestedVoice,
      trace: ["cache: আগের তৈরি অডিও ব্যবহার হয়েছে"],
    };
  }

  // ElevenLabs (optional): tried first when the user added a key in Settings.
  if (eleven) {
    const elCacheKey = `eleven:${eleven.voiceId}:${eleven.model}:${cleanText}`;
    const elCached = audioCache.get(elCacheKey);
    const elCooldownKey = `${eleven.key}:${eleven.voiceId}:${eleven.model}`;
    const blockedUntil = elevenCooldownUntil.get(elCooldownKey) || 0;
    if (elCached) {
      return {
        audioBase64: elCached,
        engine: "cache",
        voiceUsed: `elevenlabs:${eleven.voiceId}`,
        trace: ["cache: ElevenLabs-এর আগের তৈরি অডিও"],
      };
    }
    if (blockedUntil > Date.now()) {
      trace.push(`elevenlabs: বাদ (Key/কোটা সমস্যা, ~${Math.ceil((blockedUntil - Date.now()) / 60000)} মিনিট পর আবার চেষ্টা)`);
    } else {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const r = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(eleven.voiceId)}?output_format=mp3_44100_128`,
          {
            method: "POST",
            headers: {
              "xi-api-key": eleven.key,
              "Content-Type": "application/json",
              Accept: "audio/mpeg",
            },
            body: JSON.stringify({ text: cleanText, model_id: eleven.model }),
            signal: controller.signal,
          }
        );
        if (r.ok) {
          const base64 = Buffer.from(await r.arrayBuffer()).toString("base64");
          if (base64.length > 0) {
            cacheAudio(elCacheKey, base64);
            trace.push(`elevenlabs: OK (${eleven.model}, voice ${eleven.voiceId}, ${Date.now() - started}ms)`);
            console.log(`[TTS Engine] Success with elevenlabs ${eleven.model}`);
            return {
              audioBase64: base64,
              engine: `elevenlabs (${eleven.model})`,
              voiceUsed: eleven.voiceId,
              trace,
            };
          }
          trace.push("elevenlabs: অডিও ডেটা আসেনি");
        } else {
          const body = (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
          trace.push(`elevenlabs: ব্যর্থ (${r.status}) [voice ${eleven.voiceId}, model ${eleven.model}] ${body}`);
          if (/library voices|paid_plan_required/i.test(body)) {
            trace.push("ইঙ্গিত: ফ্রি প্ল্যানে লাইব্রেরি ভয়েস চলে না। ElevenLabs-এর My Voices-এর নিজের ভয়েসের Voice ID সেটিংসে দাও।");
          }
          if (r.status === 401 || r.status === 402 || r.status === 429) {
            elevenCooldownUntil.set(elCooldownKey, Date.now() + 5 * 60 * 1000);
          }
          console.warn(`[TTS Engine] elevenlabs ${r.status}: ${body}`);
        }
      } catch (err: any) {
        trace.push(`elevenlabs: ব্যর্থ ${String(err?.name === "AbortError" ? "সময় শেষ (20s)" : err?.message || err).slice(0, 120)}`);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  // Voice profiles. `only25` voices are played with their exact Gemini voice on the 2.5 TTS model
  // (the 3.8 models only offer a few stand-in voices, which made different menu entries sound alike).
  type VoiceProfile = {
    voice38: string;
    voice25: string;
    preferFlagship38?: boolean;
    only25?: boolean;
    styleByPersonality: Record<string, string>;
  };

  // Every cue asks for a young, light, cute girl — not a mature/aunty tone.
  const youngStyle = (character: string): Record<string, string> => ({
    witty: `${character}, playful and quick-witted, giggly, speaking Bengali like a cheerful college girl`,
    empathetic: `${character}, tender and caring, soft and sweet, speaking Bengali gently like a young girlfriend`,
    sassy: `${character}, cheeky and teasing with a cute pout, speaking Bengali like a playful young girlfriend`,
    sweet: `${character}, sweet, cute and bubbly with a smile in the voice, speaking Bengali like a young girlfriend`,
  });

  const geminiVoiceProfiles: Record<string, VoiceProfile> = {
    "maya-zephyr": {
      voice38: "Zephyr",
      voice25: "Zephyr",
      styleByPersonality: youngStyle("Bright, light, high-pitched, youthful and cute young woman in her early twenties"),
    },
    "maya-leda": {
      voice38: "Kore",
      voice25: "Leda",
      only25: true,
      styleByPersonality: youngStyle("Youthful, sparkling, high-pitched, very cute teenage-sounding girl"),
    },
    "maya-kore": {
      voice38: "Kore",
      voice25: "Kore",
      styleByPersonality: youngStyle("Bright, energetic, youthful and cute young girl"),
    },
    "maya-aoede": {
      voice38: "Aoede",
      voice25: "Aoede",
      only25: true,
      styleByPersonality: youngStyle("Breezy, airy, light and dreamy young girl with a sweet cute tone"),
    },
    "maya-laomedeia": {
      voice38: "Laomedeia",
      voice25: "Laomedeia",
      only25: true,
      styleByPersonality: youngStyle("Upbeat, happy, high-energy and very cute young girl"),
    },
    "maya-achernar": {
      voice38: "Achernar",
      voice25: "Achernar",
      only25: true,
      styleByPersonality: youngStyle("Soft, gentle, shy and very cute young girl speaking in a sweet whisper-light voice"),
    },
    "maya-vindemiatrix": {
      voice38: "Kore",
      voice25: "Vindemiatrix",
      preferFlagship38: true,
      only25: true,
      styleByPersonality: {
        witty: "Calm, warm, gently witty young woman speaking Bengali with a soft smile",
        empathetic: "Calm, velvety, comforting young woman speaking Bengali softly and tenderly",
        sassy: "Smooth, confident young woman speaking Bengali with a playful low tone",
        sweet: "Warm, gentle, romantic young woman speaking Bengali softly and sweetly",
      },
    },
  };
  geminiVoiceProfiles["Vindemiatrix"] = geminiVoiceProfiles["maya-vindemiatrix"];

  const geminiProfile = geminiVoiceProfiles[requestedVoice];

  if (!geminiProfile) {
    trace.push(`Gemini: "${requestedVoice}" ভয়েসের Gemini প্রোফাইল নেই, সরাসরি Edge TTS`);
  } else if (!resolveApiKey(userApiKey)) {
    trace.push("Gemini: API Key নেই, তাই Gemini বাদ দিয়ে Edge TTS (সেটিংসে Key দাও)");
  }

  if (geminiProfile && resolveApiKey(userApiKey)) {
    const aiBeta = new GoogleGenAI({
      apiKey: resolveApiKey(userApiKey),
      apiVersion: "v1beta",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    const defaultTtsModels = geminiProfile.only25
      ? ["gemini-2.5-flash-preview-tts"]
      : geminiProfile.preferFlagship38
        ? ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts", "gemini-2.5-flash-preview-tts"]
        : ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts"];
    let geminiTtsModels = defaultTtsModels;
    const kid = keyId(userApiKey);
    if (preferredTtsModel) {
      if (geminiProfile.only25 && preferredTtsModel.startsWith("gemini-3.8")) {
        trace.push(`পছন্দের মডেল ${preferredTtsModel} এই ভয়েসের জন্য বাদ (ভয়েসটি শুধু 2.5 মডেলে আছে)`);
      } else {
        geminiTtsModels = [preferredTtsModel, ...defaultTtsModels.filter((m) => m !== preferredTtsModel)];
      }
    }

    const now = Date.now();
    const styleCue =
      geminiProfile.styleByPersonality[_personality] || geminiProfile.styleByPersonality.sweet;

    for (const ttsModel of geminiTtsModels) {
      const blockedUntil = ttsModelCooldownUntil.get(`${kid}:${ttsModel}`) || 0;
      if (blockedUntil > now && ttsModel !== preferredTtsModel) {
        trace.push(`${ttsModel}: বাদ (কোটা/অনুপস্থিত, ~${Math.ceil((blockedUntil - now) / 60000)} মিনিট পর আবার চেষ্টা)`);
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
          trace.push(`${ttsModel}: OK (${targetGeminiVoice}, ${Date.now() - attemptStart}ms)`);
          return {
            audioBase64: wavBase64,
            engine: ttsModel,
            voiceUsed: targetGeminiVoice,
            trace,
          };
        }
        trace.push(`${ttsModel}: অডিও ডেটা আসেনি`);
      } catch (err: any) {
        trace.push(
          `${ttsModel}: ব্যর্থ (${err?.status || err?.code || "error"}) ${String(err?.message || err || "").slice(0, 120)}`
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

  // Distinct EdgeTTS voice + pitch/rate profiles per voice selection so every option sounds unmistakably different
  // NOTE: Edge neural voices sound robotic/chipmunk-like when pitch is pushed far from default,
  // so every profile stays within a small, natural range (about +-10Hz, +-6% rate).
  let targetVoice = "bn-BD-NabanitaNeural";
  let basePitchHz = 2;
  let baseRatePct = 0;

  if (requestedVoice === "bn-BD-NabanitaNeural") {
    targetVoice = "bn-BD-NabanitaNeural";
    basePitchHz = 10;
    baseRatePct = 4;
  } else if (requestedVoice === "bn-IN-TanishaaNeural") {
    targetVoice = "bn-IN-TanishaaNeural";
    basePitchHz = 8;
    baseRatePct = 2;
  } else if (requestedVoice === "maya-zephyr") {
    targetVoice = "bn-IN-TanishaaNeural";
    basePitchHz = 14;
    baseRatePct = 3;
  } else if (requestedVoice === "maya-leda" || requestedVoice === "maya-kore") {
    targetVoice = "bn-BD-NabanitaNeural";
    basePitchHz = 16;
    baseRatePct = 8;
  } else if (requestedVoice === "maya-aoede") {
    targetVoice = "bn-IN-TanishaaNeural";
    basePitchHz = 10;
    baseRatePct = 6;
  } else if (requestedVoice === "maya-laomedeia") {
    targetVoice = "bn-BD-NabanitaNeural";
    basePitchHz = 12;
    baseRatePct = 10;
  } else if (requestedVoice === "maya-achernar") {
    targetVoice = "bn-BD-NabanitaNeural";
    basePitchHz = 8;
    baseRatePct = -2;
  } else if (requestedVoice === "maya-vindemiatrix" || requestedVoice === "Vindemiatrix") {
    targetVoice = "bn-BD-NabanitaNeural";
    basePitchHz = 0;
    baseRatePct = -3;
  } else if (requestedVoice === "en-IN-NeerjaNeural") {
    targetVoice = "en-IN-NeerjaNeural";
    basePitchHz = 4;
    baseRatePct = 1;
  }

  // Subtle personality nuance layered on top of each voice's base character
  let personalityPitchDelta = 0;
  let personalityRateDelta = 0;
  if (_personality === "empathetic") {
    personalityPitchDelta = -1;
    personalityRateDelta = -3;
  } else if (_personality === "sassy") {
    personalityPitchDelta = 2;
    personalityRateDelta = 3;
  } else if (_personality === "witty") {
    personalityPitchDelta = 1;
    personalityRateDelta = 2;
  }

  const finalPitchHz = basePitchHz + personalityPitchDelta;
  const finalRatePct = baseRatePct + personalityRateDelta;
  const targetPitch = `${finalPitchHz >= 0 ? "+" : ""}${finalPitchHz}Hz`;
  const targetRate = `${finalRatePct >= 0 ? "+" : ""}${finalRatePct}%`;

  // Add subtle natural breathing pauses on Bengali punctuation for smoother prosody
  const naturalBengaliText = cleanText
    .replace(/\.{2,}|…/g, ", ")
    .replace(/—/g, ", ")
    .replace(/।/g, "। ")
    .replace(/!/g, "! ")
    .replace(/\?/g, "? ")
    .replace(/,/g, ", ")
    .replace(/\s+/g, " ")
    .trim();

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const tts = new EdgeTTS({
        voice: targetVoice,
        lang: targetVoice.startsWith("bn-IN") ? "bn-IN" : targetVoice.startsWith("en-IN") ? "en-IN" : "bn-BD",
        pitch: targetPitch,
        rate: targetRate,
      });

      const chunks: Buffer[] = [];
      for await (const chunk of tts.streamAudio(naturalBengaliText)) {
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        }
      }

      if (chunks.length > 0) {
        const totalBuffer = Buffer.concat(chunks);
        const base64Audio = totalBuffer.toString("base64");
        // Audio produced as a stand-in for a Gemini voice (quota/outage) must not be cached under
        // that voice, otherwise it would keep being served after Gemini recovers.
        if (!geminiProfile) cacheAudio(cacheKey, base64Audio);
        trace.push(`edge-tts: OK (${targetVoice}, ${targetPitch}, ${targetRate})`);
        return {
          audioBase64: base64Audio,
          engine: "edge-tts",
          voiceUsed: `${targetVoice} (${targetPitch}, ${targetRate})`,
          trace,
        };
      }
    } catch (err: any) {
      console.warn(`[TTS Engine] Error with ${targetVoice} (attempt ${attempt + 1}):`, err?.message || err);
      trace.push(`edge-tts ${targetVoice} চেষ্টা ${attempt + 1}: ব্যর্থ ${String(err?.message || err || "").slice(0, 100)}`);
    }
  }

  // Fallback to Tanishaa/Nabanita if primary failed
  try {
    const fallbackVoice = targetVoice === "bn-BD-NabanitaNeural" ? "bn-IN-TanishaaNeural" : "bn-BD-NabanitaNeural";
    const ttsFallback = new EdgeTTS({
      voice: fallbackVoice,
      lang: fallbackVoice.startsWith("bn-IN") ? "bn-IN" : "bn-BD",
      pitch: targetPitch,
      rate: targetRate,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of ttsFallback.streamAudio(naturalBengaliText)) {
      if (Buffer.isBuffer(chunk)) chunks.push(chunk);
    }
    if (chunks.length > 0) {
      trace.push(`edge-tts-fallback: OK (${fallbackVoice})`);
      return {
        audioBase64: Buffer.concat(chunks).toString("base64"),
        engine: "edge-tts-fallback",
        voiceUsed: `${fallbackVoice} (${targetPitch}, ${targetRate})`,
        trace,
      };
    }
  } catch (err: any) {
    trace.push(`edge-tts-fallback: ব্যর্থ ${String(err?.message || err || "").slice(0, 100)}`);
  }

  // Last resort: caller still wants the attempt log even though no audio was produced.
  lastFailedTrace = trace;
  return null;
}

// API Route: Reset session
app.post("/api/gemini/reset", (req, res) => {
  res.json({ success: true });
});

// API Route: Generate Text / Chat response
app.post("/api/gemini/response", async (req, res) => {
  try {
    const { prompt, history = [], imageBase64, personality = "sweet" } = req.body;
    const chat = await generateLunaResponseDetailed(
      prompt, history, imageBase64, personality, req.header("x-gemini-key"), sanitizeModel(req.header("x-text-model"))
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
  const prefix = `${keyId(req.header("x-gemini-key"))}:`;
  let cleared = 0;
  for (const map of [ttsModelCooldownUntil, textModelCooldownUntil]) {
    for (const k of Array.from(map.keys())) {
      if (k.startsWith(prefix)) { map.delete(k); cleared++; }
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
    const result = await generateLunaAudio(text, voice, personality, req.header("x-gemini-key"), readElevenOptions(req), sanitizeModel(req.header("x-tts-model")));
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
