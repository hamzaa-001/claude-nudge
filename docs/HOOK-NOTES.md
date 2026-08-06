# HOOK-NOTES.md

Findings from verifying the build spec against the current Claude Code docs
(fetched 2026-08-06). Sources:

- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/plugins
- https://code.claude.com/docs/en/plugins-reference
- https://code.claude.com/docs/en/plugin-marketplaces

Legend: ✅ spec confirmed · ⚠️ spec differs / needs change · ❓ verify empirically in M0.

---

## Hook input JSON (stdin, fd 0)

Common fields on **every** event (✅ the four the spec relies on are confirmed):

| Field | Status | Notes |
|---|---|---|
| `session_id` | ✅ | string |
| `cwd` | ✅ | current working directory |
| `hook_event_name` | ✅ | event name string |
| `transcript_path` | ✅ | path to conversation JSONL |
| `message` | ❓ | **NOT in the documented common fields.** Notification-event payload shape isn't published. The spec assumes `Notification` events carry `message`. Treat as unconfirmed → capture a real `permission_prompt` payload in M0 and read the actual field name before relying on it. Code must tolerate its absence. |
| `permission_mode` | (bonus) | `default\|plan\|acceptEdits\|auto\|dontAsk\|bypassPermissions` |
| `prompt_id` | (bonus) | UUID, v2.1.196+ |

## Hook events (relevant subset)

| Event | Status | Notes |
|---|---|---|
| `UserPromptSubmit` | ✅ | fires on prompt submit, before processing. Default timeout **lowered to 30s** (not 600s). |
| `Stop` | ✅ | "When Claude finishes responding." Primary turn-end signal. |
| `StopFailure` | ⚠️ new | "When the turn ends due to an API error. Output and exit code are ignored." The spec doesn't handle this — a turn that dies on an API error fires `StopFailure`, **not** `Stop`. Recommend adding a `StopFailure` hook so we still notify on error-terminated long turns. Output/exit ignored, so the notification is a pure side effect (fine for us). |
| `Notification` | ✅ | see matchers below. |
| `SessionEnd` | ✅ | **shared 1.5s budget across all SessionEnd hooks**; setting an explicit `timeout` raises it (to ≤60s). Our prune work must stay fast. |
| `TaskCompleted` | ⚠️ clarified | Exists, but fires "when a task is being marked as completed" via the `TaskCreate` **todo/subtask** system — it is NOT a turn-completion signal. Uses exit-code-2-to-block semantics. **Do not** use it for turn-end; `Stop` is the correct signal. Answers the spec's open question. |

Turn ordering confirmed: `UserPromptSubmit` → (PreToolUse/PostToolUse cycles) → `PostToolBatch` → `Stop` **OR** `StopFailure`. Only one of Stop/StopFailure per turn, so no double-fire between them — but `Notification(permission_prompt)` can fire mid-turn before `Stop`, which is expected and handled by the duration gate / high-priority bypass.

## Notification matchers

Spec assumed only `permission_prompt` and `idle_prompt`. The full documented set:

```
permission_prompt   idle_prompt   auth_success
elicitation_dialog  elicitation_complete  elicitation_response
agent_needs_input   agent_completed
```

