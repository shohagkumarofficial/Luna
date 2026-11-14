import React, { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, Loader2, Volume2, VolumeX, Keyboard, Send, Trash2, Image as ImageIcon, Smartphone, MessageSquare, X, Sparkles, Heart, Flame, Smile, ScrollText, FlaskConical } from "lucide-react";
import { getLunaResponse, getLunaAudio, resetLunaSession } from "./services/geminiService";
import { processCommand } from "./services/commandService";
import { LiveSessionManager } from "./services/liveService";
import Visualizer from "./components/Visualizer";
import PermissionModal from "./components/PermissionModal";
import { APKModal } from "./components/APKModal";
import { VoiceSettingsModal, PersonalityId, PERSONALITIES, SpeechLangCode } from "./components/VoiceSettingsModal";
import { VoiceLogPanel } from "./components/VoiceLogPanel";
import { ModelLabPanel } from "./components/ModelLabPanel";
import { OfflineIndicator } from "./components/OfflineIndicator";
import { StreamingText } from "./components/StreamingText";
import { usePWAInstall } from "./hooks/usePWAInstall";
import { playPCM, unlockAudio, playSessionChime } from "./utils/audioUtils";
import { speakLuna, stopLunaSpeech } from "./utils/speech";
import { getOfflineLunaResponse } from "./utils/offlineFallback";
import { triggerHaptic } from "./utils/haptics";
import { ThemeId, THEMES } from "./utils/theme";
import { motion, AnimatePresence } from "motion/react";

type AppState = "idle" | "listening" | "processing" | "speaking";

interface ChatMessage {
  id: string;
  sender: "user" | "luna";
  text: string;
}

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

const MOOD_BADGES: Record<
  PersonalityId,
  {
    label: string;
    bnLabel: string;
    emoji: string;
    badgeClass: string;
    cardAccent: string;
    Icon: React.ComponentType<{ size?: number; className?: string }>;
  }
> = {
  witty: {
    label: "Witty",
    bnLabel: "রসিক",
    emoji: "😄",
    badgeClass: "bg-cyan-500/15 text-cyan-200 border-cyan-400/45 shadow-[0_0_12px_rgba(34,211,238,0.22)]",
    cardAccent: "ring-1 ring-cyan-400/20",
    Icon: Sparkles,
  },
  empathetic: {
    label: "Empathetic",
    bnLabel: "মায়াবী",
    emoji: "💗",
    badgeClass: "bg-rose-500/15 text-rose-200 border-rose-400/45 shadow-[0_0_12px_rgba(244,63,94,0.22)]",
    cardAccent: "ring-1 ring-rose-400/20",
    Icon: Heart,
  },
  sassy: {
    label: "Sassy",
    bnLabel: "দুষ্টু",
    emoji: "😏",
    badgeClass: "bg-amber-500/15 text-amber-200 border-amber-400/45 shadow-[0_0_12px_rgba(245,158,11,0.22)]",
    cardAccent: "ring-1 ring-amber-400/20",
    Icon: Flame,
  },
  sweet: {
    label: "Sweet",
    bnLabel: "মিষ্টি",
    emoji: "🌸",
    badgeClass: "bg-fuchsia-500/15 text-fuchsia-200 border-fuchsia-400/45 shadow-[0_0_12px_rgba(232,121,249,0.22)]",
    cardAccent: "ring-1 ring-fuchsia-400/20",
    Icon: Smile,
  },
};

