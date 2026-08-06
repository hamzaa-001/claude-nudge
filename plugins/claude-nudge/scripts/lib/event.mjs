// event.mjs — read the hook payload from stdin and normalize it to a NudgeEvent.
import { basename } from 'node:path';

/**
 * Read stdin fully, but never hang: bail after `timeoutMs`, cap at `maxBytes`.
 * Returns whatever was collected as a UTF-8 string (possibly empty/truncated).
 */
export function readStdin({ timeoutMs = 500, maxBytes = 1024 * 1024, stream = process.stdin } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let total = 0;
    const chunks = [];
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        stream.removeAllListeners('data');
        stream.removeAllListeners('end');
        stream.removeAllListeners('error');
      } catch { /* ignore */ }
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const timer = setTimeout(finish, timeoutMs);
    if (stream.isTTY) { finish(); return; }
    stream.on('data', (c) => {
      if (total >= maxBytes) return;
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
      const room = maxBytes - total;
      chunks.push(room >= buf.length ? buf : buf.subarray(0, room));
      total += buf.length;
    });
    stream.on('end', finish);
    stream.on('error', finish);
    try { stream.resume?.(); } catch { /* ignore */ }
  });
}

const KIND_BY_EVENT = {
  UserPromptSubmit: 'turn_start',
  Stop: 'turn_end',
  StopFailure: 'turn_end', // error-terminated turn — still a "done" signal
  Notification: 'needs_input',
  // Fires when Claude is about to ask you something (question / plan approval). This is the
  // input signal that works in every permission mode, incl. the VS Code extension where the
  // idle Notification never fires. The hooks.json matcher limits it to the input-asking tools.
  PreToolUse: 'needs_input',
  SessionEnd: 'session_end',
};

// The Notification payload's message field name is not documented; probe the likely spots,
// and pull the question text out of an AskUserQuestion tool_input when present.
function extractMessage(obj) {
  const q = obj.tool_input?.questions;
  if (Array.isArray(q) && typeof q[0]?.question === 'string') return q[0].question;
  const candidates = [obj.message, obj.notification?.message, obj.notification?.body, obj.body, obj.text];
  for (const c of candidates) if (typeof c === 'string' && c.length) return c;
  return undefined;
}

/**
 * @param {string} raw   raw stdin
 * @param {number} now   epoch ms
 * @returns {import('./types.js').NudgeEvent|null}
 */
export function parseEvent(raw, now) {
  let obj;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const rawEventName = typeof obj.hook_event_name === 'string' ? obj.hook_event_name : '';
  const kind = KIND_BY_EVENT[rawEventName];
  if (!kind) return null;
  const cwd = typeof obj.cwd === 'string' ? obj.cwd : '';
  const project = cwd ? (basename(cwd) || 'unknown') : 'unknown';
  return {
    kind,
    sessionId: typeof obj.session_id === 'string' ? obj.session_id : '',
    cwd,
    project,
    message: extractMessage(obj),
    tool: typeof obj.tool_name === 'string' ? obj.tool_name : undefined,
    at: now,
    rawEventName,
  };
}
