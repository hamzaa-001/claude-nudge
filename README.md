# claude-nudge

Get a **desktop and phone notification** the moment Claude Code finishes a turn or stops to ask for your permission — so you can walk away and actually get pulled back when it matters.

```
/plugin marketplace add hamzaa-001/claude-nudge
/plugin install claude-nudge@claude-nudge-marketplace
```

![phone lighting up with a claude-nudge push](docs/demo.gif)
<!-- TODO: replace docs/demo.gif with a real recording of a phone push firing. -->

---

## Why this one

Most "notify me" hooks make a sound and that's it. Two things make them get uninstalled: they only work when you're sitting at the machine, and they fire on every trivial two-second turn until you tune them out. claude-nudge is built around the opposite defaults:

- **Remote delivery.** ntfy (free phone push), Telegram, or a generic webhook reach you when you're away from the keyboard. The VS Code extension has no notifications of its own — this fills that gap.
- **Smart suppression.** A turn shorter than `minDurationMs` (default 30s) stays silent. The eight-minute refactor pings you; the rapid back-and-forth doesn't. Permission prompts always come through immediately, regardless of elapsed time.
- **Privacy-first.** Nothing leaves your machine unless you opt in. Remote pushes send metadata only (project name + duration) unless you explicitly set `includeMessage`. Secrets are never written to the debug log.

## Phone push in 2 minutes (ntfy)

[ntfy](https://ntfy.sh) is a free, no-signup push service.

1. Install the **ntfy** app ([iOS](https://apps.apple.com/us/app/ntfy/id1625396347) / [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)).
2. Pick a **long, unguessable topic name** — anyone who knows it can read your notifications. Treat it like a password, e.g. `claude-nudge-8f3ac1e97b`.
3. In the app, **Subscribe** to that topic.
4. Tell claude-nudge the topic. Either let the plugin prompt you at install time (the `ntfyTopic` field), or set it yourself:

   ```bash
   mkdir -p ~/.claude/nudge
   cat > ~/.claude/nudge/config.json <<'JSON'
   { "providers": { "ntfy": { "enabled": true, "topic": "claude-nudge-8f3ac1e97b" } } }
   JSON
   ```

5. Verify: run `/claude-nudge:test` inside Claude Code. Your phone should buzz.

## Verify & inspect

- `/claude-nudge:test` — send one notification through every configured provider and report what worked.
- `/claude-nudge:status` — show the resolved config (secrets redacted), detected platform, provider readiness, and recent decisions.

## Configuration (quick reference)

Full details in [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. |
| `minDurationMs` | `30000` | Turn-end notifications only fire above this. Raise it if you get too many. |
| `dedupeWindowMs` | `5000` | Suppress identical notifications within this window. |
| `includeMessage` | `false` | Include raw message text in **remote** pushes. Off = metadata only. |
| `events.turn_end` | `true` | Notify when a turn finishes (subject to the duration gate). |
| `events.needs_input` | `true` | Notify on permission / idle prompts (always high priority). |
| `events.session_end` | `false` | Notify when a session ends. |
| `quietHours` | off | `{ enabled, start, end }`, local time, wraps midnight. High-priority prompts still come through. |
| `projects.allow` / `.deny` | `[]` | Substring match against `cwd`. Deny wins. |
| `providers.desktop` | on | Local OS notification. |
| `providers.ntfy` | off | Phone push via ntfy. |
| `providers.telegram` | off | Telegram bot message. |
| `providers.webhook` | off | Generic JSON POST. |

Config is layered, lowest→highest: built-in defaults → `~/.claude/nudge/config.json` → `<project>/.claude/nudge.json` → `NUDGE_*` environment variables.

## Platform support (honest matrix)

| Platform | Mechanism | Notes |
|---|---|---|
| macOS | `osascript` banner + `Glass` sound | Full support. |
| Linux | `notify-send` | Needs `libnotify` (`notify-send`). If absent, silently no-ops (logged). |
| WSL | `powershell.exe` | Toast via [BurntToast](https://github.com/Windos/BurntToast) if installed, otherwise a system **sound only**. |
| Windows | `powershell.exe` | Same as WSL. Native toasts without BurntToast are unreliable from a short-lived process, so we degrade to sound. `Install-Module BurntToast` for real toasts. |

The remote providers (ntfy/Telegram/webhook) work identically on every platform — they're the recommended path, especially in the VS Code extension.

## How it works

Claude Code fires lifecycle hooks; a single Node entrypoint (`scripts/nudge.mjs`, zero dependencies) handles all of them:

```
UserPromptSubmit → stamp turn start
Stop / StopFailure → duration gate → maybe notify (async)
Notification(permission_prompt|idle_prompt|agent_needs_input) → high-priority notify (async)
SessionEnd → clean up state
```

Per-session state lives in `~/.claude/nudge/sessions/<id>.json`. The hook always exits 0, self-terminates after 2s, and swallows every error — a notifier must never break your session.

## Roadmap (not in v1)

- Escalation ladder (local ping → phone push after N minutes unacknowledged) — needs a background daemon.
- Focus detection / suppress-when-window-active — requires native modules, which would break the zero-dependency guarantee.
- A VS Code extension UI.
- Transcript summarization in the notification body.

## Development

```bash
npm run check   # guard + unit tests + smoke
npm test        # node --test
npm run smoke   # pipe fixtures through the real entrypoint
npm run guard   # enforce zero-dep / no-shell / no path-escape
```

Test the plugin live without installing:

```bash
claude --plugin-dir ./plugins/claude-nudge
```

`/reload-plugins` picks up edits; `claude --debug` shows which hooks matched. See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## License

MIT — see [LICENSE](LICENSE).
