// guard.mjs — enforce the hard constraints on the shipped plugin source.
//  1. no `shell: true` anywhere
//  2. no relative import escapes the plugin root (the cache copy won't contain outside files)
//  3. no runtime `dependencies` in the plugin package.json
//  4. no hardcoded plugin-cache/home absolute paths
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, sep } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PLUGIN = join(root, 'plugins', 'claude-nudge');

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const errors = [];
const files = walk(PLUGIN);

// 1 + 4: string scans over source files.
const IMPORT_RE = /(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
for (const file of files.filter((f) => /\.(mjs|js)$/.test(f))) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(root, file);

  if (/shell\s*:\s*true/.test(src)) errors.push(`${rel}: contains "shell: true"`);
  if (/\/Users\/|\/home\/[^$]|C:\\\\Users/.test(src)) errors.push(`${rel}: contains a hardcoded absolute user path`);

  // 2: resolve every relative import against the plugin root.
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src))) {
    const spec = m[1] || m[2];
    if (!spec || !spec.startsWith('.')) continue; // bare/builtin imports are fine
    const resolved = resolve(dirname(file), spec);
    const relToPlugin = relative(PLUGIN, resolved);
    if (relToPlugin.startsWith('..') || relToPlugin.includes(`..${sep}`)) {
      errors.push(`${rel}: import "${spec}" escapes the plugin root`);
    }
  }
}

// 3: no runtime dependencies in the plugin manifest.
try {
  const pkg = JSON.parse(readFileSync(join(PLUGIN, 'package.json'), 'utf8'));
  const deps = pkg.dependencies && Object.keys(pkg.dependencies);
  if (deps && deps.length) errors.push(`plugins/claude-nudge/package.json: has runtime dependencies: ${deps.join(', ')}`);
} catch (e) {
  errors.push(`could not read plugin package.json: ${e.message}`);
}

if (errors.length) {
  process.stdout.write(`guard: ${errors.length} problem(s):\n`);
  for (const e of errors) process.stdout.write(`  - ${e}\n`);
  process.exit(1);
}
process.stdout.write('guard: ok — zero-dep, no shell, no path escapes\n');
