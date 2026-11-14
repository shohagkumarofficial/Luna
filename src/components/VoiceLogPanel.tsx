import React, { useEffect, useState } from "react";
import { X, Copy, Trash2, Check } from "lucide-react";
import { LogEntry, LogLevel, clearLogs, fmtTime, getLogs, logsToText, subscribeLogs } from "../utils/voiceLog";

interface VoiceLogPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const LEVEL_STYLE: Record<LogLevel, string> = {
  ok: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  warn: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  error: "bg-red-500/20 text-red-300 border-red-500/30",
  info: "bg-white/10 text-white/70 border-white/15",
};

const LEVEL_LABEL: Record<LogLevel, string> = { ok: "OK", warn: "সতর্ক", error: "ব্যর্থ", info: "তথ্য" };

export const VoiceLogPanel: React.FC<VoiceLogPanelProps> = ({ isOpen, onClose }) => {
  const [logs, setLogs] = useState<LogEntry[]>(() => getLogs());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLogs(getLogs());
    return subscribeLogs(() => setLogs([...getLogs()]));
  }, []);

  if (!isOpen) return null;

  const handleCopy = async () => {
    const text = logsToText(logs);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="w-full sm:max-w-xl max-h-[85vh] flex flex-col rounded-t-3xl sm:rounded-3xl border border-white/10 bg-[#0b0b0f] text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div>
            <h2 className="text-sm font-semibold">লুনা লগ</h2>
            <p className="text-[11px] text-white/50">কোন ইঞ্জিনে ভয়েস তৈরি হচ্ছে তা এখানে দেখা যায়</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs bg-white/10 hover:bg-white/15 border border-white/10 active:scale-95 transition"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "কপি হয়েছে" : "কপি"}
            </button>
            <button
              type="button"
              onClick={clearLogs}
              className="p-2 rounded-full bg-white/10 hover:bg-white/15 border border-white/10 active:scale-95 transition"
              title="লগ মুছুন"
            >
              <Trash2 size={13} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-full bg-white/10 hover:bg-white/15 border border-white/10 active:scale-95 transition"
              title="বন্ধ করুন"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-3 space-y-2">
          {logs.length === 0 ? (
            <p className="text-center text-xs text-white/50 py-10">
              এখনো কোনো লগ নেই। লুনার সাথে কথা বলো, তারপর এখানে দেখো।
            </p>
          ) : (
            logs.map((e) => (
              <div key={e.id} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${LEVEL_STYLE[e.level]}`}>
                    {LEVEL_LABEL[e.level]}
                  </span>
                  <span className="text-xs font-medium flex-1 min-w-0 break-words">{e.title}</span>
                  <span className="text-[10px] text-white/40 font-mono">{fmtTime(e.time)}</span>
                </div>
                {e.lines.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {e.lines.map((l, i) => (
                      <li key={i} className="text-[11px] text-white/60 font-mono break-words">
                        {l}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
