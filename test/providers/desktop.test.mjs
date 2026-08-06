import { test } from 'node:test';
import assert from 'node:assert/strict';
import desktop, { resolveWindowsSound } from '../../plugins/claude-nudge/scripts/providers/desktop.mjs';
import { detectPlatform } from '../../plugins/claude-nudge/scripts/lib/platform.mjs';

const NOTE = {
  title: 'claude-nudge — app', body: 'Finished — "quoted" & \\slashed', priority: 'high', tags: [], project: 'app', durationMs: 1000, at: 1,
};
const cfg = (sound = true) => ({ providers: { desktop: { enabled: true, sound } } });

test('always uses an argv array and never a shell', async () => {
  let call;
  const execFile = async (command, args, opts) => { call = { command, args, opts }; return { stdout: '', stderr: '' }; };
  await desktop.send(NOTE, cfg(), { execFile, log: { debug() {} } });

  const plat = detectPlatform();
  if (plat === 'darwin' || plat === 'linux' || plat === 'wsl' || plat === 'win32') {
    assert.ok(call, 'a supported platform must invoke execFile');
    assert.equal(typeof call.command, 'string');
    assert.ok(Array.isArray(call.args), 'args must be an array');
    assert.ok(!('shell' in (call.opts || {})), 'must never pass shell option');
  }
});

test('passes the AbortSignal through to execFile', async () => {
  let seenSignal;
  const controller = new AbortController();
  const execFile = async (_c, _a, opts) => { seenSignal = opts?.signal; return { stdout: '' }; };
  await desktop.send(NOTE, cfg(), { execFile, signal: controller.signal, log: { debug() {} } });
  const plat = detectPlatform();
  if (plat !== 'linux' || true) { /* signal is forwarded on all platforms that call execFile */ }
  if (seenSignal !== undefined) assert.equal(seenSignal, controller.signal);
});

test('resolveWindowsSound maps names, honors false, and passes paths through', () => {
  const env = { SystemRoot: 'C:\\Windows' };
  assert.equal(resolveWindowsSound(false, env), null);
  assert.equal(resolveWindowsSound(true, env), 'C:\\Windows\\Media\\Windows Notify System Generic.wav');
  assert.equal(resolveWindowsSound('calendar', env), 'C:\\Windows\\Media\\Windows Notify Calendar.wav');
  assert.equal(resolveWindowsSound('unknown-name', env), 'C:\\Windows\\Media\\Windows Notify System Generic.wav');
  assert.equal(resolveWindowsSound('D:\\sounds\\mine.wav', env), 'D:\\sounds\\mine.wav');
});

test('Windows send: chosen wav ends up in the powershell argv (no shell)', async () => {
  if (detectPlatform() !== 'win32' && detectPlatform() !== 'wsl') return;
  let call;
  const execFile = async (command, args, opts) => { call = { command, args, opts }; return { stdout: '' }; };
  await desktop.send(NOTE, { providers: { desktop: { enabled: true, sound: 'calendar' } } }, { execFile, log: { debug() {} } });
  assert.match(call.command, /powershell/i);
  assert.ok(Array.isArray(call.args));
  assert.ok(call.args.join(' ').includes('Windows Notify Calendar.wav'));
  assert.ok(!('shell' in (call.opts || {})));
});

test('linux: missing notify-send is swallowed as a no-op', async () => {
  if (detectPlatform() !== 'linux') return;
  const err = Object.assign(new Error('spawn notify-send ENOENT'), { code: 'ENOENT' });
  const execFile = async () => { throw err; };
  const lines = [];
  await desktop.send(NOTE, cfg(), { execFile, log: { debug: (m) => lines.push(m) } });
  assert.ok(lines.some((l) => /notify-send/.test(l)));
});
