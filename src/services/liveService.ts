import { getApiKey } from "../utils/apiKey";

export class LiveSessionManager {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private recognition: any = null;
  private isRecognizing: boolean = false;
  private recognitionRestartTimeout: any = null;
  // True while Luna's reply is being spoken by the app. The mic must stay off during this time:
  // a restarting SpeechRecognition steals audio focus on mobile (cutting the voice off) and
  // would also transcribe Luna's own voice as user input.
  private externallyPaused: boolean = false;

  // Audio playback state (24kHz for Gemini audio)
  private playbackContext: AudioContext | null = null;
  private nextPlayTime: number = 0;
  private isPlaying: boolean = false;
  public isMuted: boolean = false;
  public personality: string = "sweet";
  public recognitionLang: string = "bn-BD";

  public onStateChange: (state: "idle" | "listening" | "processing" | "speaking") => void = () => {};
  public onMessage: (sender: "user" | "luna", text: string) => void = () => {};
  public onCommand: (url: string) => void = () => {};
  public onError: (error: string) => void = () => {};
  public onWakeWordDetected: () => void = () => {};
  private lastWakeWordAt: number = 0;

  async start() {
    try {
      this.onStateChange("processing");

      // Check if getUserMedia is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Microphone API is not supported in this browser environment.");
      }

      // Initialize Audio Contexts
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContextClass({ sampleRate: 16000 });
      this.playbackContext = new AudioContextClass({ sampleRate: 24000 });
      this.nextPlayTime = this.playbackContext.currentTime;

      // Request microphone input with resilient constraints
      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (err: any) {
        if (err?.name === "OverconstrainedError" || err?.name === "TypeError") {
          this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } else {
          throw err;
        }
      }

      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        const buffer = new ArrayBuffer(pcm16.length * 2);
        const view = new DataView(buffer);
        for (let i = 0; i < pcm16.length; i++) {
          view.setInt16(i * 2, pcm16[i], true);
        }

        let binary = "";
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64Data = btoa(binary);

        this.ws.send(
          JSON.stringify({
            type: "audio",
            audio: base64Data,
          })
        );
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      // Connect to Server-side WebSocket Live API bridge
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/live`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("[Client] WebSocket live bridge connected");
        this.ws?.send(JSON.stringify({ type: "config", personality: this.personality, apiKey: getApiKey() }));
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "connected") {
            this.onStateChange("listening");
            this.startSpeechRecognition();
          } else if (data.type === "audio" && data.audio) {
            this.stopSpeechRecognition();
            this.onStateChange("speaking");
            this.playAudioChunk(data.audio);
          } else if (data.type === "interrupted") {
            this.stopPlayback();
            this.onStateChange("listening");
            this.startSpeechRecognition();
          } else if (data.type === "transcript" && data.text) {
            this.onMessage(data.sender || "luna", data.text);
          } else if (data.type === "command" && data.url) {
            this.onCommand(data.url);
          } else if (data.type === "closed") {
            this.stop();
          } else if (data.type === "error") {
            console.warn("[Client] Live session notification from server:", data.error);
            this.onError(data.error);
          }
        } catch (e) {
          console.error("Failed to parse live WebSocket message:", e);
        }
      };

      this.ws.onclose = () => {
        console.log("[Client] WebSocket live bridge closed");
        this.stop();
      };

      this.ws.onerror = (err) => {
        console.warn("[Client] WebSocket bridge error:", err);
        this.stop();
      };
    } catch (error: any) {
      this.stop();
      const isPerm =
        error?.name === "NotAllowedError" ||
        error?.name === "PermissionDeniedError" ||
        (typeof error?.message === "string" && /permission/i.test(error.message));

      if (!isPerm) {
        console.warn("Live session initialization notice:", error);
      }
      throw error;
    }
  }

  // Continuous speech recognition for conversational voice in
  private startSpeechRecognition() {
    const SpeechRec = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec || this.isRecognizing || this.externallyPaused) return;

    try {
      this.recognition = new SpeechRec();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = this.recognitionLang || "bn-BD";

      this.recognition.onstart = () => {
        this.isRecognizing = true;
      };

      this.recognition.onresult = (e: any) => {
        const lastResult = e.results[e.results.length - 1];
        if (!lastResult) return;

        const transcript = (lastResult[0]?.transcript || "").trim();
        if (!transcript) return;

        // Detect 'Luna' wake word in both interim and final speech input
        if (/\b(luna|loona)\b|লুনা|লূনা/i.test(transcript)) {
          const now = Date.now();
          if (now - this.lastWakeWordAt > 1800) {
            this.lastWakeWordAt = now;
            this.onWakeWordDetected();
          }
        }

        if (lastResult.isFinal) {
          this.onStateChange("processing");
          this.onMessage("user", transcript);
          this.sendText(transcript);
        }
      };

      this.recognition.onerror = (err: any) => {
        if (err.error !== "no-speech") {
          console.warn("Speech recognition notice:", err.error);
        }
      };

      this.recognition.onend = () => {
        this.isRecognizing = false;
        // Automatically restart if still in listening state and not playing
        if (this.ws && !this.isPlaying && !this.externallyPaused) {
          this.recognitionRestartTimeout = setTimeout(() => {
            this.startSpeechRecognition();
          }, 300);
        }
      };

      this.recognition.start();
    } catch {
      this.isRecognizing = false;
    }
  }

  public pauseRecognition() {
    this.externallyPaused = true;
    this.stopSpeechRecognition();
  }

  public resumeRecognition() {
    this.externallyPaused = false;
    if (this.ws && !this.isPlaying && !this.isRecognizing) {
      this.startSpeechRecognition();
    }
  }

  private stopSpeechRecognition() {
    if (this.recognitionRestartTimeout) {
      clearTimeout(this.recognitionRestartTimeout);
      this.recognitionRestartTimeout = null;
    }
    if (this.recognition && this.isRecognizing) {
      try {
        this.recognition.stop();
      } catch {}
      this.isRecognizing = false;
    }
  }

  // Fallback voice playback using window.speechSynthesis
  private speakFallback(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis || this.isMuted) {
      this.onStateChange("listening");
      this.startSpeechRecognition();
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const cleanText = text.replace(/[\*\#\_]/g, "");
      const utterance = new SpeechSynthesisUtterance(cleanText);

      const voices = window.speechSynthesis.getVoices();
      const bnVoice = voices.find((v) => v.lang.includes("bn") || v.lang.includes("hi") || v.lang.includes("IN"));
      if (bnVoice) {
        utterance.voice = bnVoice;
      }
      utterance.pitch = 1.15;
      utterance.rate = 1.05;

      this.onStateChange("speaking");
      this.isPlaying = true;
      this.stopSpeechRecognition();

      utterance.onend = () => {
        this.isPlaying = false;
        this.onStateChange("listening");
        this.startSpeechRecognition();
      };

      utterance.onerror = () => {
        this.isPlaying = false;
        this.onStateChange("listening");
        this.startSpeechRecognition();
      };

      window.speechSynthesis.speak(utterance);
    } catch {
      this.isPlaying = false;
      this.onStateChange("listening");
      this.startSpeechRecognition();
    }
  }

  private playAudioChunk(base64Data: string) {
    if (!this.playbackContext || this.isMuted) return;

    try {
      const binaryString = atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const buffer = new Int16Array(bytes.buffer);
      const audioBuffer = this.playbackContext.createBuffer(1, buffer.length, 24000);
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < buffer.length; i++) {
        channelData[i] = buffer[i] / 32768.0;
      }

      const source = this.playbackContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.playbackContext.destination);

      const currentTime = this.playbackContext.currentTime;
      if (this.nextPlayTime < currentTime) {
        this.nextPlayTime = currentTime;
      }

      source.start(this.nextPlayTime);
      this.nextPlayTime += audioBuffer.duration;
      this.isPlaying = true;
      this.stopSpeechRecognition();

      source.onended = () => {
        if (this.playbackContext && this.playbackContext.currentTime >= this.nextPlayTime - 0.1) {
          this.isPlaying = false;
          this.onStateChange("listening");
          this.startSpeechRecognition();
        }
      };
    } catch (e) {
      console.error("Error playing chunk", e);
      this.isPlaying = false;
      this.onStateChange("listening");
      this.startSpeechRecognition();
    }
  }

  private stopPlayback() {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    if (this.playbackContext) {
      this.playbackContext.close().catch(() => {});
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.playbackContext = new AudioContextClass({ sampleRate: 24000 });
      this.nextPlayTime = this.playbackContext.currentTime;
      this.isPlaying = false;
    }
  }

  stop() {
    this.externallyPaused = false;
    this.stopSpeechRecognition();
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.stopPlayback();

    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }

    this.onStateChange("idle");
  }

  public setPersonality(personality: string) {
    this.personality = personality;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "config", personality }));
    }
  }

  public setRecognitionLang(lang: string) {
    const nextLang = lang || "bn-BD";
    if (this.recognitionLang === nextLang) return;
    this.recognitionLang = nextLang;

    if (this.recognition) {
      this.recognition.lang = nextLang;
      // Restart active recognition instance so the browser applies the updated lang immediately
      if (this.isRecognizing && this.ws && !this.isPlaying) {
        try {
          this.recognition.stop();
        } catch {}
      }
    }
  }

  sendText(text: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "text", text, personality: this.personality }));
    }
  }

  sendImage(imageBase64: string, text?: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "image",
          image: imageBase64,
          text: text || "What do you see?",
          personality: this.personality,
        })
      );
    }
  }
}
