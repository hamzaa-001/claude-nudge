import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import {
  safeSessionId, sessionPath, readState, writeState, deleteState, pruneSessions,
} from '../plugins/claude-nudge/scripts/lib/state.mjs';

function freshBase() { return mkdtempSync(join(tmpdir(), 'nudge-state-')); }

test('safeSessionId strips path-traversal characters', () => {
  assert.equal(safeSessionId('../../etc/passwd'), 'etcpasswd');
  assert.equal(safeSessionId('a/b\\c'), 'abc');
  assert.equal(safeSessionId(''), 'unknown');
  assert.equal(safeSessionId('good-id_123'), 'good-id_123');
});

test('sessionPath for a traversal id stays inside the sessions dir', () => {
  const base = freshBase();
  const p = sessionPath('../../etc/passwd', base);
  const sessions = join(base, 'sessions') + sep;
  assert.ok(p.startsWith(sessions), `${p} should be under ${sessions}`);
  assert.ok(!p.includes(`..${sep}`));
});

test('write then read round-trips, and stamps version', () => {
  const base = freshBase();
  writeState('s1', { turnStartedAt: 42, updatedAt: 42 }, base);
  const s = readState('s1', base);
  assert.equal(s.turnStartedAt, 42);
  assert.equal(s.v, 1);
});

test('corrupt JSON is treated as fresh (null)', () => {
  const base = freshBase();
  writeState('s1', { turnStartedAt: 1 }, base); // creates the sessions dir + file
  writeFileSync(sessionPath('s1', base), '{ not valid json');
  assert.equal(readState('s1', base), null);
});

test('missing state reads as null', () => {
  assert.equal(readState('nope', freshBase()), null);
});

test('concurrent writers all land a valid file (atomic rename)', async () => {
  const base = freshBase();
  await Promise.all(
    Array.from({ length: 50 }, (_, i) => Promise.resolve().then(
      () => writeState('s1', { turnStartedAt: i, updatedAt: i }, base),
    )),
  );
  const s = readState('s1', base);
  assert.ok(s && typeof s.turnStartedAt === 'number', 'file is a complete, parseable JSON object');
  // No leftover temp files.
  const leftovers = readdirSync(join(base, 'sessions')).filter((f) => f.includes('.tmp.'));
  assert.deepEqual(leftovers, []);
});

test('deleteState removes the file and is safe when missing', () => {
  const base = freshBase();
  writeState('s1', { updatedAt: 1 }, base);
  assert.ok(existsSync(sessionPath('s1', base)));
  deleteState('s1', base);
  assert.ok(!existsSync(sessionPath('s1', base)));
  deleteState('s1', base); // no throw
});

test('prune removes only stale files', () => {
  const base = freshBase();
  const now = 1_000_000_000_000;
  writeState('fresh', { updatedAt: now - 1000 }, base);
  writeState('stale', { updatedAt: now - 25 * 3600 * 1000 }, base);
  const removed = pruneSessions({ baseDir: base, now });
  assert.equal(removed, 1);
  assert.ok(existsSync(sessionPath('fresh', base)));
  assert.ok(!existsSync(sessionPath('stale', base)));
});
