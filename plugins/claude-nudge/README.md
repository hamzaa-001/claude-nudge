# claude-nudge

Desktop and phone notifications when Claude Code finishes a turn or needs your input.

This is the plugin package. For the full walkthrough, configuration reference, and troubleshooting, see the [repository README](https://github.com/hamzaa-001/claude-nudge) and the `docs/` folder.

## Install

```
/plugin marketplace add hamzaa-001/claude-nudge
/plugin install claude-nudge@claude-nudge-marketplace
```

Or test locally without installing:

```
claude --plugin-dir ./plugins/claude-nudge
```

## Skills

- `/claude-nudge:test` — send a test notification through every configured provider.
- `/claude-nudge:status` — show resolved config (secrets redacted), platform, and recent decisions.

## Configure

Fastest path to phone push: set an ntfy topic (see the repo README). Minimal `~/.claude/nudge/config.json`:

```json
{
  "providers": {
    "ntfy": { "enabled": true, "topic": "pick-a-long-unguessable-string" }
  }
}
```

## Guarantees

- Zero runtime dependencies (Node stdlib only, ESM, Node ≥ 18).
- Never spawns a shell; every subprocess call uses an argv array.
- The hook always exits 0, self-terminates after 2s, and never surfaces errors into your session.
- Nothing leaves the machine unless you enable a remote provider; message text is withheld unless `includeMessage` is set.
