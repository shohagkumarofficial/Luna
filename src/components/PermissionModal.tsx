import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Mic, MicOff, MessageSquare, RefreshCw, CheckCircle2 } from 'lucide-react';
import { ThemeId, THEMES } from '../utils/theme';

interface Props {
  onClose: () => void;
  onRetry?: () => void;
  onSwitchToText?: () => void;
  theme?: ThemeId;
}

export default function PermissionModal({ onClose, onRetry, onSwitchToText, theme = 'neon-violet' }: Props) {
  const [requesting, setRequesting] = useState(false);
  const [granted, setGranted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const t = THEMES[theme];

  const handleRequestMic = async () => {
    setRequesting(true);
    setErrorMsg(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("আপনার ব্রাউজারে মাইক্রোফোন সাপোর্ট নেই।");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop the test stream
      stream.getTracks().forEach((track) => track.stop());
      setGranted(true);
      setTimeout(() => {
        onClose();
        if (onRetry) {
          onRetry();
        }
      }, 1000);
    } catch (err: any) {
      console.warn("Microphone request error:", err);
      setErrorMsg("ব্রাউজারে মাইক্রোফোন অনুমতি পাওয়া যায়নি। অনুগ্রহ করে সাইট সেটিংসে Allow করুন।");
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className={`w-full max-w-md border rounded-3xl p-6 sm:p-8 flex flex-col items-center text-center relative overflow-hidden ${t.modalBg}`}
      >
        <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${t.swatchGradient}`} />

        <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-5">
          <MicOff size={32} className="text-red-400" />
        </div>

        <h2 className="text-xl sm:text-2xl font-serif font-medium text-white mb-2">
          Microphone Permission Needed
        </h2>
        <p className="text-white/70 text-xs sm:text-sm mb-5 leading-relaxed">
          লুনা (Luna) আপনার কথা শোনার জন্য মাইক্রোফোনের অনুমতি প্রয়োজন। নিচে অনুমতি দিন অথবা টেক্সট দিয়ে কথা বলুন।
        </p>

        {errorMsg && (
          <div className="w-full p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs mb-4 text-left">
            {errorMsg}
          </div>
        )}

        {granted && (
          <div className="w-full p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs mb-4 flex items-center justify-center gap-2">
            <CheckCircle2 size={16} />
            <span>অনুমতি সফল হয়েছে! সেশন শুরু হচ্ছে...</span>
          </div>
        )}

        {/* Step-by-step guidance */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-left w-full mb-6 space-y-2">
          <p className={`text-xs font-semibold ${t.brandSubtitle}`}>অনুমতি চালু করার নিয়ম (How to allow):</p>
          <ol className="text-xs text-white/70 list-decimal pl-4 space-y-1.5 leading-relaxed">
            <li>
              ব্রাউজারের অ্যাড্রেস বারের পাশে <strong>লক আইকন (🔒)</strong> বা সাইট সেটিংসে চাপুন।
            </li>
            <li>
              <strong>Microphone</strong> অপশনটিকে <strong>Allow</strong> সিলেক্ট করুন।
            </li>
            <li>অথবা নিচের বাটন দিয়ে পুনরায় অনুমতি প্রম্পট দেখতে পারেন।</li>
          </ol>
        </div>

        <div className="flex flex-col w-full gap-2.5">
          <button
            onClick={handleRequestMic}
            disabled={requesting || granted}
            className={`w-full py-3 px-4 text-white font-medium text-sm rounded-xl shadow-lg flex items-center justify-center gap-2 transition disabled:opacity-50 ${t.primaryGradient}`}
          >
            {requesting ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                <span>অনুমতি চাওয়া হচ্ছে...</span>
              </>
            ) : (
              <>
                <Mic size={16} />
                <span>মাইক্রোফোন অনুমতি দিন (Allow Mic)</span>
              </>
            )}
          </button>

          <button
            onClick={() => {
              onClose();
              if (onSwitchToText) {
                onSwitchToText();
              }
            }}
            className="w-full py-2.5 px-4 bg-white/10 hover:bg-white/15 text-white font-medium text-xs sm:text-sm rounded-xl border border-white/10 flex items-center justify-center gap-2 transition"
          >
            <MessageSquare size={16} className="text-pink-400" />
            <span>টেক্সট চ্যাট ব্যবহার করুন (Use Text Instead)</span>
          </button>

          <button
            onClick={onClose}
            className="w-full py-2 px-4 text-white/50 hover:text-white text-xs transition"
          >
            বন্ধ করুন (Cancel)
          </button>
        </div>
      </motion.div>
    </div>
  );
}
