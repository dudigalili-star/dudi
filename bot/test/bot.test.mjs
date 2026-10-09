// End-to-end test of the bot against a fake Telegram Bot API server and a fake Claude client.
// Run: npm test   (no network, no real tokens needed)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createBot } from '../lib.js';

const TOKEN = '123:TEST';
const OWNER = 111, STRANGER = 222;
const sketch = fs.readFileSync(new URL('./sketch.jpg', import.meta.url));
const calls = [];
let msgId = 100;

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  if (req.url.startsWith(`/file/bot${TOKEN}/`)) { res.end(sketch); return; }
  const method = req.url.split('/').pop();
  let params = {};
  const ct = req.headers['content-type'] || '';
  if (ct.includes('json')) params = JSON.parse(body.toString() || '{}');
  else if (ct.includes('multipart')) {
    const s = body.toString('latin1');
    const names = [...s.matchAll(/name="([^"]+)"(?:;\s*filename="?([^"\r]*)"?)?\r\n(?:content-type:\s*[^\r]*\r\n)?\r\n/gi)];
    for (const m of names) {
      if (m[2] !== undefined) params.__file = { field: m[1], filename: Buffer.from(m[2], 'latin1').toString('utf8') };
      else {
        const start = m.index + m[0].length;
        params[m[1]] = Buffer.from(s.slice(start, s.indexOf('\r\n--', start)), 'latin1').toString('utf8');
      }
    }
    params.__size = body.length;
    params.__raw = body;
  }
  calls.push({ method, params });
  const ok = (result) => res.end(JSON.stringify({ ok: true, result }));
  res.setHeader('content-type', 'application/json');
  if (method === 'getMe') return ok({ id: 1, is_bot: true, first_name: 'Bot', username: 'test_bot' });
  if (method === 'getFile') return ok({ file_id: params.file_id, file_unique_id: 'u', file_path: 'photos/p.jpg' });
  if (/^send/.test(method) && method !== 'sendChatAction') return ok({ message_id: ++msgId, date: 0, chat: { id: OWNER, type: 'private' } });
  return ok(true);
});
// keep idle connections open longer than the client does, so a reused socket is never closed mid-request
server.keepAliveTimeout = 60000;
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const apiRoot = `http://127.0.0.1:${server.address().port}`;

// Fake Claude: first request → a pin; correction requests → change the length.
const aiRequests = [];
const spec = (len, extra = {}) => ({
  name: 'PIN 258', partNo: '', kind: 'turned', material: 'ST-37', finish: '', quantity: 10, notes: [],
  questions: ['לא ברור אם הפאזה 1 או 0.5'], estimated: [],
  turned: { segments: [{ length: len, diameter: 20, thread: '', threadLength: 0, diaTol: '' }], chamferLeft: 1, chamferRight: 1, overallTol: '', bores: [], crossHoles: [{ diameter: 5, x: 7, thread: '' }] },
  plate: { shape: 'rect', length: 0, width: 0, thickness: 0, cornerRadius: 0, holes: [] },
  spring: { wireDiameter: 0, outerDiameter: 0, freeLength: 0, totalCoils: 0, activeCoils: 0, ends: '' },
  ...extra,
});
const anthropic = {
  beta: {
    messages: {
      create: async (req) => {
        aiRequests.push(req);
        const text = req.messages[0].content.find((c) => c.type === 'text').text;
        const out = text.includes('Corrections:') ? spec(260, { questions: [] }) : spec(258);
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(out) }] };
      },
    },
  },
};

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'partsbot-'));
const { bot, warm } = createBot({ token: TOKEN, anthropic, allowedUsers: [String(OWNER)], dataDir, apiRoot, log: { error: (...a) => console.error('LOG', ...a), warn() {} } });
await bot.init();
await warm;

let uid = 1;
const chat = { id: OWNER, type: 'private' };
const from = (id = OWNER) => ({ id, is_bot: false, first_name: 'Dudi' });
const msg = (extra, who = OWNER) => bot.handleUpdate({ update_id: uid++, message: { message_id: uid, date: 0, chat: { ...chat, id: who }, from: from(who), ...extra } });
const cmd = (text) => msg({ text, entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] });
const press = (data) => bot.handleUpdate({ update_id: uid++, callback_query: { id: String(uid), from: from(), chat_instance: 'x', data, message: { message_id: 5, date: 0, chat } } });
const since = (n) => calls.slice(n);
const sent = (list, method) => list.filter((c) => c.method === method);
const photo = [{ file_id: 'small', file_unique_id: 'a', width: 90, height: 50 }, { file_id: 'big', file_unique_id: 'b', width: 900, height: 500 }];

