// Phone actions for the Android app (open app, call, message draft). Web builds have none of these.
// Safety: Luna never calls or sends by herself. A call opens the dialer (you press call) and a message opens the
// compose screen with the text filled in (you press send). Contacts are read on the phone only to match a name.
import { registerPlugin } from "@capacitor/core";
import { isNativeApp } from "./platform";

interface LunaPhonePlugin {
  openApp(o: { name: string }): Promise<{ opened: boolean; app?: string; reason?: string; matches?: number }>;
  findContact(o: { name: string }): Promise<{ permission: string; contacts: { name: string; number: string }[] }>;
  dial(o: { number: string }): Promise<{ opened: boolean }>;
  openUrl(o: { url: string }): Promise<{ opened: boolean }>;
  compose(o: { number: string; text: string; via: "sms" | "whatsapp" }): Promise<{ opened: boolean }>;
}

const Phone = registerPlugin<LunaPhonePlugin>("LunaPhone");

export const phoneActionsAvailable = (): boolean => isNativeApp();

// Bengali / common spoken names -> the app's usual English label
const APP_ALIASES: Record<string, string> = {
  "ইউটিউব": "youtube", "ইউটিউভ": "youtube", "হোয়াটসঅ্যাপ": "whatsapp", "হোয়াটস অ্যাপ": "whatsapp", "ফেসবুক": "facebook",
  "মেসেঞ্জার": "messenger", "ইনস্টাগ্রাম": "instagram", "টেলিগ্রাম": "telegram", "ক্রোম": "chrome", "গুগল": "google",
  "জিমেইল": "gmail", "ম্যাপ": "maps", "ম্যাপস": "maps", "ক্যামেরা": "camera", "গ্যালারি": "gallery", "ছবি": "photos",
  "সেটিংস": "settings", "সেটিং": "settings", "ক্যালকুলেটর": "calculator", "ঘড়ি": "clock", "ক্যালেন্ডার": "calendar",
  "টিকটক": "tiktok", "স্পটিফাই": "spotify", "নেটফ্লিক্স": "netflix", "প্লে স্টোর": "play store", "ফোন": "phone",
  "মেসেজ": "messages", "বিকাশ": "bkash", "নগদ": "nagad", "এক্স": "x", "টুইটার": "twitter", "জুম": "zoom",
};

const normalize = (s: string) => s.replace(/[ঀ-৿]+/g, (w) => APP_ALIASES[w] || w).trim();

export async function openAppByName(name: string) {
  const q = normalize(name || "");
  let r = await Phone.openApp({ name: q });
  if (!r.opened && q !== name) r = await Phone.openApp({ name });
  return r.opened ? { status: "opened", app: r.app } : { status: "not_found", message: `"${name}" নামে কোনো অ্যাপ পাওয়া যায়নি` };
}

async function resolveContact(name: string) {
  const res = await Phone.findContact({ name });
  if (res.permission === "denied") return { error: "contacts_permission_denied" as const };
  return { contacts: res.contacts };
}

export async function callContact(name: string) {
  const r = await resolveContact(name);
  if ("error" in r) return { status: "error", message: "কন্টাক্ট দেখার অনুমতি দেওয়া হয়নি" };
  if (r.contacts.length === 0) return { status: "not_found", message: `"${name}" নামে কোনো কন্টাক্ট পাওয়া যায়নি, নামটা আবার বলতে বা বানান করতে বলো` };
  const distinct = new Set(r.contacts.map((c) => c.name));
  if (distinct.size > 1) return { status: "multiple", message: "একাধিক কন্টাক্ট মিলেছে, কাকে চান জিজ্ঞেস করো", names: Array.from(distinct) };
  await Phone.dial({ number: r.contacts[0].number });
  return { status: "dialer_opened", contact: r.contacts[0].name, note: "ডায়ালার খুলেছে, কল বোতাম ব্যবহারকারী নিজে চাপবেন" };
}

export async function draftMessage(name: string, text: string, via: "sms" | "whatsapp") {
  const r = await resolveContact(name);
  if ("error" in r) return { status: "error", message: "কন্টাক্ট দেখার অনুমতি দেওয়া হয়নি" };
  if (r.contacts.length === 0) return { status: "not_found", message: `"${name}" নামে কোনো কন্টাক্ট পাওয়া যায়নি` };
  const distinct = new Set(r.contacts.map((c) => c.name));
  if (distinct.size > 1) return { status: "multiple", message: "একাধিক কন্টাক্ট মিলেছে, কাকে চান জিজ্ঞেস করো", names: Array.from(distinct) };
  await Phone.compose({ number: r.contacts[0].number, text, via });
  return { status: "draft_opened", contact: r.contacts[0].name, note: "মেসেজ লেখা অবস্থায় খুলেছে, পাঠানোর বোতাম ব্যবহারকারী নিজে চাপবেন" };
}

