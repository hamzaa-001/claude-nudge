import { test } from 'node:test';
import assert from 'node:assert/strict';
import desktop, { resolveWindowsSound, resolveUnixSound } from '../../plugins/claude-nudge/scripts/providers/desktop.mjs';
import { detectPlatform } from '../../plugins/claude-nudge/scripts/lib/platform.mjs';

const NOTE = {
  title: 'claude-nudge — app', body: 'Finished — "quoted" & \\slashed', priority: 'high', tags: [], project: 'app', durationMs: 1000, at: 1,
};
const cfg = (sound = true) => ({ providers: { desktop: { enabled: true, sound } } });

// Capture both execFile (toast / mac / linux) and spawn (windows audio).
function harness() {
  const execCalls = [];
  const spawnCalls = [];
  const execFile = async (command, args, opts) => { execCalls.push({ command, args, opts }); return { stdout: '', stderr: '' }; };
  const spawn = (command, args, opts) => { spawnCalls.push({ command, args, opts }); return { unref() {}, on() {} }; };
  return { execCalls, spawnCalls, execFile, spawn, log: { debug() {} } };
}

test('every subprocess call uses an argv array and never a shell', async () => {
  const h = harness();
  await desktop.send(NOTE, cfg(), { execFile: h.execFile, spawn: h.spawn, log: h.log });
  for (const c of [...h.execCalls, ...h.spawnCalls]) {
    assert.equal(typeof c.command, 'string');
    assert.ok(Array.isArray(c.args), 'args must be an array');
    assert.ok(!('shell' in (c.opts || {})), 'must never pass a shell option');
  }
});

test('resolveWindowsSound: names map, false silences, and any file path passes through', () => {
  const env = { SystemRoot: 'C:\\Windows' };
  assert.equal(resolveWindowsSound(false, env), null);
  assert.equal(resolveWindowsSound(true, env), 'C:\\Windows\\Media\\Windows Notify System Generic.wav');
  assert.equal(resolveWindowsSound('calendar', env), 'C:\\Windows\\Media\\Windows Notify Calendar.wav');
  assert.equal(resolveWindowsSound('unknown-name', env), 'C:\\Windows\\Media\\Windows Notify System Generic.wav');
  assert.equal(resolveWindowsSound('D:\\sounds\\mine.wav', env), 'D:\\sounds\\mine.wav');
  assert.equal(resolveWindowsSound('F:\\clip\\custom.mp3', env), 'F:\\clip\\custom.mp3'); // mp3 supported
});

test('resolveWindowsSound: a bundled default is used when config is at default', () => {
  const env = { SystemRoot: 'C:\\Windows' };
  const bundled = 'C:\\plug\\assets\\notify.mp3';
  assert.equal(resolveWindowsSound(true, env, bundled), bundled);
  assert.equal(resolveWindowsSound(undefined, env, bundled), bundled);
  assert.equal(resolveWindowsSound(false, env, bundled), null, 'false still silences over a bundled default');
  assert.equal(resolveWindowsSound('ding', env, bundled), 'C:\\Windows\\Media\\Windows Ding.wav', 'explicit choice overrides bundled');
});

test('resolveUnixSound: file paths vs system-sound names vs bundled default', () => {
  assert.deepEqual(resolveUnixSound(false), { file: null, name: null });
  assert.deepEqual(resolveUnixSound('Glass'), { file: null, name: 'Glass' });
  assert.deepEqual(resolveUnixSound('/home/me/s.wav'), { file: '/home/me/s.wav', name: null });
  assert.deepEqual(resolveUnixSound(true, '/plug/assets/notify.mp3'), { file: '/plug/assets/notify.mp3', name: null });
  assert.deepEqual(resolveUnixSound(true), { file: null, name: 'Glass' });
});

test('Windows: audio plays SYNCHRONOUSLY via execFile with the resolved file (survives the job object)', async () => {
  if (detectPlatform() !== 'win32' && detectPlatform() !== 'wsl') return;
  const h = harness();
  await desktop.send(NOTE, cfg('F:\\clip\\custom.mp3'), { execFile: h.execFile, spawn: h.spawn, log: h.log });
  const player = h.execCalls.find((c) => c.args.join(' ').includes('MediaPlayer'));
  assert.ok(player, 'the audio player must run via execFile (awaited), not a detached spawn');
  assert.ok(player.args.join(' ').includes('custom.mp3'), 'the chosen file must reach the player');
  assert.ok(!('signal' in (player.opts || {})), 'the 1.5s network AbortSignal must not cut local audio');
  assert.equal(player.opts.timeout, 31000, 'player has its own hard cap');
  assert.equal(h.spawnCalls.length, 0, 'Windows no longer detaches audio');
});

test('Windows: sound=false plays no audio', async () => {
  if (detectPlatform() !== 'win32' && detectPlatform() !== 'wsl') return;
  const h = harness();
  await desktop.send(NOTE, cfg(false), { execFile: h.execFile, spawn: h.spawn, log: h.log });
  assert.ok(!h.execCalls.some((c) => c.args.join(' ').includes('MediaPlayer')), 'no player when silent');
});

test('linux: missing notify-send is swallowed as a no-op', async () => {
  if (detectPlatform() !== 'linux') return;
  const err = Object.assign(new Error('spawn notify-send ENOENT'), { code: 'ENOENT' });
  const execFile = async () => { throw err; };
  const lines = [];
  await desktop.send(NOTE, cfg(), { execFile, log: { debug: (m) => lines.push(m) } });
  assert.ok(lines.some((l) => /notify-send/.test(l)));
});
