---
description: Show claude-nudge's resolved configuration, detected platform, provider readiness, and recent notification decisions.
disable-model-invocation: true
---

# claude-nudge: status

The user wants to see how claude-nudge is currently configured and why it did or didn't fire.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nudge.mjs" --status
```

Then summarize the output for the user:

- Detected platform and whether the plugin is enabled.
- The current `minDurationMs` (the duration gate) and quiet-hours window.
- Which providers are **ready** vs **enabled but not configured** vs **disabled**.
- The recent decisions list, explaining any `reason` values (e.g. `below_min_duration` means the turn was too short to notify; `deduped` means a near-identical notification just fired).
- If the recent-decisions list is empty, note that decisions are only recorded when `debug` is enabled.

The printed config has all secrets redacted (`***`); it is safe to show verbatim.
