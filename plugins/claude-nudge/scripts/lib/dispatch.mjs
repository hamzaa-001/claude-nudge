// dispatch.mjs — build the Notification and fan out to providers in parallel.
import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(_execFile);

export function humanizeDuration(ms) {
  let n = typeof ms === 'number' && ms > 0 ? ms : 0;
  const s = Math.round(n / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

/**
 * @returns {import('./types.js').Notification}
 */
export function buildNotification(event, decision, config, { durationMs = 0 } = {}) {
  const title = `claude-nudge — ${event.project}`;
  let body;
  let tags;
  if (event.kind === 'turn_end') {
    body = `Finished — ${humanizeDuration(durationMs)}`;
    tags = ['white_check_mark'];
  } else if (event.kind === 'needs_input') {
    // Only surface raw message text when explicitly opted in.
    body = config.includeMessage && event.message ? event.message : 'Waiting for your input';
    tags = ['bell'];
  } else if (event.kind === 'session_end') {
    body = 'Session ended';
    tags = ['wave'];
  } else {
    body = 'Claude Code';
    tags = ['robot'];
  }
  return {
    title, body, priority: decision.priority, tags, project: event.project, durationMs, at: event.at,
  };
}

function sanitizeError(e) {
  return String((e && (e.message || e.code || e.name)) || 'error').slice(0, 200);
}
function safeIsConfigured(p, config) {
  try { return !!p.isConfigured(config); } catch { return false; }
}

/**
 * Send to every enabled + configured provider under a shared timeout.
 * A failing provider never blocks the others and never propagates.
 * @returns {Promise<Array<{provider:string, ok:boolean, error?:string}>>}
 */
export async function dispatch(notification, config, {
  providers, log, fetchImpl = globalThis.fetch, execFileImpl = execFileP, timeoutMs = 1500,
} = {}) {
  const active = (providers || []).filter(
    (p) => config.providers?.[p.name]?.enabled && safeIsConfigured(p, config),
  );
  if (!active.length) { log?.debug?.('dispatch: no active providers'); return []; }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('dispatch timeout')), timeoutMs);
  try {
    const settled = await Promise.allSettled(active.map((p) => Promise.resolve().then(
      () => p.send(notification, config, {
        signal: controller.signal, log, fetch: fetchImpl, execFile: execFileImpl,
      }),
    )));
    return active.map((p, i) => {
      const r = settled[i];
      const ok = r.status === 'fulfilled';
      const error = ok ? undefined : sanitizeError(r.reason);
      log?.provider?.(p.name, ok, error);
      return { provider: p.name, ok, error };
    });
  } finally {
    clearTimeout(timer);
  }
}
