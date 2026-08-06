# Troubleshooting

Start with `/claude-nudge:status` (shows resolved config + provider readiness + recent decisions) and `/claude-nudge:test` (attempts a real send through each provider). Together they diagnose most issues.

## Symptom → cause table

| Symptom | Likely cause | Fix |
|---|---|---|
| **No notifications at all** | Plugin failed to load. | Open `/plugin` → **Errors** tab. Run `claude --debug` and confirm the hooks matched. |
| No notifications at all | `enabled: false`, or the event kind is disabled. | `/claude-nudge:status` shows `enabled` and each `events.*`. |
| **Nothing on turn-end, but permission prompts work** | The duration gate. Short turns are suppressed by design. | Lower `minDurationMs`, or check `status` for `below_min_duration` decisions. |
| **Notifications in the terminal but not in VS Code** | The VS Code extension has no native notifications; some `Notification` matchers (e.g. `idle_prompt`) may not fire there. | Rely on `Stop` (turn-end) + a **remote** provider (ntfy). Remote push is IDE-independent. |
| **Too many notifications** | Duration gate too low, or noisy short turns. | Raise `minDurationMs` (e.g. 60000). Raise `dedupeWindowMs`. Use `projects.deny` for scratch dirs. |
| **Phone push silent (ntfy)** | Topic typo, not subscribed, or `topic`/`server` mismatch. | Confirm the app is subscribed to the **exact** topic. Topic is case-sensitive. `server` must be `https:`. Run `/claude-nudge:test`. |
| Phone push silent | Network blocked / offline. | `test` reports `failed — ntfy: request failed`. Check connectivity to your ntfy server. |
| **Telegram silent** | Wrong `chatId`, or you never messaged the bot first. | Message the bot once, then fetch your id from `https://api.telegram.org/bot<token>/getUpdates`. |
| **`hook script not found` / spawn errors** | A hardcoded path, or Node not on PATH. | The plugin always uses `${CLAUDE_PLUGIN_ROOT}`; if you edited `hooks.json`, restore it. Ensure `node` ≥ 18 is on PATH. |
| **Windows: sound but no toast** | BurntToast not installed. Expected degradation. | `Install-Module BurntToast -Scope CurrentUser` for real toasts. |
| **Linux: nothing happens** | `notify-send` (libnotify) not installed. | Install `libnotify-bin` (Debian/Ubuntu) or your distro's equivalent. Until then desktop no-ops (logged). |
| **A provider errors but the session is fine** | By design — providers never propagate. | Enable `debug` and read `~/.claude/nudge/debug.log` for the sanitized reason. |

## Debug log

Enable `debug` (config, `NUDGE_DEBUG=true`, or the `debug` userConfig option). Then:

```
~/.claude/nudge/debug.log
```

is JSONL, rotated at 1 MB (one `.log.1` backup). It records event decisions (`reason` values), provider outcomes, and config warnings. **Secrets — ntfy topics, bot tokens, webhook headers, message content — are never written to it.**

Decision `reason` values you'll see:

| `reason` | Meaning |
|---|---|
| `ok` | Notified. |
| `disabled` / `event_disabled` | Turned off in config. |
| `below_min_duration` | Turn shorter than `minDurationMs`. |
| `deduped` | An identical notification fired within `dedupeWindowMs`. |
| `quiet_hours` | Inside the quiet-hours window (and not high priority). |
| `project_denied` / `project_not_allowed` | Filtered by `projects.deny` / `projects.allow`. |

## Verifying a fresh install

```bash
claude --plugin-dir ./plugins/claude-nudge
# then, inside Claude Code:
/claude-nudge:status   # confirm platform + providers
/claude-nudge:test     # fire one through each
```

A 60-second task should then produce a notification; a 3-second task should not; a permission prompt should notify immediately.