// Tools offered to the Live model
const SEARCH_URLS: Record<string, (q: string) => string> = {
  youtube: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  maps: (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`,
  playstore: (q) => `https://play.google.com/store/search?q=${encodeURIComponent(q)}&c=apps`,
};

async function searchOnline(where: string, query: string) {
  const w = where.toLowerCase().replace(/\s+/g, "");
  const key = /(you|ইউটিউ|ইউটিউব)/.test(w) ? "youtube" : /(map|ম্যাপ)/.test(w) ? "maps" : /(play|প্লে)/.test(w) ? "playstore" : "google";
  if (!query.trim()) return { status: "error", message: "কী সার্চ করবো বলা হয়নি" };
  const r = await Phone.openUrl({ url: SEARCH_URLS[key](query.trim()) });
  return r.opened ? { status: "ok", where: key, query } : { status: "error", message: "খুলতে পারিনি" };
}

export const LIVE_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "search_online",
        description: "YouTube, Google, Google Maps বা Play Store-এ কিছু সার্চ করে ফোনে ফলাফল খুলে দেয় (YouTube অ্যাপ থাকলে সেখানেই খোলে)।",
        parameters: {
          type: "OBJECT",
          properties: {
            where: { type: "STRING", description: "youtube, google, maps অথবা playstore" },
            query: { type: "STRING", description: "কী সার্চ করবে" },
          },
          required: ["where", "query"],
        },
      },
      {
        name: "open_app",
        description: "ফোনে ইনস্টল করা একটি অ্যাপ নাম ধরে খোলে (যেমন YouTube, WhatsApp)।",
        parameters: { type: "OBJECT", properties: { app_name: { type: "STRING", description: "অ্যাপের নাম, যেমন ব্যবহারকারী বলেছেন" } }, required: ["app_name"] },
      },
      {
        name: "call_contact",
        description: "ফোনের কন্টাক্ট থেকে নাম মিলিয়ে ডায়ালার খোলে। ব্যবহারকারী নিজে কল বোতাম চাপবেন, তুমি কল করো না।",
        parameters: { type: "OBJECT", properties: { contact_name: { type: "STRING", description: "কন্টাক্টে যে নামে সেভ করা (যেমন Mom, মা, রিনা)" } }, required: ["contact_name"] },
      },
      {
        name: "draft_message",
        description: "কন্টাক্টকে SMS বা WhatsApp মেসেজ লিখে সেন্ড স্ক্রিন খোলে। ব্যবহারকারী নিজে সেন্ড চাপবেন, তুমি পাঠাও না।",
        parameters: {
          type: "OBJECT",
          properties: {
            contact_name: { type: "STRING", description: "কন্টাক্টের নাম" },
            message: { type: "STRING", description: "মেসেজের লেখা" },
            app: { type: "STRING", description: "sms অথবা whatsapp (না বললে whatsapp)" },
          },
          required: ["contact_name", "message"],
        },
      },
    ],
  },
];

export const LIVE_TOOLS_NOTE =
  "তুমি ফোনে অ্যাপ খুলতে, YouTube/Google/Maps/Play Store-এ সার্চ করতে (search_online), কন্টাক্টের জন্য ডায়ালার খুলতে আর মেসেজ ড্রাফট করতে পারো (ফাংশন ব্যবহার করে)। কল বা মেসেজ তুমি নিজে করো না, ব্যবহারকারী নিজে বোতাম চাপেন, তাই কী করলে সংক্ষেপে বলে দাও। কন্টাক্ট না মিললে বা একাধিক মিললে ব্যবহারকারীকে জিজ্ঞেস করো। মেসেজ ড্রাফটের আগে মূল কথাটা নিশ্চিত করে নাও।";

export async function runLiveTool(name: string, args: any): Promise<Record<string, unknown>> {
  try {
    if (name === "search_online") return await searchOnline(String(args?.where || "google"), String(args?.query || ""));
    if (name === "open_app") return await openAppByName(String(args?.app_name || ""));
    if (name === "call_contact") return await callContact(String(args?.contact_name || ""));
    if (name === "draft_message") {
      const via = String(args?.app || "whatsapp").toLowerCase() === "sms" ? "sms" : "whatsapp";
      return await draftMessage(String(args?.contact_name || ""), String(args?.message || ""), via);
    }
    return { status: "error", message: "অজানা কাজ" };
  } catch (e: any) {
    return { status: "error", message: String(e?.message || e).slice(0, 120) };
  }
}
