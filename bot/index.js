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
const allowedUsers = (env.ALLOWED_USERS || '').split(/[\s,]+/).filter(Boolean);
if (!allowedUsers.length) console.warn('ALLOWED_USERS is empty: the first Telegram user to message the bot becomes its owner.');
if (!env.ANTHROPIC_API_KEY) console.warn('ANTHROPIC_API_KEY is not set: the bot will ask its owner for the key in Telegram.');

const { bot } = createBot({
  token,
  anthropicKey: env.ANTHROPIC_API_KEY || '',
  makeAnthropic: (apiKey) => new Anthropic({ apiKey }),
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
try {
  await bot.start({ drop_pending_updates: false, onStart: (me) => console.log(`Logged in as @${me.username}`) });
} catch (e) {
  if (e?.error_code === 401 || e?.error_code === 404) console.error('Telegram rejected the bot token — check TELEGRAM_BOT_TOKEN (from @BotFather).');
  else console.error('Bot stopped:', e?.message || e);
  process.exit(1);
}
