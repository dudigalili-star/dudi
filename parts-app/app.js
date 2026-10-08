import { jsPDF, JSZip, Anthropic } from './vendor/libs.js';
import {
  KINDS, PLATE_SHAPES, MATERIALS, FINISHES, newPart, normalizePart, warnings, wantsFullSet,
  canMake3D, isComplex, displayName, fileBase, overallLength, fmt,
} from './core/model.js';
import { buildDrawing, buildViews11, scaleLabel } from './core/drawing.js';
import { toSVG, toPDF, toDXF } from './core/render.js';
import { makeSTEP } from './core/cad.js';
import { analyzeImages, fileToImage, DEFAULT_MODEL } from './core/ai.js';
import { emailSubject, emailBody, attachmentList, gmailComposeUrl } from './core/email.js';

/* ───────────── storage ───────────── */

const K_PARTS = 'drw.parts', K_SEL = 'drw.sel', K_SET = 'drw.settings', K_IMG = 'drw.img.';
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const DEFAULT_SETTINGS = { apiKey: '', model: DEFAULT_MODEL, supplier: 'Mandy', email: 'sales6@jrs-sourcing.com', signature: 'Dudu Galili', drawnBy: 'Dudu Galili' };
let settings = { ...DEFAULT_SETTINGS, ...store.get(K_SET, {}) };
let parts = store.get(K_PARTS, []);
let selId = store.get(K_SEL, null);
const images = new Map(); // id -> {dataUrl, base64, mediaType, w, h}

function loadImage(id) {
  if (!images.has(id)) {
    const v = store.get(K_IMG + id, null);
    if (v) images.set(id, v);
  }
  return images.get(id) || null;
}
function saveImage(id, img) {
  images.set(id, img);
  if (!store.set(K_IMG + id, img)) toast('התמונה גדולה מדי לשמירה קבועה בדפדפן — היא תישמר רק עד רענון הדף', 'warn');
}
function saveParts() {
  if (!store.set(K_PARTS, parts)) toast('שמירה נכשלה (אחסון הדפדפן מלא)', 'err');
  store.set(K_SEL, selId);
}

const cur = () => parts.find((p) => p.id === selId) || null;
const norm = (p) => normalizePart(p);

