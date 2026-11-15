import React, { useRef, useState } from "react";
import { getUsage } from "../utils/keyUsage";
import { MODES, MODE_CATEGORIES, type ModeCategory, type ModeId } from "../../shared/modes";
import { Sparkles, Volume2, Check, X, RefreshCw, Heart, Smile, Gauge, RotateCcw, Palette, Languages, KeyRound, Eye, EyeOff } from "lucide-react";
import { getLunaAudio, lastAudioEngine } from "../services/geminiService";
import { playPCM } from "../utils/audioUtils";
import { speakLuna, stopLunaSpeech } from "../utils/speech";
import { ThemeId, THEMES, THEME_OPTIONS } from "../utils/theme";
import {
  getApiKey, getApiKeyText, getApiKeys, setApiKey, clearApiKey,
  getElevenKey, getElevenVoiceId, getElevenModel, setElevenSettings, clearElevenSettings,
  DEFAULT_ELEVEN_VOICE, DEFAULT_ELEVEN_MODEL,
} from "../utils/apiKey";

export type PersonalityId = ModeId;
export type SpeechLangCode = "bn-BD" | "en-US";

export const SPEECH_LANGUAGE_OPTIONS: {
  id: SpeechLangCode;
  label: string;
  nativeLabel: string;
  flag: string;
  description: string;
}[] = [
  {
    id: "bn-BD",
    label: "Bengali",
    nativeLabel: "বাংলা",
    flag: "🇧🇩",
    description: "বাংলা ও বাংলিশ কথা শনাক্ত করতে (bn-BD)",
  },
  {
    id: "en-US",
    label: "English",
    nativeLabel: "English",
    flag: "🇺🇸",
    description: "ইংরেজি কথা নির্ভুলভাবে শনাক্ত করতে (en-US)",
  },
];

export interface PersonalityOption {
  id: PersonalityId;
  category: ModeCategory;
  name: string;
  subtitle: string;
  description: string;
  emoji: string;
}

// Defined once in shared/modes.ts (the server and Live mode use the same list)
export const PERSONALITIES: PersonalityOption[] = MODES.map((m) => ({
  id: m.id,
  category: m.category,
  name: m.name,
  subtitle: m.subtitle,
  description: m.description,
  emoji: m.emoji,
}));

export interface VoiceOption {
  id: string;
  name: string;
  dialect: string;
  description: string;
  isNeural: boolean;
  avatar: string;
}

export const CUTE_VOICES: VoiceOption[] = [
  {
    id: "maya-leda",
    name: "লুনা — কিউট ও চঞ্চল (Leda) ✨",
    dialect: "কম বয়সী, মিষ্টি ও প্রাণবন্ত",
    description: "হালকা, ঝকঝকে ও কিউট কিশোরী-তরুণীর কণ্ঠ — সবচেয়ে ছোট ও মিষ্টি শোনায়",
    isNeural: true,
    avatar: "✨",
  },
  {
    id: "maya-zephyr",
    name: "লুনা — উজ্জ্বল ও মিষ্টি (Zephyr) 🌸",
    dialect: "হালকা ও সতেজ তরুণী",
    description: "উজ্জ্বল, হালকা ও রোমান্টিক গার্লফ্রেন্ডের মতো তরুণ কণ্ঠ",
    isNeural: true,
    avatar: "🌸",
  },
  {
    id: "maya-aoede",
    name: "লুনা — স্বপ্নিল ও নরম (Aoede) 🦋",
    dialect: "হালকা বাতাসের মতো",
    description: "নরম, স্বপ্নালু ও আদুরে মেয়েলি কণ্ঠ",
    isNeural: true,
    avatar: "🦋",
  },
  {
    id: "maya-laomedeia",
    name: "লুনা — হাসিখুশি ও উচ্ছ্বল (Laomedeia) 🎀",
    dialect: "এনার্জেটিক ও মজার",
    description: "সবসময় হাসিখুশি, দুষ্টু-মিষ্টি ও প্রাণোচ্ছল কণ্ঠ",
    isNeural: true,
    avatar: "🎀",
  },
  {
    id: "maya-achernar",
    name: "লুনা — লাজুক ও আদুরে (Achernar) 🍓",
    dialect: "ফিসফিসে নরম",
    description: "লাজুক, মিহি ও খুব আদুরে কিউট কণ্ঠ",
    isNeural: true,
    avatar: "🍓",
  },
  {
    id: "maya-vindemiatrix",
    name: "মায়া — গভীর ও শান্ত (Vindemiatrix) 🎙️",
    dialect: "গভীর ও ধীর",
    description: "গভীর, শান্ত ও রোমান্টিক কণ্ঠ (এটি একটু পরিণত শোনায়)",
    isNeural: true,
    avatar: "🎙️",
  },
  {
    id: "device-cute",
    name: "ডিভাইসের ভয়েস",
    dialect: "সিস্টেম স্পিচ",
    description: "আপনার ফোন/কম্পিউটারের নিজস্ব ভয়েস (অফলাইনেও চলে)",
    isNeural: false,
    avatar: "📱",
  },
];

