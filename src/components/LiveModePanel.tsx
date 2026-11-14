import React, { useEffect, useRef, useState } from "react";
import { X, Mic, MicOff, Radio } from "lucide-react";
import { getApiKey } from "../utils/apiKey";
import { getModelPref } from "../utils/modelPrefs";
import { addLog } from "../utils/voiceLog";
import { GeminiLiveClient, LiveState } from "../services/geminiLive";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onOpenLab: () => void;
}

const DEFAULT_LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-09-2025";
const VOICE_KEY = "luna_live_voice";
const VOICES = ["Leda", "Kore", "Aoede", "Zephyr", "Puck", "Achernar", "Laomedeia", "Callirrhoe"];

const STATE_LABEL: Record<LiveState, string> = {
  connecting: "সংযোগ হচ্ছে...",
  listening: "শুনছি... বলো",
  speaking: "লুনা বলছে (মাঝে কথা বললে থেমে যাবে)",
  closed: "বন্ধ",
};

export const LiveModePanel: React.FC<Props> = ({ isOpen, onClose, onOpenLab }) => {
  const [state, setState] = useState<LiveState>("closed");
  const [error, setError] = useState("");
  const [turns, setTurns] = useState<{ user: string; luna: string }[]>([]);
  const [voice, setVoice] = useState(() => {
    try { return localStorage.getItem(VOICE_KEY) || "Leda"; } catch { return "Leda"; }
  });
  const clientRef = useRef<GeminiLiveClient | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const model = getModelPref("live") || DEFAULT_LIVE_MODEL;
  const running = state !== "closed";

  const stop = () => {
    clientRef.current?.stop();
    clientRef.current = null;
  };

  const start = async () => {
    const key = getApiKey();
    if (!key) {
      setError("আগে সেটিংস থেকে Gemini API Key যোগ করো।");
      return;
    }
    setError("");
    setTurns([{ user: "", luna: "" }]);
    const t0 = performance.now();
    let first = true;
    const client = new GeminiLiveClient(key, model, voice, {
      onState: (s) => {
        setState(s);
        if (s === "listening" && first) {
          first = false;
          addLog("ok", `Live চালু: ${model} · ${Math.round(performance.now() - t0)}ms`, [`ভয়েস: ${voice}`]);
        }
      },
      onUserText: (t) => setTurns((a) => { const c = a.slice(); c[c.length - 1] = { ...c[c.length - 1], user: t }; return c; }),
      onLunaText: (t) => setTurns((a) => { const c = a.slice(); c[c.length - 1] = { ...c[c.length - 1], luna: t }; return c; }),
      onTurnEnd: () => setTurns((a) => [...a, { user: "", luna: "" }]),
      onError: (msg) => {
        setError(msg);
        addLog("error", "Live ব্যর্থ", [model, msg]);
      },
    });
    clientRef.current = client;
    await client.start();
  };

  useEffect(() => {
    if (!isOpen) stop();
    return () => stop();
  }, [isOpen]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  if (!isOpen) return null;

  const close = () => {
    stop();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/80" onClick={close}>
      <div
        className="w-full sm:max-w-lg h-[88vh] sm:h-[80vh] flex flex-col rounded-t-3xl sm:rounded-3xl border border-white/10 bg-[#0b0b0f] text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Radio size={16} className="text-pink-300" />
            <div>
              <h2 className="text-sm font-semibold">লাইভ কথোপকথন</h2>
              <p className="text-[11px] text-white/50 font-mono break-all">{model}</p>
            </div>
          </div>
          <button type="button" onClick={close} className="p-2 rounded-full bg-white/10 border border-white/10 active:scale-95" title="বন্ধ করুন">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {turns.length === 0 && !error && (
            <p className="text-center text-xs text-white/50 py-8">
              নিচের বোতামে চাপ দিয়ে শুরু করো। এরপর হাত না লাগিয়েই সরাসরি কথা বলতে পারবে, লুনা কথা শেষ হতেই উত্তর দেবে।
              <br />
              ইয়ারফোন ব্যবহার করলে প্রতিধ্বনি কম হয়।
            </p>
          )}
          {turns.map((t, i) =>
            t.user || t.luna ? (
              <div key={i} className="space-y-1.5">
                {t.user && <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-violet-500/25 px-3 py-2 text-sm">{t.user}</div>}
                {t.luna && <div className="mr-auto max-w-[85%] rounded-2xl rounded-bl-sm bg-white/10 px-3 py-2 text-sm">{t.luna}</div>}
              </div>
            ) : null
          )}
          <div ref={endRef} />
        </div>

        {error && (
          <div className="mx-4 mb-2 rounded-2xl border border-red-500/30 bg-red-500/10 text-red-200 text-xs p-3 break-words">
            {error}
            <button type="button" onClick={() => { close(); onOpenLab(); }} className="block mt-2 underline text-red-100">
              মডেল ল্যাবে Live মডেল টেস্ট করো
            </button>
          </div>
        )}

        <div className="p-4 border-t border-white/10 space-y-3">
          <div className="text-center text-xs text-white/60">{STATE_LABEL[state]}</div>
          <div className="flex items-center justify-center gap-3">
            {!running && (
              <select
                value={voice}
                onChange={(e) => {
                  setVoice(e.target.value);
                  try { localStorage.setItem(VOICE_KEY, e.target.value); } catch {}
                }}
                className="bg-black/30 border border-white/10 rounded-full px-3 py-2 text-xs text-white outline-none"
                title="লুনার ভয়েস"
              >
                {VOICES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            )}
            <button
              type="button"
              onClick={running ? stop : start}
              className={`flex items-center gap-2 px-6 py-3 rounded-full text-sm font-medium border active:scale-95 transition ${
                running ? "bg-red-500/25 border-red-400/40 text-red-100" : "bg-pink-500/25 border-pink-400/40 text-pink-100"
              }`}
            >
              {running ? <><MicOff size={16} /> শেষ করো</> : <><Mic size={16} /> কথা শুরু করো</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
