---
description: Send a test claude-nudge notification through every configured provider and report which succeeded or failed.
disable-model-invocation: true
---

# claude-nudge: test

The user wants to verify that claude-nudge can actually deliver notifications.

Run the self-test, which sends one synthetic notification through every enabled and configured provider:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nudge.mjs" --test
```

Then report the results to the user:

- Show the per-provider table verbatim (`sent`, `failed`, or `skipped` with the reason).
- If a provider was **skipped** as "enabled but not configured", point the user at `/claude-nudge:status` and `docs/CONFIGURATION.md` for what to fill in.
- If a provider **failed**, relay the error reason. Common causes: wrong ntfy topic, no network, an https-only URL served over http.
- If every provider was skipped, tell the user nothing is configured yet and summarize the quickest path (desktop is on by default; set an ntfy topic for phone push).

Do not invent results — only report what the command printed.
