// Telegram bot for the supplier-drawings tool. Shares all drawing / CAD / AI / email code
// with the web app in ../parts-app/core.
import fs from 'node:fs/promises';
import path from 'node:path';
import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { Resvg } from '@resvg/resvg-js';

import {
  normalizePart, warnings, wantsFullSet, canMake3D, isComplex, displayName, fileBase, overallLength, fmt, KINDS,
} from '../parts-app/core/model.js';
import { buildDrawing, buildViews11 } from '../parts-app/core/drawing.js';
import { toSVG, toPDF, toDXF } from '../parts-app/core/render.js';
import { makeSTEP, loadCAD } from '../parts-app/core/cad.js';
import { analyzeImages, DEFAULT_MODEL } from '../parts-app/core/ai.js';
import { emailSubject, emailBody, attachmentList, gmailComposeUrl } from '../parts-app/core/email.js';

const HELP = `📐 *בוט שרטוטים לספק*

שלח לי:
• 📷 *תמונה* של חלק או של סקיצה (אפשר כמה תמונות ביחד). בכיתוב אפשר להוסיף מידות, כמות וחומר.
• ✍️ או *תיאור בטקסט*, למשל: _פין קוטר 20 אורך 258, 2 חורים 5 במרחק 7 מהקצוות, 10 יח' ST37_

אני מחזיר שרטוט מסודר (PDF, ולחלק מורכב גם STEP ו-DXF).

✏️ *תיקונים:* פשוט כתוב הודעה, למשל _"האורך 260, חומר 1045"_. היא תחול על החלק האחרון שעבדנו עליו.

פקודות:
/new — החלק הבא שאכתוב בטקסט יהיה חלק חדש
/list — החלקים בבקשה הנוכחית
/email — מייל לספק + ZIP עם כל הקבצים
/clear — התחלת בקשה חדשה`;

/* ───────────── small helpers ───────────── */

function imageSize(buf) {
  // PNG
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  // JPEG: walk the segments to the SOF marker
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return { w: 0, h: 0 };
}

