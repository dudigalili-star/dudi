import Anthropic from '@anthropic-ai/sdk';
import { createBot } from './lib.js';

const env = process.env;
const need = (k) => {
  if (!env[k]) {
    console.error(`Missing environment variable ${k} (see bot/README.md)`);
    process.exit(1);
  }
  return env[k];
};

const token = need('TELEGRAM_BOT_TOKEN');
const anthropic = new Anthropic({ apiKey: need('ANTHROPIC_API_KEY') });
const allowedUsers = (env.ALLOWED_USERS || '').split(/[\s,]+/).filter(Boolean);
if (!allowedUsers.length) console.warn('ALLOWED_USERS is empty: the bot will only reply with each user\'s ID until you set it.');

const { bot } = createBot({
  token,
  anthropic,
  model: env.CLAUDE_MODEL || undefined,
  allowedUsers,
  dataDir: env.DATA_DIR || './data',
  supplierName: env.SUPPLIER_NAME || 'Mandy',
  supplierEmail: env.SUPPLIER_EMAIL || 'sales6@jrs-sourcing.com',
  signature: env.SIGNATURE || 'Dudu Galili',
  drawnBy: env.DRAWN_BY || env.SIGNATURE || 'Dudu Galili',
});

await bot.api.setMyCommands([
  { command: 'new', description: 'חלק חדש מתיאור בטקסט' },
  { command: 'list', description: 'החלקים בבקשה' },
  { command: 'email', description: 'מייל לספק + ZIP' },
  { command: 'clear', description: 'בקשה חדשה' },
  { command: 'help', description: 'עזרה' },
]).catch((e) => console.warn('setMyCommands failed', e.message));

const stop = () => bot.stop();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

console.log('Bot is running (long polling)…');
await bot.start({ drop_pending_updates: false, onStart: (me) => console.log(`Logged in as @${me.username}`) });
