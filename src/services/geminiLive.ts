import { buildSystemInstruction } from "../../shared/lunaShared";

// Real-time voice conversation with the Gemini Live API.
// Runs directly browser -> Google using the user's own key (it never touches the Luna server).
// Mic audio is streamed as 16 kHz PCM, Luna's voice comes back as 24 kHz PCM and is played as it arrives.

export type LiveState = "connecting" | "listening" | "speaking" | "closed";

export interface LiveCallbacks {
  onState: (s: LiveState) => void;
  onUserText: (text: string) => void; // growing transcript of what the user is saying
  onLunaText: (text: string) => void; // growing transcript of Luna's reply
  onTurnEnd: () => void;
  onError: (msg: string, wasReady: boolean) => void;
  onToolCall?: (name: string, args: any) => Promise<Record<string, unknown>>;
}

const LIVE_NOTE = "এটি সরাসরি ফোনে কথা বলার মতো আলাপ: উত্তর ছোট রাখো (গল্পের মোডে একটু বড় হতে পারে) আর প্রথম বাক্যেই সরাসরি শুরু করো।";

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class GeminiLiveClient {
  private ws: WebSocket | null = null;
  private micCtx: AudioContext | null = null;
  private outCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private ready = false;
  private closed = false;
  private userText = "";
  private lunaText = "";
  private queue: Promise<void> = Promise.resolve();
  private speakingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private key: string,
    private model: string,
    private voice: string,
    private cb: LiveCallbacks,
    private personaExtra = "",
    private mode = "sweet",
    private tools: unknown[] | null = null,
    private toolsNote = ""
  ) {}

  async start() {
    this.cb.onState("connecting");
    // Ask for the mic first so the permission prompt happens before connecting.
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch {
      this.fail("মাইক্রোফোনের অনুমতি পাওয়া যায়নি। ব্রাউজারে মাইক চালু করে আবার চেষ্টা করো।");
      return;
    }
    this.outCtx = new AudioContext({ sampleRate: 24000 });
    await this.outCtx.resume().catch(() => {});

    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(this.key)}`;
    try {
      this.ws = new WebSocket(url);
    } catch (e: any) {
      this.fail("সংযোগ খোলা যায়নি: " + (e?.message || e));
      return;
    }
    this.ws.onopen = () => {
      this.ws?.send(
        JSON.stringify({
          setup: {
            model: "models/" + this.model,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voice } } },
            },
            systemInstruction: { parts: [{ text: buildSystemInstruction(this.mode) + "\n" + LIVE_NOTE + (this.tools ? "\n" + this.toolsNote : "") + (this.personaExtra ? "\n" + this.personaExtra : "") }] },
            ...(this.tools ? { tools: this.tools } : {}),
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        })
      );
    };
    this.ws.onmessage = (ev) => {
      this.queue = this.queue.then(() => this.handle(ev)).catch(() => {});
    };
    this.ws.onerror = () => {
      if (!this.ready) this.fail("সংযোগ ব্যর্থ। মডেলের নাম বা API Key ঠিক আছে কিনা মডেল ল্যাবের Live ট্যাবে দেখো।");
    };
    this.ws.onclose = (ev) => {
      if (this.closed) return;
      const reason = ev.reason ? ` (${ev.code}: ${ev.reason.slice(0, 120)})` : ` (কোড ${ev.code})`;
      this.fail((this.ready ? "সংযোগ বন্ধ হয়ে গেছে" : "সংযোগ হয়নি") + reason);
    };
  }

  private async handle(ev: MessageEvent) {
    let txt: any = ev.data;
    if (txt instanceof Blob) txt = await txt.text();
    let m: any;
    try {
      m = JSON.parse(txt);
    } catch {
      return;
    }
    if (m.setupComplete !== undefined && !this.ready) {
      this.ready = true;
      this.startMic();
      this.cb.onState("listening");
      return;
    }
    if (m.toolCall?.functionCalls && this.cb.onToolCall) {
      const responses: any[] = [];
      for (const fc of m.toolCall.functionCalls) {
        const result = await this.cb.onToolCall(fc.name, fc.args || {});
        responses.push({ id: fc.id, name: fc.name, response: result });
      }
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
      return;
    }
    const sc = m.serverContent;
    if (!sc) return;
    if (sc.interrupted) {
      this.stopPlayback();
      this.lunaText = "";
      this.cb.onState("listening");
    }
    if (sc.inputTranscription?.text) {
      if (this.lunaText) {
        // a new user turn started: reset for the next exchange
        this.lunaText = "";
        this.userText = "";
      }
      this.userText += sc.inputTranscription.text;
      this.cb.onUserText(this.userText);
    }
    for (const p of sc.modelTurn?.parts || []) {
      if (p.inlineData?.data) this.playChunk(p.inlineData.data);
    }
    if (sc.outputTranscription?.text) {
      this.lunaText += sc.outputTranscription.text;
      this.cb.onLunaText(this.lunaText);
    }
    if (sc.turnComplete) {
      this.cb.onTurnEnd();
      // user's next turn will reset the transcripts
    }
  }

  private startMic() {
    if (!this.stream) return;
    this.micCtx = new AudioContext();
    const src = this.micCtx.createMediaStreamSource(this.stream);
    const proc = this.micCtx.createScriptProcessor(4096, 1, 1);
    const inRate = this.micCtx.sampleRate;
    proc.onaudioprocess = (e) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.ready) return;
      const input = e.inputBuffer.getChannelData(0);
      // downsample to 16 kHz (simple averaging), then to 16-bit PCM
      const ratio = inRate / 16000;
      const outLen = Math.floor(input.length / ratio);
      const pcm = new Int16Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.min(input.length, Math.floor((i + 1) * ratio));
        let sum = 0;
        for (let j = start; j < end; j++) sum += input[j];
        const v = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
        pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
      this.ws.send(
        JSON.stringify({
          realtimeInput: { audio: { data: bytesToB64(new Uint8Array(pcm.buffer)), mimeType: "audio/pcm;rate=16000" } },
        })
      );
    };
    src.connect(proc);
    proc.connect(this.micCtx.destination); // required for the processor to run (outputs silence)
    this.processor = proc;
  }

  private playChunk(b64: string) {
    if (!this.outCtx) return;
    const bytes = b64ToBytes(b64);
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const buf = this.outCtx.createBuffer(1, samples.length, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 32768;
    const node = this.outCtx.createBufferSource();
    node.buffer = buf;
    node.connect(this.outCtx.destination);
    const now = this.outCtx.currentTime;
    if (this.nextTime < now + 0.03) this.nextTime = now + 0.03;
    node.start(this.nextTime);
    this.nextTime += buf.duration;
    this.sources.add(node);
    node.onended = () => this.sources.delete(node);
    this.cb.onState("speaking");
    if (this.speakingTimer) clearTimeout(this.speakingTimer);
    this.speakingTimer = setTimeout(() => {
      if (!this.closed && this.sources.size === 0) this.cb.onState("listening");
    }, Math.max(200, (this.nextTime - now) * 1000 + 150));
  }

  private stopPlayback() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {}
    }
    this.sources.clear();
    this.nextTime = 0;
  }

  private fail(msg: string) {
    if (this.closed) return;
    this.cb.onError(msg, this.ready);
    this.stop();
  }

  // Typed text goes into the same live conversation.
  sendText(text: string) {
    try {
      if (this.ws && this.ready) this.ws.send(JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true } }));
    } catch {}
  }

  stop() {
    if (this.closed && !this.ws) return;
    this.closed = true;
    if (this.speakingTimer) clearTimeout(this.speakingTimer);
    this.stopPlayback();
    try {
      this.processor?.disconnect();
    } catch {}
    this.stream?.getTracks().forEach((t) => t.stop());
    this.micCtx?.close().catch(() => {});
    this.outCtx?.close().catch(() => {});
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
    this.cb.onState("closed");
  }
}
