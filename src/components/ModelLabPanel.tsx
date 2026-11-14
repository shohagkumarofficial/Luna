import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, RefreshCw, Play, Check, FlaskConical, Square } from "lucide-react";
import { getApiKey } from "../utils/apiKey";
import { getModelPref, setModelPref } from "../utils/modelPrefs";
import { addLog } from "../utils/voiceLog";
import {
  LAB_VOICES, LabModel, LabResult, LiveMethod, ModelKindLab,
  listModels, testLive, testText, testTTS,
} from "../utils/modelLab";

interface ModelLabPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type RowState = { status: "running" | "ok" | "warn" | "fail"; ms?: number; message?: string };

const TABS: { id: ModelKindLab; label: string; hint: string }[] = [
  { id: "text", label: "💬 উত্তর", hint: "লুনা কোন মডেল দিয়ে উত্তর লিখবে" },
  { id: "tts", label: "🔊 কণ্ঠ (TTS)", hint: "উত্তরের লেখা কোন মডেল কণ্ঠে বদলাবে" },
  { id: "live", label: "🎙 Live", hint: "সরাসরি কথোপকথনের মডেল (টেস্ট ও বাছাই করে রাখা যায়, Live মোড পরে যোগ হবে)" },
];

const PILL: Record<RowState["status"], string> = {
  running: "bg-white/10 text-white/70 border-white/15",
  ok: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  warn: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  fail: "bg-red-500/20 text-red-300 border-red-500/30",
};
const PILL_LABEL: Record<RowState["status"], string> = { running: "চলছে...", ok: "✅ চলছে", warn: "⚠️ সতর্ক", fail: "❌ ব্যর্থ" };

