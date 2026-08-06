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
 * Resolve the desktop `sound` config to a concrete Windows wav path (or null for silent).
 * - false            -> null (no sound)
 * - true / undefined -> the gentle default chime
 * - "<name>"         -> a mapped friendly name (unknown names fall back to the default)
 * - "X:\path.wav"    -> used verbatim
 * @returns {string|null}
 */
export function resolveWindowsSound(soundOpt, env = process.env) {
  if (soundOpt === false) return null;
  const root = env.SystemRoot || env.windir || 'C:\\Windows';
  const media = (file) => `${root}\\Media\\${file}`;
  if (soundOpt === true || soundOpt == null || soundOpt === '') return media(WIN_DEFAULT);
  const s = String(soundOpt).trim();
  if (/\.wav$/i.test(s) && /[\\/:]/.test(s)) return s; // an explicit path
  return media(WIN_SOUNDS[s.toLowerCase()] || WIN_DEFAULT);
}

export default {
  name: 'desktop',
  isConfigured() { return true; },

  async send(n, config, { signal, log, execFile }) {
    const soundOpt = config.providers?.desktop?.sound; // true | false | string
    const plat = detectPlatform();
    if (plat === 'darwin') return sendMac(n, soundOpt, { signal, execFile });
    if (plat === 'linux') return sendLinux(n, { signal, execFile, log });
    if (plat === 'wsl' || plat === 'win32') return sendWindows(n, soundOpt, { signal, execFile });
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

async function sendWindows(n, soundOpt, { signal, execFile }) {
  const title = psQuote(n.title);
  const body = psQuote(n.body);
  const wav = resolveWindowsSound(soundOpt);
  // Play a gentle wav synchronously so a short-lived process finishes the sound.
  const playCmd = wav
    ? `try { (New-Object System.Media.SoundPlayer '${psQuote(wav)}').PlaySync() } catch { }`
    : '';
  // If BurntToast is installed, show a real toast (its default sound is the smooth system chime);
  // otherwise degrade to the gentle wav.
  const script =
    "$ErrorActionPreference='SilentlyContinue'; "
    + 'if (Get-Module -ListAvailable -Name BurntToast) { '
    + `Import-Module BurntToast; New-BurntToastNotification -Text '${title}','${body}'${wav ? '' : ' -Silent'} } `
    + `else { ${playCmd} }`;
  await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { signal });
}
