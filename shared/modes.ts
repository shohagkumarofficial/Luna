// Luna's talking modes, grouped by category. Used by the app UI, the server and the Live mode.
export type ModeCategory = "companion" | "work" | "fun";

export const MODE_CATEGORIES: { id: ModeCategory; title: string; hint: string }[] = [
  { id: "companion", title: "💞 সঙ্গী", hint: "আদর, খুনসুটি আর মনের কথা" },
  { id: "work", title: "💼 কাজ ও পড়াশোনা", hint: "গোছানো, ফোকাসড, ফলাফল-মুখী" },
  { id: "fun", title: "🎭 মজা ও বিশ্রাম", hint: "আড্ডা, গল্প, ভাষা শেখা, শান্তি" },
];

export interface ModeDef {
  id: string;
  category: ModeCategory;
  name: string;
  subtitle: string;
  description: string;
  emoji: string;
  /** How the voice should sound (appended to the voice's own character). */
  ttsTone: string;
}

// The first four keep their original order (the app relies on that); new modes follow.
export const MODES = [
  { id: "witty", category: "companion", name: "Witty (রসিক)", subtitle: "বুদ্ধিদীপ্ত ও মজার", description: "চটপটে রসিকতা, মিষ্টি খোঁচা আর মজার কথায় হাসিয়ে তুলবে", emoji: "😄", ttsTone: "" },
  { id: "empathetic", category: "companion", name: "Empathetic (মায়াবী)", subtitle: "যত্নশীল ও আবেগি", description: "মন দিয়ে কথা শুনবে, নরম ও আদুরে কণ্ঠে মানসিক সাহস দেবে", emoji: "💗", ttsTone: "" },
  { id: "sassy", category: "companion", name: "Sassy (দুষ্টু অভিমানী)", subtitle: "বোল্ড ও খুনসুটি", description: "মিষ্টি অভিমান, নখরা আর বোল্ড দুষ্টুমি ভরা স্টাইল", emoji: "😏", ttsTone: "" },
  { id: "sweet", category: "companion", name: "Sweet (মিষ্টি ও চঞ্চল)", subtitle: "সহজ ও প্রাণবন্ত", description: "সবসময়ের কিউট, হাসিখুশি ও আন্তরিক গার্লফ্রেন্ড ভাব", emoji: "🌸", ttsTone: "" },

  { id: "boss", category: "work", name: "Boss (বস মোড)", subtitle: "কড়া কিন্তু সম্মানজনক", description: "সোজাসুজি কথা, স্পষ্ট পরের ধাপ আর কাজ শেষ করানোর চাপ, তবে কখনো অপমান নয়", emoji: "👔", ttsTone: "confident, crisp, composed and professional, speaking Bengali clearly and firmly yet politely" },
  { id: "secretary", category: "work", name: "Secretary (সেক্রেটারি)", subtitle: "গোছানো ও দক্ষ", description: "কাজের তালিকা, সারসংক্ষেপ আর সিদ্ধান্তে ভদ্র ও দ্রুত সাহায্য", emoji: "📋", ttsTone: "polished, efficient, courteous and warm, speaking Bengali clearly like a capable personal assistant" },
  { id: "tutor", category: "work", name: "Tutor (শিক্ষক)", subtitle: "ধৈর্যশীল ব্যাখ্যাকারী", description: "ধাপে ধাপে সহজ ব্যাখ্যা, উদাহরণ আর ছোট প্রশ্নে বোঝা যাচাই", emoji: "🎓", ttsTone: "patient, clear, encouraging teacher-like, speaking Bengali slowly and clearly" },
  { id: "coach", category: "work", name: "Focus Coach (ফোকাস কোচ)", subtitle: "উৎসাহী ও লক্ষ্যমুখী", description: "বড় লক্ষ্য ছোট ধাপে ভেঙে ফোকাস আর বিরতির রুটিনে এগিয়ে নেবে", emoji: "🎯", ttsTone: "energetic, upbeat, motivating coach-like, speaking Bengali with enthusiasm" },

  { id: "friend", category: "fun", name: "Friend (দোস্ত)", subtitle: "আড্ডাবাজ বন্ধু", description: "খোলামেলা হাসিঠাট্টার আড্ডা, প্রেমিকা-সুলভ আদর ছাড়া নির্ভেজাল বন্ধুত্ব", emoji: "🤝", ttsTone: "relaxed, friendly, casual and playful, speaking Bengali like a close friend" },
  { id: "storyteller", category: "fun", name: "Storyteller (গল্পকার)", subtitle: "গল্প বলার জাদুকর", description: "ছোট ছোট সুন্দর গল্প বলবে, আর গল্পের মোড় তুমি ঠিক করবে", emoji: "📖", ttsTone: "expressive, warm storyteller voice with gentle dramatic pauses, speaking Bengali" },
  { id: "english", category: "fun", name: "English Partner (ইংরেজি প্র্যাকটিস)", subtitle: "সহজ ইংরেজিতে আড্ডা", description: "ছোট ইংরেজি বাক্যে কথা, বাংলায় ভুল শুধরে দেওয়া আর নতুন শব্দ শেখানো", emoji: "🗣️", ttsTone: "clear, friendly and encouraging language partner, speaking natural clear English at a moderate pace" },
  { id: "calm", category: "fun", name: "Calm Night (শান্ত রাত)", subtitle: "ধীর ও মোলায়েম", description: "নরম ফিসফিসে কণ্ঠে দুশ্চিন্তা কমানো, গভীর শ্বাস আর শান্ত গল্প", emoji: "🌙", ttsTone: "very soft, slow, calm and soothing, almost whispering, speaking Bengali gently" },
] as const satisfies readonly ModeDef[];

export type ModeId = (typeof MODES)[number]["id"];

export const MODE_IDS: string[] = MODES.map((m) => m.id);
export const isModeId = (v: unknown): v is ModeId => typeof v === "string" && MODE_IDS.includes(v);
export const isCompanionMode = (id: string): boolean => (MODES.find((m) => m.id === id)?.category ?? "companion") === "companion";
