// smoke.mjs — pipe every fixture (plus edge cases) through nudge.mjs and assert:
// exit code 0, and valid JSON on stdout. A dev/CI tool; not part of the shipped plugin.
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const NUDGE = join(root, 'plugins', 'claude-nudge', 'scripts', 'nudge.mjs');
const FIXTURES = join(root, 'test', 'fixtures');

function run(input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [NUDGE], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, out, err }));
    child.stdin.end(input);
  });
}

const cases = [];
for (const f of readdirSync(FIXTURES)) {
  if (f.endsWith('.json')) cases.push({ name: f, input: readFileSync(join(FIXTURES, f), 'utf8') });
}
cases.push({ name: '<empty stdin>', input: '' });
cases.push({ name: '<garbage>', input: 'this is not json at all' });
cases.push({ name: '<truncated json>', input: '{"hook_event_name":"Stop"' });

let failed = 0;
for (const c of cases) {
  // eslint-disable-next-line no-await-in-loop
  const { code, out, err } = await run(c.input);
  let ok = code === 0;
  let detail = `exit ${code}`;
  if (ok) {
    try { JSON.parse(out.trim() || '{}'); detail = 'exit 0, valid json'; } catch { ok = false; detail = `exit 0 but stdout not json: ${JSON.stringify(out.slice(0, 80))}`; }
  }
  if (err.trim()) detail += ` (stderr: ${err.trim().slice(0, 80)})`;
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${c.name.padEnd(28)} ${detail}\n`);
  if (!ok) failed++;
}

process.stdout.write(`\n${cases.length - failed}/${cases.length} passed\n`);
process.exit(failed ? 1 : 0);
