import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, defaults } from '../plugins/claude-nudge/scripts/lib/config.mjs';

function tempHome() { return mkdtempSync(join(tmpdir(), 'nudge-home-')); }
function writeHomeConfig(home, obj) {
  const dir = join(home, '.claude', 'nudge');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(obj));
}
function writeProjectConfig(cwd, obj) {
  const dir = join(cwd, '.claude');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'nudge.json'), JSON.stringify(obj));
}

test('defaults are returned when nothing overrides', () => {
  const c = loadConfig({ cwd: undefined, env: {}, homeDir: tempHome() });
  assert.equal(c.minDurationMs, 30000);
  assert.equal(c.providers.desktop.enabled, true);
  assert.equal(c.providers.ntfy.enabled, false);
});

test('precedence: env > project > home > defaults', () => {
  const home = tempHome();
  const cwd = mkdtempSync(join(tmpdir(), 'nudge-proj-'));
  writeHomeConfig(home, { minDurationMs: 10000 });
  writeProjectConfig(cwd, { minDurationMs: 20000 });
  const c = loadConfig({ cwd, env: { NUDGE_MIN_DURATION_MS: '40000' }, homeDir: home });
  assert.equal(c.minDurationMs, 40000);

  const c2 = loadConfig({ cwd, env: {}, homeDir: home });
  assert.equal(c2.minDurationMs, 20000, 'project overrides home');
});

test('deep merge preserves untouched sibling keys', () => {
  const home = tempHome();
  writeHomeConfig(home, { providers: { ntfy: { enabled: true, topic: 'abc' } } });
  const c = loadConfig({ cwd: undefined, env: {}, homeDir: home });
  assert.equal(c.providers.ntfy.enabled, true);
  assert.equal(c.providers.ntfy.topic, 'abc');
  assert.equal(c.providers.ntfy.server, 'https://ntfy.sh', 'default server survives the merge');
  assert.equal(c.providers.desktop.enabled, true, 'sibling provider untouched');
});

test('invalid values fall back rather than throw', () => {
  const home = tempHome();
  writeHomeConfig(home, {
    minDurationMs: 'not-a-number',
    quietHours: { enabled: true, start: '99:99', end: '07:00' },
    events: 'nonsense',
  });
  let warned = 0;
  const c = loadConfig({ cwd: undefined, env: {}, homeDir: home, onWarn: () => { warned++; } });
  assert.equal(c.minDurationMs, defaults().minDurationMs);
  assert.equal(c.quietHours.start, '23:00');
  assert.equal(c.events.turn_end, true);
  assert.ok(warned > 0, 'invalid values are reported via onWarn');
});

test('corrupt config file is ignored, not fatal', () => {
  const home = tempHome();
  const dir = join(home, '.claude', 'nudge');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), '{ broken');
  const c = loadConfig({ cwd: undefined, env: {}, homeDir: home });
  assert.equal(c.minDurationMs, 30000);
});

test('userConfig env vars map in and auto-enable ntfy', () => {
  const c = loadConfig({
    cwd: undefined,
    homeDir: tempHome(),
    env: {
      CLAUDE_PLUGIN_OPTION_NTFYTOPIC: 'my-secret-topic',
      CLAUDE_PLUGIN_OPTION_MINDURATIONSECONDS: '45',
      CLAUDE_PLUGIN_OPTION_DEBUG: 'true',
    },
  });
  assert.equal(c.providers.ntfy.enabled, true);
  assert.equal(c.providers.ntfy.topic, 'my-secret-topic');
  assert.equal(c.minDurationMs, 45000);
  assert.equal(c.debug, true);
});

test('desktop.sound preserves a string name, keeps false, defaults to true', () => {
  const home = tempHome();
  writeHomeConfig(home, { providers: { desktop: { sound: 'calendar' } } });
  assert.equal(loadConfig({ homeDir: home, env: {} }).providers.desktop.sound, 'calendar');

  const home2 = tempHome();
  writeHomeConfig(home2, { providers: { desktop: { sound: false } } });
  assert.equal(loadConfig({ homeDir: home2, env: {} }).providers.desktop.sound, false);

  assert.equal(loadConfig({ homeDir: tempHome(), env: {} }).providers.desktop.sound, true);
});

test('NUDGE_DESKTOP_SOUND accepts a name or a boolean', () => {
  assert.equal(loadConfig({ homeDir: tempHome(), env: { NUDGE_DESKTOP_SOUND: 'messaging' } }).providers.desktop.sound, 'messaging');
  assert.equal(loadConfig({ homeDir: tempHome(), env: { NUDGE_DESKTOP_SOUND: 'false' } }).providers.desktop.sound, false);
});

test('numeric clamping keeps values in range', () => {
  const c = loadConfig({ cwd: undefined, homeDir: tempHome(), env: { NUDGE_MIN_DURATION_MS: '-500' } });
  assert.equal(c.minDurationMs, 0);
});
