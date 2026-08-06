import { test } from 'node:test';
import assert from 'node:assert/strict';
import ntfy from '../../plugins/claude-nudge/scripts/providers/ntfy.mjs';

const NOTE = {
  title: 'claude-nudge — app', body: 'Finished — 4m 12s', priority: 'high', tags: ['white_check_mark'], project: 'app', durationMs: 252000, at: 1,
};
function cfg(topic = 'super-secret-topic', server = 'https://ntfy.sh') {
  return { providers: { ntfy: { enabled: true, server, topic } } };
}
function capturingLog() {
  const lines = [];
  return { lines, debug: (m) => lines.push(String(m)), provider: () => {} };
}

test('isConfigured requires a topic and server', () => {
  assert.equal(ntfy.isConfigured(cfg()), true);
  assert.equal(ntfy.isConfigured({ providers: { ntfy: { server: 'https://ntfy.sh', topic: null } } }), false);
});

test('POSTs to server/topic with mapped headers', async () => {
  let call;
  const fetch = async (url, opts) => { call = { url, opts }; return { ok: true, status: 200 }; };
  await ntfy.send(NOTE, cfg(), { fetch, log: capturingLog(), signal: undefined });
  assert.equal(call.url, 'https://ntfy.sh/super-secret-topic');
  assert.equal(call.opts.method, 'POST');
  assert.equal(call.opts.body, 'Finished — 4m 12s');
  assert.equal(call.opts.headers.Priority, '4'); // high -> 4
  assert.equal(call.opts.headers.Title, 'claude-nudge - app'); // em dash -> ascii
  assert.equal(call.opts.headers.Tags, 'white_check_mark');
});

test('priority mapping low/normal', async () => {
  const seen = [];
  const fetch = async (_u, opts) => { seen.push(opts.headers.Priority); return { ok: true, status: 200 }; };
  await ntfy.send({ ...NOTE, priority: 'low' }, cfg(), { fetch });
  await ntfy.send({ ...NOTE, priority: 'normal' }, cfg(), { fetch });
  assert.deepEqual(seen, ['2', '3']);
});

test('rejects a non-https server', async () => {
  await assert.rejects(
    () => ntfy.send(NOTE, cfg('t', 'http://ntfy.sh'), { fetch: async () => ({ ok: true }) }),
    /https/,
  );
});

test('never logs the topic — success or failure', async () => {
  const log = capturingLog();
  await ntfy.send(NOTE, cfg(), { fetch: async () => ({ ok: true, status: 200 }), log });
  await ntfy.send(NOTE, cfg(), { fetch: async () => ({ ok: false, status: 403 }), log }).catch((e) => {
    assert.ok(!String(e.message).includes('super-secret-topic'));
  });
  assert.ok(log.lines.every((l) => !l.includes('super-secret-topic')), 'topic must never appear in logs');
});

test('HTTP error status rejects', async () => {
  await assert.rejects(
    () => ntfy.send(NOTE, cfg(), { fetch: async () => ({ ok: false, status: 500 }) }),
    /HTTP 500/,
  );
});
