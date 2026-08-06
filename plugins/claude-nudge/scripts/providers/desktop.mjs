// desktop.mjs — local OS notification. All subprocess calls use argv arrays (never a shell).
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { detectPlatform } from '../lib/platform.mjs';

function escAppleScript(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
function psQuote(s) { return String(s).replace(/'/g, "''"); }

// Friendly names -> the gentle notification wavs Windows ships in %SystemRoot%\Media.
const WIN_SOUNDS = {
  generic: 'Windows Notify System Generic.wav',
  default: 'Windows Notify System Generic.wav',
  chime: 'Windows Notify System Generic.wav',
  calendar: 'Windows Notify Calendar.wav',
  messaging: 'Windows Notify Messaging.wav',
  email: 'Windows Notify Email.wav',
  mail: 'Windows Notify Email.wav',
  notify: 'Windows Notify.wav',
  ding: 'Windows Ding.wav',
  chimes: 'chimes.wav',
};
const WIN_DEFAULT = 'Windows Notify System Generic.wav';

// A sound file bundled with the plugin (assets/notify.wav|mp3) ships to every install and
// becomes the default sound, so users hear it out of the box without any local file.
const ASSET_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');
export function bundledSound() {
  for (const f of ['notify.wav', 'notify.mp3']) {
    const p = join(ASSET_DIR, f);
    if (existsSync(p)) return p;
  }
  return null;
}

function isFilePath(s) { return /[\\/]/.test(s) && /\.[a-z0-9]{2,4}$/i.test(s); }

/**
 * Resolve the desktop `sound` config to a Windows audio path (or null for silent).
 * @param soundOpt        false | true | undefined | "<name>" | "X:\file.mp3"
 * @param bundledDefault  path to the bundled sound to use when the config is at its default
 */
export function resolveWindowsSound(soundOpt, env = process.env, bundledDefault = null) {
  if (soundOpt === false) return null;
  const root = env.SystemRoot || env.windir || 'C:\\Windows';
  const media = (file) => `${root}\\Media\\${file}`;
  if (soundOpt === true || soundOpt == null || soundOpt === '') return bundledDefault || media(WIN_DEFAULT);
  const s = String(soundOpt).trim();
  if (isFilePath(s)) return s; // an explicit path, any format
  return media(WIN_SOUNDS[s.toLowerCase()] || WIN_DEFAULT);
}

// For macOS/Linux: split the config into "play this file" vs "use this named system sound".
export function resolveUnixSound(soundOpt, bundledDefault = null) {
  if (soundOpt === false) return { file: null, name: null };
  if (typeof soundOpt === 'string' && soundOpt.trim()) {
    const s = soundOpt.trim();
    return isFilePath(s) ? { file: s, name: null } : { file: null, name: s };
  }
  return bundledDefault ? { file: bundledDefault, name: null } : { file: null, name: 'Glass' };
}

function spawnDetached(spawn, cmd, args, extraOpts = {}) {
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', ...extraOpts });
    child.unref?.();
    child.on?.('error', () => {}); // missing player is fine
    return child;
  } catch { return null; }
}

export default {
  name: 'desktop',
  isConfigured() { return true; },

  async send(n, config, { signal, log, execFile, spawn }) {
    const soundOpt = config.providers?.desktop?.sound; // true | false | string
    const bundled = bundledSound();
    const plat = detectPlatform();
    if (plat === 'darwin') return sendMac(n, soundOpt, bundled, { signal, execFile, spawn });
    if (plat === 'linux') return sendLinux(n, soundOpt, bundled, { signal, execFile, spawn, log });
    if (plat === 'wsl' || plat === 'win32') return sendWindows(n, soundOpt, bundled, { execFile, log });
    log?.debug?.(`desktop: unsupported platform ${plat}`);
    return undefined;
  },
};

async function sendMac(n, soundOpt, bundled, { signal, execFile, spawn }) {
  const { file, name } = resolveUnixSound(soundOpt, bundled);
  // Audio: afplay handles mp3/wav/aiff and plays to completion (detached).
  if (file && spawn) spawnDetached(spawn, 'afplay', [file]);
  // Visual: native banner. Only ask osascript to play a sound when we have a system sound NAME
  // (a bundled/custom file is handled by afplay above, so avoid doubling).
  let script = `display notification "${escAppleScript(n.body)}" with title "${escAppleScript(n.title)}"`;
  if (!file && name) script += ` sound name "${escAppleScript(name)}"`;
  await execFile('osascript', ['-e', script], { signal });
}

async function sendLinux(n, soundOpt, bundled, { signal, execFile, spawn, log }) {
  const { file } = resolveUnixSound(soundOpt, bundled);
  if (file && spawn) playLinuxFile(spawn, file);
  const urgency = n.priority === 'high' ? 'critical' : n.priority === 'low' ? 'low' : 'normal';
  try {
    await execFile('notify-send', ['-a', 'Claude Code', '-u', urgency, n.title, n.body], { signal });
  } catch (e) {
    if (e && e.code === 'ENOENT') { log?.debug?.('desktop: notify-send not installed'); return; }
    throw e;
  }
}

// Try audio players in order; each ENOENT falls through to the next (best-effort on Linux).
function playLinuxFile(spawn, file) {
  const candidates = /\.wav$/i.test(file)
    ? [['paplay', [file]], ['aplay', ['-q', file]], ['ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', file]]]
    : [['ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', file]], ['mpg123', ['-q', file]], ['paplay', [file]]];
  let i = 0;
  const tryNext = () => {
    if (i >= candidates.length) return;
    const [cmd, args] = candidates[i++];
    try {
      const c = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      c.unref?.();
      c.on?.('error', tryNext);
    } catch { tryNext(); }
  };
  tryNext();
}

