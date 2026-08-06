// platform.mjs — detect the host once per process.
import { readFileSync } from 'node:fs';
import { platform as osPlatform } from 'node:os';

let cached = null;

/** @returns {'darwin'|'linux'|'wsl'|'win32'|string} */
export function detectPlatform() {
  if (cached) return cached;
  const p = osPlatform();
  if (p === 'win32') return (cached = 'win32');
  if (p === 'darwin') return (cached = 'darwin');
  if (p === 'linux') {
    try {
      if (/microsoft/i.test(readFileSync('/proc/version', 'utf8'))) return (cached = 'wsl');
    } catch { /* /proc/version unreadable => plain linux */ }
    return (cached = 'linux');
  }
  return (cached = p);
}

/** Test helper: forget the cached detection. */
export function _resetPlatformCache() { cached = null; }
