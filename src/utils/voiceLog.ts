// In-memory diagnostic log shown in the app's "Log" panel.
// Nothing here is sent anywhere; API keys are never written to the log.
export type LogLevel = "ok" | "warn" | "error" | "info";

export interface LogEntry {
  id: number;
  time: number;
  level: LogLevel;
  title: string;
  lines: string[];
}

const MAX_ENTRIES = 80;
let entries: LogEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

export function addLog(level: LogLevel, title: string, lines: string[] = []) {
  entries = [{ id: nextId++, time: Date.now(), level, title, lines }, ...entries].slice(0, MAX_ENTRIES);
  emit();
}

export function getLogs(): LogEntry[] {
  return entries;
}

export function clearLogs() {
  entries = [];
  emit();
}

export function subscribeLogs(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function fmtTime(t: number) {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Plain-text version for the "Copy" button, so the log can be pasted into a chat.
export function logsToText(list: LogEntry[] = entries): string {
  return list
    .slice()
    .reverse()
    .map((e) => `[${fmtTime(e.time)}] ${e.level.toUpperCase()} ${e.title}${e.lines.length ? "\n  " + e.lines.join("\n  ") : ""}`)
    .join("\n");
}

export { fmtTime };