// A self-contained PowerShell program that plays any audio file to completion via
// System.Windows.Media.MediaPlayer (mp3/wav/wma/…), capped at 30s.
function buildPlayerScript(soundPath) {
  return [
    "$ErrorActionPreference='SilentlyContinue'",
    'Add-Type -AssemblyName PresentationCore',
    '$p=New-Object System.Windows.Media.MediaPlayer',
    `$p.Open((New-Object System.Uri('${psQuote(soundPath)}')))`,
    '$n=0; while(-not $p.NaturalDuration.HasTimeSpan -and $n -lt 60){ Start-Sleep -Milliseconds 50; $n++ }',
    '$p.Play()',
    '$ms=2000; if($p.NaturalDuration.HasTimeSpan){ $ms=[int]$p.NaturalDuration.TimeSpan.TotalMilliseconds+400 }',
    'if($ms -gt 30000){ $ms=30000 }',
    'Start-Sleep -Milliseconds $ms',
    '$p.Close()',
  ].join('; ');
}

async function sendWindows(n, soundOpt, bundled, { execFile, log }) {
  const sound = resolveWindowsSound(soundOpt, process.env, bundled);

  // Visual: a real toast if BurntToast is installed (silent — the player owns the sound).
  // Fire it alongside the audio; don't block the sound on it.
  const title = psQuote(n.title);
  const body = psQuote(n.body);
  const toast = "$ErrorActionPreference='SilentlyContinue'; "
    + 'if (Get-Module -ListAvailable -Name BurntToast) { '
    + `Import-Module BurntToast; New-BurntToastNotification -Text '${title}','${body}' -Silent }`;
  const toastP = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', toast], { timeout: 5000 })
    .catch(() => {});

  // Audio: play SYNCHRONOUSLY. Claude Code runs hooks in a Windows job object that kills
  // detached children when the hook exits, so we must let the sound finish before returning.
  // No dispatch AbortSignal here (that 1.5s cap is for network providers); own 31s hard cap.
  if (sound) {
    const t0 = Date.now();
    try {
      await execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', buildPlayerScript(sound)],
        { timeout: 31000, windowsHide: true },
      );
      log?.debug?.(`desktop: played ${sound} in ${Date.now() - t0}ms`);
    } catch (e) {
      log?.debug?.(`desktop: player failed after ${Date.now() - t0}ms (${e?.code || e?.message || 'error'})`);
    }
  }
  await toastP;
}