Decisions:
- Keep `permission_prompt` — the dependable "blocking you now" signal. ✅
- Keep `idle_prompt` — bonus; ❓ **verify it fires in the VS Code extension** (docs don't say). Treat `Stop` as the dependable path.
- ⚠️ **Add `agent_needs_input`** to the matcher → another `needs_input` source (subagent/team flows).
- Consider `agent_completed` as a secondary done-signal, but `Stop` already covers the main case; leave out of v1 to avoid duplicate pings (revisit if `Stop` proves unreliable in IDE).

Final matcher string: `permission_prompt|idle_prompt|agent_needs_input`.

## async hooks

✅ `async: true` is supported on command hook entries. **Output is discarded** for async hooks. Implication: for the async `Stop`/`Notification` hooks, returning `{"suppressOutput": true}` on stdout is a no-op (output already ignored) — harmless to emit, and still correct/needed for the **sync** `UserPromptSubmit`/`SessionEnd` hooks where output IS read. Keep emitting it uniformly.

`asyncRewake: true` also exists (wakes Claude on exit 2, feeds stderr back). Not needed — a notifier must never wake/steer the model. Do **not** set it.

## Hook output JSON

✅ `suppressOutput` is a real top-level output field. Exit code 0 = success (JSON on stdout honored); exit 2 = blocking (stderr → Claude); other = non-blocking, stderr logged. **We always exit 0** and never write to stderr in a surfacing way. The 2s self-terminate watchdog is essential given the 600s default command timeout.

---

## Plugin structure

✅ Confirmed exactly as the spec states:
- Only `plugin.json` lives in `.claude-plugin/`.
- `hooks/`, `scripts/`, `skills/` sit at the **plugin root**, never inside `.claude-plugin/`.
- `${CLAUDE_PLUGIN_ROOT}` is the substitution for the plugin's own dir. Also available: `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_PROJECT_DIR}`.
- Skills: `skills/<name>/SKILL.md`, invoked as `/claude-nudge:<name>`. Frontmatter needs `description`. For test/status (user-only, not model-auto-invoked) add `disable-model-invocation: true`.
- Test with `claude --plugin-dir ./plugins/claude-nudge`; `/reload-plugins` to hot-reload; `/plugin` Errors tab + `claude --debug` for load failures.

## `user_config` → **`userConfig`** ⚠️ (important correction)

The manifest field is **`userConfig`** (camelCase), not `user_config` as the spec's prose implies. Schema:

```json
{
  "userConfig": {
    "ntfy_topic": {
      "type": "string",            // string|number|boolean|directory|file
      "title": "ntfy topic",
      "description": "Your private ntfy topic",
      "sensitive": true,           // masks + secure storage (Keychain / .credentials.json)
      "required": false,
      "default": null,
      "multiple": false,           // string type: allow array
      "min": 0, "max": 0           // number type bounds
    }
  }
}
```

Substitution / env exposure:
- Substitution token in exec-form `args`: `${user_config.KEY}` (snake path with the **exact key**).
- Every value is exported to hook processes as **`CLAUDE_PLUGIN_OPTION_<KEY>`** (key uppercased). ← our config layer will read these.
- ⚠️ **Shell-form** hook commands **reject** `${user_config.*}` (security). We are already exec-form (`command: "node"`, `args: [...]`), so substitution is allowed there — but reading `CLAUDE_PLUGIN_OPTION_*` env vars is simpler and works for sensitive values too. **Plan: read env vars, don't rely on arg substitution.**
- Non-sensitive values stored under `pluginConfigs[<id>].options` in user `settings.json`; sensitive → keychain (~2KB budget). Project-level `.claude/settings.json` `pluginConfigs` are **ignored** (only user/managed/--settings sources read).

Proposed `userConfig` keys (per spec): `ntfyTopic` (sensitive), `minDurationSeconds` (number), `desktopEnabled` (boolean), `debug` (boolean). Env vars: `CLAUDE_PLUGIN_OPTION_NTFYTOPIC`, `..._MINDURATIONSECONDS`, `..._DESKTOPENABLED`, `..._DEBUG`. config.mjs will map these in.

## Manifest schema

✅ All spec fields valid: `name` (only required), `description`, `version`, `author{name,email,url}`, `homepage`, `repository`, `license`, `keywords[]`. Bonus useful: `displayName`, `defaultEnabled`. Unknown top-level fields → warnings only (pass unless `--strict`). Keep `version` explicit (else git SHA per-commit versioning). `keywords` must be an array or the plugin fails to load.

## marketplace.json

✅ Matches spec. Required: `name`, `owner{name}`, `plugins[]`. Each plugin entry requires `name` + `source`. `source` relative path **must start with `./`** and resolves from marketplace root (the dir containing `.claude-plugin/`). `category`, `description` optional. No `../`. Note: reserved marketplace names exist (e.g. anything impersonating Anthropic) — pick a neutral name.

---

## Net changes to the spec (carry into implementation)

1. Manifest field is **`userConfig`**, not `user_config`; read config via **`CLAUDE_PLUGIN_OPTION_<KEY>`** env vars.
2. Notification matcher becomes **`permission_prompt|idle_prompt|agent_needs_input`**.
3. Add a **`StopFailure`** hook (async) so error-terminated turns still notify.
4. `message` field on Notification is **unverified** — capture real payload in M0; code must not assume it exists.
5. `idle_prompt` in the **VS Code extension** is unverified; `Stop` is the dependable path — document honestly.

## Update — question/plan nudges in every permission mode (v0.3.0)

The VS Code extension does **not** emit a `Notification` (`idle_prompt`/`agent_needs_input`) when Claude
asks an interactive question (the `AskUserQuestion` tool) — verified empirically: with a question
dialog open, zero hooks fired. So a `Notification`-only approach can't nudge on questions there.

Fix: hook **`PreToolUse`** matched to the input-asking tools (`AskUserQuestion|ExitPlanMode`). `PreToolUse`
fires for every tool call regardless of permission mode, so the nudge fires right as the question/plan
dialog appears — no need to switch to "default" permission mode. `event.mjs` maps `PreToolUse` →
`needs_input` (high priority, bypasses the duration gate) and reads the tool name for a tailored body
("Claude has a question for you" / "Claude has a plan to review").

Still to confirm live: that the VS Code extension emits `PreToolUse` for `AskUserQuestion` (core tool
events should fire for all tools). Verify after reload via the debug log: a question should log
`DECISION needs_input … (raw:PreToolUse)`.
6. SessionEnd hooks share a **1.5s budget**; keep prune fast (explicit `timeout` raises it).
7. async hook stdout is discarded — `suppressOutput` matters only for the sync hooks; emit it uniformly anyway.

---

## M0 verification status

- `claude plugin validate ./plugins/claude-nudge --strict` → **✔ passed** (run locally).
- The entrypoint was exercised end-to-end by piping each fixture through `nudge.mjs`:
  fast turn → `below_min_duration` (suppressed), long turn → `ok` (notify), `permission_prompt`
  → `ok`/high (bypasses gate). ntfy delivered a real 200 to ntfy.sh. Secret sentinels for
  every provider were confirmed **absent** from `debug.log`.
- **Fixtures in `test/fixtures/` are schema-derived**, not captured from a live `--plugin-dir`
  session (this build ran headless). They match the documented common fields. The one field to
  confirm against a real payload is the **Notification `message`** (see #4): `event.mjs`
  probes `message` / `notification.message` / `body` / `text` and tolerates its absence, so a
  different real field name degrades to the generic "Waiting for your input" body rather than
  breaking. When you next run interactively, capture a real `permission_prompt` payload with
  `NUDGE_DEBUG=true` + `claude --debug` and update the fixture if the field differs.
