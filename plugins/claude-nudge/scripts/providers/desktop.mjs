// desktop.mjs — local OS notification. All subprocess calls use argv arrays (never a shell).
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

/**
 * Resolve the desktop `sound` config to a concrete audio file path (or null for silent).
 * - false            -> null (no sound)
 * - true / undefined -> the gentle default chime
 * - "<name>"         -> a mapped friendly name (unknown names fall back to the default)
 * - "X:\my.mp3"      -> used verbatim (any format MediaPlayer supports: mp3, wav, wma, m4a…)
 * @returns {string|null}
 */
export function resolveWindowsSound(soundOpt, env = process.env) {
  if (soundOpt === false) return null;
  const root = env.SystemRoot || env.windir || 'C:\\Windows';
  const media = (file) => `${root}\\Media\\${file}`;
  if (soundOpt === true || soundOpt == null || soundOpt === '') return media(WIN_DEFAULT);
  const s = String(soundOpt).trim();
  if (/[\\/:]/.test(s) && /\.[a-z0-9]{2,4}$/i.test(s)) return s; // an explicit file path, any format
  return media(WIN_SOUNDS[s.toLowerCase()] || WIN_DEFAULT);
}

export default {
  name: 'desktop',
  isConfigured() { return true; },

  async send(n, config, { signal, log, execFile, spawn }) {
    const soundOpt = config.providers?.desktop?.sound; // true | false | string
    const plat = detectPlatform();
    if (plat === 'darwin') return sendMac(n, soundOpt, { signal, execFile });
    if (plat === 'linux') return sendLinux(n, { signal, execFile, log });
    if (plat === 'wsl' || plat === 'win32') return sendWindows(n, soundOpt, { signal, execFile, spawn });
    log?.debug?.(`desktop: unsupported platform ${plat}`);
    return undefined;
  },
};

async function sendMac(n, soundOpt, { signal, execFile }) {
  let script = `display notification "${escAppleScript(n.body)}" with title "${escAppleScript(n.title)}"`;
  const name = soundOpt === false ? null : (typeof soundOpt === 'string' && soundOpt.trim() ? soundOpt.trim() : 'Glass');
  if (name) script += ` sound name "${escAppleScript(name)}"`;
  await execFile('osascript', ['-e', script], { signal });
}

async function sendLinux(n, { signal, execFile, log }) {
  const urgency = n.priority === 'high' ? 'critical' : n.priority === 'low' ? 'low' : 'normal';
  try {
    await execFile('notify-send', ['-a', 'Claude Code', '-u', urgency, n.title, n.body], { signal });
  } catch (e) {
    if (e && e.code === 'ENOENT') { log?.debug?.('desktop: notify-send not installed'); return; }
    throw e;
  }
}

// A self-contained PowerShell program that plays any audio file to completion via
// System.Windows.Media.MediaPlayer (supports mp3/wav/wma/…), capped at 30s.
function buildPlayerScript(wavPath) {
  return [
    "$ErrorActionPreference='SilentlyContinue'",
    'Add-Type -AssemblyName PresentationCore',
    '$p=New-Object System.Windows.Media.MediaPlayer',
    `$p.Open((New-Object System.Uri('${psQuote(wavPath)}')))`,
    '$n=0; while(-not $p.NaturalDuration.HasTimeSpan -and $n -lt 40){ Start-Sleep -Milliseconds 50; $n++ }',
    '$p.Play()',
    '$ms=2000; if($p.NaturalDuration.HasTimeSpan){ $ms=[int]$p.NaturalDuration.TimeSpan.TotalMilliseconds+400 }',
    'if($ms -gt 30000){ $ms=30000 }',
    'Start-Sleep -Milliseconds $ms',
    '$p.Close()',
  ].join('; ');
}

function sendWindows(n, soundOpt, { signal, execFile, spawn }) {
  const wav = resolveWindowsSound(soundOpt);

  // Audio: fire-and-forget a DETACHED player so it plays fully, unbound by the hook's
  // 1.5s dispatch timeout / 2s watchdog. Any format, plays to completion (≤30s).
  if (wav && spawn) {
    try {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', buildPlayerScript(wav)],
        { detached: true, stdio: 'ignore', windowsHide: true },
      );
      child.unref?.();
      child.on?.('error', () => {});
    } catch { /* audio is best-effort */ }
  }

  // Visual: show a real toast if BurntToast is installed (silent — our player owns the sound).
  // If it isn't installed, this is a no-op and the sound alone stands in.
  const title = psQuote(n.title);
  const body = psQuote(n.body);
  const toast = "$ErrorActionPreference='SilentlyContinue'; "
    + 'if (Get-Module -ListAvailable -Name BurntToast) { '
    + `Import-Module BurntToast; New-BurntToastNotification -Text '${title}','${body}' -Silent }`;
  return execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', toast], { signal })
    .catch(() => {}); // toast is best-effort; never fail the notification over it
}
