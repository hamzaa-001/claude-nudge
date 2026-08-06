# Configuration

claude-nudge resolves configuration in layers, **lowest to highest precedence**:

1. Built-in defaults
2. `~/.claude/nudge/config.json` (personal, all projects)
3. `<project>/.claude/nudge.json` (per-project overrides)
4. Environment variables (`NUDGE_*`, and the plugin's `userConfig` values)

Objects deep-merge; arrays and scalars replace. Invalid values are logged and fall back to the default — a bad config never crashes the hook.

## Full default config

```json
{
  "enabled": true,
  "minDurationMs": 30000,
  "dedupeWindowMs": 5000,
  "includeMessage": false,
  "events": {
    "turn_end": true,
    "needs_input": true,
    "session_end": false
  },
  "quietHours": { "enabled": false, "start": "23:00", "end": "07:00" },
  "projects": { "allow": [], "deny": [] },
  "providers": {
    "desktop": { "enabled": true, "sound": true },
    "ntfy":    { "enabled": false, "server": "https://ntfy.sh", "topic": null },
    "telegram":{ "enabled": false, "botToken": null, "chatId": null },
    "webhook": { "enabled": false, "url": null, "headers": {} }
  },
  "debug": false
}
```

## Field reference

### Top level

| Field | Type | Notes |
|---|---|---|
| `enabled` | boolean | Master switch. `false` silences everything. |
| `minDurationMs` | number (ms) | The **duration gate**. A `turn_end` only notifies if the turn ran at least this long. Clamped to `[0, 86400000]`. This is the single most useful knob against notification fatigue. |
| `dedupeWindowMs` | number (ms) | Suppress a repeat of the same notification key within this window. Clamped to `[0, 3600000]`. |
| `includeMessage` | boolean | When `true`, remote providers may include the raw hook message text. Default `false` = metadata only. |
| `debug` | boolean | Write a JSONL log to `~/.claude/nudge/debug.log` (rotated at 1 MB). No secrets are ever logged. |

### `events`

Turn individual event kinds on/off.

| Key | Default | Fires on |
|---|---|---|
| `turn_end` | `true` | `Stop` / `StopFailure` — Claude finished (or errored out of) a turn. Subject to the duration gate. |
| `needs_input` | `true` | `Notification` (`permission_prompt`, `idle_prompt`, `agent_needs_input`). Always high priority; bypasses the duration gate and quiet hours. |
| `session_end` | `false` | `SessionEnd`. |

### `quietHours`

```json
{ "enabled": true, "start": "23:00", "end": "07:00" }
```

Local time, `HH:MM` 24-hour. Windows that wrap midnight are handled. During quiet hours, normal notifications are suppressed but **high-priority prompts still come through** — being blocked at 2am is worth a buzz.

### `projects`

Substring match (case-insensitive) against the session `cwd`.

- `deny`: if any pattern matches, suppress. **Deny wins over allow.**
- `allow`: if non-empty, only matching projects notify.

```json
{ "projects": { "deny": ["scratch", "experiments"], "allow": [] } }
```

### Providers

Every provider has `enabled` plus its own fields. A provider must be **both enabled and configured** to fire.

#### `desktop`
| Field | Notes |
|---|---|
| `enabled` | Local OS notification. |
| `sound` | `true` (gentle default chime), `false` (silent), or a name/path. |

**Sound options.** On Windows/WSL the default is the soft `Windows Notify System Generic` chime (not the harsh Asterisk beep). Set `providers.desktop.sound` to:

- a friendly name — `generic`, `calendar`, `messaging`, `email`, `notify`, `ding`, `chimes`, or
- **an absolute path to your own audio file** — `mp3`, `wav`, `wma`, `m4a`, … (anything Windows MediaPlayer supports), or
- `false` to silence.

Custom audio plays in a detached background process, so it plays **to completion** (up to a 30-second cap) rather than being cut short by the hook's safety timeout. On macOS the value is used as the `osascript` sound name (default `Glass`); macOS custom sounds are limited to installed system sound names.

```json
{ "providers": { "desktop": { "enabled": true, "sound": "C:\\Users\\you\\Sounds\\notify.mp3" } } }
```

(Use doubled backslashes in JSON.) Or per-shell: `NUDGE_DESKTOP_SOUND=messaging` (or a path, or `false`).

#### `ntfy` (phone push)
| Field | Notes |
|---|---|
| `enabled` | |
| `server` | Must be `https:`. Default `https://ntfy.sh`. |
| `topic` | **Secret.** Your subscribe topic. Never logged. |

Priority maps to ntfy: `low`→2, `normal`→3, `high`→4.

#### `telegram`
| Field | Notes |
|---|---|
| `botToken` | **Secret.** From [@BotFather](https://t.me/BotFather). Never logged. |
| `chatId` | Your chat/user id (message the bot, then read it from `getUpdates`). |

#### `webhook`
| Field | Notes |
|---|---|
| `url` | `https:` required, except `localhost` / `127.0.0.1`. |
| `headers` | Merged into the request. Cannot override `Content-Type`. |

Webhook body:

```json
{ "title": "...", "body": "...", "priority": "normal", "project": "app", "durationMs": 252000, "at": 1730000000000 }
```

## Environment variables

Highest precedence. Useful for CI, dotfiles, or per-shell overrides.

| Variable | Maps to |
|---|---|
| `NUDGE_ENABLED` | `enabled` |
| `NUDGE_MIN_DURATION_MS` | `minDurationMs` |
| `NUDGE_DEDUPE_WINDOW_MS` | `dedupeWindowMs` |
| `NUDGE_INCLUDE_MESSAGE` | `includeMessage` |
| `NUDGE_DEBUG` | `debug` |
| `NUDGE_QUIET_HOURS_ENABLED` / `NUDGE_QUIET_START` / `NUDGE_QUIET_END` | `quietHours.*` |
| `NUDGE_DESKTOP_ENABLED` / `NUDGE_DESKTOP_SOUND` | `providers.desktop.*` |
| `NUDGE_NTFY_ENABLED` / `NUDGE_NTFY_SERVER` / `NUDGE_NTFY_TOPIC` | `providers.ntfy.*` |
| `NUDGE_TELEGRAM_ENABLED` / `NUDGE_TELEGRAM_BOT_TOKEN` / `NUDGE_TELEGRAM_CHAT_ID` | `providers.telegram.*` |
| `NUDGE_WEBHOOK_ENABLED` / `NUDGE_WEBHOOK_URL` | `providers.webhook.*` |

### Plugin `userConfig`

If you install via a marketplace, Claude Code prompts for these at enable time and exports them as `CLAUDE_PLUGIN_OPTION_*`:

| Field | Effect |
|---|---|
| `ntfyTopic` (sensitive) | Sets `providers.ntfy.topic` **and** enables ntfy. |
| `minDurationSeconds` | Sets `minDurationMs` (×1000). |
| `desktopEnabled` | Sets `providers.desktop.enabled`. |
| `debug` | Sets `debug`. |

Explicit `NUDGE_*` variables override `userConfig` values.
