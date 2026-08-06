// state.mjs — one JSON file per session under ~/.claude/nudge/sessions/.
// Atomic writes (tmp + rename). session_id is untrusted → allowlist-sanitized.
import {
  readFileSync, writeFileSync, renameSync, mkdirSync, existsSync,
  unlinkSync, readdirSync, statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_BASE_DIR = join(homedir(), '.claude', 'nudge');
const STATE_VERSION = 1;
const SESSION_ID_RE = /[^A-Za-z0-9_-]/g;

let tmpCounter = 0;

/** Strip everything outside [A-Za-z0-9_-]; this is the path-traversal guard. */
export function safeSessionId(id) {
  const s = String(id ?? '').replace(SESSION_ID_RE, '');
  return s.length ? s.slice(0, 128) : 'unknown';
}

function sessionsDir(baseDir) { return join(baseDir, 'sessions'); }

export function sessionPath(sessionId, baseDir = DEFAULT_BASE_DIR) {
  return join(sessionsDir(baseDir), `${safeSessionId(sessionId)}.json`);
}

/** @returns the parsed state object, or null if missing/corrupt (treated as fresh). */
export function readState(sessionId, baseDir = DEFAULT_BASE_DIR) {
  try {
    const o = JSON.parse(readFileSync(sessionPath(sessionId, baseDir), 'utf8'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

/** Atomic write: temp file in the same dir, then rename over the target. */
export function writeState(sessionId, state, baseDir = DEFAULT_BASE_DIR) {
  const dir = sessionsDir(baseDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const target = sessionPath(sessionId, baseDir);
  const tmp = `${target}.tmp.${process.pid}.${tmpCounter++}`;
  writeFileSync(tmp, JSON.stringify({ v: STATE_VERSION, ...state }));
  renameSync(tmp, target);
}

export function deleteState(sessionId, baseDir = DEFAULT_BASE_DIR) {
  try { unlinkSync(sessionPath(sessionId, baseDir)); } catch { /* already gone */ }
}

/** Remove session files not updated within maxAgeMs. @returns count removed. */
export function pruneSessions({ baseDir = DEFAULT_BASE_DIR, maxAgeMs = 24 * 3600 * 1000, now = Date.now() } = {}) {
  const dir = sessionsDir(baseDir);
  let removed = 0;
  let files;
  try { files = readdirSync(dir); } catch { return 0; }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const full = join(dir, f);
    try {
      let updatedAt = null;
      try { updatedAt = JSON.parse(readFileSync(full, 'utf8'))?.updatedAt ?? null; } catch { /* fall through */ }
      if (typeof updatedAt !== 'number') updatedAt = statSync(full).mtimeMs;
      if (now - updatedAt > maxAgeMs) { unlinkSync(full); removed++; }
    } catch { /* ignore individual file errors */ }
  }
  return removed;
}
