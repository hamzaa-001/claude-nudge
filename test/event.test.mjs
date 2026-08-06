import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvent } from '../plugins/claude-nudge/scripts/lib/event.mjs';

const ev = (obj) => parseEvent(JSON.stringify(obj), 100);

test('maps hook events to kinds', () => {
  assert.equal(ev({ hook_event_name: 'UserPromptSubmit', cwd: '/a/b' }).kind, 'turn_start');
  assert.equal(ev({ hook_event_name: 'Stop', cwd: '/a/b' }).kind, 'turn_end');
  assert.equal(ev({ hook_event_name: 'StopFailure', cwd: '/a/b' }).kind, 'turn_end');
  assert.equal(ev({ hook_event_name: 'Notification', cwd: '/a/b' }).kind, 'needs_input');
  assert.equal(ev({ hook_event_name: 'SessionEnd', cwd: '/a/b' }).kind, 'session_end');
});

test('PreToolUse (question/plan tools) is a needs_input event that captures the tool + question', () => {
  const e = ev({
    hook_event_name: 'PreToolUse',
    tool_name: 'AskUserQuestion',
    cwd: '/home/dev/proj',
    tool_input: { questions: [{ question: 'Pick one?' }] },
  });
  assert.equal(e.kind, 'needs_input');
  assert.equal(e.tool, 'AskUserQuestion');
  assert.equal(e.project, 'proj');
  assert.equal(e.message, 'Pick one?');
});

test('project falls back to unknown without cwd', () => {
  assert.equal(ev({ hook_event_name: 'Stop' }).project, 'unknown');
});

test('unrecognized events and bad input return null', () => {
  assert.equal(ev({ hook_event_name: 'PostToolUse' }), null);
  assert.equal(parseEvent('not json', 1), null);
  assert.equal(parseEvent('[]', 1), null);
});
