// desktop.mjs — local OS notification. All subprocess calls use argv arrays (never a shell).
import { detectPlatform } from '../lib/platform.mjs';

function escAppleScript(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
function psQuote(s) { return String(s).replace(/'/g, "''"); }

export default {
  name: 'desktop',
  isConfigured() { return true; },

  async send(n, config, { signal, log, execFile }) {
    const sound = config.providers?.desktop?.sound !== false;
    const plat = detectPlatform();
    if (plat === 'darwin') return sendMac(n, sound, { signal, execFile });
    if (plat === 'linux') return sendLinux(n, { signal, execFile, log });
    if (plat === 'wsl' || plat === 'win32') return sendWindows(n, sound, { signal, execFile });
    log?.debug?.(`desktop: unsupported platform ${plat}`);
    return undefined;
  },
};

async function sendMac(n, sound, { signal, execFile }) {
  let script = `display notification "${escAppleScript(n.body)}" with title "${escAppleScript(n.title)}"`;
  if (sound) script += ' sound name "Glass"';
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

async function sendWindows(n, sound, { signal, execFile }) {
  const title = psQuote(n.title);
  const body = psQuote(n.body);
  const soundCmd = '[System.Media.SystemSounds]::Asterisk.Play()';
  // Prefer a real toast via BurntToast if the module is present; otherwise degrade to sound.
  const script =
    "$ErrorActionPreference='SilentlyContinue'; "
    + 'if (Get-Module -ListAvailable -Name BurntToast) { '
    + `Import-Module BurntToast; New-BurntToastNotification -Text '${title}','${body}'${sound ? `; ${soundCmd}` : ''} `
    + '} '
    + (sound ? `else { ${soundCmd} }` : 'else { }');
  await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { signal });
}
