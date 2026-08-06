import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, inQuietHours, notifyKey } from '../plugins/claude-nudge/scripts/lib/rules.mjs';
import { defaults } from '../plugins/claude-nudge/scripts/lib/config.mjs';

function cfg(overrides = {}) {
  const c = defaults();
  return { ...c, ...overrides };
}
const ev = (kind, extra = {}) => ({
  kind, sessionId: 's1', cwd: '/home/dev/projects/app', project: 'app', at: 1000, rawEventName: kind, ...extra,
});
const NOW = 1_000_000;

test('disabled config never notifies', () => {
  const d = decide(ev('turn_end'), { turnStartedAt: 0 }, cfg({ enabled: false }), NOW);
  assert.equal(d.notify, false);
  assert.equal(d.reason, 'disabled');
});

test('event disabled is respected', () => {
  const c = cfg();
  c.events.turn_end = false;
  const d = decide(ev('turn_end'), { turnStartedAt: 0 }, c, NOW);
  assert.equal(d.reason, 'event_disabled');
});

test('turn under the duration threshold is suppressed', () => {
  const c = cfg({ minDurationMs: 30000 });
  const d = decide(ev('turn_end'), { turnStartedAt: NOW - 3000 }, c, NOW);
  assert.equal(d.notify, false);
  assert.equal(d.reason, 'below_min_duration');
});

test('turn over the duration threshold notifies (normal priority)', () => {
  const c = cfg({ minDurationMs: 30000 });
  const d = decide(ev('turn_end'), { turnStartedAt: NOW - 120000 }, c, NOW);
  assert.equal(d.notify, true);
  assert.equal(d.priority, 'normal');
});

test('missing turnStartedAt notifies (fail toward useful)', () => {
  const d = decide(ev('turn_end'), null, cfg(), NOW);
  assert.equal(d.notify, true);
  assert.equal(d.reason, 'ok');
});

test('needs_input bypasses the duration gate and is high priority', () => {
  const c = cfg({ minDurationMs: 999999 });
  const d = decide(ev('needs_input'), { turnStartedAt: NOW - 1 }, c, NOW);
  assert.equal(d.notify, true);
  assert.equal(d.priority, 'high');
});

test('needs_input bypasses quiet hours', () => {
  const c = cfg();
  c.quietHours = { enabled: true, start: '00:00', end: '23:59' };
  const d = decide(ev('needs_input'), null, c, NOW);
  assert.equal(d.notify, true, 'high priority should punch through quiet hours');
});

test('quiet hours suppresses a normal turn_end', () => {
  const c = cfg();
  // Build a NOW that is inside the quiet window in local time.
  const noon = new Date(2030, 0, 1, 12, 0, 0).getTime();
  c.quietHours = { enabled: true, start: '11:00', end: '13:00' };
  const d = decide(ev('turn_end'), null, c, noon);
  assert.equal(d.notify, false);
  assert.equal(d.reason, 'quiet_hours');
});

test('dedupe within the window suppresses', () => {
  const c = cfg({ dedupeWindowMs: 5000 });
  const e = ev('turn_end');
  const state = { turnStartedAt: NOW - 60000, lastNotifyKey: notifyKey(e), lastNotifiedAt: NOW - 1000 };
  const d = decide(e, state, c, NOW);
  assert.equal(d.reason, 'deduped');
});

test('dedupe boundary: exactly at the window edge notifies', () => {
  const c = cfg({ dedupeWindowMs: 5000 });
  const e = ev('turn_end');
  const state = { turnStartedAt: NOW - 60000, lastNotifyKey: notifyKey(e), lastNotifiedAt: NOW - 5000 };
  const d = decide(e, state, c, NOW);
  assert.equal(d.notify, true, 'now - lastNotifiedAt === window is not < window');
});

test('project deny-list suppresses', () => {
  const c = cfg();
  c.projects.deny = ['/home/dev/projects/app'];
  const d = decide(ev('turn_end'), null, c, NOW);
  assert.equal(d.reason, 'project_denied');
});

test('project allow-list: non-matching cwd suppressed', () => {
  const c = cfg();
  c.projects.allow = ['/some/other/place'];
  const d = decide(ev('turn_end'), null, c, NOW);
  assert.equal(d.reason, 'project_not_allowed');
});

test('project allow-list: matching cwd allowed', () => {
  const c = cfg();
  c.projects.allow = ['projects/app'];
  const d = decide(ev('turn_end'), null, c, NOW);
  assert.equal(d.notify, true);
});

test('deny takes precedence over allow', () => {
  const c = cfg();
  c.projects.allow = ['projects/app'];
  c.projects.deny = ['projects/app'];
  const d = decide(ev('turn_end'), null, c, NOW);
  assert.equal(d.reason, 'project_denied');
});

test('inQuietHours handles a window that wraps midnight', () => {
  const q = { enabled: true, start: '23:00', end: '07:00' };
  const at2am = new Date(2030, 0, 1, 2, 0, 0).getTime();
  const at1pm = new Date(2030, 0, 1, 13, 0, 0).getTime();
  const at1130pm = new Date(2030, 0, 1, 23, 30, 0).getTime();
  assert.equal(inQuietHours(at2am, q), true);
  assert.equal(inQuietHours(at1130pm, q), true);
  assert.equal(inQuietHours(at1pm, q), false);
});

test('inQuietHours: disabled always false', () => {
  assert.equal(inQuietHours(Date.now(), { enabled: false, start: '00:00', end: '23:59' }), false);
});
