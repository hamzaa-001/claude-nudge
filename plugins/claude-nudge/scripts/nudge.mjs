#!/usr/bin/env node
// nudge.mjs — single entrypoint for every hook event, plus --test / --status CLI modes.
// Contract: every path exits 0, all errors swallowed, self-terminates at 2s.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readStdin, parseEvent } from './lib/event.mjs';
import { loadConfig } from './lib/config.mjs';
import {
  readState, writeState, deleteState, pruneSessions, DEFAULT_BASE_DIR,
} from './lib/state.mjs';
import { decide, notifyKey } from './lib/rules.mjs';
import { dispatch, buildNotification } from './lib/dispatch.mjs';
import { createLogger, redactConfig } from './lib/logger.mjs';
import { detectPlatform } from './lib/platform.mjs';
import { providers } from './providers/index.mjs';

const WATCHDOG_MS = 2000;
const pad = (s) => String(s).padEnd(10);

let hookMode = true;

function envDebug() {
  const v = process.env.NUDGE_DEBUG ?? process.env.CLAUDE_PLUGIN_OPTION_DEBUG;
  return v != null && ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

async function runHook(logger) {
  const now = Date.now();
  const event = parseEvent(await readStdin(), now);
  if (!event) { logger.debug('no valid event on stdin'); return; }

  const config = loadConfig({ cwd: event.cwd, onWarn: (m) => logger.debug(`config: ${m}`) });
  logger.setEnabled(config.debug || logger.enabled);
  const baseDir = DEFAULT_BASE_DIR;

  if (event.kind === 'turn_start') {
    // Hot path: stamp the start time and get out. Never notifies.
    const st = readState(event.sessionId, baseDir) || {};
    writeState(event.sessionId, {
      ...st, sessionId: event.sessionId, cwd: event.cwd, turnStartedAt: now, updatedAt: now,
    }, baseDir);
    return;
  }

  if (event.kind === 'session_end') {
    if (config.events?.session_end) {
      const st = readState(event.sessionId, baseDir);
      const decision = decide(event, st, config, now);
      logger.decision(event, decision);
      if (decision.notify) {
        await dispatch(buildNotification(event, decision, config, {}), config, { providers, log: logger });
      }
    }
    deleteState(event.sessionId, baseDir);
    pruneSessions({ baseDir, now });
    return;
  }

  // turn_end | needs_input
  const state = readState(event.sessionId, baseDir);
  const decision = decide(event, state, config, now);
  logger.decision(event, decision);

  const next = {
    ...(state || {}), sessionId: event.sessionId, cwd: event.cwd, updatedAt: now,
  };
  if (decision.notify) {
    const durationMs = event.kind === 'turn_end' && state && typeof state.turnStartedAt === 'number'
      ? Math.max(0, now - state.turnStartedAt) : 0;
    await dispatch(buildNotification(event, decision, config, { durationMs }), config, { providers, log: logger });
    next.lastNotifiedAt = now;
    next.lastNotifyKey = notifyKey(event);
  }
  writeState(event.sessionId, next, baseDir);
}

async function runTest(logger) {
  const config = loadConfig({ cwd: process.cwd() });
  const now = Date.now();
  const notification = {
    title: 'claude-nudge — test',
    body: 'Test notification from claude-nudge',
    priority: 'normal',
    tags: ['test_tube'],
    project: 'claude-nudge',
    durationMs: 0,
    at: now,
  };

  const report = [];
  for (const p of providers) {
    const enabled = !!config.providers?.[p.name]?.enabled;
    let configured = false;
    try { configured = !!p.isConfigured(config); } catch { /* treat as not configured */ }
    if (!enabled) { report.push({ provider: p.name, status: 'skipped', reason: 'disabled in config' }); continue; }
    if (!configured) { report.push({ provider: p.name, status: 'skipped', reason: 'enabled but not configured' }); continue; }
    const [res] = await dispatch(notification, config, { providers: [p], log: logger });
    if (res?.ok) report.push({ provider: p.name, status: 'sent' });
    else report.push({ provider: p.name, status: 'failed', reason: res?.error || 'unknown error' });
  }

  const lines = ['claude-nudge test — sending through every configured provider', ''];
  for (const r of report) lines.push(`  ${pad(r.provider)} ${r.status}${r.reason ? ` — ${r.reason}` : ''}`);
  if (report.every((r) => r.status === 'skipped')) {
    lines.push('', 'No providers are configured. See /claude-nudge:status and docs/CONFIGURATION.md.');
  }
  lines.push('', JSON.stringify({ report }, null, 2));
  process.stdout.write(`${lines.join('\n')}\n`);
}

function readRecentDecisions(n) {
  try {
    const lines = readFileSync(join(homedir(), '.claude', 'nudge', 'debug.log'), 'utf8').trim().split('\n');
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
      try { const o = JSON.parse(lines[i]); if (o.type === 'decision') out.push(o); } catch { /* skip */ }
    }
    return out.reverse();
  } catch { return []; }
}

async function runStatus() {
  const config = loadConfig({ cwd: process.cwd() });
  const out = [];
  out.push('claude-nudge status');
  out.push(`  platform:       ${detectPlatform()}`);
  out.push(`  enabled:        ${config.enabled}`);
  out.push(`  minDurationMs:  ${config.minDurationMs}`);
  out.push(`  includeMessage: ${config.includeMessage}`);
  out.push(`  quietHours:     ${config.quietHours.enabled ? `${config.quietHours.start}–${config.quietHours.end}` : 'off'}`);
  out.push('  providers:');
  for (const p of providers) {
    const enabled = !!config.providers?.[p.name]?.enabled;
    let configured = false;
    try { configured = !!p.isConfigured(config); } catch { /* ignore */ }
    const readiness = enabled && configured ? 'ready' : enabled ? 'enabled, NOT configured' : 'disabled';
    out.push(`    ${pad(p.name)} ${readiness}`);
  }
  const decisions = readRecentDecisions(10);
  out.push(`  recent decisions (${decisions.length}):`);
  if (!decisions.length && !config.debug) out.push('    (enable debug to record decisions)');
  for (const d of decisions) out.push(`    ${d.t || ''}  ${pad(d.event)} notify=${d.notify} reason=${d.reason}`);
  out.push('');
  out.push('resolved config (secrets redacted):');
  out.push(JSON.stringify(redactConfig(config), null, 2));
  process.stdout.write(`${out.join('\n')}\n`);
}

async function main() {
  const logger = createLogger(envDebug());
  const argv = process.argv.slice(2);
  if (argv.includes('--test')) { hookMode = false; return runTest(logger); }
  if (argv.includes('--status')) { hookMode = false; return runStatus(); }
  await runHook(logger);
  // async hooks discard stdout, but the sync hooks read it — keep our output out of the transcript.
  try { process.stdout.write('{"suppressOutput":true}\n'); } catch { /* ignore */ }
  return undefined;
}

const watchdog = setTimeout(() => {
  try { if (hookMode) process.stdout.write('{"suppressOutput":true}\n'); } catch { /* ignore */ }
  process.exit(0);
}, WATCHDOG_MS);
watchdog.unref();

main().catch(() => {}).finally(() => { clearTimeout(watchdog); process.exit(0); });