export const ModelLabPanel: React.FC<ModelLabPanelProps> = ({ isOpen, onClose }) => {
  const [tab, setTab] = useState<ModelKindLab>("text");
  const [models, setModels] = useState<LabModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [results, setResults] = useState<Record<string, RowState>>({});
  const [voice, setVoice] = useState("Kore");
  const [method, setMethod] = useState<LiveMethod>("clientContent");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState({ text: getModelPref("text"), tts: getModelPref("tts"), live: getModelPref("live") });
  const [batchRunning, setBatchRunning] = useState(false);
  const stopRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hasKey = Boolean(getApiKey());

  useEffect(() => {
    if (isOpen) setSelected({ text: getModelPref("text"), tts: getModelPref("tts"), live: getModelPref("live") });
  }, [isOpen]);

  const visible = useMemo(
    () => models.filter((m) => m.kind === tab && m.id.toLowerCase().includes(filter.trim().toLowerCase())),
    [models, tab, filter]
  );

  if (!isOpen) return null;

  const fetchModels = async () => {
    const key = getApiKey();
    if (!key) return;
    setLoading(true);
    setListError("");
    const { models: list, error } = await listModels(key);
    setLoading(false);
    if (error) {
      setListError(error);
      addLog("error", "মডেলের তালিকা আনা গেল না", [error]);
      return;
    }
    setModels(list);
    addLog("ok", `মডেলের তালিকা: ${list.length}টি`, []);
  };

  const runOne = async (m: LabModel): Promise<void> => {
    const key = getApiKey();
    if (!key) return;
    setResults((r) => ({ ...r, [m.id]: { status: "running" } }));
    let res: LabResult;
    if (m.kind === "text") res = await testText(key, m.id, "এক বাক্যে বাংলায় হ্যালো বলো।");
    else if (m.kind === "tts") res = await testTTS(key, m.id, voice, "হ্যালো, আমি লুনা। তুমি কেমন আছো?");
    else res = await testLive(key, m.id, voice, "হ্যালো, আমি লুনা। তুমি কেমন আছো?", method);
    const status: RowState["status"] = res.ok === true ? "ok" : res.ok === false ? "fail" : "warn";
    setResults((r) => ({ ...r, [m.id]: { status, ms: res.ms, message: res.message } }));
    if (res.ok === true && m.kind !== "live") {
      // a working test also lifts the server's "rest" list for this key
      fetch("/api/gemini/reset-cooldowns", { method: "POST", headers: { "x-gemini-key": getApiKey() || "" } }).catch(() => {});
    }
    addLog(res.ok === true ? "ok" : res.ok === false ? "error" : "warn", `মডেল টেস্ট (${m.kind}): ${m.id} · ${res.ms}ms`, [res.message]);
    if (res.audio && audioRef.current) {
      audioRef.current.src = URL.createObjectURL(res.audio);
      audioRef.current.play().catch(() => {});
    }
  };

  const runAll = async () => {
    stopRef.current = false;
    setBatchRunning(true);
    for (const m of visible) {
      if (stopRef.current) break;
      await runOne(m);
      await new Promise((r) => setTimeout(r, 400));
    }
    setBatchRunning(false);
  };

  const choose = (m: LabModel) => {
    const next = selected[m.kind] === m.id ? "" : m.id;
    setModelPref(m.kind, next);
    setSelected((s) => ({ ...s, [m.kind]: next }));
  };

  const resetKind = () => {
    setModelPref(tab, "");
    setSelected((s) => ({ ...s, [tab]: "" }));
  };

  const tabInfo = TABS.find((t) => t.id === tab)!;

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="w-full sm:max-w-xl max-h-[90vh] flex flex-col rounded-t-3xl sm:rounded-3xl border border-white/10 bg-[#0b0b0f] text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <FlaskConical size={16} className="text-violet-300" />
            <div>
              <h2 className="text-sm font-semibold">মডেল ল্যাব</h2>
              <p className="text-[11px] text-white/50">নিজের Key-তে মডেল টেস্ট করে বেছে নিন</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-full bg-white/10 hover:bg-white/15 border border-white/10 active:scale-95 transition" title="বন্ধ করুন">
            <X size={14} />
          </button>
        </div>

        <div className="overflow-y-auto p-3 space-y-3">
          {!hasKey && (
            <div className="text-xs rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-200 p-3">
              আগে সেটিংস থেকে Gemini API Key যোগ করুন, তারপর এখানে ফিরে আসুন।
            </div>
          )}

          <div className="flex gap-1.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex-1 px-2 py-2 rounded-xl text-xs font-medium border transition ${
                  tab === t.id ? "bg-violet-500 border-violet-400 text-white" : "bg-white/5 border-white/10 text-white/70"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-white/50">{tabInfo.hint}</p>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!hasKey || loading}
              onClick={fetchModels}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs bg-white/10 hover:bg-white/15 border border-white/10 disabled:opacity-50 active:scale-95 transition"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> মডেল আনুন
            </button>
            {batchRunning ? (
              <button
                type="button"
                onClick={() => (stopRef.current = true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs bg-red-500/20 text-red-200 border border-red-500/30 active:scale-95 transition"
              >
                <Square size={12} /> থামান
              </button>
            ) : (
              <button
                type="button"
                disabled={!hasKey || visible.length === 0}
                onClick={runAll}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs bg-white/10 hover:bg-white/15 border border-white/10 disabled:opacity-50 active:scale-95 transition"
              >
                <Play size={13} /> সব টেস্ট করুন ({visible.length})
              </button>
            )}
            {tab !== "text" && (
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                className="bg-black/30 border border-white/10 rounded-full px-3 py-1.5 text-xs text-white outline-none"
                title="টেস্টের ভয়েস"
              >
                {LAB_VOICES.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            )}
          </div>

          {tab === "live" && (
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as LiveMethod)}
              className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none"
            >
              <option value="clientContent">পাঠানোর পদ্ধতি: clientContent (2.5 Native Audio)</option>
              <option value="realtimeInput">পাঠানোর পদ্ধতি: realtimeInput.text (নতুন 3.x Live)</option>
            </select>
          )}

          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="মডেল খুঁজুন (যেমন flash, tts, 3.8)"
            className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-white/30"
          />

          <div className="flex items-center justify-between gap-2 text-[11px] text-white/60">
            <span className="min-w-0 break-words">
              ব্যবহার হচ্ছে:{" "}
              <b className="text-white/90 font-mono">{selected[tab] || "ডিফল্ট (অটো)"}</b>
            </span>
            {selected[tab] && (
              <button type="button" onClick={resetKind} className="shrink-0 px-2.5 py-1 rounded-full bg-white/10 border border-white/10 active:scale-95 transition">
                ডিফল্টে ফিরুন
              </button>
            )}
          </div>

          {listError && <div className="text-xs text-red-300 break-words">{listError}</div>}

          <div className="space-y-2">
            {visible.length === 0 && !loading && (
              <p className="text-center text-xs text-white/50 py-6">
                {models.length === 0 ? "\"মডেল আনুন\" চাপুন, আপনার Key-র মডেলগুলো এখানে আসবে।" : "এই ট্যাবে কোনো মডেল মেলেনি।"}
              </p>
            )}
            {visible.map((m) => {
              const st = results[m.id];
              const isSel = selected[m.kind] === m.id;
              return (
                <div key={m.id} className={`rounded-2xl border p-3 ${isSel ? "border-violet-400/60 bg-violet-500/10" : "border-white/10 bg-white/5"}`}>
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-mono break-all">{m.id}</div>
                      {m.displayName && <div className="text-[10px] text-white/40">{m.displayName}</div>}
                    </div>
                    {st && (
                      <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${PILL[st.status]}`}>
                        {PILL_LABEL[st.status]}
                        {st.ms ? ` · ${st.ms}ms` : ""}
                      </span>
                    )}
                  </div>
                  {st?.message && <div className="mt-1.5 text-[11px] text-white/60 break-words">{st.message}</div>}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={!hasKey || st?.status === "running"}
                      onClick={() => runOne(m)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs bg-white/10 hover:bg-white/15 border border-white/10 disabled:opacity-50 active:scale-95 transition"
                    >
                      <Play size={12} /> টেস্ট
                    </button>
                    <button
                      type="button"
                      onClick={() => choose(m)}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs border active:scale-95 transition ${
                        isSel ? "bg-violet-500 border-violet-400 text-white" : "bg-white/10 hover:bg-white/15 border-white/10"
                      }`}
                    >
                      {isSel ? <Check size={12} /> : null} {isSel ? "ব্যবহার হচ্ছে" : "ব্যবহার করুন"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <audio ref={audioRef} controls className="w-full" />
          <p className="text-[11px] text-white/40 leading-relaxed">
            টেস্ট আপনার ব্রাউজার থেকে সরাসরি Google-এ যায়, Key আমাদের সার্ভারে যায় না। "ব্যবহার করুন" চাপলে লুনা ওই মডেল আগে চেষ্টা করবে, ব্যর্থ হলে অন্য মডেলে যাবে।
          </p>
        </div>
      </div>
    </div>
  );
};
