// webhook.mjs — generic JSON POST. https only, except loopback hosts.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

export default {
  name: 'webhook',
  isConfigured(config) { return !!config.providers?.webhook?.url; },

  async send(n, config, { signal, log, fetch }) {
    const { url, headers = {} } = config.providers.webhook;
    let u;
    try { u = new URL(url); } catch { throw new Error('webhook: invalid url'); }

    const loopback = LOOPBACK.has(u.hostname);
    if (u.protocol === 'https:') { /* ok */ } else if (u.protocol === 'http:' && loopback) { /* ok */ } else {
      throw new Error('webhook: refusing non-https url');
    }

    // Merge user headers, but never let them override Content-Type.
    const merged = { 'Content-Type': 'application/json' };
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === 'content-type') continue;
      merged[k] = String(v);
    }

    const payload = {
      title: n.title, body: n.body, priority: n.priority, project: n.project, durationMs: n.durationMs, at: n.at,
    };
    let res;
    try {
      res = await fetch(u.toString(), { method: 'POST', headers: merged, body: JSON.stringify(payload), signal });
    } catch (e) {
      throw new Error(`webhook: request failed (${e?.name || e?.code || 'network'})`);
    }
    if (!res.ok) throw new Error(`webhook: HTTP ${res.status}`);
    log?.debug?.(`webhook: delivered to ${u.host}`);
  },
};
