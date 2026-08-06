// logger.mjs — append-only JSONL debug log with secret redaction.
// Guarantees: never throws, never writes secrets, never touches disk when disabled.
import {
  appendFileSync, statSync, renameSync, mkdirSync, existsSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const NUDGE_DIR = join(homedir(), '.claude', 'nudge');
const LOG_PATH = join(NUDGE_DIR, 'debug.log');
const LOG_BACKUP = `${LOG_PATH}.1`;
const MAX_LOG_BYTES = 1024 * 1024;

// Any object key whose name matches this is a candidate secret and gets masked.
const SECRET_KEY_RE = /(token|topic|secret|password|apikey|api_key|authorization|cookie|credential)/i;

/** Deep-copy `value`, masking any property whose key looks like a secret. */
export function redact(value) {
  return _redact(value, 0);
}
function _redact(value, depth) {
  if (depth > 8) return '[deep]';
  if (Array.isArray(value)) return value.map((v) => _redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(k)) out[k] = v == null || v === '' ? v : '***';
      else out[k] = _redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Redacted view of a resolved config, safe to print or log. */
export function redactConfig(config) {
  const c = redact(config);
  // Webhook header VALUES can carry auth tokens; mask them all regardless of key name.
  const headers = c?.providers?.webhook?.headers;
  if (headers && typeof headers === 'object') {
    const masked = {};
    for (const k of Object.keys(headers)) masked[k] = '***';
    c.providers.webhook.headers = masked;
  }
  return c;
}

/** Remove every occurrence of `token` from `str` (defence in depth for error text). */
export function redactToken(str, token) {
  if (!token || typeof str !== 'string') return str;
  return str.split(token).join('***');
}

export function createLogger(initialEnabled = false) {
  let enabled = !!initialEnabled;

  function rotateIfNeeded() {
    try {
      if (statSync(LOG_PATH).size > MAX_LOG_BYTES) renameSync(LOG_PATH, LOG_BACKUP);
    } catch { /* missing log file is normal */ }
  }

  function write(entry) {
    if (!enabled) return;
    try {
      if (!existsSync(NUDGE_DIR)) mkdirSync(NUDGE_DIR, { recursive: true });
      rotateIfNeeded();
      appendFileSync(LOG_PATH, `${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`);
    } catch { /* the logger must never break the hook */ }
  }

  return {
    get enabled() { return enabled; },
    setEnabled(v) { enabled = !!v; },
    debug: (msg, data) => write({ type: 'debug', msg, ...(data ? { data: redact(data) } : {}) }),
    error: (msg, data) => write({ type: 'error', msg, ...(data ? { data: redact(data) } : {}) }),
    decision: (event, decision) => write({
      type: 'decision',
      event: event?.kind,
      project: event?.project,
      raw: event?.rawEventName,
      notify: decision?.notify,
      reason: decision?.reason,
      priority: decision?.priority,
    }),
    provider: (name, ok, detail) => write({
      type: 'provider', provider: name, ok, ...(detail ? { detail: String(detail).slice(0, 200) } : {}),
    }),
    path: LOG_PATH,
  };
}
