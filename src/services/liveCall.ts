import { getApiKeys } from "../utils/apiKey";
import { getModelPref } from "../utils/modelPrefs";
import { phoneActionsAvailable, LIVE_TOOLS, LIVE_TOOLS_NOTE, runLiveTool } from "../utils/phoneActions";
import { addLog } from "../utils/voiceLog";
import { GeminiLiveClient, LiveState } from "./geminiLive";

export const DEFAULT_LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-09-2025";

export interface LiveCallHandlers {
  onState: (s: LiveState) => void;
  onUserText: (t: string) => void;
  onLunaText: (t: string) => void;
  onTurnEnd: (user: string, luna: string) => void;
  onFatal: (msg: string) => void;
}

// One call-like voice session: key rotation, auto-reconnect with recent context, phone tools.
export class LiveCall {
  private client: GeminiLiveClient | null = null;
  private turn = { user: "", luna: "" };
  private recent: { user: string; luna: string }[] = [];
  private retries = 0;
  private stopped = false;

  constructor(private h: LiveCallHandlers, private voice: string, private getMode: () => string) {}

  async start() {
    if (!getApiKeys().length) {
      this.h.onFatal("আগে সেটিংস থেকে Gemini API Key যোগ করো।");
      return;
    }
    await this.connect(0, "");
  }

  sendText(t: string) { this.client?.sendText(t); }

  stop() {
    this.stopped = true;
    this.client?.stop();
    this.client = null;
  }

  private async connect(ki: number, context: string) {
    if (this.stopped) return;
    const keys = getApiKeys();
    const model = getModelPref("live") || DEFAULT_LIVE_MODEL;
    const t0 = performance.now();
    let first = true;
    const client = new GeminiLiveClient(keys[ki], model, this.voice, {
      onState: (s) => {
        if (this.stopped && s !== "closed") return;
        this.h.onState(s);
        if (s === "listening" && first) {
          first = false;
          addLog("ok", `Live চালু: ${model} · ${Math.round(performance.now() - t0)}ms`, [`ভয়েস: ${this.voice}`]);
        }
      },
      onUserText: (t) => { this.turn.user = t; this.h.onUserText(t); },
      onLunaText: (t) => { this.turn.luna = t; this.h.onLunaText(t); },
      onTurnEnd: () => {
        const done = this.turn;
        this.turn = { user: "", luna: "" };
        if (done.user || done.luna) {
          this.recent = [...this.recent, done].slice(-6);
          this.h.onTurnEnd(done.user, done.luna);
        }
      },
      onError: (msg, wasReady) => {
        addLog("error", `Live ব্যর্থ${keys.length > 1 ? ` [Key ${ki + 1}]` : ""}`, [model, msg]);
        if (this.stopped) return;
        if (first && ki + 1 < keys.length) { this.connect(ki + 1, context); return; }
        if (wasReady && this.retries < 3) {
          this.retries += 1;
          const ctx = this.recent.map((x) => `সোহাগ: ${x.user}\nলুনা: ${x.luna}`).join("\n");
          addLog("warn", "Live সংযোগ কেটে গিয়েছিল, আবার জুড়ছে", [`চেষ্টা ${this.retries}/৩`]);
          setTimeout(() => this.connect(ki, ctx ? `এই কথোপকথন চলছিল, এখান থেকেই স্বাভাবিকভাবে চালিয়ে যাও:\n${ctx}` : ""), 600);
          return;
        }
        this.stopped = true;
        this.h.onFatal(msg);
      },
      onToolCall: async (name, args) => {
        const result = await runLiveTool(name, args);
        addLog(result.status === "error" || result.status === "not_found" ? "warn" : "ok", `ফোন কাজ: ${name}`, [JSON.stringify(args).slice(0, 120), JSON.stringify(result).slice(0, 160)]);
        return result;
      },
    }, context, this.getMode(), phoneActionsAvailable() ? LIVE_TOOLS : null, LIVE_TOOLS_NOTE);
    this.client = client;
    await client.start();
  }
}
