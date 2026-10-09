// Renders drawing primitives (see drawing.js) to SVG, PDF (jsPDF) and DXF (R12 ASCII).
import { SHEET_W, SHEET_H, textWidth } from './drawing.js';

const WIDTH = { thick: 0.5, thin: 0.25, center: 0.25, hidden: 0.35 };
const DASH = { center: [6, 1.5, 1, 1.5], hidden: [2.5, 1.2] };
const COLOR = '#111';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r2 = (n) => Math.round(n * 1000) / 1000;

function arcPoints(cx, cy, r, a1, a2, step = 6) {
  let end = a2;
  while (end <= a1) end += 360;
  const pts = [];
  const n = Math.max(2, Math.ceil((end - a1) / step));
  for (let i = 0; i <= n; i++) {
    const a = ((a1 + ((end - a1) * i) / n) * Math.PI) / 180;
    pts.push([cx + r * Math.cos(a), cy - r * Math.sin(a)]);
  }
  return pts;
}

/* ───────────── SVG ───────────── */

export function toSVG(sheet, { width = SHEET_W, height = SHEET_H, viewBox = `0 0 ${SHEET_W} ${SHEET_H}` } = {}) {
  const out = [];
  const st = (s) => {
    const d = DASH[s] ? ` stroke-dasharray="${DASH[s].join(' ')}"` : '';
    return `stroke="${COLOR}" stroke-width="${WIDTH[s] || 0.25}"${d} fill="none"`;
  };
  for (const q of sheet.prims) {
    if (q.t === 'line') out.push(`<line x1="${r2(q.x1)}" y1="${r2(q.y1)}" x2="${r2(q.x2)}" y2="${r2(q.y2)}" ${st(q.s)} stroke-linecap="round"/>`);
    else if (q.t === 'circle') out.push(`<circle cx="${r2(q.cx)}" cy="${r2(q.cy)}" r="${r2(q.r)}" ${st(q.s)}/>`);
    else if (q.t === 'arc') {
      const pts = arcPoints(q.cx, q.cy, q.r, q.a1, q.a2, 3);
      out.push(`<polyline points="${pts.map((p) => `${r2(p[0])},${r2(p[1])}`).join(' ')}" ${st(q.s)}/>`);
    } else if (q.t === 'poly') {
      const pts = q.pts.map((p) => `${r2(p[0])},${r2(p[1])}`).join(' ');
      const tag = q.closed ? 'polygon' : 'polyline';
      if (q.fill) out.push(`<polygon points="${pts}" fill="${COLOR}" stroke="none"/>`);
      else out.push(`<${tag} points="${pts}" ${st(q.s)} stroke-linejoin="round"/>`);
    } else if (q.t === 'text') {
      const anchor = q.anchor === 'middle' ? 'middle' : q.anchor === 'end' ? 'end' : 'start';
      const tr = q.rot ? ` transform="rotate(${-q.rot} ${r2(q.x)} ${r2(q.y)})"` : '';
      out.push(`<text x="${r2(q.x)}" y="${r2(q.y)}" font-size="${q.h}" font-family="Helvetica, Arial, sans-serif"${q.bold ? ' font-weight="bold"' : ''} text-anchor="${anchor}" fill="${COLOR}"${tr} direction="ltr">${esc(q.text)}</text>`);
    } else if (q.t === 'image') {
      out.push(`<image x="${r2(q.x)}" y="${r2(q.y)}" width="${r2(q.w)}" height="${r2(q.h)}" href="${q.src}" preserveAspectRatio="xMidYMid meet"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}mm" height="${height}mm"><rect x="0" y="0" width="${SHEET_W}" height="${SHEET_H}" fill="#fff"/>${out.join('')}</svg>`;
}

/* ───────────── PDF ───────────── */

// jsPDF's built-in fonts use WinAnsi; map a few characters that are not in it.
const pdfText = (s) => s.replace(/⌀/g, 'Ø').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/[–—]/g, '-');

export function drawToPDF(doc, sheet) {
  const PT = 1 / 0.3528; // mm → pt
  const setStyle = (s) => {
    doc.setLineWidth(WIDTH[s] || 0.25);
    doc.setLineDashPattern(DASH[s] || [], 0);
  };
  doc.setDrawColor(17, 17, 17);
  doc.setFillColor(17, 17, 17);
  doc.setTextColor(17, 17, 17);
  for (const q of sheet.prims) {
    if (q.t === 'line') {
      setStyle(q.s);
      doc.line(q.x1, q.y1, q.x2, q.y2);
    } else if (q.t === 'circle') {
      setStyle(q.s);
      doc.circle(q.cx, q.cy, q.r, 'S');
    } else if (q.t === 'arc' || (q.t === 'poly' && !q.fill)) {
      setStyle(q.s);
      const pts = q.t === 'arc' ? arcPoints(q.cx, q.cy, q.r, q.a1, q.a2, 3) : q.pts.slice();
      if (q.t === 'poly' && q.closed) pts.push(pts[0]);
      const rel = [];
      for (let i = 1; i < pts.length; i++) rel.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
      if (rel.length) doc.lines(rel, pts[0][0], pts[0][1], [1, 1], 'S', false);
    } else if (q.t === 'poly' && q.fill) {
      doc.setLineDashPattern([], 0);
      const p = q.pts;
      if (p.length === 3) doc.triangle(p[0][0], p[0][1], p[1][0], p[1][1], p[2][0], p[2][1], 'F');
    } else if (q.t === 'text') {
      doc.setFont('helvetica', q.bold ? 'bold' : 'normal');
      doc.setFontSize(q.h * PT);
      const text = pdfText(q.text);
      const w = doc.getTextWidth(text);
      const shift = q.anchor === 'middle' ? w / 2 : q.anchor === 'end' ? w : 0;
      const a = (q.rot * Math.PI) / 180;
      // move the baseline start back along the (rotated) text direction
      const x = q.x - shift * Math.cos(a);
      const y = q.y + shift * Math.sin(a);
      doc.text(text, x, y, q.rot ? { angle: q.rot } : undefined);
    } else if (q.t === 'image') {
      try {
        const fmt = /^data:image\/png/.test(q.src) ? 'PNG' : 'JPEG';
        doc.addImage(q.src, fmt, q.x, q.y, q.w, q.h);
      } catch (e) {
        console.warn('image failed', e);
      }
    }
  }
  doc.setLineDashPattern([], 0);
}

export function toPDF(jsPDF, sheets, meta = {}) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: meta.title || 'Drawing', author: meta.author || '', creator: 'Dudi drawings' });
  sheets.forEach((s, i) => {
    if (i > 0) doc.addPage('a4', 'landscape');
    drawToPDF(doc, s);
  });
  return doc;
}

