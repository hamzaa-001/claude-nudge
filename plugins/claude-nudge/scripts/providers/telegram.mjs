// telegram.mjs — POST to the Bot API. The bot token is a secret: never log it.
export default {
  name: 'telegram',
  isConfigured(config) {
    const c = config.providers?.telegram;
    return !!(c && c.botToken && c.chatId);
  },

  async send(n, config, { signal, log, fetch }) {
    const { botToken, chatId } = config.providers.telegram;
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const text = `${n.title}\n${n.body}`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_notification: n.priority === 'low' }),
        signal,
      });
    } catch (e) {
      throw new Error(`telegram: request failed (${e?.name || e?.code || 'network'})`);
    }
    if (!res.ok) throw new Error(`telegram: HTTP ${res.status}`);
    log?.debug?.('telegram: delivered'); // never log token or chatId
  },
};