// 1. strangers are refused and told their ID
let n = calls.length;
await msg({ text: 'hi' }, STRANGER);
assert.match(sent(since(n), 'sendMessage')[0].params.text, /222/);
assert.equal(aiRequests.length, 0);

// 2. a photo with a caption creates a part and sends a drawing card
n = calls.length;
await msg({ photo, caption: '10 יח ST37' });
let card = sent(since(n), 'sendPhoto')[0];
assert.ok(card, 'card sent');
assert.match(card.params.caption, /PIN 258/);
assert.match(card.params.caption, /לבדוק/);
assert.match(card.params.reply_markup, /pdf:/);
fs.writeFileSync(path.join(dataDir, 'card.png'), card.params.__raw.subarray(card.params.__raw.indexOf(Buffer.from('\x89PNG', 'latin1'))));
assert.equal(aiRequests[0].messages[0].content[0].type, 'image');
assert.match(aiRequests[0].messages[0].content[1].text, /10 יח ST37/);
const partId = JSON.parse(card.params.reply_markup).inline_keyboard[0][0].callback_data.split(':')[1];

// 3. a text message corrects the current part
n = calls.length;
await msg({ text: 'האורך 260' });
card = sent(since(n), 'sendPhoto')[0];
assert.match(card.params.caption, /עודכן/);
assert.match(card.params.caption, /אורך כולל 260/);
assert.match(aiRequests[1].messages[0].content[0].text, /"length":258/);

// 4. buttons: PDF, STEP, DXF
for (const [act, ext] of [['pdf', '.pdf'], ['step', '.step'], ['dxf', '.dxf']]) {
  n = calls.length;
  await press(`${act}:${partId}`);
  const doc = sent(since(n), 'sendDocument')[0];
  assert.ok(doc, `${act} sent`);
  assert.equal(doc.params.__file.filename, `PIN 258${ext}`);
  assert.ok(doc.params.__size > 2000, `${act} has content`);
}

// 5. an album of two photos is analysed as one part
n = calls.length;
await msg({ photo, media_group_id: 'g1', caption: 'two views' });
await msg({ photo, media_group_id: 'g1' });
await new Promise((r) => setTimeout(r, 2200));
await new Promise((r) => setTimeout(r, 300));
assert.equal(aiRequests.length, 3);
assert.equal(aiRequests[2].messages[0].content.filter((c) => c.type === 'image').length, 2);

// 6. /list and /email
n = calls.length;
await cmd('/list');
assert.match(sent(since(n), 'sendMessage')[0].params.text, /2 חלקים/);
n = calls.length;
await cmd('/email');
const zip = sent(since(n), 'sendDocument')[0];
assert.match(zip.params.__file.filename, /^Quotation .*\.zip$/);
const mail = sent(since(n), 'sendMessage').at(-1);
assert.match(mail.params.text, /Dear Mandy/);
assert.match(mail.params.text, /PIN 258 – 10 units – ST-37/);
assert.match(JSON.stringify(mail.params.reply_markup), /mail\.google\.com/);

// 7. full-set toggle and delete
n = calls.length;
await press(`full:${partId}`);
assert.ok(sent(since(n), 'editMessageReplyMarkup').length === 1);
n = calls.length;
await press(`del:${partId}`);
assert.match(sent(since(n), 'sendMessage')[0].params.text, /נשארו 1/);

// 8. state survives a restart
const again = createBot({ token: TOKEN, anthropic, allowedUsers: [String(OWNER)], dataDir, apiRoot, log: console });
const st = await again.store.get(OWNER);
assert.equal(st.parts.length, 1);

console.log(`OK — ${calls.length} Telegram calls, ${aiRequests.length} Claude calls. Card preview: ${path.join(dataDir, 'card.png')}`);
server.close();
process.exit(0);
