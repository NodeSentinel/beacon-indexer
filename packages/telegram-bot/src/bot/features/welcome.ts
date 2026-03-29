import { Composer } from 'grammy';

import type { Context } from '@/src/bot/context.js';
import { logHandle } from '@/src/bot/helpers/logging.js';
import { env } from '@/src/env.js';

const composer = new Composer<Context>();

const feature = composer.chatType('private');

const chainDisplayName = env.CHAIN === 'ethereum' ? 'Ethereum' : 'Gnosis';

const welcomeMessage = [
  `<b>Welcome to <a href="https://node-sentinel.xyz/">NodeSentinel</a></b>, your <b>${chainDisplayName}</b> validator watchdog`,
  ``,
  `⚡️ <b>Quick Setup</b>`,
  `  1︎⃣  Open the <a href="https://t.me/gnosis_nodeSentinel_bot/miniapp">App</a>`,
  `  2︎⃣  Create a <b>cluster</b> (<i>one per machine or VPS</i>)`,
  `  3︎⃣  Add validators to each cluster`,
  ``,
  `Once set up, you'll get:`,
  `  ⦿  <b>Live feed in chat</b>: statuses, performance &amp; APY`,
  `  ⦿  <b>Mini-app dasboard</b>: detailed charts, stats &amp; history`,
  `  ⦿  <b>Real-time alerts</b>: instant notifications if something goes wrong`,
  ``,
  `Need help? → @node_sentinel`,
  `Back the project → follow on <a href="https://x.com/NodeSentnl">𝕏 NodeSentnl</a>`,
].join('\n');

feature.command('start', logHandle('command-start'), (ctx) => {
  return ctx.reply(welcomeMessage, {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });
});

export { composer as welcomeFeature };
