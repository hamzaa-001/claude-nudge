import { test } from 'node:test';
import assert from 'node:assert/strict';
import telegram from '../../plugins/claude-nudge/scripts/providers/telegram.mjs';

const TOKEN = '123456:AAExampleBotTokenSecret';
const NOTE = {
  title: 'claude-nudge — app', body: 'Waiting for your input', priority: 'high', tags: ['bell'], project: 'app', durationMs: 0, at: 1,
};
const cfg = { providers: { telegram: { enabled: true, botToken: TOKEN, chatId: '99887766' } } };

test('isConfigured requires token and chatId', () => {
  assert.equal(telegram.isConfigured(cfg), true);
  assert.equal(telegram.isConfigured({ providers: { telegram: { botToken: TOKEN } } }), false);
});

test('POSTs JSON to the bot sendMessage endpoint', async () => {
  let call;
  const fetch = async (url, opts) => { call = { url, opts }; return { ok: true, status: 200 }; };
  await telegram.send(NOTE, cfg, { fetch });
  assert.equal(call.url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.equal(call.opts.headers['Content-Type'], 'application/json');
  const body = JSON.parse(call.opts.body);
  assert.equal(body.chat_id, '99887766');
  assert.ok(body.text.includes('Waiting for your input'));
});

test('never logs the token', async () => {
  const lines = [];
  const log = { debug: (m) => lines.push(String(m)) };
  await telegram.send(NOTE, cfg, { fetch: async () => ({ ok: true, status: 200 }), log });
  assert.ok(lines.every((l) => !l.includes(TOKEN)));
});

test('network failure rejects without leaking the token', async () => {
  await telegram.send(NOTE, cfg, {
    fetch: async () => { throw new Error(`connect ECONNREFUSED to https://api.telegram.org/bot${TOKEN}/sendMessage`); },
  }).catch((e) => {
    assert.ok(!e.message.includes(TOKEN), 'sanitized error must not echo the token');
  });
});
