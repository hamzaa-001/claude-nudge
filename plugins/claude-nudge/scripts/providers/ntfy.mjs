// ntfy.mjs — POST to {server}/{topic}. The topic is a bearer secret: never log it.
// HTTP headers must be latin-1; transliterate the common typographic chars we emit,
// then drop anything still non-ASCII.
function asciiHeader(s) {
  return String(s)
    .replace(/[‒-―−]/g, '-') // dashes / minus -> hyphen
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E]/g, '?');
}

export default {
  name: 'ntfy',
  isConfigured(config) {
    const c = config.providers?.ntfy;
    return !!(c && c.topic && typeof c.server === 'string' && c.server);
  },

  async send(n, config, { signal, log, fetch }) {
    const { server, topic } = config.providers.ntfy;
    const full = `${String(server).replace(/\/+$/, '')}/${encodeURIComponent(topic)}`;
    let url;
    try { url = new URL(full); } catch { throw new Error('ntfy: invalid server'); }
    if (url.protocol !== 'https:') throw new Error('ntfy: server must be https');

    const priority = n.priority === 'high' ? '4' : n.priority === 'low' ? '2' : '3';
    let res;
    try {
      res = await fetch(url.toString(), {
        method: 'POST',
        body: n.body,
        headers: { Title: asciiHeader(n.title), Priority: priority, Tags: (n.tags || []).join(',') },
        signal,
      });
    } catch (e) {
      throw new Error(`ntfy: request failed (${e?.name || e?.code || 'network'})`);
    }
    if (!res.ok) throw new Error(`ntfy: HTTP ${res.status}`);
    log?.debug?.(`ntfy: delivered to ${url.host}`); // host only — never the topic
  },
};