/* ───────────── DXF (R12, mm, 1:1) ───────────── */

const LAYERS = {
  thick: { name: 'OUTLINE', color: 7, ltype: 'CONTINUOUS' },
  thin: { name: 'DIMENSIONS', color: 3, ltype: 'CONTINUOUS' },
  center: { name: 'CENTER', color: 1, ltype: 'CENTER' },
  hidden: { name: 'HIDDEN', color: 5, ltype: 'DASHED' },
  text: { name: 'TEXT', color: 2, ltype: 'CONTINUOUS' },
};

export function toDXF(sheet) {
  const L = [];
  const g = (code, value) => { L.push(String(code), String(value)); };
  const num = (n) => (Math.round(n * 10000) / 10000).toString();
  // y is flipped: drawings are built y-down, DXF is y-up
  const Y = (y) => -y;

  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$INSUNITS'); g(70, 4);
  g(9, '$MEASUREMENT'); g(70, 1);
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 3);
  const ltype = (name, desc, pattern) => {
    g(0, 'LTYPE'); g(2, name); g(70, 0); g(3, desc); g(72, 65); g(73, pattern.length);
    g(40, num(pattern.reduce((a, b) => a + Math.abs(b), 0)));
    pattern.forEach((p) => g(49, num(p)));
  };
  ltype('CONTINUOUS', 'Solid line', []);
  ltype('DASHED', '__ __ __', [3, -1.5]);
  ltype('CENTER', '____ _ ____', [8, -1.5, 1.5, -1.5]);
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, Object.keys(LAYERS).length);
  Object.values(LAYERS).forEach((l) => { g(0, 'LAYER'); g(2, l.name); g(70, 0); g(62, l.color); g(6, l.ltype); });
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'STYLE'); g(70, 1);
  g(0, 'STYLE'); g(2, 'STANDARD'); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 2.5); g(3, 'txt'); g(4, '');
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'ENTITIES');
  const layer = (s) => (LAYERS[s] || LAYERS.thin).name;
  const line = (x1, y1, x2, y2, s) => {
    g(0, 'LINE'); g(8, layer(s));
    g(10, num(x1)); g(20, num(Y(y1))); g(30, 0);
    g(11, num(x2)); g(21, num(Y(y2))); g(31, 0);
  };
  for (const q of sheet.prims) {
    if (q.t === 'line') line(q.x1, q.y1, q.x2, q.y2, q.s);
    else if (q.t === 'circle') {
      g(0, 'CIRCLE'); g(8, layer(q.s)); g(10, num(q.cx)); g(20, num(Y(q.cy))); g(30, 0); g(40, num(q.r));
    } else if (q.t === 'arc') {
      // paper CCW == DXF CCW once y is flipped
      g(0, 'ARC'); g(8, layer(q.s)); g(10, num(q.cx)); g(20, num(Y(q.cy))); g(30, 0); g(40, num(q.r));
      g(50, num(((q.a1 % 360) + 360) % 360)); g(51, num(((q.a2 % 360) + 360) % 360 || 360));
    } else if (q.t === 'poly' && q.fill) {
      const p = q.pts;
      g(0, 'SOLID'); g(8, layer('thin'));
      g(10, num(p[0][0])); g(20, num(Y(p[0][1]))); g(30, 0);
      g(11, num(p[1][0])); g(21, num(Y(p[1][1]))); g(31, 0);
      g(12, num(p[2][0])); g(22, num(Y(p[2][1]))); g(32, 0);
      g(13, num(p[2][0])); g(23, num(Y(p[2][1]))); g(33, 0);
    } else if (q.t === 'poly') {
      const pts = q.pts;
      for (let i = 1; i < pts.length; i++) line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], q.s);
      if (q.closed) line(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1], q.s);
    } else if (q.t === 'text') {
      const w = textWidth(q.text, q.h);
      const shift = q.anchor === 'middle' ? w / 2 : q.anchor === 'end' ? w : 0;
      const a = (q.rot * Math.PI) / 180;
      const x = q.x - shift * Math.cos(a);
      const y = q.y + shift * Math.sin(a);
      g(0, 'TEXT'); g(8, layer('text'));
      g(10, num(x)); g(20, num(Y(y))); g(30, 0);
      g(40, num(q.h * 0.72)); g(1, q.text.replace(/Ø/g, '%%c').replace(/°/g, '%%d').replace(/±/g, '%%p'));
      if (q.rot) g(50, num(q.rot));
    }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return L.join('\r\n') + '\r\n';
}
