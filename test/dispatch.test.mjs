import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, buildNotification, humanizeDuration } from '../plugins/claude-nudge/scripts/lib/dispatch.mjs';
import { defaults } from '../plugins/claude-nudge/scripts/lib/config.mjs';

test('humanizeDuration formats seconds/minutes/hours', () => {
  assert.equal(humanizeDuration(3000), '3s');
  assert.equal(humanizeDuration(65000), '1m 5s');
  assert.equal(humanizeDuration(252000), '4m 12s');
  assert.equal(humanizeDuration(3600000), '1h');
  assert.equal(humanizeDuration(3661000), '1h 1m');
  assert.equal(humanizeDuration(-5), '0s');
});

test('buildNotification for turn_end humanizes duration', () => {
  const ev = { kind: 'turn_end', project: 'app', at: 5, message: undefined };
  const n = buildNotification(ev, { priority: 'normal' }, defaults(), { durationMs: 252000 });
  assert.equal(n.title, 'claude-nudge — app');
  assert.equal(n.body, 'Finished — 4m 12s');
  assert.equal(n.at, 5);
});

test('needs_input hides message unless includeMessage is set', () => {
  const ev = { kind: 'needs_input', project: 'app', at: 1, message: 'run rm -rf secret' };
  const off = buildNotification(ev, { priority: 'high' }, { ...defaults(), includeMessage: false }, {});
  assert.equal(off.body, 'Waiting for your input');
  const on = buildNotification(ev, { priority: 'high' }, { ...defaults(), includeMessage: true }, {});
  assert.equal(on.body, 'run rm -rf secret');
});

test('dispatch only calls enabled + configured providers, in parallel', async () => {
  const calls = [];
  const mkProvider = (name, configured) => ({
    name,
    isConfigured: () => configured,
    send: async () => { calls.push(name); },
  });
  const config = defaults();
  config.providers.desktop.enabled = true;
  config.providers.ntfy.enabled = true; // enabled but "not configured" below
  const providers = [mkProvider('desktop', true), mkProvider('ntfy', false)];
  const results = await dispatch({ title: 't', body: 'b', priority: 'normal', tags: [] }, config, { providers });
  assert.deepEqual(calls, ['desktop']);
  assert.deepEqual(results.map((r) => r.provider), ['desktop']);
  assert.equal(results[0].ok, true);
});

test('a failing provider does not block or propagate', async () => {
  const config = defaults();
  config.providers.desktop.enabled = true;
  config.providers.webhook.enabled = true;
  config.providers.webhook.url = 'https://example.com';
  const good = { name: 'desktop', isConfigured: () => true, send: async () => {} };
  const bad = { name: 'webhook', isConfigured: () => true, send: async () => { throw new Error('boom'); } };
  const results = await dispatch({ title: 't', body: 'b', priority: 'normal', tags: [] }, config, { providers: [good, bad] });
  const byName = Object.fromEntries(results.map((r) => [r.provider, r]));
  assert.equal(byName.desktop.ok, true);
  assert.equal(byName.webhook.ok, false);
  assert.match(byName.webhook.error, /boom/);
});