function mediaTypeOf(buf) {
  if (buf.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
  return null;
}

// Telegram Markdown (legacy) only needs these escaped
const md = (s) => String(s ?? '').replace(/([_*`[])/g, '\\$1');

export function partSummary(p) {
  const L = [];
  L.push(`*${md(displayName(p))}*${p.partNo ? `  (${md(p.partNo)})` : ''}`);
  L.push(`סוג: ${md(KINDS[p.kind])}`);
  if (p.kind === 'turned') {
    const t = p.turned;
    const steps = t.segments.map((s) => `${s.thread || `Ø${fmt(s.diameter)}`}×${fmt(s.length)}`).join(' | ');
    L.push(`מידות: אורך כולל ${fmt(overallLength(p))} — ${md(steps)}`);
    if (t.chamferLeft || t.chamferRight) L.push(`פאזות: ${fmt(t.chamferLeft)} / ${fmt(t.chamferRight)} ×45°`);
    t.bores.forEach((b) => L.push(`קדח ${b.end === 'left' ? 'משמאל' : 'מימין'}: ${md(b.thread || `Ø${fmt(b.diameter)}`)} ${b.depth ? `עומק ${fmt(b.depth)}` : 'עובר'}`));
    if (t.crossHoles.length) L.push(`חורים רוחביים: ${t.crossHoles.map((h) => `${md(h.thread || `Ø${fmt(h.diameter)}`)} ב-${fmt(h.x)}`).join(', ')} (מהקצה השמאלי)`);
  } else if (p.kind === 'plate') {
    const pl = p.plate;
    L.push(`מידות: ${pl.shape === 'disc' ? `Ø${fmt(pl.length)}` : `${fmt(pl.length)}×${fmt(pl.width)}`} עובי ${fmt(pl.thickness)}`);
    if (pl.holes.length) L.push(`חורים: ${pl.holes.length} — ${pl.holes.map((h) => `${md(h.thread || `Ø${fmt(h.diameter)}`)} (${fmt(h.x)},${fmt(h.y)})`).join(', ')}`);
  } else if (p.kind === 'spring') {
    const s = p.spring;
    L.push(`תיל Ø${fmt(s.wireDiameter)} × OD ${fmt(s.outerDiameter)} × L0 ${fmt(s.freeLength)}, ${fmt(s.totalCoils)} כריכות`);
  }
  L.push(`חומר: ${md(p.material || '—')}${p.finish ? ` | גימור: ${md(p.finish)}` : ''}`);
  L.push(`כמות: ${p.quantity || '—'}`);
  L.push(`קבצים: ${wantsFullSet(p) ? 'סט מלא (PDF + STEP + DXF)' : 'PDF'}`);
  const w = warnings(p);
  if (p.estimated.length) L.push('', '📏 *הוערך מהתמונה:*', ...p.estimated.map((x) => `• ${md(x)}`));
  if (p.questions.length) L.push('', '❓ *לבדוק:*', ...p.questions.map((x) => `• ${md(x)}`));
  if (w.length) L.push('', '⚠️ ' + w.map(md).join('\n⚠️ '));
  L.push('', '_לתיקון — פשוט כתוב הודעה_');
  return L.join('\n');
}

function partKeyboard(p) {
  const kb = new InlineKeyboard().text('📄 PDF', `pdf:${p.id}`);
  if (canMake3D(p)) {
    kb.text('🧊 STEP', `step:${p.id}`).text('📐 DXF', `dxf:${p.id}`).row();
    kb.text(wantsFullSet(p) ? '✅ סט מלא במייל' : '⬜ סט מלא במייל', `full:${p.id}`);
  }
  kb.text('🗑 הסר', `del:${p.id}`).row();
  kb.text('✉️ מייל + ZIP לכל הבקשה', 'email');
  return kb;
}

/* ───────────── state (one JSON file per chat) ───────────── */

class Store {
  constructor(dir) { this.dir = dir; this.cache = new Map(); }
  file(chatId) { return path.join(this.dir, `chat-${chatId}.json`); }
  imgFile(id) { return path.join(this.dir, 'img', `${id}.bin`); }
  async get(chatId) {
    if (this.cache.has(chatId)) return this.cache.get(chatId);
    let s;
    try { s = JSON.parse(await fs.readFile(this.file(chatId), 'utf8')); } catch { s = { parts: [], currentId: null }; }
    this.cache.set(chatId, s);
    return s;
  }
  async save(chatId) {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = this.file(chatId) + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.cache.get(chatId)));
    await fs.rename(tmp, this.file(chatId));
  }
  async putImage(id, buf) {
    await fs.mkdir(path.join(this.dir, 'img'), { recursive: true });
    await fs.writeFile(this.imgFile(id), buf);
  }
  async getImage(id) {
    try { return await fs.readFile(this.imgFile(id)); } catch { return null; }
  }
  async delImage(id) {
    try { await fs.unlink(this.imgFile(id)); } catch { /* gone */ }
  }
  // Bot-wide settings that can be set from Telegram: the owner and the Anthropic API key.
  async getConfig() {
    if (!this.config) {
      try { this.config = JSON.parse(await fs.readFile(path.join(this.dir, 'config.json'), 'utf8')); } catch { this.config = {}; }
    }
    return this.config;
  }
  async saveConfig() {
    await fs.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, 'config.json');
    await fs.writeFile(`${file}.tmp`, JSON.stringify(this.config), { mode: 0o600 });
    await fs.rename(`${file}.tmp`, file);
  }
}

const KEY_RE = /sk-ant-[A-Za-z0-9_-]{20,}/;
const NEED_KEY = `🔑 *חסר מפתח API של Claude*

כדי שאוכל לנתח תמונות ותיאורים, שלח לי כאן את המפתח כהודעה רגילה (מתחיל ב-\`sk-ant-\`).
אני שומר אותו בשרת ומוחק את ההודעה מהצ'אט מיד.

יוצרים מפתח ב-platform.claude.com/settings/keys ← Create Key ← Copy.`;

/* ───────────── the bot ───────────── */

export function createBot({
  token, anthropic = null, anthropicKey = '', makeAnthropic = null, model = DEFAULT_MODEL, allowedUsers = [], dataDir = './data',
  supplierName = 'Mandy', supplierEmail = 'sales6@jrs-sourcing.com', signature = 'Dudu Galili', drawnBy = 'Dudu Galili',
  apiRoot = 'https://api.telegram.org', log = console,
}) {
  const bot = new Bot(token, { client: { apiRoot } });
  const store = new Store(dataDir);
  const albums = new Map(); // media_group_id -> {timer, buffers, caption, ctx}
  const queues = new Map(); // chatId -> promise (handle one message at a time per chat)

  // The Claude client: fixed (tests), or built from the key in the environment / sent in Telegram.
  let cached = { key: null, client: null };
  async function getClient() {
    if (anthropic) return anthropic;
    const key = (await store.getConfig()).anthropicKey || anthropicKey;
    if (!key || !makeAnthropic) return null;
    if (cached.key !== key) cached = { key, client: makeAnthropic(key) };
    return cached.client;
  }

  const inQueue = (chatId, fn) => {
    const prev = queues.get(chatId) || Promise.resolve();
    const next = prev.then(fn, fn);
    queues.set(chatId, next.catch(() => {}));
    return next;
  };

  /* outputs */
  async function drawingImageFor(p) {
    const id = p.imageIds?.[0];
    if (!id) return null;
    const buf = await store.getImage(id);
    if (!buf) return null;
    const { w, h } = imageSize(buf);
    const mt = mediaTypeOf(buf);
    if (!w || !h || !(mt === 'image/jpeg' || mt === 'image/png')) return null;
    return { src: `data:${mt};base64,${buf.toString('base64')}`, w, h };
  }
  async function sheetFor(p) {
    return buildDrawing(p, { drawnBy, image: await drawingImageFor(p) }).sheet;
  }
  async function pngFor(p) {
    const svg = toSVG(await sheetFor(p));
    const r = new Resvg(svg, {
      fitTo: { mode: 'width', value: 1600 },
      background: '#ffffff',
      font: { loadSystemFonts: true, defaultFontFamily: 'Liberation Sans', sansSerifFamily: 'Liberation Sans' },
    });
    return Buffer.from(r.render().asPng());
  }
  async function pdfFor(p) {
    const doc = toPDF(jsPDF, [await sheetFor(p)], { title: displayName(p), author: drawnBy });
    return Buffer.from(doc.output('arraybuffer'));
  }
  const dxfFor = (p) => Buffer.from(toDXF(buildViews11(p)), 'utf8');
  const stepFor = async (p) => Buffer.from(await (await makeSTEP(p)).arrayBuffer());

  async function sendCard(ctx, p, note = '') {
    const caption = (note ? `${note}\n\n` : '') + partSummary(p);
    const png = await pngFor(p);
    // Telegram caption limit is 1024 chars; long summaries go in a separate message
    if (caption.length <= 1000) {
      await ctx.replyWithPhoto(new InputFile(png, `${fileBase(p)}.png`), { caption, parse_mode: 'Markdown', reply_markup: partKeyboard(p) });
    } else {
      await ctx.replyWithPhoto(new InputFile(png, `${fileBase(p)}.png`));
      await ctx.reply(caption, { parse_mode: 'Markdown', reply_markup: partKeyboard(p) });
    }
  }

  async function withTyping(ctx, fn) {
    const send = () => ctx.replyWithChatAction('typing').catch(() => {});
    send();
    const t = setInterval(send, 4500);
    try { return await fn(); } finally { clearInterval(t); }
  }

  async function fail(ctx, e) {
    log.error?.(e);
    const msg = e?.status === 401 ? 'מפתח ה-API של Anthropic לא תקין' : (e?.message || String(e));
    await ctx.reply(`❌ ${msg}`).catch(() => {});
  }

  /* access control: the bot spends API credit, so only its owner(s) may use it.
     Owners come from ALLOWED_USERS; if there are none yet, the first person to write becomes the owner. */
  bot.use(async (ctx, next) => {
    const uid = ctx.from?.id;
    if (!uid) return;
    const cfg = await store.getConfig();
    const owners = new Set([...allowedUsers.map(String), ...(cfg.owners || [])]);
    if (!owners.size && ctx.message) {
      cfg.owners = [String(uid)];
      await store.saveConfig();
      owners.add(String(uid));
      log.warn?.(`Telegram user ${uid} is now the owner of the bot`);
      await ctx.reply('👑 נרשמת כבעלים של הבוט. מעכשיו רק אתה יכול להשתמש בו.');
      if (!(await getClient())) await ctx.reply(NEED_KEY, { parse_mode: 'Markdown' });
    }
    if (!owners.has(String(uid))) {
      if (ctx.message) await ctx.reply(`⛔ הבוט פרטי.\nמספר המשתמש שלך הוא: ${uid}`);
      else if (ctx.callbackQuery) await ctx.answerCallbackQuery();
      return;
    }
    await next();
  });

  /* the Anthropic API key can be sent as a message; it is checked, saved, and the message deleted */
  bot.use(async (ctx, next) => {
    const text = ctx.message?.text || ctx.message?.caption || '';
    const m = KEY_RE.exec(text);
    if (!m) return next();
    await ctx.deleteMessage().catch(() => {});
    if (!makeAnthropic) return ctx.reply('המפתח מוגדר בשרת ולא ניתן לשנות אותו מכאן.');
    try {
      await makeAnthropic(m[0]).models.list({ limit: 1 });
    } catch (e) {
      const why = e?.status === 401 ? 'Anthropic לא מכיר את המפתח הזה' : (e?.message || String(e));
      return ctx.reply(`❌ המפתח לא התקבל: ${why}\nהעתק אותו שוב (כפתור Copy באתר) ושלח שוב.`);
    }
    const cfg = await store.getConfig();
    cfg.anthropicKey = m[0];
    await store.saveConfig();
    return ctx.reply('✅ המפתח נשמר (וההודעה נמחקה מהצ\'אט).\n\nאפשר להתחיל: שלח תמונה של חלק או סקיצה, או תיאור בטקסט.');
  });

  bot.command(['start', 'help'], async (ctx) => {
    await ctx.reply(HELP, { parse_mode: 'Markdown' });
    if (!(await getClient())) await ctx.reply(NEED_KEY, { parse_mode: 'Markdown' });
  });

  bot.command('new', async (ctx) => {
    const s = await store.get(ctx.chat.id);
    s.currentId = null;
    await store.save(ctx.chat.id);
    const rest = ctx.match?.trim();
    if (rest) return inQueue(ctx.chat.id, () => createPart(ctx, [], rest));
    return ctx.reply('👍 שלח תמונה או תיאור של החלק החדש.');
  });

  bot.command('list', async (ctx) => {
    const s = await store.get(ctx.chat.id);
    if (!s.parts.length) return ctx.reply('אין עדיין חלקים בבקשה. שלח תמונה או תיאור של חלק.');
    const kb = new InlineKeyboard();
    s.parts.forEach((raw) => {
      const p = normalizePart(raw);
      kb.text(`${p.id === s.currentId ? '▶️ ' : ''}${displayName(p)} — ${p.quantity || '?'} יח'`, `sel:${p.id}`).row();
    });
    kb.text('✉️ מייל + ZIP', 'email');
    return ctx.reply(`בבקשה הנוכחית ${s.parts.length} חלקים. בחר חלק כדי לראות אותו או לתקן אותו:`, { reply_markup: kb });
  });

  bot.command('email', (ctx) => inQueue(ctx.chat.id, () => sendEmail(ctx)));

  bot.command('clear', (ctx) => ctx.reply('להתחיל בקשה חדשה? כל החלקים הנוכחיים יימחקו.', {
    reply_markup: new InlineKeyboard().text('כן, בקשה חדשה', 'clear:yes').text('ביטול', 'clear:no'),
  }));

  async function createPart(ctx, images, text) {
    if (!images.length && !text) return;
    const client = await getClient();
    if (!client) return ctx.reply(NEED_KEY, { parse_mode: 'Markdown' });
    await withTyping(ctx, async () => {
      const wait = await ctx.reply(images.length ? '🔍 מנתח את התמונה… (בדרך כלל 20–60 שניות)' : '🔍 בונה את החלק מהתיאור…');
      try {
        const spec = await analyzeImages({ client, model, images: images.map((i) => ({ base64: i.buf.toString('base64'), mediaType: i.mediaType })), userText: text });
        const s = await store.get(ctx.chat.id);
        const p = normalizePart({ ...spec, imageIds: [] });
        for (const img of images) {
          const id = `${p.id}-${Math.random().toString(36).slice(2, 7)}`;
          await store.putImage(id, img.buf);
          p.imageIds.push(id);
        }
        s.parts.push(p);
        s.currentId = p.id;
        await store.save(ctx.chat.id);
        await sendCard(ctx, p, `✅ נוסף לבקשה (חלק ${s.parts.length})`);
      } finally {
        ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      }
    }).catch((e) => fail(ctx, e));
  }

  async function revisePart(ctx, text) {
    const s = await store.get(ctx.chat.id);
    const i = s.parts.findIndex((x) => x.id === s.currentId);
    if (i < 0) return createPart(ctx, [], text);
    const client = await getClient();
    if (!client) return ctx.reply(NEED_KEY, { parse_mode: 'Markdown' });
    await withTyping(ctx, async () => {
      const cur = normalizePart(s.parts[i]);
      const spec = await analyzeImages({ client, model, userText: text, current: cur });
      const p = normalizePart({ ...spec, id: cur.id, imageIds: cur.imageIds, createdAt: cur.createdAt, fullSet: cur.fullSet });
      s.parts[i] = p;
      await store.save(ctx.chat.id);
      await sendCard(ctx, p, '✏️ עודכן');
    }).catch((e) => fail(ctx, e));
  }

  async function sendEmail(ctx) {
    const s = await store.get(ctx.chat.id);
    const list = s.parts.map(normalizePart);
    if (!list.length) return ctx.reply('אין חלקים בבקשה.');
    await withTyping(ctx, async () => {
      const zip = new JSZip();
      for (const p of list) {
        const b = fileBase(p);
        zip.file(`${b}.pdf`, await pdfFor(p));
        if (wantsFullSet(p)) {
          zip.file(`${b}.step`, await stepFor(p));
          zip.file(`${b}.dxf`, dxfFor(p));
        }
      }
      const buf = await zip.generateAsync({ type: 'nodebuffer' });
      const subject = emailSubject();
      const body = emailBody(list, { supplierName, signature });
      const missing = list.filter((p) => !p.quantity).map(displayName);
      const d = new Date();
      const zipName = `Quotation ${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}.zip`;
      await ctx.replyWithDocument(new InputFile(buf, zipName), { caption: `📎 ${attachmentList(list).join(', ')}`.slice(0, 1000) });
      const kb = new InlineKeyboard().url('פתח טיוטה ב-Gmail', gmailComposeUrl(supplierEmail, subject, body));
      await ctx.reply(`*אל:* ${md(supplierEmail)}\n*נושא:* ${md(subject)}\n\n${md(body)}${missing.length ? `\n\n⚠️ חסרה כמות: ${missing.map(md).join(', ')}` : ''}\n\n_צרף את הקבצים מה-ZIP למייל._`, { parse_mode: 'Markdown', reply_markup: kb });
    }).catch((e) => fail(ctx, e));
  }

  /* photos & image documents (albums are collected and analysed together) */
  async function downloadFile(ctx, fileId) {
    const f = await ctx.api.getFile(fileId);
    const res = await fetch(`${apiRoot}/file/bot${token}/${f.file_path}`);
    if (!res.ok) throw new Error(`הורדת הקובץ מטלגרם נכשלה (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  async function onImage(ctx, fileId) {
    const chatId = ctx.chat.id;
    const caption = ctx.message.caption?.trim() || '';
    const group = ctx.message.media_group_id;
    const fetchImg = async () => {
      const buf = await downloadFile(ctx, fileId);
      const mediaType = mediaTypeOf(buf);
      if (!mediaType) throw new Error('פורמט התמונה לא נתמך — שלח כתמונה רגילה (לא כקובץ HEIC)');
      return { buf, mediaType };
    };
    if (!group) return inQueue(chatId, async () => {
      try { await createPart(ctx, [await fetchImg()], caption); } catch (e) { await fail(ctx, e); }
    });
    let a = albums.get(group);
    if (!a) {
      a = { items: [], caption: '', ctx };
      albums.set(group, a);
    }
    a.items.push(fetchImg());
    if (caption) a.caption = caption;
    clearTimeout(a.timer);
    a.timer = setTimeout(() => {
      albums.delete(group);
      inQueue(chatId, async () => {
        try { await createPart(a.ctx, await Promise.all(a.items), a.caption); } catch (e) { await fail(a.ctx, e); }
      });
    }, 1500);
  }

  bot.on('message:photo', (ctx) => {
    const sizes = ctx.message.photo;
    return onImage(ctx, sizes[sizes.length - 1].file_id);
  });
  bot.on('message:document', (ctx) => {
    const d = ctx.message.document;
    if (!/^image\//.test(d.mime_type || '')) return ctx.reply('שלח תמונה (צילום או סקיצה) או תיאור בטקסט.');
    if (/heic|heif/i.test(d.mime_type)) return ctx.reply('קובץ HEIC לא נתמך — שלח את התמונה כ"תמונה" ולא כקובץ.');
    return onImage(ctx, d.file_id);
  });

  bot.on('message:text', (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return ctx.reply('פקודה לא מוכרת. /help לעזרה.');
    return inQueue(ctx.chat.id, () => revisePart(ctx, text));
  });

  /* buttons */
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const chatId = ctx.chat.id;
    const s = await store.get(chatId);
    const [act, id] = data.split(':');
    const raw = s.parts.find((x) => x.id === id);
    const p = raw ? normalizePart(raw) : null;
    try {
      if (act === 'email') {
        await ctx.answerCallbackQuery({ text: 'מכין מייל וקבצים…' });
        return inQueue(chatId, () => sendEmail(ctx));
      }
      if (act === 'clear') {
        await ctx.answerCallbackQuery();
        if (id === 'yes') {
          for (const q of s.parts) for (const im of q.imageIds || []) await store.delImage(im);
          s.parts = [];
          s.currentId = null;
          await store.save(chatId);
          return ctx.editMessageText('🆕 בקשה חדשה. שלח תמונה או תיאור של חלק.');
        }
        return ctx.editMessageText('בוטל.');
      }
      if (!p) return ctx.answerCallbackQuery({ text: 'החלק כבר לא נמצא בבקשה', show_alert: true });
      if (act === 'pdf') {
        await ctx.answerCallbackQuery();
        return ctx.replyWithDocument(new InputFile(await pdfFor(p), `${fileBase(p)}.pdf`));
      }
      if (act === 'dxf') {
        await ctx.answerCallbackQuery();
        return ctx.replyWithDocument(new InputFile(dxfFor(p), `${fileBase(p)}.dxf`));
      }
      if (act === 'step') {
        await ctx.answerCallbackQuery({ text: 'מכין STEP…' });
        return withTyping(ctx, async () => ctx.replyWithDocument(new InputFile(await stepFor(p), `${fileBase(p)}.step`)));
      }
      if (act === 'full') {
        const want = !wantsFullSet(p);
        raw.fullSet = want === isComplex(p) ? null : want;
        await store.save(chatId);
        await ctx.answerCallbackQuery({ text: want ? 'במייל יישלח סט מלא' : 'במייל יישלח PDF בלבד' });
        return ctx.editMessageReplyMarkup({ reply_markup: partKeyboard(normalizePart(raw)) }).catch(() => {});
      }
      if (act === 'del') {
        s.parts = s.parts.filter((x) => x.id !== id);
        if (s.currentId === id) s.currentId = s.parts[s.parts.length - 1]?.id || null;
        for (const im of raw.imageIds || []) await store.delImage(im);
        await store.save(chatId);
        await ctx.answerCallbackQuery({ text: 'הוסר מהבקשה' });
        return ctx.reply(`🗑 ${displayName(p)} הוסר. נשארו ${s.parts.length} חלקים.`);
      }
      if (act === 'sel') {
        s.currentId = id;
        await store.save(chatId);
        await ctx.answerCallbackQuery();
        return sendCard(ctx, p, '▶️ זה החלק הנוכחי — הודעות טקסט יתקנו אותו');
      }
      return ctx.answerCallbackQuery();
    } catch (e) {
      await ctx.answerCallbackQuery().catch(() => {});
      return fail(ctx, e);
    }
  });

  bot.catch((err) => log.error?.('bot error', err.error || err));

  // Warm up the CAD engine in the background so the first STEP is fast.
  const warm = loadCAD().catch((e) => log.warn?.('CAD engine failed to load', e));

  return { bot, store, warm };
}
