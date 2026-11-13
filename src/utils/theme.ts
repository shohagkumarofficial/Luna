export type ThemeId = "neon-violet" | "soft-sunset";

export interface ThemeConfig {
  id: ThemeId;
  name: string;
  bnName: string;
  description: string;
  swatchGradient: string;
  bgCanvas: string;
  blobTop: string;
  blobBottom: string;
  brandAvatar: string;
  brandSubtitle: string;
  settingsBtn: string;
  settingsIcon: string;
  primaryGradient: string;
  primaryBorder: string;
  badgeBg: string;
  userBubble: string;
  dialogueCard: string;
  dialogueDot: string;
  dialogueLabel: string;
  listenAgainBtn: string;
  thinkingPill: string;
  thinkingSpinner: string;
  inputBar: string;
  inputIcon: string;
  keyboardActive: string;
  drawerBg: string;
  drawerAccentIcon: string;
  modalBg: string;
  modalHeaderIcon: string;
  modalTitle: string;
  selectedCard: string;
  hoverCard: string;
  checkActive: string;
  accentSlider: string;
  pillTag: string;
  tabActive: string;
  footerHeart: string;
}

export const THEMES: Record<ThemeId, ThemeConfig> = {
  "neon-violet": {
    id: "neon-violet",
    name: "Neon Violet",
    bnName: "নিয়ন ভায়োলেট",
    description: "গভীর রাতের ভায়োলেট ও গোলাপি নিয়ন গ্লো",
    swatchGradient: "from-violet-600 via-fuchsia-500 to-pink-500",
    bgCanvas: "bg-[#050505]",
    blobTop: "bg-[radial-gradient(circle_at_18%_12%,rgba(109,40,217,0.22),transparent_52%)]",
    blobBottom: "bg-[radial-gradient(circle_at_82%_88%,rgba(219,39,119,0.2),transparent_52%)]",
    brandAvatar: "bg-gradient-to-tr from-violet-500 to-pink-500 shadow-md shadow-violet-500/20",
    brandSubtitle: "text-violet-300/80",
    settingsBtn:
      "bg-pink-500/15 hover:bg-pink-500/25 text-pink-300 border-pink-500/40 shadow-pink-950/20",
    settingsIcon: "text-pink-400",
    primaryGradient:
      "bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 shadow-violet-900/40",
    primaryBorder: "border-violet-400/50",
    badgeBg: "bg-pink-500",
    userBubble: "bg-violet-600 text-white",
    dialogueCard:
      "bg-[#0d0e17]/90 border-violet-500/40 shadow-[0_8px_32px_rgba(0,0,0,0.7)]",
    dialogueDot: "bg-pink-400",
    dialogueLabel: "text-pink-400",
    listenAgainBtn: "text-pink-300 hover:text-white",
    thinkingPill: "bg-black/60 border-violet-500/30 text-cyan-300",
    thinkingSpinner: "text-pink-400",
    inputBar: "bg-[#0c0d16]/90 border-violet-500/30",
    inputIcon: "text-violet-300",
    keyboardActive: "bg-violet-600 text-white border-violet-400",
    drawerBg: "bg-[#0b0c14]",
    drawerAccentIcon: "text-pink-400",
    modalBg: "bg-[#0d0e17] border-pink-500/30 shadow-[0_10px_40px_rgba(236,72,153,0.2)]",
    modalHeaderIcon: "bg-pink-500/20 border-pink-500/40 text-pink-400",
    modalTitle: "text-pink-200",
    selectedCard:
      "bg-gradient-to-r from-pink-950/40 to-violet-950/40 border-pink-500 shadow-md shadow-pink-500/15",
    hoverCard: "hover:border-pink-500/40 hover:bg-white/10",
    checkActive: "bg-pink-500 border-pink-400 text-white",
    accentSlider: "accent-pink-500",
    pillTag: "bg-pink-500/20 text-pink-300 border-pink-500/30",
    tabActive: "bg-violet-600 text-white shadow-md",
    footerHeart: "text-pink-300/80",
  },
  "soft-sunset": {
    id: "soft-sunset",
    name: "Soft Sunset",
    bnName: "সফট সানসেট",
    description: "গোধূলির সোনালি অ্যাম্বার ও রোজ-কোরাল আভা",
    swatchGradient: "from-amber-400 via-orange-500 to-rose-500",
    bgCanvas: "bg-[#120b0d]",
    blobTop: "bg-[radial-gradient(circle_at_18%_12%,rgba(217,119,6,0.22),transparent_52%)]",
    blobBottom: "bg-[radial-gradient(circle_at_82%_88%,rgba(225,29,72,0.2),transparent_52%)]",
    brandAvatar: "bg-gradient-to-tr from-amber-400 via-orange-500 to-rose-500 shadow-md shadow-orange-500/25",
    brandSubtitle: "text-amber-300/80",
    settingsBtn:
      "bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border-amber-400/40 shadow-orange-950/30",
    settingsIcon: "text-amber-400",
    primaryGradient:
      "bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-400 hover:to-rose-400 shadow-orange-950/40",
    primaryBorder: "border-amber-300/50",
    badgeBg: "bg-rose-500",
    userBubble: "bg-gradient-to-r from-orange-600 to-rose-600 text-white",
    dialogueCard:
      "bg-[#1a1012]/90 border-amber-500/35 shadow-[0_8px_32px_rgba(24,8,8,0.75)]",
    dialogueDot: "bg-amber-400",
    dialogueLabel: "text-amber-300",
    listenAgainBtn: "text-amber-300 hover:text-white",
    thinkingPill: "bg-[#1c1113]/80 border-amber-500/30 text-amber-200",
    thinkingSpinner: "text-rose-400",
    inputBar: "bg-[#190f11]/95 border-amber-500/35",
    inputIcon: "text-amber-300",
    keyboardActive: "bg-gradient-to-r from-amber-500 to-rose-500 text-white border-amber-300",
    drawerBg: "bg-[#150d0f]",
    drawerAccentIcon: "text-amber-400",
    modalBg: "bg-[#170e10] border-amber-500/30 shadow-[0_10px_40px_rgba(245,158,11,0.18)]",
    modalHeaderIcon: "bg-amber-500/20 border-amber-500/40 text-amber-300",
    modalTitle: "text-amber-100",
    selectedCard:
      "bg-gradient-to-r from-amber-950/50 to-rose-950/50 border-amber-400 shadow-md shadow-amber-500/15",
    hoverCard: "hover:border-amber-400/40 hover:bg-white/10",
    checkActive: "bg-gradient-to-r from-amber-500 to-rose-500 border-amber-300 text-white",
    accentSlider: "accent-amber-400",
    pillTag: "bg-amber-500/20 text-amber-200 border-amber-500/30",
    tabActive: "bg-gradient-to-r from-amber-500 to-rose-500 text-white shadow-md",
    footerHeart: "text-amber-200/80",
  },
};

export const THEME_OPTIONS: ThemeConfig[] = [THEMES["neon-violet"], THEMES["soft-sunset"]];
