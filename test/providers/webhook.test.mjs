import { test } from 'node:test';
import assert from 'node:assert/strict';
import webhook from '../../plugins/claude-nudge/scripts/providers/webhook.mjs';

const NOTE = {
  title: 'claude-nudge — app', body: 'Finished — 1m', priority: 'normal', tags: [], project: 'app', durationMs: 60000, at: 42,
};
const cfg = (url, headers = {}) => ({ providers: { webhook: { enabled: true, url, headers } } });

test('posts the documented JSON payload', async () => {
  let call;
  const fetch = async (url, opts) => { call = { url, opts }; return { ok: true, status: 200 }; };
  await webhook.send(NOTE, cfg('https://example.com/hook'), { fetch });
  const body = JSON.parse(call.opts.body);
  assert.deepEqual(body, {
    title: 'claude-nudge — app', body: 'Finished — 1m', priority: 'normal', project: 'app', durationMs: 60000, at: 42,
  });
});

test('refuses non-https remote urls', async () => {
  await assert.rejects(() => webhook.send(NOTE, cfg('http://evil.example.com'), { fetch: async () => ({ ok: true }) }), /https/);
});

test('allows http for loopback hosts', async () => {
  let called = false;
  await webhook.send(NOTE, cfg('http://127.0.0.1:8080/hook'), { fetch: async () => { called = true; return { ok: true, status: 200 }; } });
  assert.ok(called);
});

test('user headers merge but cannot override Content-Type', async () => {
  let call;
  const fetch = async (_u, opts) => { call = opts; return { ok: true, status: 200 }; };
  await webhook.send(NOTE, cfg('https://example.com/hook', { 'content-type': 'text/plain', 'X-Token': 'abc' }), { fetch });
  assert.equal(call.headers['Content-Type'], 'application/json');
  assert.equal(call.headers['X-Token'], 'abc');
});

test('invalid url rejects', async () => {
  await assert.rejects(() => webhook.send(NOTE, cfg('not a url'), { fetch: async () => ({ ok: true }) }), /invalid url/);
});
