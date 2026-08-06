// rules.mjs — the decision engine. Pure, no I/O. This is the core of the tool.

/** Stable key identifying "this kind of notification for this session". */
export function notifyKey(event) { return `${event.kind}:${event.sessionId || '?'}`; }

function toMinutes(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Local-time quiet-hours check; correctly handles windows that wrap midnight. */
export function inQuietHours(now, quietHours) {
  if (!quietHours?.enabled) return false;
  const start = toMinutes(quietHours.start);
  const end = toMinutes(quietHours.end);
  if (start == null || end == null || start === end) return false;
  const d = new Date(now);
  const cur = d.getHours() * 60 + d.getMinutes();
  return start < end ? (cur >= start && cur < end) : (cur >= start || cur < end);
}

function projectMatches(cwd, patterns) {
  const c = String(cwd || '').replace(/\\/g, '/').toLowerCase();
  return patterns.some((p) => {
    const s = String(p).replace(/\\/g, '/').toLowerCase();
    return s.length > 0 && c.includes(s);
  });
}

/**
 * @param {import('./types.js').NudgeEvent} event
 * @param {object|null} state
 * @param {object} config
 * @param {number} now epoch ms
 * @returns {import('./types.js').Decision}
 */
export function decide(event, state, config, now) {
  const priority = event.kind === 'needs_input' ? 'high' : 'normal';

  if (config.enabled === false) return { notify: false, reason: 'disabled', priority };
  if (config.events?.[event.kind] === false) return { notify: false, reason: 'event_disabled', priority };

  const deny = config.projects?.deny || [];
  if (deny.length && projectMatches(event.cwd, deny)) return { notify: false, reason: 'project_denied', priority };

  const allow = config.projects?.allow || [];
  if (allow.length && !projectMatches(event.cwd, allow)) return { notify: false, reason: 'project_not_allowed', priority };

  if (inQuietHours(now, config.quietHours) && priority !== 'high') {
    return { notify: false, reason: 'quiet_hours', priority };
  }

  // needs_input is blocking the user right now: bypass the duration gate.
  if (event.kind === 'needs_input') return { notify: true, reason: 'ok', priority: 'high' };

  // Duration gate — the anti-fatigue core. Missing turnStartedAt => notify (fail useful).
  if (event.kind === 'turn_end') {
    const startedAt = state && typeof state.turnStartedAt === 'number' ? state.turnStartedAt : null;
    if (startedAt !== null && now - startedAt < config.minDurationMs) {
      return { notify: false, reason: 'below_min_duration', priority };
    }
  }

  // De-dupe rapid repeats of the same key.
  if (
    state
    && state.lastNotifyKey === notifyKey(event)
    && typeof state.lastNotifiedAt === 'number'
    && now - state.lastNotifiedAt < config.dedupeWindowMs
  ) {
    return { notify: false, reason: 'deduped', priority };
  }

  return { notify: true, reason: 'ok', priority };
}