export default function App() {
  const [appState, setAppState] = useState<AppState>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem("luna_chat_history");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse chat history", e);
      }
    }
    return [];
  });
  const messagesRef = useRef(messages);

  useEffect(() => {
    messagesRef.current = messages;
    localStorage.setItem("luna_chat_history", JSON.stringify(messages));
  }, [messages]);

  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(isMuted);

  useEffect(() => {
    isMutedRef.current = isMuted;
    if (isMuted) {
      stopLunaSpeech();
    }
    if (liveSessionRef.current) {
      liveSessionRef.current.isMuted = isMuted;
    }
  }, [isMuted]);

  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [showAPKModal, setShowAPKModal] = useState(false);
  const [showChatDrawer, setShowChatDrawer] = useState(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [showLogPanel, setShowLogPanel] = useState(false);
  const [showModelLab, setShowModelLab] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<string>(() => {
    return localStorage.getItem("luna_voice_choice") || "maya-leda";
  });
  const selectedVoiceRef = useRef(selectedVoice);

  const [selectedPersonality, setSelectedPersonality] = useState<PersonalityId>(() => {
    const saved = localStorage.getItem("luna_personality_choice");
    if (saved === "witty" || saved === "empathetic" || saved === "sassy" || saved === "sweet") {
      return saved;
    }
    return "sweet";
  });
  const selectedPersonalityRef = useRef<PersonalityId>(selectedPersonality);

  const [speakingRate, setSpeakingRate] = useState<number>(() => {
    const saved = parseFloat(localStorage.getItem("luna_speaking_rate") || "");
    if (!Number.isNaN(saved) && saved >= 0.5 && saved <= 2.0) {
      return saved;
    }
    return 1.0;
  });
  const speakingRateRef = useRef<number>(speakingRate);

  const [speechLang, setSpeechLang] = useState<SpeechLangCode>(() => {
    const saved = localStorage.getItem("luna_speech_lang");
    return saved === "en-US" ? "en-US" : "bn-BD";
  });
  const speechLangRef = useRef<SpeechLangCode>(speechLang);

  const [selectedTheme, setSelectedTheme] = useState<ThemeId>(() => {
    const saved = localStorage.getItem("luna_ui_theme");
    return saved === "soft-sunset" ? "soft-sunset" : "neon-violet";
  });
  const t = THEMES[selectedTheme];
  const activeMood = MOOD_BADGES[selectedPersonality] || MOOD_BADGES.sweet;

  const handleSelectVoice = (voiceId: string) => {
    setSelectedVoice(voiceId);
    selectedVoiceRef.current = voiceId;
    localStorage.setItem("luna_voice_choice", voiceId);
  };

  const handleSelectPersonality = (personality: PersonalityId) => {
    setSelectedPersonality(personality);
    selectedPersonalityRef.current = personality;
    localStorage.setItem("luna_personality_choice", personality);
    liveSessionRef.current?.setPersonality(personality);
  };

  const handleChangeSpeakingRate = (rate: number) => {
    const clamped = Math.min(2.0, Math.max(0.5, Number(rate.toFixed(2))));
    setSpeakingRate(clamped);
    speakingRateRef.current = clamped;
    localStorage.setItem("luna_speaking_rate", String(clamped));
  };

  const handleChangeSpeechLang = (lang: SpeechLangCode) => {
    setSpeechLang(lang);
    speechLangRef.current = lang;
    localStorage.setItem("luna_speech_lang", lang);
    liveSessionRef.current?.setRecognitionLang(lang);
  };

  const handleSelectTheme = (theme: ThemeId) => {
    setSelectedTheme(theme);
    localStorage.setItem("luna_ui_theme", theme);
  };

  const [isSessionActive, setIsSessionActive] = useState(false);
  const [wakeWordActive, setWakeWordActive] = useState(false);
  const wakeWordTimeoutRef = useRef<number | null>(null);

  const triggerWakeWordIndicator = useCallback(() => {
    triggerHaptic("wake");
    setWakeWordActive(true);
    if (wakeWordTimeoutRef.current) {
      window.clearTimeout(wakeWordTimeoutRef.current);
    }
    wakeWordTimeoutRef.current = window.setTimeout(() => {
      setWakeWordActive(false);
      wakeWordTimeoutRef.current = null;
    }, 3000);
  }, []);

  const prevAppStateRef = useRef<AppState>("idle");
  useEffect(() => {
    if (prevAppStateRef.current !== "listening" && appState === "listening") {
      triggerHaptic("listening");
    }
    prevAppStateRef.current = appState;
  }, [appState]);

  const { isInstallable, isInstalled, isAndroid, isIOS, install } = usePWAInstall();

  const liveSessionRef = useRef<LiveSessionManager | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Derive last messages for live subtitle display
  const latestLunaMessage = [...messages].reverse().find((m) => m.sender === "luna");
  const lastUserMessage = [...messages].reverse().find((m) => m.sender === "user");
  const initialLunaIdRef = useRef<string | undefined>(latestLunaMessage?.id);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, appState]);

  // Reliable speech and audio playback with sweet, cute female voice
  // Each call gets a run id. If a newer reply (or a stop/mute) supersedes it, the older call
  // must not start playing late audio on top of the new one — that is what made the wrong
  // voice play after switching voices quickly.
  const voiceRunRef = useRef(0);

  const playLunaVoice = useCallback(async (text: string) => {
    if (isMutedRef.current) return;
    const runId = ++voiceRunRef.current;
    const isStale = () => voiceRunRef.current !== runId;

    setAppState("speaking");
    liveSessionRef.current?.pauseRecognition();

    const finishRun = () => {
      if (isStale()) return;
      setAppState(liveSessionRef.current ? "listening" : "idle");
      liveSessionRef.current?.resumeRecognition();
    };

    const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
    try {
      if (!isOffline && selectedVoiceRef.current !== "device-cute") {
        const audioBase64 = await getLunaAudio(
          text,
          selectedVoiceRef.current,
          selectedPersonalityRef.current
        );
        if (isStale()) return;
        if (isMutedRef.current) {
          finishRun();
          return;
        }
        if (audioBase64) {
          await playPCM(audioBase64, "mp3", speakingRateRef.current);
          finishRun();
          return;
        }
      }
    } catch (e) {
      console.warn("Server audio notice:", e);
    }

    if (isStale()) return;
    if (isMutedRef.current) {
      finishRun();
      return;
    }

    // Device Web Speech fallback so Luna still speaks out loud when cloud voice is unavailable
    await speakLuna(
      text,
      () => {
        if (!isStale()) setAppState("speaking");
      },
      finishRun,
      speakingRateRef.current
    );
  }, []);

  const handleTextCommand = useCallback(async (finalTranscript: string, imageBase64?: string) => {
    if (!finalTranscript.trim() && !imageBase64) {
      setAppState("idle");
      return;
    }

    const userMessage = finalTranscript || (imageBase64 ? "Look at this image" : "");
    setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "user", text: userMessage }]);
    
    // If live session is active, send text through it
    if (isSessionActive && liveSessionRef.current) {
      if (imageBase64) {
        liveSessionRef.current.sendImage(imageBase64, finalTranscript);
      } else {
        liveSessionRef.current.sendText(finalTranscript);
      }
      return;
    }

    setAppState("processing");

    // 1. Check for browser commands (only if no image)
    const commandResult = !imageBase64 ? processCommand(finalTranscript) : { isBrowserAction: false };

    let responseText = "";

    if (commandResult.isBrowserAction && 'action' in commandResult) {
      responseText = commandResult.action;
      setMessages((prev) => [...prev, { id: Date.now().toString() + "-z", sender: "luna", text: responseText }]);
      
      await playLunaVoice(responseText);

      setTimeout(() => {
        if ('url' in commandResult && commandResult.url) {
          window.open(commandResult.url, "_blank");
        }
      }, 1500);
    } else {
      // 2. General Chit-Chat via Gemini
      responseText = await getLunaResponse(
        finalTranscript || "What do you see?",
        messagesRef.current,
        imageBase64,
        selectedPersonalityRef.current
      );
      setMessages((prev) => [...prev, { id: Date.now().toString() + "-z", sender: "luna", text: responseText }]);
      
      await playLunaVoice(responseText);
    }
  }, [isSessionActive, playLunaVoice]);

  useEffect(() => {
    return () => {
      if (wakeWordTimeoutRef.current) {
        window.clearTimeout(wakeWordTimeoutRef.current);
      }
      if (liveSessionRef.current) {
        liveSessionRef.current.stop();
      }
      stopLunaSpeech();
    };
  }, []);

  const toggleListening = async () => {
    unlockAudio();
    if (isSessionActive) {
      setIsSessionActive(false);
      setWakeWordActive(false);
      if (wakeWordTimeoutRef.current) {
        window.clearTimeout(wakeWordTimeoutRef.current);
        wakeWordTimeoutRef.current = null;
      }
      voiceRunRef.current++; // cancel any reply still being fetched for playback
      stopLunaSpeech();
      if (liveSessionRef.current) {
        liveSessionRef.current.stop();
        liveSessionRef.current = null;
      }
      if (!isMutedRef.current) {
        playSessionChime("stop");
      }
      triggerHaptic("sessionOff");
      setAppState("idle");
      resetLunaSession();
    } else {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        triggerHaptic("sessionOn");
        const offlineGreeting = getOfflineLunaResponse("__offline_session__", selectedPersonalityRef.current);
        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString() + "-offline", sender: "luna", text: offlineGreeting },
        ]);
        setShowTextInput(true);
        if (!isMutedRef.current) {
          playSessionChime("start");
          await playLunaVoice(offlineGreeting);
        }
        return;
      }

      try {
        triggerHaptic("sessionOn");
        setIsSessionActive(true);
        resetLunaSession();
        
        const session = new LiveSessionManager();
        session.isMuted = isMuted;
        session.personality = selectedPersonalityRef.current;
        session.recognitionLang = speechLangRef.current;
        liveSessionRef.current = session;
        
        session.onStateChange = (state) => {
          setAppState(state);
        };

        session.onWakeWordDetected = () => {
          triggerWakeWordIndicator();
        };
        
        session.onMessage = (sender, text) => {
          setMessages((prev) => [...prev, { id: Date.now().toString() + "-" + sender, sender, text }]);
          if (sender === "luna") {
            playLunaVoice(text);
          }
        };
        
        session.onCommand = (url) => {
          setTimeout(() => {
            window.open(url, "_blank");
          }, 1000);
        };

        session.onError = (errorMessage) => {
          console.warn("Live session error notification:", errorMessage);
          setIsSessionActive(false);
          setAppState("idle");
          if (!isMutedRef.current) {
            playSessionChime("stop");
          }
          triggerHaptic("sessionOff");
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString() + "-err",
              sender: "luna",
              text: "লাইভ অডিও সংযোগে সমস্যা হয়েছে। আপনি নিচে টেক্সট লিখে কথা বলতে পারেন!",
            },
          ]);
          setShowTextInput(true);
        };

        await session.start();
        if (!isMutedRef.current) {
          playSessionChime("start");
        }
      } catch (e: any) {
        const isPermission =
          e?.name === "NotAllowedError" ||
          e?.name === "PermissionDeniedError" ||
          (typeof e?.message === "string" && /permission/i.test(e.message));

        if (isPermission) {
          console.warn("Microphone permission was denied or blocked by the browser.");
          setShowPermissionModal(true);
        } else {
          console.warn("Failed to start session:", e?.message || e);
        }
        setIsSessionActive(false);
        setAppState("idle");
      }
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    unlockAudio();
    if (!textInput.trim() && !selectedImage) return;
    
    handleTextCommand(textInput, selectedImage || undefined);
    setTextInput("");
    setSelectedImage(null);
    setShowTextInput(false);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setSelectedImage(base64.split(',')[1]);
        setShowTextInput(true);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className={`h-[100dvh] w-screen ${t.bgCanvas} text-white flex flex-col items-center justify-between font-sans relative overflow-hidden m-0 p-0 transition-colors duration-500`}>
      <OfflineIndicator />

      {showPermissionModal && (
        <PermissionModal 
          onClose={() => setShowPermissionModal(false)}
          onRetry={() => {
            setShowPermissionModal(false);
            toggleListening();
          }}
          onSwitchToText={() => {
            setShowPermissionModal(false);
            setShowTextInput(true);
          }}
          theme={selectedTheme}
        />
      )}

      <APKModal
        isOpen={showAPKModal}
        onClose={() => setShowAPKModal(false)}
        isInstallable={isInstallable}
        isInstalled={isInstalled}
        isAndroid={isAndroid}
        isIOS={isIOS}
        onInstall={install}
        theme={selectedTheme}
      />

      <VoiceLogPanel isOpen={showLogPanel} onClose={() => setShowLogPanel(false)} />
      <ModelLabPanel isOpen={showModelLab} onClose={() => setShowModelLab(false)} />

      <VoiceSettingsModal
        isOpen={showVoiceModal}
        onClose={() => setShowVoiceModal(false)}
        selectedVoice={selectedVoice}
        onSelectVoice={handleSelectVoice}
        selectedPersonality={selectedPersonality}
        onSelectPersonality={handleSelectPersonality}
        speakingRate={speakingRate}
        onChangeSpeakingRate={handleChangeSpeakingRate}
        speechLang={speechLang}
        onChangeSpeechLang={handleChangeSpeechLang}
        selectedTheme={selectedTheme}
        onSelectTheme={handleSelectTheme}
      />

      {/* Cinematic Background Gradients (GPU-light radial gradients without Gaussian blur filters) */}
      <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none">
        <div className={`absolute inset-0 ${t.blobTop} transition-colors duration-700`} />
        <div className={`absolute inset-0 ${t.blobBottom} transition-colors duration-700`} />
      </div>

      {/* Header */}
      <header className="absolute top-0 left-0 w-full flex justify-between items-center z-30 shrink-0 px-4 sm:px-6 py-4 md:px-12 md:py-6">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${t.brandAvatar}`}>
            L
          </div>
          <div>
            <h1 className="text-xl font-serif font-medium tracking-wide opacity-90 leading-tight">Luna</h1>
            <span className={`text-[10px] font-mono hidden sm:inline-block ${t.brandSubtitle}`}>AI Voice Assistant</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Model Lab button: test and pick models */}
          <button
            onClick={() => setShowModelLab(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all border shadow-lg active:scale-95 ${t.settingsBtn}`}
            title="মডেল ল্যাব: মডেল টেস্ট করে বেছে নিন"
          >
            <FlaskConical size={14} className={t.settingsIcon} />
            <span className="hidden sm:inline">মডেল</span>
          </button>
          {/* Diagnostic log button */}
          <button
            onClick={() => setShowLogPanel(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all border shadow-lg active:scale-95 ${t.settingsBtn}`}
            title="লগ দেখুন (কোন ইঞ্জিনে ভয়েস তৈরি হচ্ছে)"
          >
            <ScrollText size={14} className={t.settingsIcon} />
            <span className="hidden sm:inline">লগ</span>
          </button>
          {/* Cute Voice & Personality Settings Button */}
          <button
            onClick={() => setShowVoiceModal(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all border shadow-lg active:scale-95 ${t.settingsBtn}`}
            title="লুনার ভয়েস, পার্সোনালিটি ও থিম পরিবর্তন করুন"
          >
            <Sparkles size={14} className={t.settingsIcon} />
            <span className="hidden sm:inline">
              {selectedVoice.includes("leda")
                ? "লুনা (Leda)"
                : selectedVoice.includes("zephyr")
                  ? "লুনা (Zephyr)"
                  : selectedVoice.includes("maya")
                    ? "মায়া"
                    : selectedVoice.includes("Nabanita")
                      ? "নবানিতা"
                      : selectedVoice.includes("Tanishaa")
                        ? "তানিশা"
                        : "ভয়েস"} • {(PERSONALITIES.find((p) => p.id === selectedPersonality) || PERSONALITIES[3]).emoji} {(PERSONALITIES.find((p) => p.id === selectedPersonality)?.id || "sweet").replace(/^\w/, (c) => c.toUpperCase())}
            </span>
            <span className="sm:hidden">লুনা {(PERSONALITIES.find((p) => p.id === selectedPersonality) || PERSONALITIES[3]).emoji}</span>
          </button>

          {/* APK / Mobile App Install Button */}
          <button
            onClick={() => setShowAPKModal(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all border shadow-lg ${
              isInstalled
                ? "bg-white/5 hover:bg-white/10 text-emerald-400 border-emerald-500/30"
                : `${t.primaryGradient} text-white ${t.primaryBorder} active:scale-95`
            }`}
            title="Install APK / Android App"
          >
            <Smartphone size={14} className={isInstalled ? "text-emerald-400" : "text-white/90"} />
            <span className="hidden sm:inline">{isInstalled ? "APK Installed" : "Install APK"}</span>
            <span className="sm:hidden">{isInstalled ? "Installed" : "APK"}</span>
          </button>

          {/* Chat History Drawer Toggle Button */}
          <button
            onClick={() => setShowChatDrawer(true)}
            className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/80 hover:text-white transition-colors border border-white/10 relative"
            title="কথোপকথন হিস্টোরি (Chat History)"
          >
            <MessageSquare size={18} />
            {messages.length > 0 && (
              <span className={`absolute -top-1 -right-1 ${t.badgeBg} text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center shadow`}>
                {messages.length}
              </span>
            )}
          </button>

          {messages.length > 0 && (
            <button
              onClick={() => {
                if (confirm("Are you sure you want to clear the chat history?")) {
                  setMessages([]);
                  resetLunaSession();
                }
              }}
              className="p-2 rounded-full bg-white/5 hover:bg-red-500/20 hover:text-red-400 transition-colors border border-white/10"
              title="Clear Chat History"
            >
              <Trash2 size={18} className="opacity-70" />
            </button>
          )}

          <button
            onClick={() => setIsMuted(!isMuted)}
            className={`p-2 rounded-full transition-colors border ${
              isMuted ? "bg-red-500/20 text-red-400 border-red-500/40" : "bg-white/5 hover:bg-white/10 text-white border-white/10"
            }`}
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? (
              <VolumeX size={18} />
            ) : (
              <Volume2 size={18} />
            )}
          </button>
        </div>
      </header>

      {/* Main Content - Visualizer */}
      <main className="absolute inset-0 flex flex-row items-center justify-between w-full h-full z-10 overflow-hidden pt-20 pb-24 px-4 md:px-12 pointer-events-none">
        
        {/* Left Column: Luna Status */}
        <div className="flex w-[30%] lg:w-[25%] h-full flex-col justify-center gap-4 z-10">
          <div className="h-6">
            <AnimatePresence>
              {appState === "processing" && (
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex items-center gap-2 text-cyan-300/80 text-sm md:text-base italic font-serif"
                >
                  <Loader2 size={16} className="animate-spin" />
                  Replying...
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Center Visualizer (Fixed Full Screen Background) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
          <Visualizer state={appState} theme={selectedTheme} wakeWordActive={wakeWordActive} />
        </div>

        {/* Subtle Wake Word Indicator (Pulses when 'Luna' is detected during a live session) */}
        <div className="absolute top-20 md:top-24 left-0 w-full flex justify-center pointer-events-none z-20 px-4">
          <AnimatePresence>
            {isSessionActive && wakeWordActive && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.92 }}
                animate={{ opacity: 1, y: 0, scale: [1, 1.03, 1] }}
                exit={{ opacity: 0, y: -8, scale: 0.94 }}
                transition={{ duration: 0.35 }}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-medium shadow-lg bg-black/75 ${t.settingsBtn}`}
              >
                <span className="relative flex h-2.5 w-2.5">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${t.dialogueDot}`} />
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${t.dialogueDot}`} />
                </span>
                <span>Wake Word Detected: Luna • শুনছি...</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Column: User Status */}
        <div className="flex w-[30%] lg:w-[25%] h-full flex-col justify-center gap-4 z-10">
          <div className="h-6 flex justify-end">
            <AnimatePresence>
              {appState === "listening" && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className={`flex items-center gap-2 text-sm md:text-base italic ${t.brandSubtitle}`}
                >
                  <div className={`w-2 h-2 rounded-full animate-pulse ${t.dialogueDot}`} />
                  Listening...
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Live Dialogue & Subtitle Card (Visible response overlay so user sees & reads Luna's answers) */}
      <div className="absolute bottom-24 md:bottom-28 left-0 w-full flex flex-col items-center justify-center px-4 pointer-events-none z-20">
        <AnimatePresence mode="wait">
          {appState === "processing" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`pointer-events-auto px-4 py-2 rounded-full border text-xs sm:text-sm flex items-center gap-2 shadow-lg ${t.thinkingPill}`}
            >
              <Loader2 size={14} className={`animate-spin ${t.thinkingSpinner}`} />
              <span>চিন্তা করছি সোহাগ... (Thinking...)</span>
            </motion.div>
          )}

          {appState !== "processing" && latestLunaMessage && (
            <motion.div
              key={latestLunaMessage.id}
              initial={{ opacity: 0, y: 15, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.96 }}
              className={`pointer-events-auto max-w-xl w-full border rounded-2xl p-4 sm:p-5 flex flex-col gap-2.5 ${t.dialogueCard} ${activeMood.cardAccent}`}
            >
              {lastUserMessage && (
                <div className="text-xs text-white/50 border-b border-white/10 pb-2 flex items-center justify-between">
                  <span className="truncate">সোহাগ: "{lastUserMessage.text}"</span>
                </div>
              )}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center flex-wrap gap-2 mb-1.5">
                    <div className={`flex items-center gap-1.5 text-xs font-semibold ${t.dialogueLabel}`}>
                      <span className={`w-2 h-2 rounded-full ${t.dialogueDot} ${appState === "speaking" ? "animate-ping" : ""}`} />
                      <span>Luna (লুনা)</span>
                    </div>

                    {/* Dynamic Mood Badge reflecting active Personality */}
                    <motion.button
                      key={selectedPersonality}
                      type="button"
                      initial={{ opacity: 0, scale: 0.88 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.2 }}
                      onClick={() => setShowVoiceModal(true)}
                      title="লুনার মুড / পার্সোনালিটি পরিবর্তন করুন"
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold tracking-wide transition hover:brightness-110 active:scale-95 ${activeMood.badgeClass}`}
                    >
                      <activeMood.Icon size={10} />
                      <span>{activeMood.emoji}</span>
                      <span>{activeMood.label} • {activeMood.bnLabel}</span>
                    </motion.button>
                  </div>
                  <p className="text-sm md:text-base text-white/95 leading-relaxed font-sans min-h-[1.5rem]">
                    <StreamingText
                      text={latestLunaMessage.text}
                      messageId={latestLunaMessage.id}
                      animateOnMount={latestLunaMessage.id !== initialLunaIdRef.current}
                      cursorColorClass={t.dialogueDot}
                    />
                  </p>
                </div>
                <button
                  onClick={() => playLunaVoice(latestLunaMessage.text)}
                  className={`p-2 rounded-full bg-white/5 hover:bg-white/15 transition shrink-0 border border-white/10 ${t.listenAgainBtn}`}
                  title="আবার শুনুন (Listen again)"
                >
                  <Volume2 size={16} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Chat History Slide-Over Drawer */}
      <AnimatePresence>
        {showChatDrawer && (
          <div className="fixed inset-0 z-50 flex justify-end bg-black/75">
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className={`w-full max-w-md h-full border-l border-white/10 shadow-2xl flex flex-col ${t.drawerBg}`}
            >
              {/* Drawer Header */}
              <div className="flex items-center justify-between p-4 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <MessageSquare size={18} className={t.drawerAccentIcon} />
                  <h3 className="font-semibold text-sm">কথোপকথন হিস্টোরি (Chat History)</h3>
                </div>
                <button
                  onClick={() => setShowChatDrawer(false)}
                  className="p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Messages List */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center text-white/40 text-xs">
                    <p>এখনো কোনো বার্তা নেই।</p>
                    <p className="mt-1">"Start Session" চাপুন বা নিচে লিখে কথা বলুন!</p>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
                    >
                      <div className="text-[10px] text-white/40 mb-1 px-1">
                        {msg.sender === "user" ? "সোহাগ (Shohag)" : "Luna (লুনা)"}
                      </div>
                      <div
                        className={`p-3 rounded-2xl max-w-[85%] text-xs sm:text-sm leading-relaxed ${
                          msg.sender === "user"
                            ? `${t.userBubble} rounded-tr-none`
                            : "bg-white/10 text-white/95 rounded-tl-none border border-white/10"
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Drawer Footer */}
              <div className="p-4 border-t border-white/10 flex items-center justify-between gap-2">
                <button
                  onClick={() => {
                    if (confirm("সব বার্তা মুছে ফেলতে চান?")) {
                      setMessages([]);
                      resetLunaSession();
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs border border-red-500/20 transition flex items-center gap-1.5"
                >
                  <Trash2 size={14} />
                  <span>মুছে ফেলুন</span>
                </button>
                <button
                  onClick={() => setShowChatDrawer(false)}
                  className="px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium transition"
                >
                  বন্ধ করুন
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Controls Footer */}
      <footer className="absolute bottom-0 left-0 w-full flex flex-col items-center justify-center pb-5 md:pb-7 z-30 shrink-0 gap-3">
        <AnimatePresence>
          {showTextInput && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="w-full max-w-md px-4 flex flex-col gap-2"
            >
              {selectedImage && (
                <div className="relative w-20 h-20 ml-4 mb-2 rounded-lg overflow-hidden border border-white/20">
                  <img src={`data:image/jpeg;base64,${selectedImage}`} className="w-full h-full object-cover" />
                  <button 
                    onClick={() => setSelectedImage(null)}
                    className="absolute top-1 right-1 bg-black/50 rounded-full p-1 hover:bg-black/80"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
              <form 
                onSubmit={handleTextSubmit}
                className={`flex items-center gap-2 border rounded-full p-1 pl-4 shadow-2xl ${t.inputBar}`}
              >
                <input 
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder={selectedImage ? "ছবির বর্ণনা দিন..." : "লুনাকে কিছু বলুন (বাংলা বা ইংরেজিতে)..."}
                  className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/40 text-xs sm:text-sm"
                  autoFocus
                />
                <label className="p-2 rounded-full hover:bg-white/10 cursor-pointer transition-colors">
                  <ImageIcon size={18} className={`opacity-70 ${t.inputIcon}`} />
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                </label>
                <button 
                  type="submit"
                  disabled={!textInput.trim() && !selectedImage}
                  className={`p-2 rounded-full disabled:opacity-40 transition-colors shadow-md ${t.primaryGradient}`}
                >
                  <Send size={16} />
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-4">
          <button
            onClick={toggleListening}
            className={`
              group relative flex items-center gap-3 px-8 py-3.5 sm:py-4 rounded-full font-medium tracking-wide transition-all duration-300 shadow-2xl active:scale-95
              ${
                isSessionActive
                  ? "bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30"
                  : "bg-white/10 text-white border border-white/20 hover:bg-white/20 hover:scale-105"
              }
            `}
          >
            {isSessionActive ? (
              <>
                <MicOff size={20} />
                <span>End Session</span>
              </>
            ) : (
              <>
                <Mic size={20} className={`group-hover:animate-bounce ${t.listenAgainBtn}`} />
                <span>Start Session</span>
              </>
            )}
          </button>
          
          <button
            onClick={() => setShowTextInput(!showTextInput)}
            className={`p-3.5 sm:p-4 rounded-full transition-all border shadow-2xl ${
              showTextInput
                ? t.keyboardActive
                : "bg-white/5 border-white/10 hover:bg-white/10 text-white/80 hover:text-white"
            }`}
            title="Type a message"
          >
            <Keyboard size={20} />
          </button>
        </div>
      </footer>
    </div>
  );
}