interface VoiceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedVoice: string;
  onSelectVoice: (voiceId: string) => void;
  selectedPersonality: PersonalityId;
  onSelectPersonality: (personality: PersonalityId) => void;
  speakingRate: number;
  onChangeSpeakingRate: (rate: number) => void;
  speechLang: SpeechLangCode;
  onChangeSpeechLang: (lang: SpeechLangCode) => void;
  selectedTheme: ThemeId;
  onSelectTheme: (theme: ThemeId) => void;
}

export const VoiceSettingsModal: React.FC<VoiceSettingsModalProps> = ({
  isOpen,
  onClose,
  selectedVoice,
  onSelectVoice,
  selectedPersonality,
  onSelectPersonality,
  speakingRate,
  onChangeSpeakingRate,
  speechLang,
  onChangeSpeechLang,
  selectedTheme,
  onSelectTheme,
}) => {
  const [testingId, setTestingId] = useState<string | null>(null);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const testRunRef = useRef(0);
  const [keyInput, setKeyInput] = useState<string>(() => getApiKeyText());
  const [hasSavedKey, setHasSavedKey] = useState<boolean>(() => Boolean(getApiKey()));
  const [elKey, setElKey] = useState<string>(() => getElevenKey());
  const [elVoice, setElVoice] = useState<string>(() => getElevenVoiceId());
  const [elModel, setElModel] = useState<string>(() => getElevenModel());
  const [hasElKey, setHasElKey] = useState<boolean>(() => Boolean(getElevenKey()));
  const [showElKey, setShowElKey] = useState(false);
  const [elSaved, setElSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);

  if (!isOpen) return null;

  const t = THEMES[selectedTheme];

  const handleTestVoice = async (voice: VoiceOption) => {
    // Latest click wins: a slower response for an earlier voice must never play over
    // (or instead of) the voice the user clicked last.
    const runId = ++testRunRef.current;
    const isStale = () => testRunRef.current !== runId;

    stopLunaSpeech();
    setFallbackNotice(null);
    setTestingId(voice.id);

    try {
      const testPhrase = "হেই জান! কেমন আছো তুমি? আমি লুনা, তোমার সাথে গল্প করতে চলে এসেছি!";
      if (voice.isNeural) {
        const audio = await getLunaAudio(testPhrase, voice.id, selectedPersonality);
        if (isStale()) return;
        if (audio) {
          await playPCM(audio, "mp3", speakingRate);
          return;
        }
        setFallbackNotice(
          "এই কণ্ঠটি এখন সার্ভার থেকে আনা যায়নি (নেটওয়ার্ক/কোটা সমস্যা হতে পারে), তাই আপনার ডিভাইসের ভয়েস বাজছে — এটা এই কণ্ঠ নয়।"
        );
      }
      if (isStale()) return;
      await speakLuna(testPhrase, undefined, undefined, speakingRate);
    } catch (e) {
      console.warn("Test voice error:", e);
      if (!isStale()) setFallbackNotice("শব্দ বাজানো যায়নি। ব্রাউজারের সাউন্ড পারমিশন ও ভলিউম দেখুন।");
    } finally {
      if (!isStale()) setTestingId(null);
    }
  };

  const activePersonality =
    PERSONALITIES.find((p) => p.id === selectedPersonality) || PERSONALITIES[3];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div
        className={`w-full max-w-lg border rounded-3xl p-6 sm:p-7 text-white relative animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col ${t.modalBg}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className={`w-9 h-9 rounded-full border flex items-center justify-center ${t.modalHeaderIcon}`}>
              <Sparkles size={18} />
            </div>
            <div>
              <h3 className={`font-serif text-lg font-semibold flex items-center gap-1.5 ${t.modalTitle}`}>
                লুনার ভয়েস, পার্সোনালিটি ও থিম
              </h3>
              <p className="text-xs text-white/60">
                পছন্দের কণ্ঠ, ইমোশনাল টোন, গতি এবং থিম কালার বেছে নিন
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="py-4 space-y-5 overflow-y-auto pr-1">
          {/* Gemini API Key Section */}
          <div>
            <div className={`flex items-center justify-between mb-2.5 text-xs font-semibold uppercase tracking-wider ${t.brandSubtitle}`}>
              <div className="flex items-center gap-1.5">
                <KeyRound size={14} className={t.settingsIcon} />
                <span>Gemini API Key</span>
              </div>
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border normal-case tracking-normal ${
                  hasSavedKey
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                    : "bg-amber-500/20 text-amber-300 border-amber-500/30"
                }`}
              >
                {hasSavedKey ? `যোগ করা আছে (${getApiKeys().length}টি)` : "যোগ করা হয়নি"}
              </span>
            </div>
            <div className="p-3.5 rounded-2xl border bg-white/5 border-white/10 space-y-2.5">
              <div className="flex items-center gap-2">
                <textarea
                  rows={3}
                  value={keyInput}
                  onChange={(e) => {
                    setKeyInput(e.target.value);
                    setKeySaved(false);
                  }}
                  placeholder={"AIza... (প্রতি লাইনে একটা Key)\nএকাধিক Key দিলে একটার লিমিট শেষ হলে লুনা নিজে পরেরটায় যাবে"}
                  autoComplete="off"
                  spellCheck={false}
                  style={showKey ? undefined : ({ WebkitTextSecurity: "disc" } as React.CSSProperties)}
                  className="flex-1 min-w-0 bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-white/30 font-mono resize-none"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="p-2 rounded-full bg-white/10 hover:bg-white/15 text-white/70 transition"
                  title={showKey ? "লুকান" : "দেখান"}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setApiKey(keyInput);
                    setHasSavedKey(Boolean(keyInput.trim()));
                    setKeySaved(true);
                  }}
                  className={`px-4 py-1.5 rounded-full text-white font-medium text-xs shadow-md transition active:scale-95 ${t.primaryGradient}`}
                >
                  {keySaved ? "সেভ হয়েছে ✓" : "সেভ করুন"}
                </button>
                {hasSavedKey && (
                  <button
                    type="button"
                    onClick={() => {
                      clearApiKey();
                      setKeyInput("");
                      setHasSavedKey(false);
                      setKeySaved(false);
                    }}
                    className="px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 hover:bg-white/15 text-white/85 border border-white/10 transition active:scale-95"
                  >
                    মুছুন
                  </button>
                )}
              </div>
              {hasSavedKey && (() => {
                const u = getUsage();
                const n = getApiKeys().length;
                return (
                  <div className="text-[11px] text-white/60 font-mono space-y-0.5">
                    <div className="text-white/40">আজকের ব্যবহার (এই ডিভাইস থেকে, লুনার সার্ভারের হিসাবে)</div>
                    {Array.from({ length: n }, (_, i) => (
                      <div key={i}>
                        Key {i + 1}: {u.ok[i] || 0}টি সফল
                        {(u.quota[i] || 0) > 0 && <span className="text-amber-300"> · {u.quota[i]}বার কোটা শেষ</span>}
                      </div>
                    ))}
                  </div>
                );
              })()}
              <p className="text-[11px] text-white/50 leading-relaxed">
                ফ্রি Key পেতে{" "}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-white/70"
                >
                  aistudio.google.com/apikey
                </a>{" "}
                এ যান। Key শুধু আপনার এই ব্রাউজারে থাকে, সার্ভারে সেভ হয় না।
              </p>
            </div>
          </div>

          {/* ElevenLabs API Key Section (optional) */}
          <div>
            <div className={`flex items-center justify-between mb-2.5 text-xs font-semibold uppercase tracking-wider ${t.brandSubtitle}`}>
              <div className="flex items-center gap-1.5">
                <Volume2 size={14} className={t.settingsIcon} />
                <span>ElevenLabs ভয়েস (ঐচ্ছিক)</span>
              </div>
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border normal-case tracking-normal ${
                  hasElKey
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                    : "bg-white/10 text-white/60 border-white/15"
                }`}
              >
                {hasElKey ? "চালু" : "বন্ধ"}
              </span>
            </div>
            <div className="p-3.5 rounded-2xl border bg-white/5 border-white/10 space-y-2.5">
              <div className="flex items-center gap-2">
                <input
                  type={showElKey ? "text" : "password"}
                  value={elKey}
                  onChange={(e) => {
                    setElKey(e.target.value);
                    setElSaved(false);
                  }}
                  placeholder="ElevenLabs API Key পেস্ট করুন"
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 min-w-0 bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-white/30"
                />
                <button
                  type="button"
                  onClick={() => setShowElKey((v) => !v)}
                  className="p-2 rounded-full bg-white/10 hover:bg-white/15 text-white/70 transition"
                  title={showElKey ? "লুকান" : "দেখান"}
                >
                  {showElKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <input
                type="text"
                value={elVoice}
                onChange={(e) => {
                  setElVoice(e.target.value);
                  setElSaved(false);
                }}
                placeholder="Voice ID (ফ্রি প্ল্যানে নিজের My Voices থেকে দাও)"
                autoComplete="off"
                spellCheck={false}
                className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-white/30"
              />
              <input
                type="text"
                value={elModel}
                onChange={(e) => {
                  setElModel(e.target.value);
                  setElSaved(false);
                }}
                placeholder={`Model (ঐচ্ছিক, ডিফল্ট ${DEFAULT_ELEVEN_MODEL})`}
                autoComplete="off"
                spellCheck={false}
                className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-white/30"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setElevenSettings(elKey, elVoice, elModel);
                    setHasElKey(Boolean(elKey.trim()));
                    setElSaved(true);
                  }}
                  className={`px-4 py-1.5 rounded-full text-white font-medium text-xs shadow-md transition active:scale-95 ${t.primaryGradient}`}
                >
                  {elSaved ? "সেভ হয়েছে ✓" : "সেভ করুন"}
                </button>
                {hasElKey && (
                  <button
                    type="button"
                    onClick={() => {
                      clearElevenSettings();
                      setElKey("");
                      setElVoice("");
                      setElModel("");
                      setHasElKey(false);
                      setElSaved(false);
                    }}
                    className="px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 hover:bg-white/15 text-white/85 border border-white/10 transition active:scale-95"
                  >
                    মুছুন
                  </button>
                )}
              </div>
              <p className="text-[11px] text-white/50 leading-relaxed">
                Key দিলে সব ভয়েসে আগে ElevenLabs ব্যবহার হবে। ব্যর্থ হলে Gemini, তারপর Edge ভয়েসে যাবে।
                বাংলার জন্য Model <span className="font-mono">eleven_v3</span> লাগে। নিজের পছন্দের কণ্ঠ চাইলে ElevenLabs-এ গিয়ে সেই ভয়েসের ID এখানে দাও।
                Key শুধু এই ব্রাউজারে থাকে, সার্ভারে সেভ হয় না।
              </p>
            </div>
          </div>

          {/* UI Theme Section */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <div className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${t.brandSubtitle}`}>
                <Palette size={14} className={t.settingsIcon} />
                <span>App Theme (থিম কালার)</span>
              </div>
              <span className={`text-[11px] font-medium ${t.listenAgainBtn}`}>
                {t.name}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {THEME_OPTIONS.map((themeOpt) => {
                const isSelected = selectedTheme === themeOpt.id;
                return (
                  <button
                    key={themeOpt.id}
                    type="button"
                    onClick={() => onSelectTheme(themeOpt.id)}
                    className={`p-3 rounded-2xl border text-left transition-all flex items-center gap-3 ${
                      isSelected
                        ? t.selectedCard
                        : `bg-white/5 border-white/10 ${t.hoverCard}`
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-xl bg-gradient-to-br ${themeOpt.swatchGradient} shrink-0 shadow-md border border-white/20`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-medium text-xs sm:text-sm text-white truncate">
                          {themeOpt.name}
                        </span>
                        {isSelected && (
                          <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${t.checkActive}`}>
                            <Check size={10} strokeWidth={3} />
                          </span>
                        )}
                      </div>
                      <span className="block text-[10px] text-white/60 mt-0.5 truncate">
                        {themeOpt.bnName}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Personality Section */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <div className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${t.brandSubtitle}`}>
                <Smile size={14} className={t.settingsIcon} />
                <span>Personality (কথা বলার ধরন)</span>
              </div>
              <span className={`text-[11px] font-medium ${t.listenAgainBtn}`}>
                {activePersonality.emoji} {activePersonality.name}
              </span>
            </div>

            <div className="space-y-4">
              {MODE_CATEGORIES.map((cat) => (
                <div key={cat.id}>
                  <div className="flex items-baseline gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-white/90">{cat.title}</span>
                    <span className="text-[10px] text-white/40">{cat.hint}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {PERSONALITIES.filter((p) => p.category === cat.id).map((p) => {
                      const isSelected = selectedPersonality === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => onSelectPersonality(p.id)}
                          className={`p-3 rounded-2xl border text-left transition-all flex items-start gap-2.5 ${
                            isSelected
                              ? t.selectedCard
                              : `bg-white/5 border-white/10 ${t.hoverCard}`
                          }`}
                        >
                          <span className="text-xl select-none leading-none mt-0.5">{p.emoji}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-medium text-xs sm:text-sm text-white truncate">
                                {p.name}
                              </span>
                              {isSelected && (
                                <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${t.checkActive}`}>
                                  <Check size={10} strokeWidth={3} />
                                </span>
                              )}
                            </div>
                            <span className={`block text-[10px] font-mono mt-0.5 ${t.brandSubtitle}`}>
                              {p.subtitle}
                            </span>
                            <p className="text-[11px] text-white/60 mt-1 leading-snug line-clamp-2">
                              {p.description}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Speaking Speed (Rate) Slider Section */}
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${t.brandSubtitle}`}>
                <Gauge size={14} className={t.settingsIcon} />
                <span>Speaking Speed (কথার গতি)</span>
              </div>
              <div className="flex items-center gap-2">
                {speakingRate !== 1.0 && (
                  <button
                    type="button"
                    onClick={() => onChangeSpeakingRate(1.0)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition"
                    title="স্বাভাবিক গতিতে (1.0x) ফিরিয়ে আনুন"
                  >
                    <RotateCcw size={10} />
                    <span>রিসেট</span>
                  </button>
                )}
                <span className={`text-xs font-mono font-semibold px-2.5 py-0.5 rounded-full border ${t.pillTag}`}>
                  {speakingRate.toFixed(2)}x •{" "}
                  {speakingRate < 0.85 ? "ধীর" : speakingRate > 1.15 ? "দ্রুত" : "স্বাভাবিক"}
                </span>
              </div>
            </div>

            <input
              type="range"
              min={0.6}
              max={1.6}
              step={0.05}
              value={speakingRate}
              onChange={(e) => onChangeSpeakingRate(parseFloat(e.target.value))}
              aria-label="Speaking Speed"
              className={`w-full h-2 rounded-lg appearance-none cursor-pointer bg-white/15 ${t.accentSlider}`}
            />

            <div className="flex items-center justify-between text-[10px] font-mono text-white/45 mt-1.5 px-0.5">
              <span>0.6x (ধীর)</span>
              <span>1.0x (স্বাভাবিক)</span>
              <span>1.6x (দ্রুত)</span>
            </div>
          </div>

          {/* Speech-to-Text Recognition Language Toggle */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <div className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${t.brandSubtitle}`}>
                <Languages size={14} className={t.settingsIcon} />
                <span>Speech Recognition (কথা শোনার ভাষা)</span>
              </div>
              <span className={`text-[11px] font-mono font-medium ${t.listenAgainBtn}`}>
                {speechLang}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {SPEECH_LANGUAGE_OPTIONS.map((langOpt) => {
                const isSelected = speechLang === langOpt.id;
                return (
                  <button
                    key={langOpt.id}
                    type="button"
                    onClick={() => onChangeSpeechLang(langOpt.id)}
                    aria-pressed={isSelected}
                    className={`p-3 rounded-2xl border text-left transition-all flex items-start gap-2.5 ${
                      isSelected
                        ? t.selectedCard
                        : `bg-white/5 border-white/10 ${t.hoverCard}`
                    }`}
                  >
                    <span className="text-xl select-none leading-none mt-0.5">{langOpt.flag}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-medium text-xs sm:text-sm text-white truncate">
                          {langOpt.label}
                        </span>
                        {isSelected && (
                          <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${t.checkActive}`}>
                            <Check size={10} strokeWidth={3} />
                          </span>
                        )}
                      </div>
                      <span className={`block text-[10px] font-mono mt-0.5 ${t.brandSubtitle}`}>
                        {langOpt.nativeLabel} • {langOpt.id}
                      </span>
                      <p className="text-[11px] text-white/60 mt-1 leading-snug line-clamp-2">
                        {langOpt.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Voice Selection Section */}
          <div>
            <div className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider mb-2.5 ${t.brandSubtitle}`}>
              <Volume2 size={14} className={t.settingsIcon} />
              <span>Voice (কণ্ঠস্বর)</span>
            </div>

            {fallbackNotice && (
              <p className="mb-2.5 text-[11px] leading-relaxed text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
                {fallbackNotice}
              </p>
            )}

            <div className="space-y-2.5">
              {CUTE_VOICES.map((v) => {
                const isSelected = selectedVoice === v.id;
                const isTesting = testingId === v.id;

                return (
                  <div
                    key={v.id}
                    onClick={() => onSelectVoice(v.id)}
                    className={`w-full p-3.5 sm:p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 text-left ${
                      isSelected
                        ? t.selectedCard
                        : `bg-white/5 border-white/10 ${t.hoverCard}`
                    }`}
                  >
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <span className="text-2xl select-none mt-0.5">{v.avatar}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-white">
                            {v.name}
                          </span>
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${t.pillTag}`}>
                            {v.dialect}
                          </span>
                          {isSelected && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              সক্রিয়
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-white/60 mt-1 line-clamp-2">
                          {v.description}
                        </p>
                      </div>
                    </div>

                    {/* Test button & Checkmark */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTestVoice(v);
                        }}
                        disabled={isTesting}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 transition border ${
                          isTesting
                            ? `${t.checkActive} animate-pulse`
                            : `bg-white/10 hover:bg-white/15 text-white/85 border-white/10 active:scale-95`
                        }`}
                        title="কণ্ঠটি পরীক্ষা করুন"
                      >
                        {isTesting ? (
                          <RefreshCw size={12} className="animate-spin" />
                        ) : (
                          <Volume2 size={12} />
                        )}
                        <span>{isTesting ? "বলছে..." : "শুনুন"}</span>
                      </button>

                      <div
                        className={`w-5 h-5 rounded-full flex items-center justify-center border transition-all ${
                          isSelected
                            ? t.checkActive
                            : "border-white/20 text-transparent"
                        }`}
                      >
                        <Check size={12} strokeWidth={3} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="pt-3 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/50 shrink-0">
          <div className={`flex items-center gap-1.5 ${t.footerHeart}`}>
            <Heart size={13} className={`${t.settingsIcon} fill-current opacity-80`} />
            <span>টোন: {activePersonality.name} • থিম: {t.name}</span>
          </div>
          <button
            onClick={onClose}
            className={`w-full sm:w-auto px-5 py-2 rounded-full text-white font-medium text-xs shadow-md transition active:scale-95 ${t.primaryGradient}`}
          >
            সম্পন্ন (Done)
          </button>
        </div>
      </div>
    </div>
  );
};
