// config.mjs — layered config resolution. Never throws; invalid values fall back.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const RAW_DEFAULTS = {
  enabled: true,
  minDurationMs: 30000,
  dedupeWindowMs: 5000,
  includeMessage: false,
  events: { turn_end: true, needs_input: true, session_end: false },
  quietHours: { enabled: false, start: '23:00', end: '07:00' },
  projects: { allow: [], deny: [] },
  providers: {
    desktop: { enabled: true, sound: true },
    ntfy: { enabled: false, server: 'https://ntfy.sh', topic: null },
    telegram: { enabled: false, botToken: null, chatId: null },
    webhook: { enabled: false, url: null, headers: {} },
  },
  debug: false,
};

export function defaults() { return structuredClone(RAW_DEFAULTS); }

function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

/** Deep-merge: objects merge recursively, arrays and scalars replace. */
function deepMerge(base, override) {
  if (!isPlainObject(override)) return base;
  const out = isPlainObject(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(override)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

function readJsonSafe(path, onWarn) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') onWarn?.(`ignoring invalid config ${path}: ${e.message}`);
    return {};
  }
}

function toBool(v) {
  if (v == null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return undefined;
}
function toNum(v) {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function assign(obj, path, val) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isPlainObject(cur[parts[i]])) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
}

function applyEnv(cfg, env) {
  const set = (path, val) => { if (val !== undefined) assign(cfg, path, val); };

  // Lower precedence: plugin userConfig, exported as CLAUDE_PLUGIN_OPTION_<KEY>.
  set('providers.desktop.enabled', toBool(env.CLAUDE_PLUGIN_OPTION_DESKTOPENABLED));
  set('debug', toBool(env.CLAUDE_PLUGIN_OPTION_DEBUG));
  { const n = toNum(env.CLAUDE_PLUGIN_OPTION_MINDURATIONSECONDS); if (n !== undefined) set('minDurationMs', n * 1000); }
  { const t = env.CLAUDE_PLUGIN_OPTION_NTFYTOPIC; if (t) { set('providers.ntfy.topic', t); set('providers.ntfy.enabled', true); } }

  // Highest precedence: explicit NUDGE_* environment variables.
  set('enabled', toBool(env.NUDGE_ENABLED));
  set('minDurationMs', toNum(env.NUDGE_MIN_DURATION_MS));
  set('dedupeWindowMs', toNum(env.NUDGE_DEDUPE_WINDOW_MS));
  set('includeMessage', toBool(env.NUDGE_INCLUDE_MESSAGE));
  set('debug', toBool(env.NUDGE_DEBUG));
  set('quietHours.enabled', toBool(env.NUDGE_QUIET_HOURS_ENABLED));
  if (env.NUDGE_QUIET_START) set('quietHours.start', env.NUDGE_QUIET_START);
  if (env.NUDGE_QUIET_END) set('quietHours.end', env.NUDGE_QUIET_END);
  set('providers.desktop.enabled', toBool(env.NUDGE_DESKTOP_ENABLED));
  if (env.NUDGE_DESKTOP_SOUND != null) {
    const b = toBool(env.NUDGE_DESKTOP_SOUND); // "true"/"false" -> boolean; a name -> string
    set('providers.desktop.sound', b === undefined ? env.NUDGE_DESKTOP_SOUND : b);
  }
  set('providers.ntfy.enabled', toBool(env.NUDGE_NTFY_ENABLED));
  if (env.NUDGE_NTFY_SERVER) set('providers.ntfy.server', env.NUDGE_NTFY_SERVER);
  if (env.NUDGE_NTFY_TOPIC) set('providers.ntfy.topic', env.NUDGE_NTFY_TOPIC);
  set('providers.telegram.enabled', toBool(env.NUDGE_TELEGRAM_ENABLED));
  if (env.NUDGE_TELEGRAM_BOT_TOKEN) set('providers.telegram.botToken', env.NUDGE_TELEGRAM_BOT_TOKEN);
  if (env.NUDGE_TELEGRAM_CHAT_ID) set('providers.telegram.chatId', env.NUDGE_TELEGRAM_CHAT_ID);
  set('providers.webhook.enabled', toBool(env.NUDGE_WEBHOOK_ENABLED));
  if (env.NUDGE_WEBHOOK_URL) set('providers.webhook.url', env.NUDGE_WEBHOOK_URL);
  return cfg;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
function clampNum(v, min, max, def, name, onWarn) {
  if (typeof v !== 'number' || !Number.isFinite(v)) { onWarn?.(`invalid ${name}, using ${def}`); return def; }
  return Math.min(max, Math.max(min, v));
}

/** Coerce/clamp every field; on invalid input fall back to the default rather than throw. */
function validate(cfg, onWarn) {
  cfg.enabled = cfg.enabled !== false;
  cfg.minDurationMs = clampNum(cfg.minDurationMs, 0, 24 * 3600 * 1000, RAW_DEFAULTS.minDurationMs, 'minDurationMs', onWarn);
  cfg.dedupeWindowMs = clampNum(cfg.dedupeWindowMs, 0, 3600 * 1000, RAW_DEFAULTS.dedupeWindowMs, 'dedupeWindowMs', onWarn);
  cfg.includeMessage = !!cfg.includeMessage;
  cfg.debug = !!cfg.debug;

  if (!isPlainObject(cfg.events)) cfg.events = structuredClone(RAW_DEFAULTS.events);
  for (const k of Object.keys(RAW_DEFAULTS.events)) {
    if (typeof cfg.events[k] !== 'boolean') cfg.events[k] = RAW_DEFAULTS.events[k];
  }

  if (!isPlainObject(cfg.quietHours)) cfg.quietHours = structuredClone(RAW_DEFAULTS.quietHours);
  cfg.quietHours.enabled = !!cfg.quietHours.enabled;
  if (!TIME_RE.test(cfg.quietHours.start)) { onWarn?.('invalid quietHours.start'); cfg.quietHours.start = RAW_DEFAULTS.quietHours.start; }
  if (!TIME_RE.test(cfg.quietHours.end)) { onWarn?.('invalid quietHours.end'); cfg.quietHours.end = RAW_DEFAULTS.quietHours.end; }

  if (!isPlainObject(cfg.projects)) cfg.projects = structuredClone(RAW_DEFAULTS.projects);
  cfg.projects.allow = Array.isArray(cfg.projects.allow) ? cfg.projects.allow.map(String) : [];
  cfg.projects.deny = Array.isArray(cfg.projects.deny) ? cfg.projects.deny.map(String) : [];

  if (!isPlainObject(cfg.providers)) cfg.providers = structuredClone(RAW_DEFAULTS.providers);
  for (const [name, def] of Object.entries(RAW_DEFAULTS.providers)) {
    if (!isPlainObject(cfg.providers[name])) cfg.providers[name] = structuredClone(def);
    else cfg.providers[name] = { ...structuredClone(def), ...cfg.providers[name] };
  }
  cfg.providers.desktop.enabled = !!cfg.providers.desktop.enabled;
  // sound may be false (silent), true (default chime), or a string (named sound / wav path).
  const snd = cfg.providers.desktop.sound;
  if (snd === false) cfg.providers.desktop.sound = false;
  else if (typeof snd === 'string' && snd.trim()) cfg.providers.desktop.sound = snd.trim();
  else cfg.providers.desktop.sound = true;
  if (!isPlainObject(cfg.providers.webhook.headers)) cfg.providers.webhook.headers = {};
  return cfg;
}

/**
 * Resolve config, lowest→highest: defaults, ~/.claude/nudge/config.json,
 * <cwd>/.claude/nudge.json, environment.
 */
export function loadConfig({ cwd, env = process.env, homeDir = homedir(), onWarn } = {}) {
  let cfg = defaults();
  cfg = deepMerge(cfg, readJsonSafe(join(homeDir, '.claude', 'nudge', 'config.json'), onWarn));
  if (cwd) cfg = deepMerge(cfg, readJsonSafe(join(cwd, '.claude', 'nudge.json'), onWarn));
  applyEnv(cfg, env);
  validate(cfg, onWarn);
  return cfg;
}
