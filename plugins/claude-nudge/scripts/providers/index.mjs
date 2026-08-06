// index.mjs — the provider registry, in dispatch order.
import desktop from './desktop.mjs';
import ntfy from './ntfy.mjs';
import telegram from './telegram.mjs';
import webhook from './webhook.mjs';

export const providers = [desktop, ntfy, telegram, webhook];
export {
  desktop, ntfy, telegram, webhook,
};
