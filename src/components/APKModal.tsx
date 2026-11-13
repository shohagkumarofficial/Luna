import React, { useState } from 'react';
import { Download, Smartphone, CheckCircle, ExternalLink, Copy, Check, QrCode, X, Sparkles, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { ThemeId, THEMES } from '../utils/theme';

interface APKModalProps {
  isOpen: boolean;
  onClose: () => void;
  isInstallable: boolean;
  isInstalled: boolean;
  isAndroid: boolean;
  isIOS: boolean;
  onInstall: () => Promise<boolean>;
  theme?: ThemeId;
}

export const APKModal: React.FC<APKModalProps> = ({
  isOpen,
  onClose,
  isInstallable,
  isInstalled,
  isAndroid,
  isIOS,
  onInstall,
  theme = 'neon-violet',
}) => {
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [activeTab, setActiveTab] = useState<'direct' | 'apk' | 'qr'>('direct');

  if (!isOpen) return null;

  const t = THEMES[theme];
  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
  const pwaBuilderUrl = `https://www.pwabuilder.com?url=${encodeURIComponent(currentUrl)}`;
  const qrColor = theme === 'soft-sunset' ? 'fbbf24' : 'c084fc';
  const qrBg = theme === 'soft-sunset' ? '170e10' : '101018';
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(currentUrl)}&bgcolor=${qrBg}&color=${qrColor}&margin=8`;

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(currentUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 15 }}
        className={`relative w-full max-w-xl border rounded-2xl p-6 sm:p-7 text-white overflow-hidden max-h-[92vh] flex flex-col ${t.modalBg}`}
      >
        {/* Glow Effects */}
        <div className={`absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl pointer-events-none ${t.blobTop}`} />
        <div className={`absolute bottom-0 left-0 w-64 h-64 rounded-full blur-3xl pointer-events-none ${t.blobBottom}`} />

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-lg ${t.brandAvatar}`}>
              <Smartphone size={22} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold tracking-wide flex items-center gap-2">
                Luna APK & Mobile App
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${t.pillTag}`}>
                  Android & WebAPK
                </span>
              </h2>
              <p className="text-xs text-white/60">
                অ্যান্ড্রয়েড মোবাইলে সরাসরি APK বা অ্যাপ হিসেবে ইনস্টল করুন
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 mt-4 p-1 bg-white/5 rounded-xl border border-white/10 shrink-0">
          <button
            onClick={() => setActiveTab('direct')}
            className={`flex-1 py-2 text-xs sm:text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'direct'
                ? t.tabActive
                : 'text-white/70 hover:text-white hover:bg-white/5'
            }`}
          >
            <Smartphone size={16} />
            <span>Direct WebAPK (1-Tap)</span>
          </button>
          <button
            onClick={() => setActiveTab('apk')}
            className={`flex-1 py-2 text-xs sm:text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'apk'
                ? t.tabActive
                : 'text-white/70 hover:text-white hover:bg-white/5'
            }`}
          >
            <Download size={16} />
            <span>Download .APK Package</span>
          </button>
          <button
            onClick={() => setActiveTab('qr')}
            className={`flex-1 py-2 text-xs sm:text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'qr'
                ? t.tabActive
                : 'text-white/70 hover:text-white hover:bg-white/5'
            }`}
          >
            <QrCode size={16} />
            <span>Scan on Phone</span>
          </button>
        </div>

        {/* Tab Contents */}
        <div className="overflow-y-auto mt-4 pr-1 flex-1 space-y-4">
          {activeTab === 'direct' && (
            <div className="space-y-4">
              {isInstalled ? (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center gap-3">
                  <CheckCircle size={24} className="shrink-0 text-emerald-400" />
                  <div>
                    <h4 className="font-semibold text-sm">Luna অ্যাপটি ইতোমধ্যে ইনস্টল করা আছে!</h4>
                    <p className="text-xs text-emerald-200/80">
                      আপনার ফোন বা ডিভাইসের হোমস্ক্রিন বা অ্যাপ ড্রয়ার থেকে সরাসরি Luna ওপেন করুন।
                    </p>
                  </div>
                </div>
              ) : isInstallable ? (
                <div className="p-4 rounded-xl bg-violet-950/40 border border-violet-500/30 flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-violet-300 font-semibold text-sm">
                    <Sparkles size={18} className="text-pink-400" />
                    <span>Android 1-Tap WebAPK ইনস্টলেশন প্রস্তুত!</span>
                  </div>
                  <p className="text-xs text-white/70 leading-relaxed">
                    Android Google Chrome ব্রাউজারে এটি ক্লিক করলেই কোনো থার্ড-পার্টি ফাইল ছাড়াই আপনার ফোনে অফিসিয়াল অ্যান্ড্রয়েড প্যাকেজ (WebAPK) হিসেবে ইনস্টল হয়ে যাবে।
                  </p>
                  <button
                    onClick={async () => {
                      const success = await onInstall();
                      if (success) onClose();
                    }}
                    className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white font-semibold text-sm shadow-lg shadow-violet-600/30 flex items-center justify-center gap-2 transition-transform active:scale-95"
                  >
                    <Download size={18} />
                    <span>এখনই অ্যান্ড্রয়েড APK ইনস্টল করুন (Install Now)</span>
                  </button>
                </div>
              ) : null}

              {/* Step-by-Step Mobile Instructions */}
              <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
                <h3 className="text-sm font-semibold text-white/90 flex items-center gap-2">
                  <Smartphone size={16} className="text-violet-400" />
                  <span>অ্যান্ড্রয়েড মোবাইলে ইনস্টল করার নিয়ম (Android Chrome):</span>
                </h3>
                <ol className="text-xs text-white/75 space-y-2 list-decimal list-inside pl-1">
                  <li className="leading-relaxed">
                    আপনার অ্যান্ড্রয়েড ফোনে <strong>Chrome</strong> ব্রাউজারে Luna ওপেন করুন।
                  </li>
                  <li className="leading-relaxed">
                    উপরে ডানদিকের <strong>থ্রি-ডট মেনু (⋮)</strong> তে ট্যাপ করুন।
                  </li>
                  <li className="leading-relaxed">
                    তালিকা থেকে <strong>"Install app"</strong> বা <strong>"Add to Home screen"</strong> সিলেক্ট করুন।
                  </li>
                  <li className="leading-relaxed">
                    অ্যান্ড্রয়েড সিস্টেম সরাসরি ব্যাকগ্রাউন্ডে একটি <strong>WebAPK</strong> তৈরি করে অ্যাপ ড্রয়ারে এবং হোমস্ক্রিনে অ্যাপ আইকন যুক্ত করে দেবে।
                  </li>
                </ol>
              </div>

              {/* iOS Note */}
              <div className="p-3 rounded-xl bg-white/5 border border-white/5 text-[11px] text-white/60 space-y-1">
                <span className="font-semibold text-white/80">iPhone / iPad ব্যবহারকারীদের জন্য:</span>
                <p>Safari ব্রাউজারে Share বাটনে চাপ দিয়ে "Add to Home Screen" সিলেক্ট করলেই হোমস্ক্রিনে ইনস্টল হয়ে যাবে।</p>
              </div>
            </div>
          )}

          {activeTab === 'apk' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-violet-950/30 border border-violet-500/20 space-y-2">
                <h3 className="text-sm font-semibold text-violet-300 flex items-center gap-2">
                  <Download size={16} />
                  <span>PWABuilder দিয়ে সরাসরি Standalone .APK ফাইল তৈরি করুন</span>
                </h3>
                <p className="text-xs text-white/70 leading-relaxed">
                  PWABuilder হলো Microsoft এর অফিসিয়াল ওপেন-সোর্স সার্ভিস, যা এই প্রোগ্রেসিভ ওয়েব অ্যাপকে মাত্র ১ ক্লিকে ফুল অ্যান্ড্রয়েড <strong>.apk</strong> ফাইলে কনভার্ট করে দেয়। আপনি সরাসরি ডাউনলোড করে যেকোনো অ্যান্ড্রয়েড ফোনে সাইডলোড (Sideload) করতে পারবেন।
                </p>
              </div>

              <div className="space-y-2">
                <a
                  href={pwaBuilderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-sm shadow-lg shadow-violet-600/30 flex items-center justify-center gap-2 transition"
                >
                  <ExternalLink size={16} />
                  <span>PWABuilder এ .APK জেনারেট করুন (Generate .APK)</span>
                </a>

                <div className="p-3 bg-white/5 rounded-xl border border-white/10 flex items-center justify-between gap-2">
                  <div className="truncate text-xs text-white/70 select-all font-mono">
                    {currentUrl}
                  </div>
                  <button
                    onClick={handleCopyUrl}
                    className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs flex items-center gap-1.5 shrink-0 transition"
                  >
                    {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    <span>{copied ? 'Copied!' : 'Copy Link'}</span>
                  </button>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-2">
                <h4 className="text-xs font-semibold text-white/90">PWABuilder এ ৩টি সহজ ধাপ:</h4>
                <ol className="text-xs text-white/70 space-y-1.5 list-decimal list-inside pl-1">
                  <li>উপরের বাটনে ক্লিক করে PWABuilder সাইটে যান।</li>
                  <li>"Package for Stores" বাটনে চাপ দিন এবং <strong>Android</strong> বেছে নিন।</li>
                  <li>"Download Package / APK" তে ক্লিক করলেই আপনার কাঙ্ক্ষিত .apk ফাইল ডাউনলোড হয়ে যাবে!</li>
                </ol>
              </div>
            </div>
          )}

          {activeTab === 'qr' && (
            <div className="space-y-4 flex flex-col items-center text-center">
              <p className="text-xs text-white/70 max-w-sm">
                আপনার অ্যান্ড্রয়েড ফোনের ক্যামেরা বা গুগল লেন্স (Google Lens) দিয়ে নিচের কিউআর কোডটি স্ক্যান করুন। সাথে সাথে ফোনে ওপেন হয়ে যাবে এবং ইনস্টল প্রম্পট দেখতে পাবেন।
              </p>

              <div className="p-3 rounded-2xl bg-[#101018] border-2 border-violet-500/40 shadow-xl inline-block">
                <img
                  src={qrCodeUrl}
                  alt="Luna Mobile App QR Code"
                  className="w-48 h-48 sm:w-56 sm:h-56 rounded-xl object-contain"
                  loading="lazy"
                />
              </div>

              <div className="flex items-center gap-2 text-xs text-violet-300">
                <ShieldCheck size={16} className="text-emerald-400" />
                <span>মডেল এবং মাইক্রোফোন পারমিশন সরাসরি ফোনে অ্যাক্টিভ হবে</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-4 mt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/50 shrink-0">
          <span>PWA & Android WebAPK Verified</span>
          <div className="flex items-center gap-2">
            <a
              href="/api/download-source"
              download="luna-voice-assistant-source.zip"
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs flex items-center gap-1.5 transition"
            >
              <Download size={13} />
              <span>Source Code (.zip)</span>
            </a>
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs transition"
            >
              বন্ধ করুন (Close)
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