/* ───────────── helpers ───────────── */

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function saveBlob(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

let toastTimer;
function toast(msg, kind = 'ok') {
  const el = $('#status');
  if (!el) return;
  el.innerHTML = msg ? `<div class="alert ${kind}">${msg}</div>` : '';
  clearTimeout(toastTimer);
  if (kind === 'ok' && msg) toastTimer = setTimeout(() => { el.innerHTML = ''; }, 5000);
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  keys.slice(0, -1).forEach((k) => { o = o[k]; });
  o[keys[keys.length - 1]] = value;
}

function partImage(p) {
  const id = p.imageIds?.[0];
  return id ? loadImage(id) : null;
}

/* ───────────── outputs ───────────── */

function drawingFor(p) {
  const img = partImage(p);
  return buildDrawing(p, { drawnBy: settings.drawnBy, image: img ? { src: img.dataUrl, w: img.w, h: img.h } : null });
}

function pdfBlob(p) {
  const { sheet } = drawingFor(p);
  const doc = toPDF(jsPDF, [sheet], { title: displayName(p), author: settings.drawnBy });
  return doc.output('blob');
}

function dxfBlob(p) {
  return new Blob([toDXF(buildViews11(p))], { type: 'application/dxf' });
}

async function withCadStatus(fn) {
  toast('<span class="spinner"></span> מכין מודל תלת-ממד… (בפעם הראשונה נטען מנוע של כ-23MB, זה לוקח כמה שניות)', 'warn');
  try {
    const r = await fn();
    toast('');
    return r;
  } catch (e) {
    console.error(e);
    toast(`יצירת STEP נכשלה: ${esc(e.message || e)}`, 'err');
    throw e;
  }
}

async function downloadAll() {
  const list = parts.map(norm);
  if (!list.length) return;
  const zip = new JSZip();
  const needsCad = list.some(wantsFullSet);
  const run = async () => {
    for (const p of list) {
      const b = fileBase(p);
      zip.file(`${b}.pdf`, pdfBlob(p));
      if (wantsFullSet(p)) {
        zip.file(`${b}.step`, await makeSTEP(p));
        zip.file(`${b}.dxf`, dxfBlob(p));
      }
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const d = new Date();
    saveBlob(`Quotation ${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}.zip`, blob);
  };
  if (needsCad) await withCadStatus(run);
  else await run();
}

/* ───────────── rendering: parts list ───────────── */

function renderList() {
  const ul = $('#plist');
  if (!parts.length) {
    ul.innerHTML = '<li style="cursor:default;justify-content:center;color:var(--muted)">אין עדיין חלקים</li>';
  } else {
    ul.innerHTML = parts.map((raw) => {
      const p = norm(raw);
      const img = partImage(p);
      const w = warnings(p).length + p.questions.length;
      return `<li data-id="${p.id}" class="${p.id === selId ? 'sel' : ''}">
        ${img ? `<img class="thumb" src="${img.dataUrl}" alt="">` : '<div class="thumb"></div>'}
        <div style="flex:1;min-width:0">
          <div class="nm">${esc(displayName(p))}</div>
          <div class="meta">${p.quantity ? `${p.quantity} יח'` : 'ללא כמות'} · ${esc(KINDS[p.kind].split(' (')[0])}</div>
        </div>
        ${wantsFullSet(p) ? '<span class="badge full">סט מלא</span>' : '<span class="badge">PDF</span>'}
        ${w ? `<span class="badge warn" title="יש דברים לבדוק">${w}!</span>` : ''}
      </li>`;
    }).join('');
  }
  renderMail();
}

/* ───────────── rendering: email ───────────── */

function renderMail() {
  const card = $('#mail-card');
  const list = parts.map(norm);
  if (!list.length) {
    card.innerHTML = '<h2>מייל לספק</h2><div class="muted">הוסף חלקים כדי לייצר מייל לבקשת הצעת מחיר.</div>';
    return;
  }
  const subject = emailSubject();
  const body = emailBody(list, { supplierName: settings.supplier, signature: settings.signature });
  const files = attachmentList(list);
  const missingQty = list.filter((p) => !p.quantity).length;
  card.innerHTML = `<h2>מייל ל${esc(settings.supplier || 'ספק')}</h2>
    ${missingQty ? `<div class="alert warn">ל-${missingQty} חלקים חסרה כמות</div>` : ''}
    <label class="f">אל<input class="ltr" id="m-to" value="${esc(settings.email)}"></label>
    <label class="f" style="margin-top:8px">נושא<input class="ltr" id="m-subj" value="${esc(subject)}"></label>
    <label class="f" style="margin-top:8px">תוכן<textarea class="ltr" id="m-body">${esc(body)}</textarea></label>
    <div class="sub">קבצים לצרף (${files.length})</div>
    <div class="files">${files.map(esc).join('<br>')}</div>
    <div class="row" style="margin-top:12px">
      <button class="btn primary" id="m-zip">⬇ כל הקבצים (ZIP)</button>
      <button class="btn" id="m-copy">העתק תוכן</button>
      <a class="btn" id="m-gmail" target="_blank" rel="noopener">פתח טיוטה ב-Gmail</a>
    </div>
    <div class="muted" style="margin-top:6px">ב-Gmail צריך לגרור את הקבצים מה-ZIP לטיוטה.</div>`;
  const upd = () => { $('#m-gmail').href = gmailComposeUrl($('#m-to').value, $('#m-subj').value, $('#m-body').value); };
  upd();
  ['#m-to', '#m-subj', '#m-body'].forEach((s) => $(s).addEventListener('input', upd));
  $('#m-copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('#m-body').value); $('#m-copy').textContent = '✓ הועתק'; } catch { $('#m-body').select(); }
  };
  $('#m-zip').onclick = async (e) => {
    e.target.disabled = true;
    try { await downloadAll(); } finally { e.target.disabled = false; }
  };
}

/* ───────────── rendering: editor ───────────── */

const field = (label, path, value, { type = 'text', ltr = true, list = '', step = 'any', placeholder = '' } = {}) => `
  <label class="f">${label}<input data-path="${path}" ${type === 'number' ? `type="number" step="${step}" inputmode="decimal"` : 'type="text"'} ${ltr ? 'class="ltr"' : ''} ${list ? `list="${list}"` : ''} value="${esc(value)}" placeholder="${esc(placeholder)}"></label>`;

function tableRows(rows, path, cols) {
  return `<table class="t"><thead><tr><th></th>${cols.map((c) => `<th>${c.label}</th>`).join('')}<th></th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr><td class="idx">${i + 1}</td>${cols.map((c) => `<td><input data-path="${path}.${i}.${c.key}" class="ltr" ${c.type === 'number' ? 'type="number" step="any" inputmode="decimal"' : ''} ${c.list ? `list="${c.list}"` : ''} value="${esc(r[c.key])}" placeholder="${esc(c.ph || '')}"></td>`).join('')}
      <td style="white-space:nowrap">
        ${path.endsWith('segments') ? `<button class="btn ghost small" data-move="${path}|${i}|-1" title="הזז שמאלה">▲</button><button class="btn ghost small" data-move="${path}|${i}|1" title="הזז ימינה">▼</button>` : ''}
        <button class="btn ghost small" data-del="${path}|${i}" title="מחק">✕</button></td></tr>`).join('')}
  </tbody></table>`;
}

function dimsHTML(p) {
  if (p.kind === 'turned') {
    const t = p.turned;
    return `
      <div class="muted">מקטעים לפי הסדר <b>משמאל לימין</b> (כמו בשרטוט). אורך כולל: <b class="ltr" id="ov-len">${fmt(overallLength(norm(p)))}</b> מ"מ</div>
      ${tableRows(t.segments, 'turned.segments', [
        { key: 'length', label: 'אורך', type: 'number' },
        { key: 'diameter', label: 'קוטר', type: 'number' },
        { key: 'thread', label: 'הברגה', ph: 'M20 / M20x1.5', list: 'dl-threads' },
        { key: 'threadLength', label: 'אורך הברגה (0=כל המקטע)', type: 'number' },
        { key: 'diaTol', label: 'טולרנס קוטר', ph: 'h7 / ±0.05' },
      ])}
      <button class="btn small" data-add="turned.segments">+ מקטע</button>
      <div class="grid" style="margin-top:12px">
        ${field('פאזה שמאל (45°)', 'turned.chamferLeft', t.chamferLeft, { type: 'number' })}
        ${field('פאזה ימין (45°)', 'turned.chamferRight', t.chamferRight, { type: 'number' })}
        ${field('טולרנס אורך כולל', 'turned.overallTol', t.overallTol, { placeholder: '±0.1' })}
      </div>
      <div class="sub">קדחים בציר (מהקצה)</div>
      ${t.bores.length ? tableRows(t.bores, 'turned.bores', [
        { key: 'end', label: 'קצה (left/right)', list: 'dl-ends' },
        { key: 'diameter', label: 'קוטר', type: 'number' },
        { key: 'depth', label: 'עומק (0=עובר)', type: 'number' },
        { key: 'thread', label: 'הברגה', ph: 'M8', list: 'dl-threads' },
      ]) : ''}
      <button class="btn small" data-add="turned.bores">+ קדח צירי</button>
      <div class="sub">חורים רוחביים (מרחק ממרכז החור לקצה השמאלי)</div>
      ${t.crossHoles.length ? tableRows(t.crossHoles, 'turned.crossHoles', [
        { key: 'x', label: 'מרחק מקצה שמאלי למרכז', type: 'number' },
        { key: 'diameter', label: 'קוטר', type: 'number' },
        { key: 'thread', label: 'הברגה', ph: 'M6', list: 'dl-threads' },
      ]) : ''}
      <button class="btn small" data-add="turned.crossHoles">+ חור רוחבי</button>`;
  }
  if (p.kind === 'plate') {
    const pl = p.plate;
    return `
      <div class="grid">
        <label class="f">צורה<select data-path="plate.shape">${Object.entries(PLATE_SHAPES).map(([k, v]) => `<option value="${k}" ${pl.shape === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        ${field(pl.shape === 'disc' ? 'קוטר חיצוני' : 'אורך (X)', 'plate.length', pl.length, { type: 'number' })}
        ${pl.shape === 'disc' ? '' : field('רוחב (Y)', 'plate.width', pl.width, { type: 'number' })}
        ${field('עובי', 'plate.thickness', pl.thickness, { type: 'number' })}
        ${pl.shape === 'rect' ? field('רדיוס פינות', 'plate.cornerRadius', pl.cornerRadius, { type: 'number' }) : ''}
        ${field('טולרנס אורך', 'plate.lengthTol', pl.lengthTol, { placeholder: '±0.1' })}
        ${pl.shape === 'disc' ? '' : field('טולרנס רוחב', 'plate.widthTol', pl.widthTol, { placeholder: '±0.1' })}
        ${field('טולרנס עובי', 'plate.thicknessTol', pl.thicknessTol, { placeholder: '±0.1' })}
      </div>
      <div class="sub">חורים — מיקום מרכז החור מהקצה <b>השמאלי</b> (X) ומהקצה <b>התחתון</b> (Y)</div>
      ${pl.holes.length ? tableRows(pl.holes, 'plate.holes', [
        { key: 'x', label: 'X', type: 'number' },
        { key: 'y', label: 'Y', type: 'number' },
        { key: 'diameter', label: 'קוטר', type: 'number' },
        { key: 'thread', label: 'הברגה', ph: 'M6', list: 'dl-threads' },
        { key: 'depth', label: 'עומק (0=עובר)', type: 'number' },
        { key: 'tol', label: 'טולרנס', ph: 'H7' },
      ]) : ''}
      <button class="btn small" data-add="plate.holes">+ חור</button>`;
  }
  if (p.kind === 'spring') {
    const sp = p.spring;
    return `<div class="grid">
      ${field('קוטר תיל', 'spring.wireDiameter', sp.wireDiameter, { type: 'number' })}
      ${field('קוטר חיצוני (OD)', 'spring.outerDiameter', sp.outerDiameter, { type: 'number' })}
      ${field('אורך חופשי', 'spring.freeLength', sp.freeLength, { type: 'number' })}
      ${field('כריכות סה"כ', 'spring.totalCoils', sp.totalCoils, { type: 'number' })}
      ${field('כריכות פעילות', 'spring.activeCoils', sp.activeCoils, { type: 'number' })}
      ${field('קצוות', 'spring.ends', sp.ends, { list: 'dl-ends-spring' })}
      ${field('כיוון ליפוף', 'spring.direction', sp.direction, { list: 'dl-dir' })}
    </div>`;
  }
  return '<div class="muted">חלק מורכב: השרטוט יכלול את התמונה הראשונה + הערות + טבלת כותרת. לחלקים כאלה עדיף לצרף גם את קבצי ה-CAD המקוריים אם יש.</div>';
}

function renderEditor() {
  const ed = $('#editor');
  const p = cur();
  if (!p) {
    ed.innerHTML = `<div class="card empty">
      <div style="font-size:40px">📐</div>
      <p style="margin:8px 0 14px">צלם חלק או סקיצה ← קבל שרטוט מסודר לשליחה לספק</p>
      <button class="btn primary" id="btn-add2">+ חלק חדש</button></div>`;
    $('#btn-add2').onclick = addPart;
    return;
  }
  const n = norm(p);
  const imgs = p.imageIds.map((id) => [id, loadImage(id)]).filter(([, v]) => v);
  ed.innerHTML = `
    <div id="status"></div>
    <div class="card">
      <h2><span class="step">1</span> תמונה או סקיצה</h2>
      <div class="drop" id="drop">
        <input type="file" id="file" accept="image/*" multiple hidden>
        📷 לחץ לצילום / בחירת תמונה, או גרור לכאן<br><span class="muted">אפשר כמה תמונות של אותו חלק (מבטים שונים, סקיצה + צילום)</span>
      </div>
      <div class="thumbs">${imgs.map(([id, v]) => `<div class="th"><img src="${v.dataUrl}" alt=""><button class="x" data-rmimg="${id}" title="הסר">✕</button></div>`).join('')}</div>
      <label class="f" style="margin-top:12px">מידע נוסף ל-AI (לא חובה) — מידות ידועות, כמות, חומר, הערות
        <textarea id="ai-text" rows="2" placeholder="למשל: אורך 258, קוטר 20, 10 יחידות, ST37, חור 5 במרחק 7 מכל צד"></textarea></label>
      <div class="row" style="margin-top:10px">
        <button class="btn primary" id="btn-ai">✨ נתח עם AI</button>
        <span class="muted">${settings.apiKey ? 'אפשר גם בלי תמונה — רק תיאור בטקסט' : 'צריך מפתח API בהגדרות. אפשר גם למלא ידנית למטה.'}</span>
      </div>
    </div>

    <div class="card">
      <h2><span class="step">2</span> פרטי החלק</h2>
      <div class="row" style="margin-bottom:12px">
        <label class="f" style="flex:1;min-width:220px">תיקון בשפה חופשית (AI)
          <input id="ai-fix" placeholder="למשל: האורך 260, החומר 1045, להוסיף חור 6 במרחק 30 מהקצה"></label>
        <button class="btn" id="btn-ai-fix">עדכן</button>
      </div>
      ${n.questions.length ? `<div class="alert warn"><b>שאלות פתוחות מה-AI — כדאי לבדוק לפני שליחה:</b><ul>${n.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>
        <button class="btn small" id="btn-clear-q" style="margin-top:6px">✓ בדקתי, הסר</button></div>` : ''}
      ${n.estimated.length ? `<div class="alert warn"><b>מידות שהוערכו מהתמונה (לא נכתבו בה):</b><ul>${n.estimated.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>
        <button class="btn small" id="btn-clear-e" style="margin-top:6px">✓ אימתתי את המידות</button></div>` : ''}
      <div id="warn-box"></div>
      <div class="grid">
        ${field('שם החלק (באנגלית)', 'name', p.name, { placeholder: 'PIN 258' })}
        ${field('מספר חלק', 'partNo', p.partNo)}
        <label class="f">סוג<select data-path="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${p.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        ${field('חומר', 'material', p.material, { list: 'dl-mat' })}
        ${field('גימור / צבע', 'finish', p.finish, { list: 'dl-fin' })}
        ${field('כמות', 'quantity', p.quantity || '', { type: 'number', step: '1' })}
        ${field('טולרנס כללי', 'generalTolerance', p.generalTolerance, { list: 'dl-tol' })}
        ${field('מהדורה', 'revision', p.revision)}
      </div>
      <label class="f" style="margin-top:10px">הערות לשרטוט (באנגלית, שורה לכל הערה)
        <textarea class="ltr" data-path="notes" data-lines="1" rows="2" placeholder="HARDEN TO 40-45 HRC">${esc(p.notes.join('\n'))}</textarea></label>
    </div>

    <div class="card">
      <h2><span class="step">3</span> מידות (מ"מ)</h2>
      ${dimsHTML(p)}
    </div>

    <div class="card">
      <h2><span class="step">4</span> שרטוט וקבצים</h2>
      <div class="preview" id="preview"></div>
      <div class="row" style="margin-top:12px; justify-content:space-between">
        <div class="row">
          <button class="btn primary" id="dl-pdf">⬇ PDF</button>
          ${canMake3D(n) ? '<button class="btn" id="dl-step">⬇ STEP</button><button class="btn" id="dl-dxf">⬇ DXF</button>' : ''}
        </div>
        ${canMake3D(n) ? `<label class="toggle"><input type="checkbox" id="full-set" ${wantsFullSet(n) ? 'checked' : ''}> לשלוח סט מלא (PDF+STEP+DXF)
          <span class="muted" id="full-hint">${p.fullSet == null ? `(אוטומטי: ${isComplex(n) ? 'חלק מורכב' : 'חלק פשוט'})` : ''}</span></label>` : '<span class="muted">לסוג חלק זה נשלח PDF בלבד</span>'}
      </div>
      <div class="row" style="margin-top:14px; justify-content:flex-end">
        <button class="btn ghost" id="btn-del">🗑 מחק חלק</button>
      </div>
    </div>
    <datalist id="dl-mat">${MATERIALS.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
    <datalist id="dl-fin">${FINISHES.filter(Boolean).map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
    <datalist id="dl-tol"><option value="ISO 2768-m"><option value="ISO 2768-f"><option value="ISO 2768-c"></datalist>
    <datalist id="dl-threads">${[4, 5, 6, 8, 10, 12, 14, 16, 20, 24, 30].map((d) => `<option value="M${d}">`).join('')}<option value="M12x1.5"><option value="M20x1.5"><option value="M24x1.5"></datalist>
    <datalist id="dl-ends"><option value="left"><option value="right"></datalist>
    <datalist id="dl-ends-spring"><option value="Closed and ground"><option value="Closed not ground"><option value="Open"></datalist>
    <datalist id="dl-dir"><option value="Right hand"><option value="Left hand"></datalist>`;
  bindEditor();
  refreshOutputs();
}

/* ───────────── live updates ───────────── */

let previewTimer;
function refreshOutputs() {
  const p = cur();
  if (!p) return;
  const n = norm(p);
  const pv = $('#preview');
  if (pv) {
    const { sheet } = drawingFor(n);
    pv.innerHTML = toSVG(sheet);
  }
  const wb = $('#warn-box');
  if (wb) {
    const w = warnings(n);
    wb.innerHTML = w.length ? `<div class="alert warn"><b>לבדוק:</b><ul>${w.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
  }
  const ol = $('#ov-len');
  if (ol) ol.textContent = fmt(overallLength(n));
  const fs = $('#full-set');
  if (fs) {
    fs.checked = wantsFullSet(n);
    $('#full-hint').textContent = p.fullSet == null ? `(אוטומטי: ${isComplex(n) ? 'חלק מורכב' : 'חלק פשוט'})` : '';
  }
  renderList();
}

function scheduleRefresh() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => { saveParts(); refreshOutputs(); }, 180);
}

function bindEditor() {
  const ed = $('#editor');
  const p = cur();

  ed.querySelectorAll('[data-path]').forEach((el) => {
    const path = el.dataset.path;
    const handler = () => {
      let v = el.value;
      if (el.dataset.lines) v = v.split('\n').map((s) => s.trim()).filter(Boolean);
      else if (el.type === 'number') v = v === '' ? 0 : parseFloat(v);
      setPath(p, path, v);
      if (path === 'kind' || path === 'plate.shape') {
        saveParts();
        renderEditor();
      } else scheduleRefresh();
    };
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', handler);
  });

  ed.querySelectorAll('[data-add]').forEach((b) => {
    b.onclick = () => {
      const path = b.dataset.add;
      const arr = getPath(p, path);
      const n = norm(p);
      const defaults = {
        'turned.segments': { length: 20, diameter: arr.length ? arr[arr.length - 1].diameter : 20, thread: '', threadLength: 0, diaTol: '' },
        'turned.bores': { end: 'left', diameter: 8, depth: 0, thread: '' },
        'turned.crossHoles': { x: Math.round(overallLength(n) / 2), diameter: 6, thread: '' },
        'plate.holes': { x: Math.round(n.plate.length / 2), y: Math.round(n.plate.width / 2), diameter: 8, thread: '', depth: 0, tol: '' },
      };
      arr.push({ ...defaults[path] });
      saveParts();
      renderEditor();
    };
  });
  ed.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = () => {
      const [path, i] = b.dataset.del.split('|');
      getPath(p, path).splice(Number(i), 1);
      saveParts();
      renderEditor();
    };
  });
  ed.querySelectorAll('[data-move]').forEach((b) => {
    b.onclick = () => {
      const [path, i, d] = b.dataset.move.split('|');
      const arr = getPath(p, path);
      const a = Number(i), c = a + Number(d);
      if (c < 0 || c >= arr.length) return;
      [arr[a], arr[c]] = [arr[c], arr[a]];
      saveParts();
      renderEditor();
    };
  });

  // images
  const drop = $('#drop'), file = $('#file');
  drop.onclick = () => file.click();
  file.onchange = () => addImages(file.files);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addImages(e.dataTransfer.files); });
  ed.querySelectorAll('[data-rmimg]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.rmimg;
      p.imageIds = p.imageIds.filter((x) => x !== id);
      store.del(K_IMG + id);
      images.delete(id);
      saveParts();
      renderEditor();
    };
  });

  $('#btn-ai').onclick = () => runAI();
  $('#btn-ai-fix').onclick = () => runAI({ fix: true });
  $('#ai-fix').addEventListener('keydown', (e) => { if (e.key === 'Enter') runAI({ fix: true }); });
  const cq = $('#btn-clear-q');
  if (cq) cq.onclick = () => { p.questions = []; saveParts(); renderEditor(); };
  const ce = $('#btn-clear-e');
  if (ce) ce.onclick = () => { p.estimated = []; saveParts(); renderEditor(); };

  $('#dl-pdf').onclick = () => saveBlob(`${fileBase(norm(p))}.pdf`, pdfBlob(norm(p)));
  const ds = $('#dl-step');
  if (ds) ds.onclick = async () => {
    ds.disabled = true;
    try {
      const blob = await withCadStatus(() => makeSTEP(norm(p)));
      saveBlob(`${fileBase(norm(p))}.step`, blob);
      toast('קובץ STEP נוצר');
    } catch { /* reported */ } finally { ds.disabled = false; }
  };
  const dd = $('#dl-dxf');
  if (dd) dd.onclick = () => saveBlob(`${fileBase(norm(p))}.dxf`, dxfBlob(norm(p)));
  const fs = $('#full-set');
  if (fs) fs.onchange = () => { p.fullSet = fs.checked === isComplex(norm(p)) ? null : fs.checked; saveParts(); refreshOutputs(); };
  $('#btn-del').onclick = () => {
    if (!confirm(`למחוק את ${displayName(norm(p))}?`)) return;
    p.imageIds.forEach((id) => store.del(K_IMG + id));
    parts = parts.filter((x) => x.id !== p.id);
    selId = parts[0]?.id || null;
    saveParts();
    renderList();
    renderEditor();
  };
}

async function addImages(fileList) {
  const p = cur();
  if (!p) return;
  const files = [...fileList].filter((f) => f.type.startsWith('image/'));
  for (const f of files) {
    try {
      const img = await fileToImage(f);
      const id = `${p.id}-${Math.random().toString(36).slice(2, 7)}`;
      saveImage(id, img);
      p.imageIds.push(id);
    } catch (e) {
      toast(esc(e.message), 'err');
    }
  }
  saveParts();
  renderEditor();
}

async function runAI({ fix = false } = {}) {
  const p = cur();
  if (!settings.apiKey) {
    openSettings();
    return;
  }
  const imgs = p.imageIds.map(loadImage).filter(Boolean);
  const userText = (fix ? $('#ai-fix') : $('#ai-text')).value.trim();
  if (fix && !userText) return;
  if (!fix && !imgs.length && !userText) {
    toast('הוסף תמונה או כתוב תיאור של החלק', 'warn');
    return;
  }
  const btn = $(fix ? '#btn-ai-fix' : '#btn-ai');
  btn.disabled = true;
  toast(`<span class="spinner"></span> ${fix ? 'מעדכן את החלק…' : 'מנתח… (בדרך כלל 20–60 שניות)'}`, 'warn');
  try {
    const res = await analyzeImages({
      Anthropic, apiKey: settings.apiKey, model: settings.model || DEFAULT_MODEL,
      images: fix ? [] : imgs, userText, current: fix ? norm(p) : null,
    });
    const keep = { id: p.id, imageIds: p.imageIds, createdAt: p.createdAt, fullSet: fix ? p.fullSet : null };
    // values the user already typed win over AI guesses
    if (p.quantity && !res.quantity) keep.quantity = p.quantity;
    Object.assign(p, res, keep);
    saveParts();
    renderEditor();
    toast(fix ? 'החלק עודכן.' : 'הניתוח הושלם — עבור על המידות והשאלות לפני שליחה.');
  } catch (e) {
    console.error(e);
    const msg = e?.status === 401 ? 'מפתח ה-API לא תקין' : (e?.message || String(e));
    toast(`הפעולה נכשלה: ${esc(msg)}`, 'err');
  } finally {
    if ($('#btn-ai')) $('#btn-ai').disabled = false;
    if ($('#btn-ai-fix')) $('#btn-ai-fix').disabled = false;
  }
}

/* ───────────── top-level actions ───────────── */

function addPart() {
  const p = newPart('turned');
  p.turned.segments = [{ length: 100, diameter: 20, thread: '', threadLength: 0, diaTol: '' }];
  parts.push(p);
  selId = p.id;
  saveParts();
  renderList();
  renderEditor();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openSettings() {
  $('#set-key').value = settings.apiKey;
  $('#set-model').value = settings.model;
  $('#set-supplier').value = settings.supplier;
  $('#set-email').value = settings.email;
  $('#set-sign').value = settings.signature;
  $('#set-drawn').value = settings.drawnBy;
  $('#dlg-settings').showModal();
}

$('#btn-settings').onclick = openSettings;
$('#set-cancel').onclick = () => $('#dlg-settings').close();
$('#set-save').onclick = () => {
  settings = {
    apiKey: $('#set-key').value.trim(),
    model: $('#set-model').value.trim() || DEFAULT_MODEL,
    supplier: $('#set-supplier').value.trim(),
    email: $('#set-email').value.trim(),
    signature: $('#set-sign').value.trim(),
    drawnBy: $('#set-drawn').value.trim(),
  };
  store.set(K_SET, settings);
  $('#dlg-settings').close();
  renderEditor();
  renderList();
};
$('#btn-add').onclick = addPart;
$('#btn-clear').onclick = () => {
  if (!parts.length || !confirm('להתחיל בקשה חדשה? כל החלקים הנוכחיים יימחקו.')) return;
  parts.forEach((p) => p.imageIds.forEach((id) => store.del(K_IMG + id)));
  parts = [];
  selId = null;
  saveParts();
  renderList();
  renderEditor();
};
$('#plist').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  selId = li.dataset.id;
  saveParts();
  renderList();
  renderEditor();
});

if (!cur()) selId = parts[0]?.id || null;
renderList();
renderEditor();

/* ───────────── installable app ───────────── */

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker', e));
}

let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  $('#btn-install').hidden = false;
});
$('#btn-install').onclick = async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  $('#btn-install').hidden = true;
};

// Photos shared to the app from the phone's share sheet (see sw.js) become a new part.
async function takeSharedImages() {
  if (!new URLSearchParams(location.search).has('shared') || !('caches' in window)) return;
  history.replaceState(null, '', location.pathname);
  const cache = await caches.open('parts-app-share');
  const keys = await cache.keys();
  const files = [];
  for (const k of keys) {
    const res = await cache.match(k);
    const blob = await res.blob();
    files.push(new File([blob], 'shared.jpg', { type: blob.type || 'image/jpeg' }));
    await cache.delete(k);
  }
  if (!files.length) return;
  addPart();
  await addImages(files);
}
takeSharedImages().catch((e) => console.warn('share', e));
