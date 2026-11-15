// Counts today's successful / quota-failed calls per saved key, from the server's attempt traces.
// Stored only in this browser. It counts only what Luna's server reported, not usage elsewhere.
const LS = "luna_key_usage";

interface Usage { date: string; ok: number[]; quota: number[] }

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function load(): Usage {
  try {
    const u = JSON.parse(localStorage.getItem(LS) || "null");
    if (u && u.date === today() && Array.isArray(u.ok) && Array.isArray(u.quota)) return u;
  } catch {}
  return { date: today(), ok: [], quota: [] };
}

export function recordFromTrace(trace: string[]) {
  if (!Array.isArray(trace)) return;
  const u = load();
  let changed = false;
  for (const line of trace) {
    if (typeof line !== "string") continue;
    const m = line.match(/\[Key (\d+)\]/);
    const idx = (m ? parseInt(m[1], 10) : 1) - 1;
    if (/: OK\b/.test(line)) {
      u.ok[idx] = (u.ok[idx] || 0) + 1;
      changed = true;
    } else if (/\b429\b|quota|RESOURCE_EXHAUSTED/i.test(line) && /ব্যর্থ/.test(line)) {
      u.quota[idx] = (u.quota[idx] || 0) + 1;
      changed = true;
    }
  }
  if (changed) {
    try { localStorage.setItem(LS, JSON.stringify(u)); } catch {}
  }
}

export function getUsage(): { ok: number[]; quota: number[] } {
  const u = load();
  return { ok: u.ok, quota: u.quota };
}
