// Builds a 2D engineering drawing (A4 landscape, mm, y pointing down) as a list of
// simple primitives. The same primitives are rendered to SVG (preview), PDF and DXF.
import { overallLength, fmt, displayName, dimensionList, plateHoleGroup, crossHoleGroup, useHoleTable, plateHoleTags } from './model.js';

export const SHEET_W = 297;
export const SHEET_H = 210;
const VIEW_AREA = { x1: 14, y1: 14, x2: 283, y2: 150 };
const ARROW_L = 2.6;
const ARROW_W = 0.65;
const DIM_H = 3; // dimension text height
const SCALES = [10, 5, 2, 1, 0.5, 0.4, 0.2, 0.1, 0.05];

export class Sheet {
  // tags: optional {key: {n, estimated}} — numbered balloons next to dimension texts (chat preview only)
  constructor(tags = null) { this.prims = []; this.tags = tags; }
  line(x1, y1, x2, y2, s = 'thick') { this.prims.push({ t: 'line', x1, y1, x2, y2, s }); }
  circle(cx, cy, r, s = 'thick') { this.prims.push({ t: 'circle', cx, cy, r, s }); }
  // a1→a2 in degrees, counter-clockwise as seen on paper.
  arc(cx, cy, r, a1, a2, s = 'thick') { this.prims.push({ t: 'arc', cx, cy, r, a1, a2, s }); }
  poly(pts, { closed = false, fill = false, s = 'thin' } = {}) { this.prims.push({ t: 'poly', pts, closed, fill, s }); }
  text(x, y, text, { h = 3.5, anchor = 'start', rot = 0, bold = false, tag = null } = {}) {
    const tags = this.tags && tag ? [...new Set([].concat(tag).map((k) => this.tags[k]).filter(Boolean))] : [];
    const est = tags.some((d) => d.estimated);
    const str = String(text) + (est ? ' ?' : '');
    this.prims.push({ t: 'text', x, y, text: str, h, anchor, rot, bold });
    if (!tags.length) return;
    // balloons after the end of the text
    const w = String(str).length * h * 0.6;
    const R = 2.1;
    tags.forEach((d, i) => {
      const off = w * (anchor === 'middle' ? 0.5 : anchor === 'end' ? 0 : 1) + R + (rot ? 1.8 : 0.8) + i * (2 * R + 0.6);
      const cx = rot ? x - h * 0.35 : x + off;
      const cy = rot ? y - off : y - h * 0.35;
      this.circle(cx, cy, R, d.estimated ? 'thick' : 'thin');
      const label = String(d.n);
      this.prims.push({ t: 'text', x: cx, y: cy + 0.85, text: label, h: label.length > 1 ? 2.1 : 2.4, anchor: 'middle', rot: 0, bold: d.estimated });
    });
  }
  image(x, y, w, h, src) { this.prims.push({ t: 'image', x, y, w, h, src }); }
  rect(x, y, w, h, s = 'thin') { this.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], { closed: true, s }); }
}

export function textWidth(text, h) {
  return String(text).length * h * 0.56;
}

// A dimension label is a string, or {text, key} where key (or a list of keys) names the
// dimension in dimensionList() — used for the numbered balloons on the chat preview.
const lab = (l) => (l && typeof l === 'object' ? l : { text: String(l), key: null });
const K = (key, text) => ({ text, key });

function arrow(S, tipX, tipY, dx, dy) {
  // dx,dy: unit vector pointing from the tip back along the line
  const bx = tipX + dx * ARROW_L, by = tipY + dy * ARROW_L;
  const nx = -dy * ARROW_W, ny = dx * ARROW_W;
  S.poly([[tipX, tipY], [bx + nx, by + ny], [bx - nx, by - ny]], { closed: true, fill: true });
}

// Dimension line between two points along x (horizontal) at height yLine.
// yA / yB are the paper y of the measured points (for the extension lines).
export function hDim(S, xA, yA, xB, yB, yLine, label) {
  if (xB < xA) [xA, yA, xB, yB] = [xB, yB, xA, yA];
  const ext = (x, y) => {
    const dir = Math.sign(yLine - y) || 1;
    S.line(x, y + dir * 1, x, yLine + dir * 1.5, 'thin');
  };
  ext(xA, yA); ext(xB, yB);
  const { text, key } = lab(label);
  const len = xB - xA;
  const tw = textWidth(text, DIM_H);
  if (len >= ARROW_L * 2 + 1) {
    S.line(xA, yLine, xB, yLine, 'thin');
    arrow(S, xA, yLine, 1, 0); arrow(S, xB, yLine, -1, 0);
  } else {
    S.line(xA - ARROW_L - 3, yLine, xB + ARROW_L + 3, yLine, 'thin');
    arrow(S, xA, yLine, -1, 0); arrow(S, xB, yLine, 1, 0);
  }
  if (tw + 2 < len) S.text((xA + xB) / 2, yLine - 0.9, text, { h: DIM_H, anchor: 'middle', tag: key });
  else S.text(xB + ARROW_L + 4, yLine - 0.9, text, { h: DIM_H, anchor: 'start', tag: key });
}

// Vertical dimension at x = xLine between paper y's yA,yB (points at xA / xB).
export function vDim(S, xA, yA, xB, yB, xLine, label) {
  if (yB < yA) [xA, yA, xB, yB] = [xB, yB, xA, yA];
  const ext = (x, y) => {
    const dir = Math.sign(xLine - x) || 1;
    S.line(x + dir * 1, y, xLine + dir * 1.5, y, 'thin');
  };
  ext(xA, yA); ext(xB, yB);
  const { text, key } = lab(label);
  const len = yB - yA;
  const tw = textWidth(text, DIM_H);
  if (len >= ARROW_L * 2 + 1) {
    S.line(xLine, yA, xLine, yB, 'thin');
    arrow(S, xLine, yA, 0, 1); arrow(S, xLine, yB, 0, -1);
  } else {
    S.line(xLine, yA - ARROW_L - 3, xLine, yB + ARROW_L + 3, 'thin');
    arrow(S, xLine, yA, 0, -1); arrow(S, xLine, yB, 0, 1);
  }
  if (tw + 2 < len) S.text(xLine - 0.9, (yA + yB) / 2, text, { h: DIM_H, anchor: 'middle', rot: 90, tag: key });
  else S.text(xLine - 0.9, yA - ARROW_L - 4, text, { h: DIM_H, anchor: 'start', rot: 90, tag: key });
}

// Dimension drawn inside a feature (e.g. a diameter across a shaft step), arrows touching the edges.
function innerVDim(S, x, yA, yB, label) {
  S.line(x, yA, x, yB, 'thin');
  arrow(S, x, yA, 0, 1); arrow(S, x, yB, 0, -1);
  const len = Math.abs(yB - yA);
  const { text, key } = lab(label);
  if (textWidth(text, DIM_H) + 2 < len) S.text(x - 0.9, (yA + yB) / 2, text, { h: DIM_H, anchor: 'middle', rot: 90, tag: key });
  else S.text(x - 0.9, Math.min(yA, yB) - 2, text, { h: DIM_H, anchor: 'start', rot: 90, tag: key });
}

// Leader with a callout; a callout may have several lines (\n), the first one sits on the shoulder.
// key: one key / list of keys, or a list per line ([[k1], [k2, k3]]).
function leader(S, x, y, label, dx = 8, dy = -8) {
  const ex = x + dx, ey = y + dy;
  const ang = Math.atan2(y - ey, x - ex);
  S.line(ex, ey, x, y, 'thin');
  arrow(S, x, y, -Math.cos(ang), -Math.sin(ang));
  const { text, key } = lab(label);
  const lines = text.split('\n');
  const perLine = Array.isArray(key) && key.some(Array.isArray);
  const tw = Math.max(...lines.map((l) => textWidth(l, DIM_H)));
  const right = dx >= 0;
  S.line(ex, ey, ex + (right ? tw + 1 : -tw - 1), ey, 'thin');
  lines.forEach((l, i) => S.text(ex + (right ? 0.5 : -0.5), ey - 0.8 + i * (DIM_H + 1.3), l, {
    h: DIM_H, anchor: right ? 'start' : 'end', tag: perLine ? key[i] : i === 0 ? key : null,
  }));
}
function leaderLines(label) {
  return lab(label).text.split('\n').length;
}

function centerMark(S, cx, cy, r) {
  const e = Math.max(r + 1.5, 2.5);
  S.line(cx - e, cy, cx + e, cy, 'center');
  S.line(cx, cy - e, cx, cy + e, 'center');
}

const COARSE_PITCH = { 3: 0.5, 4: 0.7, 5: 0.8, 6: 1, 8: 1.25, 10: 1.5, 12: 1.75, 14: 2, 16: 2, 18: 2.5, 20: 2.5, 22: 2.5, 24: 3, 27: 3, 30: 3.5, 33: 3.5, 36: 4, 39: 4, 42: 4.5, 45: 4.5, 48: 5 };

export function threadInfo(spec, fallbackDia) {
  const m = /^M\s*(\d+(?:\.\d+)?)\s*(?:[x×X*]\s*(\d+(?:\.\d+)?))?/.exec(spec || '');
  if (!m) return { major: fallbackDia, minor: fallbackDia * 0.85, pitch: 0, label: spec };
  const major = parseFloat(m[1]);
  const pitch = m[2] ? parseFloat(m[2]) : (COARSE_PITCH[major] || major * 0.15);
  const label = m[2] ? `M${fmt(major)}x${fmt(pitch)}` : `M${fmt(major)}`;
  return { major, minor: major - 1.0825 * pitch, pitch, label };
}

const withTol = (label, tol) => (tol ? `${label} ${tol}` : label);

// Thread callout with the ISO tolerance class (6H inside, 6g outside) unless one is given.
export function threadCallout(spec, internal) {
  const s = String(spec || '').trim();
  if (!/^M\s*\d/i.test(s)) return s;
  if (/(^|[-\s])\d[a-hA-H]{1,2}$/.test(s)) return s;
  const th = threadInfo(s, 0);
  return `${th.label}-${internal ? '6H' : '6g'}`;
}

/* ───────────────────────── Turned parts ───────────────────────── */

// Hole callouts are stacked in rows above the part, one row per label.
function labelRows(t, L) {
  return new Set(t.crossHoles.map(crossHoleGroup)).size + t.bores.reduce((a, b, i) => a + leaderLines(boreCallout(b, i, L)), 0);
}

// "M8-6H x 12 DEEP / DRILL Ø6.8 x 20 DEEP", "Ø10 THRU"…
function boreCallout(b, i, L) {
  const k = (f) => `turned.bores.${i}.${f}`;
  const blind = b.depth > 0 && b.depth < L;
  const depth = blind ? ` x ${fmt(b.depth)} DEEP` : ' THRU';
  if (!b.thread) return K([k('diameter'), k('depth')], `Ø${fmt(b.diameter)}${depth}`);
  const th = threadInfo(b.thread, b.diameter);
  const name = threadCallout(b.thread, true);
  const full = blind ? b.depth : L;
  if (b.threadDepth > 0 && b.threadDepth < full - 1e-6) {
    return K([[k('diameter'), k('threadDepth')], [k('depth')]], `${name} x ${fmt(b.threadDepth)} DEEP\n${blind ? 'DRILL ' : ''}Ø${fmt(Math.round(th.minor * 10) / 10)}${depth}`);
  }
  return K([k('diameter'), k('depth')], `${name}${depth}`);
}

function turnedEnvelope(p, s) {
  const t = p.turned;
  const L = overallLength(p);
  const R = Math.max(...t.segments.map((x) => x.diameter)) / 2;
  const threadDims = t.segments.some((g) => g.thread && g.threadLength > 0 && g.threadLength < g.length);
  const labels = labelRows(t, L);
  const above = Math.max(12 + (threadDims ? 7 : 0), 5 + labels * 5 + 7) + 12; // hole labels, overall dim
  const below = 12 + t.crossHoles.length * 7 + 4;
  const gap = 22;
  return {
    w: 6 + L * s + gap + 2 * R * s + 6,
    h: above + 2 * R * s + below,
    above, gap, L, R,
  };
}

function drawTurned(S, p, s, ox, oy) {
  const t = p.turned;
  const segs = t.segments;
  const L = overallLength(p);
  const R = Math.max(...segs.map((x) => x.diameter)) / 2;
  const X = (x) => ox + x * s;
  const Y = (r) => oy - r * s;
  const cl = Math.min(t.chamferLeft, segs[0].diameter / 2 - 0.01, segs[0].length / 2);
  const cr = Math.min(t.chamferRight, segs[segs.length - 1].diameter / 2 - 0.01, segs[segs.length - 1].length / 2);

  // Outline (top half; mirrored for the bottom)
  const top = [];
  let x = 0;
  segs.forEach((g, i) => {
    const r = g.diameter / 2;
    const x0 = x, x1 = x + g.length;
    const c0 = i === 0 ? cl : 0;
    const c1 = i === segs.length - 1 ? cr : 0;
    top.push([x0, r - c0], [x0 + c0, r], [x1 - c1, r], [x1, r - c1]);
    x = x1;
  });
  for (const sign of [1, -1]) {
    S.poly(top.map(([a, r]) => [X(a), Y(sign * r)]), { s: 'thick' });
  }
  // End faces
  S.line(X(0), Y(segs[0].diameter / 2 - cl), X(0), Y(-(segs[0].diameter / 2 - cl)));
  const rr = segs[segs.length - 1].diameter / 2;
  S.line(X(L), Y(rr - cr), X(L), Y(-(rr - cr)));
  // Chamfer edges
  if (cl > 0) S.line(X(cl), Y(segs[0].diameter / 2), X(cl), Y(-segs[0].diameter / 2));
  if (cr > 0) S.line(X(L - cr), Y(rr), X(L - cr), Y(-rr));
  // Shoulders: the face of the larger step is visible across its full diameter
  x = 0;
  for (let i = 0; i < segs.length - 1; i++) {
    x += segs[i].length;
    const rm = Math.max(segs[i].diameter, segs[i + 1].diameter) / 2;
    S.line(X(x), Y(rm), X(x), Y(-rm));
  }
  // Axis
  S.line(X(0) - 3, oy, X(L) + 3, oy, 'center');

  // Threads (external): thin lines at the minor diameter
  x = 0;
  const threadLenDims = [];
  segs.forEach((g, i) => {
    if (g.thread) {
      const th = threadInfo(g.thread, g.diameter);
      const tl = g.threadLength > 0 ? Math.min(g.threadLength, g.length) : g.length;
      // Threads on the last segment start from the right end, otherwise from the left of the segment
      const fromRight = i === segs.length - 1 && segs.length > 1;
      const a = fromRight ? x + g.length - tl : x;
      const b = a + tl;
      for (const sign of [1, -1]) S.line(X(a), Y(sign * th.minor / 2), X(b), Y(sign * th.minor / 2), 'thin');
      const inner = fromRight ? a : b;
      if (inner > x + 0.01 && inner < x + g.length - 0.01) S.line(X(inner), Y(g.diameter / 2), X(inner), Y(-g.diameter / 2), 'thin');
      if (tl < g.length - 0.01) threadLenDims.push({ a, b, r: g.diameter / 2, i });
    }
    x += g.length;
  });

  // Bores (hidden)
  const boreLabels = [];
  t.bores.forEach((b, bi) => {
    const depth = b.depth > 0 ? Math.min(b.depth, L) : L;
    const th = b.thread ? threadInfo(b.thread, b.diameter) : null;
    const rDrill = (th ? th.minor : b.diameter) / 2;
    const x0 = b.end === 'left' ? 0 : L;
    const dir = b.end === 'left' ? 1 : -1;
    const x1 = x0 + dir * depth;
    for (const sign of [1, -1]) {
      S.line(X(x0), Y(sign * rDrill), X(x1), Y(sign * rDrill), 'hidden');
      if (th) {
        const tl = b.threadDepth > 0 ? Math.min(b.threadDepth, depth) : depth;
        S.line(X(x0), Y(sign * th.major / 2), X(x0 + dir * tl), Y(sign * th.major / 2), 'hidden');
      }
    }
    if (b.depth > 0 && b.depth < L) {
      // drill point 118°
      const tip = rDrill / Math.tan((59 * Math.PI) / 180);
      S.line(X(x1), Y(rDrill), X(x1 + dir * tip), oy, 'hidden');
      S.line(X(x1), Y(-rDrill), X(x1 + dir * tip), oy, 'hidden');
      S.line(X(x1), Y(rDrill), X(x1), Y(-rDrill), 'hidden');
    }
    boreLabels.push({ x: X(x0 + dir * Math.min(depth, 3 / s)), y: Y(rDrill), label: boreCallout(b, bi, L), right: b.end === 'left' });
  });

  // Cross holes (axis perpendicular to the view)
  t.crossHoles.forEach((h) => {
    const r = (h.thread ? threadInfo(h.thread, h.diameter).major : h.diameter) / 2 * s;
    S.circle(X(h.x), oy, r, 'thick');
    centerMark(S, X(h.x), oy, r);
  });

  // ── Dimensions ──
  const yTop = Y(R);
  const yBot = Y(-R);
  // Thread lengths (just above the part)
  threadLenDims.forEach((d) => hDim(S, X(d.a), Y(d.r), X(d.b), Y(d.r), yTop - 7, K(`turned.segments.${d.i}.threadLength`, `THREAD ${fmt(d.b - d.a)}`)));
  // keep the overall length dimension above the hole callouts
  const overallY = Math.min(yTop - 10 - (threadLenDims.length ? 7 : 0), yTop - 5 - labelRows(t, L) * 5 - 7);
  hDim(S, X(0), Y(segs[0].diameter / 2), X(L), Y(rr), overallY, K(segs.length === 1 ? 'turned.segments.0.length' : null, withTol(fmt(L), t.overallTol)));
  // Chain of step lengths below
  if (segs.length > 1) {
    x = 0;
    segs.forEach((g, i) => {
      hDim(S, X(x), Y(-g.diameter / 2), X(x + g.length), Y(-g.diameter / 2), yBot + 9, K(`turned.segments.${i}.length`, fmt(g.length)));
      x += g.length;
    });
  }
  // Diameters, inside each step (away from cross holes)
  x = 0;
  segs.forEach((g, i) => {
    let xm = x + g.length * 0.5;
    const holes = t.crossHoles.filter((h) => Math.abs(h.x - xm) < h.diameter / 2 + 3 / s);
    if (holes.length) xm = Math.min(x + g.length - 2 / s, holes[0].x + holes[0].diameter / 2 + 5 / s);
    const lbl = g.thread ? threadCallout(g.thread, false) : withTol(`Ø${fmt(g.diameter)}`, g.diaTol);
    innerVDim(S, X(xm), Y(g.diameter / 2), Y(-g.diameter / 2), K(`turned.segments.${i}.diameter`, lbl));
    x += g.length;
  });
  // Cross-hole positions from the left end, stacked below
  const baseY = yBot + (segs.length > 1 ? 16 : 9);
  [...t.crossHoles.keys()].sort((a, b) => t.crossHoles[a].x - t.crossHoles[b].x).forEach((hi, i) => {
    const h = t.crossHoles[hi];
    hDim(S, X(0), Y(-segs[0].diameter / 2), X(h.x), oy, baseY + i * 7, K(`turned.crossHoles.${hi}.x`, fmt(h.x)));
  });
  // Cross-hole callouts
  const groups = new Map();
  t.crossHoles.forEach((h, i) => {
    const k = crossHoleGroup(h);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  });
  let li = 0;
  groups.forEach((idx) => {
    const h = t.crossHoles[idx[0]];
    const name = h.thread ? threadCallout(h.thread, true) : `Ø${fmt(h.diameter)}`;
    const cnt = idx.length > 1 ? `${idx.length}x ` : '';
    const r = (h.thread ? threadInfo(h.thread, h.diameter).major : h.diameter) / 2 * s;
    const a = Math.PI / 4;
    leader(S, X(h.x) + r * Math.cos(a), oy - r * Math.sin(a), K(idx.map((i) => `turned.crossHoles.${i}.diameter`), `${cnt}${name} THRU`), 6, -(oy - yTop) - 4 - li * 5);
    li++;
  });
  boreLabels.forEach((b) => {
    li += leaderLines(b.label) - 1; // extra lines hang below the shoulder, into the rows reserved here
    leader(S, b.x, b.y, b.label, b.right ? 8 : -8, -(b.y - yTop) - 5 - li * 5);
    li += 1;
  });
  // Chamfer callouts
  if (cl > 0) leader(S, X(cl / 2), Y(segs[0].diameter / 2 - cl / 2), K('turned.chamferLeft', `${fmt(cl)}x45°`), -5, -6);
  if (cr > 0) leader(S, X(L - cr / 2), Y(rr - cr / 2), K('turned.chamferRight', `${fmt(cr)}x45°`), 5, -6);

  // ── End view (looking at the right end) ──
  const ex = X(L) + turnedEnvelope(p, s).gap + R * s;
  const rightD = segs[segs.length - 1].diameter;
  const ds = [...new Set(segs.map((g) => g.diameter))].sort((a, b) => b - a);
  ds.forEach((d) => {
    const visible = d >= rightD;
    S.circle(ex, oy, (d / 2) * s, visible ? 'thick' : 'hidden');
  });
  if (cr > 0) S.circle(ex, oy, (rightD / 2 - cr) * s, 'thick');
  const lastThread = segs[segs.length - 1].thread;
  if (lastThread) {
    const th = threadInfo(lastThread, rightD);
    S.arc(ex, oy, (th.minor / 2) * s, 0, 270, 'thin');
  }
  t.bores.forEach((b) => {
    const th = b.thread ? threadInfo(b.thread, b.diameter) : null;
    const rD = (th ? th.minor : b.diameter) / 2 * s;
    const vis = b.end === 'right' || b.depth === 0;
    S.circle(ex, oy, rD, vis ? 'thick' : 'hidden');
    if (th && vis) S.arc(ex, oy, (th.major / 2) * s, 0, 270, 'thin');
  });
  t.crossHoles.forEach((h) => {
    const r = (h.diameter / 2) * s;
    const halfChord = Math.sqrt(Math.max(0, (R * s) ** 2 - r ** 2));
    S.line(ex - halfChord, oy - r, ex + halfChord, oy - r, 'hidden');
    S.line(ex - halfChord, oy + r, ex + halfChord, oy + r, 'hidden');
  });
  S.line(ex - R * s - 3, oy, ex + R * s + 3, oy, 'center');
  S.line(ex, oy - R * s - 3, ex, oy + R * s + 3, 'center');
  S.text(ex, oy + R * s + 9, 'END VIEW', { h: 3, anchor: 'middle' });
}

/* ───────────────────────── Plates / washers / blocks ───────────────────────── */

function plateGroups(p) {
  const groups = new Map();
  p.plate.holes.forEach((h, i) => {
    const k = plateHoleGroup(h);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  });
  return [...groups.values()];
}

// Hole callout for a group of identical plate holes, one line per operation:
// "4x M8-6H x 12 DEEP" / "DRILL Ø6.8 x 16 DEEP" / "CBORE Ø14 x 8 DEEP" / "CSK Ø16 x 90°"
function plateCallout(p, idx, withCount = true) {
  const h = p.plate.holes[idx[0]];
  const T = p.plate.thickness;
  const k = (f) => idx.map((i) => `plate.holes.${i}.${f}`);
  const cnt = withCount && idx.length > 1 ? `${idx.length}x ` : '';
  const blind = h.depth > 0 && h.depth < T;
  const depth = blind ? ` x ${fmt(h.depth)} DEEP` : ' THRU';
  const lines = [], keys = [];
  if (h.thread) {
    const th = threadInfo(h.thread, h.diameter);
    const name = threadCallout(h.thread, true);
    const full = blind ? h.depth : T;
    if (h.threadDepth > 0 && h.threadDepth < full - 1e-6) {
      lines.push(`${cnt}${name} x ${fmt(h.threadDepth)} DEEP`); keys.push([...k('diameter'), ...k('threadDepth')]);
      lines.push(`${blind ? 'DRILL ' : ''}Ø${fmt(Math.round(th.minor * 10) / 10)}${depth}`); keys.push(k('depth'));
    } else {
      lines.push(`${cnt}${name}${depth}`); keys.push([...k('diameter'), ...k('depth')]);
    }
  } else {
    lines.push(`${cnt}${holeName(h)}${depth}`); keys.push([...k('diameter'), ...k('depth')]);
  }
  if (h.cboreDia > 0) { lines.push(`CBORE Ø${fmt(h.cboreDia)} x ${fmt(h.cboreDepth)} DEEP`); keys.push([...k('cboreDia'), ...k('cboreDepth')]); }
  if (h.csinkDia > 0) { lines.push(`CSK Ø${fmt(h.csinkDia)} x ${fmt(h.csinkAngle)}°`); keys.push(k('csinkDia')); }
  return K(keys, lines.join('\n'));
}

const TABLE_ROW = 4.4;
function holeTableSize(p) {
  if (!useHoleTable(p)) return null;
  const legend = plateGroups(p).map((idx) => lab(plateCallout(p, idx)).text.split('\n'));
  const lines = legend.flat();
  const lw = Math.max(...lines.map((l) => textWidth(l, 2.6))) + 7;
  return { w: Math.max(42, lw), h: (p.plate.holes.length + 1) * TABLE_ROW + 4 + lines.length * 3.8, legend };
}

function plateEnvelope(p, s) {
  const pl = p.plate;
  const table = holeTableSize(p);
  const xs = table ? 0 : new Set(pl.holes.map((h) => h.x)).size;
  const ys = table ? 0 : new Set(pl.holes.map((h) => h.y)).size;
  const callouts = table ? 0 : plateGroups(p).reduce((a, idx) => a + 6 + (leaderLines(plateCallout(p, idx)) - 1) * (DIM_H + 1.3), 0);
  const above = 6 + xs * 6 + 12;
  const left = 6 + ys * 6 + 6;
  const gap = 24;
  return {
    w: left + pl.length * s + 14 + gap + pl.thickness * s + 14 + (table ? 8 + table.w : 0),
    h: Math.max(above + pl.width * s + 20 + callouts, table ? above + table.h : 0),
    above, left, gap, table,
  };
}

function holeName(h) {
  return h.thread ? threadCallout(h.thread, true) : withTol(`Ø${fmt(h.diameter)}`, h.tol);
}

function drawPlate(S, p, s, ox, oy) {
  const pl = p.plate;
  const L = pl.length, W = pl.width;
  const X = (x) => ox + x * s;
  const Y = (y) => oy + (W - y) * s;
  const env = plateEnvelope(p, s);
  const table = env.table;

  // Outline
  if (pl.shape === 'disc') {
    S.circle(X(L / 2), Y(W / 2), (L / 2) * s);
    centerMark(S, X(L / 2), Y(W / 2), (L / 2) * s);
  } else {
    const r = pl.shape === 'obround' ? Math.min(L, W) / 2 : pl.cornerRadius;
    if (r <= 0) {
      S.rect(X(0), Y(W), L * s, W * s, 'thick');
    } else {
      const rs = r * s;
      S.line(X(0) + rs, Y(0), X(L) - rs, Y(0));
      S.line(X(0) + rs, Y(W), X(L) - rs, Y(W));
      if (W - 2 * r > 1e-6) {
        S.line(X(0), Y(0) - rs, X(0), Y(W) + rs);
        S.line(X(L), Y(0) - rs, X(L), Y(W) + rs);
      }
      S.arc(X(L) - rs, Y(W) + rs, rs, 0, 90);
      S.arc(X(0) + rs, Y(W) + rs, rs, 90, 180);
      S.arc(X(0) + rs, Y(0) - rs, rs, 180, 270);
      S.arc(X(L) - rs, Y(0) - rs, rs, 270, 360);
    }
  }

  // Holes (seen from the entry side: counterbores and countersinks are visible circles)
  const tags = plateHoleTags(p);
  pl.holes.forEach((h, i) => {
    let outer;
    if (h.thread) {
      const th = threadInfo(h.thread, h.diameter);
      S.circle(X(h.x), Y(h.y), (th.minor / 2) * s, 'thick');
      S.arc(X(h.x), Y(h.y), (th.major / 2) * s, 0, 270, 'thin');
      outer = th.major / 2;
    } else {
      S.circle(X(h.x), Y(h.y), (h.diameter / 2) * s, 'thick');
      outer = h.diameter / 2;
    }
    if (h.cboreDia > 0) { S.circle(X(h.x), Y(h.y), (h.cboreDia / 2) * s, 'thick'); outer = Math.max(outer, h.cboreDia / 2); }
    if (h.csinkDia > 0) { S.circle(X(h.x), Y(h.y), (h.csinkDia / 2) * s, 'thick'); outer = Math.max(outer, h.csinkDia / 2); }
    centerMark(S, X(h.x), Y(h.y), outer * s);
    if (table) S.text(X(h.x) + outer * s * 0.75 + 0.6, Y(h.y) - outer * s * 0.75 - 0.6, tags[i], { h: 2.6, bold: true });
  });

  // Overall dimensions
  const label = pl.shape === 'disc' ? withTol(`Ø${fmt(L)}`, pl.lengthTol) : withTol(fmt(L), pl.lengthTol);
  hDim(S, X(0), Y(pl.shape === 'disc' ? W / 2 : 0), X(L), Y(pl.shape === 'disc' ? W / 2 : 0), Y(0) + 10, K('plate.length', label));
  if (pl.shape !== 'disc') vDim(S, X(L), Y(0), X(L), Y(W), X(L) + 10, K('plate.width', withTol(fmt(W), pl.widthTol)));
  if (pl.shape !== 'rect' || pl.cornerRadius > 0) {
    const r = pl.shape === 'obround' ? Math.min(L, W) / 2 : pl.cornerRadius;
    if (pl.shape !== 'disc') {
      const a = Math.PI / 4;
      const cx = X(L) - r * s, cy = Y(W) + r * s;
      leader(S, cx + r * s * Math.cos(a), cy - r * s * Math.sin(a), pl.shape === 'obround' ? `R${fmt(r)} FULL` : K('plate.cornerRadius', `R${fmt(r)}`), 6, -6);
    }
  }

  // Hole positions: baseline from the left edge (above) and from the bottom edge (left side)
  // (a hole concentric with a round washer needs no position dimensions)
  const placed = [...pl.holes.keys()].filter((i) => !(pl.shape === 'disc' && Math.abs(pl.holes[i].x - L / 2) < 1e-6 && Math.abs(pl.holes[i].y - W / 2) < 1e-6));
  if (!table) {
    const xs = [...new Set(placed.map((i) => pl.holes[i].x))].sort((a, b) => a - b);
    const ys = [...new Set(placed.map((i) => pl.holes[i].y))].sort((a, b) => a - b);
    xs.forEach((xv, i) => {
      const idx = placed.filter((q) => pl.holes[q].x === xv);
      const h = idx.map((q) => pl.holes[q]).sort((a, b) => b.y - a.y)[0];
      hDim(S, X(0), Y(W), X(xv), Y(h.y), Y(W) - 8 - i * 6, K(idx.map((q) => `plate.holes.${q}.x`), fmt(xv)));
    });
    ys.forEach((yv, i) => {
      const idx = placed.filter((q) => pl.holes[q].y === yv);
      const h = idx.map((q) => pl.holes[q]).sort((a, b) => a.x - b.x)[0];
      vDim(S, X(0), Y(0), X(h.x), Y(yv), X(0) - 8 - i * 6, K(idx.map((q) => `plate.holes.${q}.y`), fmt(yv)));
    });

    // Hole callouts, grouped, run out below the part under the overall length dimension
    let yy = Y(0) + 17;
    plateGroups(p).forEach((idx) => {
      const h = pl.holes[idx[0]];
      const r = Math.max(h.thread ? threadInfo(h.thread, h.diameter).major : h.diameter, h.cboreDia, h.csinkDia) / 2 * s;
      const a = -Math.PI / 4;
      const px = X(h.x) + r * Math.cos(a), py = Y(h.y) - r * Math.sin(a);
      const c = plateCallout(p, idx);
      leader(S, px, py, c, 6, yy - py);
      yy += 6 + (leaderLines(c) - 1) * (DIM_H + 1.3);
    });
  } else {
    // origin mark for the table coordinates
    S.text(X(0) - 1, Y(0) + 4, 'X0 Y0', { h: 2.4, anchor: 'end' });
  }

  // Side view (right), thickness horizontal; holes enter from the left face
  const sx = X(L) + 14 + env.gap;
  const T = pl.thickness;
  S.rect(sx, Y(W), T * s, W * s, 'thick');
  if (pl.shape === 'rect' && pl.cornerRadius > 0) {
    const r = pl.cornerRadius;
    S.line(sx, Y(W) + r * s, sx + T * s, Y(W) + r * s, 'thin');
    S.line(sx, Y(0) - r * s, sx + T * s, Y(0) - r * s, 'thin');
  }
  pl.holes.forEach((h) => {
    const rr = (h.thread ? threadInfo(h.thread, h.diameter).minor : h.diameter) / 2;
    const depth = h.depth > 0 ? Math.min(h.depth, T) : T;
    let z0 = 0;
    if (h.cboreDia > 0) {
      const cd = Math.min(h.cboreDepth, depth);
      for (const sg of [1, -1]) S.line(sx, Y(h.y + sg * h.cboreDia / 2), sx + cd * s, Y(h.y + sg * h.cboreDia / 2), 'hidden');
      S.line(sx + cd * s, Y(h.y + h.cboreDia / 2), sx + cd * s, Y(h.y - h.cboreDia / 2), 'hidden');
      z0 = cd;
    }
    if (h.csinkDia > 0) {
      const cz = Math.min(((h.csinkDia - 2 * rr) / 2) / Math.tan((h.csinkAngle / 2) * Math.PI / 180), depth);
      for (const sg of [1, -1]) S.line(sx, Y(h.y + sg * h.csinkDia / 2), sx + cz * s, Y(h.y + sg * rr), 'hidden');
      z0 = Math.max(z0, cz);
    }
    S.line(sx + z0 * s, Y(h.y + rr), sx + depth * s, Y(h.y + rr), 'hidden');
    S.line(sx + z0 * s, Y(h.y - rr), sx + depth * s, Y(h.y - rr), 'hidden');
    S.line(sx - 2, Y(h.y), sx + T * s + 2, Y(h.y), 'center');
  });
  hDim(S, sx, Y(0), sx + T * s, Y(0), Y(0) + 10, K('plate.thickness', withTol(fmt(T), pl.thicknessTol)));
  S.text(sx + (T * s) / 2, Y(0) + 18, 'SIDE VIEW', { h: 3, anchor: 'middle' });

  // Hole table: tag / X / Y for every hole, and one callout per hole letter
  if (table) {
    const tx = sx + T * s + 14 + 8, ty = Math.min(Y(W), oy);
    const cols = [12, 14, 14];
    const cw = cols.reduce((a, b) => a + b, 0);
    const rows = pl.holes.length + 1;
    S.rect(tx, ty, cw, rows * TABLE_ROW, 'thin');
    for (let r = 1; r < rows; r++) S.line(tx, ty + r * TABLE_ROW, tx + cw, ty + r * TABLE_ROW, 'thin');
    let cx = tx;
    cols.slice(0, -1).forEach((w) => { cx += w; S.line(cx, ty, cx, ty + rows * TABLE_ROW, 'thin'); });
    const cell = (c, r, t, opt = {}) => {
      const x0 = tx + cols.slice(0, c).reduce((a, b) => a + b, 0);
      S.text(x0 + cols[c] / 2, ty + r * TABLE_ROW + 3.2, t, { h: 2.6, anchor: 'middle', ...opt });
    };
    ['HOLE', 'X', 'Y'].forEach((t, c) => cell(c, 0, t, { bold: true }));
    pl.holes.forEach((h, i) => {
      cell(0, i + 1, tags[i], { bold: true });
      cell(1, i + 1, fmt(h.x), { tag: `plate.holes.${i}.x` });
      cell(2, i + 1, fmt(h.y), { tag: `plate.holes.${i}.y` });
    });
    let ly = ty + rows * TABLE_ROW + 5;
    plateGroups(p).forEach((idx) => {
      const c = lab(plateCallout(p, idx));
      const letter = tags[idx[0]][0];
      S.text(tx, ly, letter, { h: 2.6, bold: true });
      c.text.split('\n').forEach((l, li) => {
        S.text(tx + 5, ly, l, { h: 2.6, tag: c.key[li] });
        ly += 3.8;
      });
    });
  }
}

/* ───────────────────────── Springs ───────────────────────── */

function springEnvelope(p, s) {
  const sp = p.spring;
  return { w: 30 + sp.freeLength * s + 30, h: 18 + sp.outerDiameter * s + 18 };
}

function drawSpring(S, p, s, ox, oy) {
  const sp = p.spring;
  const Lf = sp.freeLength, D = sp.outerDiameter, d = sp.wireDiameter;
  const n = Math.max(1, sp.totalCoils);
  const X = (x) => ox + x * s;
  const Y = (y) => oy - y * s;
  const Rm = (D - d) / 2;
  const pitch = (Lf - d) / n;
  for (let i = 0; i <= n; i++) {
    const xt = d / 2 + i * pitch;
    if (xt <= Lf - d / 2 + 1e-6) S.circle(X(xt), Y(Rm), (d / 2) * s, 'thick');
    const xb = xt + pitch / 2;
    if (xb <= Lf - d / 2 + 1e-6) S.circle(X(xb), Y(-Rm), (d / 2) * s, 'thick');
    if (xb <= Lf - d / 2 + 1e-6) {
      S.line(X(xt - d / 2), Y(Rm), X(xb - d / 2), Y(-Rm), 'thick');
      S.line(X(xt + d / 2), Y(Rm), X(xb + d / 2), Y(-Rm), 'thick');
    }
  }
  if (/ground/i.test(sp.ends)) {
    S.line(X(0), Y(D / 2), X(0), Y(-D / 2), 'thick');
    S.line(X(Lf), Y(D / 2), X(Lf), Y(-D / 2), 'thick');
  }
  S.line(X(0) - 3, oy, X(Lf) + 3, oy, 'center');
  hDim(S, X(0), Y(D / 2), X(Lf), Y(D / 2), Y(D / 2) - 9, K('spring.freeLength', `L0 = ${fmt(Lf)}`));
  vDim(S, X(Lf), Y(D / 2), X(Lf), Y(-D / 2), X(Lf) + 10, K('spring.outerDiameter', `OD ${fmt(D)}`));
  leader(S, X(d / 2 + pitch / 2), Y(-Rm) + (d / 2) * s, K('spring.wireDiameter', `WIRE Ø${fmt(d)}`), 8, 8);
}

/* ───────────────────────── Sheet: frame, title block, notes ───────────────────────── */

export function scaleLabel(s) {
  if (s >= 1) return `${fmt(s)}:1`;
  return `1:${fmt(1 / s)}`;
}

// Notes written by hand or by the AI often repeat what the standard notes already say.
const STANDARD_NOTE = [
  /dimensions? (are )?in mm|units?:? *mm/i,
  /general tol|2768|unless otherwise/i,
  /burr|sharp edges?/i,
  /^material\b/i,
  /^qty\b|^quantity\b/i,
];
export function extraNotes(p) {
  const seen = new Set();
  return p.notes.filter((x) => {
    const t = x.trim();
    const key = t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!t || seen.has(key)) return false;
    seen.add(key);
    if (STANDARD_NOTE.some((re) => re.test(t))) return false;
    if (p.finish && /^(finish|paint|coating)\b/i.test(t)) return false;
    if (p.kind === 'turned' && /^chamfer\b/i.test(t) && (p.turned.chamferLeft || p.turned.chamferRight)) return false;
    return true;
  });
}

export function partNotes(p) {
  const n = [];
  n.push('ALL DIMENSIONS IN mm.');
  n.push(`GENERAL TOLERANCES: ${p.generalTolerance || 'ISO 2768-m'}.`);
  if (p.kind !== 'spring') n.push('REMOVE BURRS, BREAK SHARP EDGES 0.3-0.5.');
  if (p.kind === 'turned') {
    const t = p.turned;
    if (t.chamferLeft > 0 && t.chamferLeft === t.chamferRight) n.push(`CHAMFER ${fmt(t.chamferLeft)}x45° BOTH ENDS.`);
    else {
      if (t.chamferLeft > 0) n.push(`CHAMFER ${fmt(t.chamferLeft)}x45° LEFT END.`);
      if (t.chamferRight > 0) n.push(`CHAMFER ${fmt(t.chamferRight)}x45° RIGHT END.`);
    }
    if (t.crossHoles.length) n.push('CROSS HOLE POSITIONS ARE TO HOLE CENTER, FROM LEFT END.');
  }
  if (p.kind === 'plate' && p.plate.holes.length) {
    n.push(useHoleTable(p) ? 'HOLE POSITIONS PER HOLE TABLE, TO HOLE CENTER, FROM X0 Y0 (LEFT / BOTTOM EDGES).' : 'HOLE POSITIONS ARE TO HOLE CENTER, FROM LEFT AND BOTTOM EDGES.');
  }
  if (p.kind === 'spring') {
    const sp = p.spring;
    n.push(`COMPRESSION SPRING: WIRE Ø${fmt(sp.wireDiameter)} x OD ${fmt(sp.outerDiameter)} x L0 ${fmt(sp.freeLength)}.`);
    n.push(`TOTAL COILS ${fmt(sp.totalCoils)}, ACTIVE COILS ${fmt(sp.activeCoils)}.`);
    n.push(`ENDS: ${sp.ends.toUpperCase()}. WIND: ${sp.direction.toUpperCase()}.`);
    n.push(`ID ${fmt(sp.outerDiameter - 2 * sp.wireDiameter)} (REF).`);
  }
  if (p.finish) n.push(`FINISH: ${p.finish.toUpperCase()}.`);
  extraNotes(p).forEach((x) => n.push(x.endsWith('.') ? x : `${x}.`));
  return n.map((x, i) => `${i + 1}. ${x}`);
}

function titleBlock(S, p, scale, opts) {
  const x0 = 117, y0 = 158, w = 170, h = 42;
  S.rect(x0, y0, w, h, 'thick');
  const rows = [y0 + 14, y0 + 23, y0 + 32];
  rows.forEach((y) => S.line(x0, y, x0 + w, y, 'thin'));
  S.line(x0 + 110, y0, x0 + 110, y0 + 14, 'thin');
  S.line(x0 + 85, rows[0], x0 + 85, rows[1], 'thin');
  [42, 85, 128].forEach((dx) => S.line(x0 + dx, rows[1], x0 + dx, rows[2], 'thin'));
  [60, 100, 128].forEach((dx) => S.line(x0 + dx, rows[2], x0 + dx, y0 + h, 'thin'));
  const cap = (x, y, t) => S.text(x + 1.2, y + 2.6, t, { h: 1.9 });
  const val = (x, y, t, hh = 3.2) => S.text(x + 1.5, y, t, { h: hh, bold: true });

  cap(x0, y0, 'PART NAME');
  let name = displayName(p);
  const nameH = Math.min(6.5, 105 / Math.max(1, name.length * 0.56));
  val(x0, y0 + 11, name, nameH);
  cap(x0 + 110, y0, 'PART No.');
  val(x0 + 110, y0 + 11, p.partNo || '-', 3.5);
  cap(x0, rows[0], 'MATERIAL');
  val(x0, rows[0] + 7.3, p.material || '-', 3);
  cap(x0 + 85, rows[0], 'FINISH');
  val(x0 + 85, rows[0] + 7.3, p.finish || 'NONE', 3);
  cap(x0, rows[1], 'QTY');
  val(x0, rows[1] + 7.3, p.quantity ? `${p.quantity} PCS` : '-');
  cap(x0 + 42, rows[1], 'SCALE');
  val(x0 + 42, rows[1] + 7.3, scale ? scaleLabel(scale) : 'NTS');
  cap(x0 + 85, rows[1], 'UNITS');
  val(x0 + 85, rows[1] + 7.3, 'mm');
  cap(x0 + 128, rows[1], 'GENERAL TOL.');
  val(x0 + 128, rows[1] + 7.3, p.generalTolerance || 'ISO 2768-m', 2.6);
  cap(x0, rows[2], 'DRAWN BY');
  val(x0, rows[2] + 7.5, opts.drawnBy || '-', 3);
  cap(x0 + 60, rows[2], 'DATE');
  val(x0 + 60, rows[2] + 7.5, opts.date, 3);
  cap(x0 + 100, rows[2], 'REV');
  val(x0 + 100, rows[2] + 7.5, p.revision || 'A', 3);
  cap(x0 + 128, rows[2], 'SHEET');
  val(x0 + 128, rows[2] + 7.5, 'A4  1/1', 3);
}

function notesBlock(S, p) {
  const lines = partNotes(p);
  const x = 14;
  const lh = 3.9;
  // wrap long lines at ~ 52 chars
  const wrapped = [];
  lines.forEach((l) => {
    let rest = l;
    let first = true;
    while (rest.length > 54) {
      let cut = rest.lastIndexOf(' ', 54);
      if (cut < 20) cut = 54;
      wrapped.push((first ? '' : '   ') + rest.slice(0, cut));
      rest = rest.slice(cut).trim();
      first = false;
    }
    wrapped.push((first ? '' : '   ') + rest);
  });
  const y0 = Math.min(162, 200 - wrapped.length * lh);
  S.text(x, y0 - 1.5, 'NOTES:', { h: 3.2, bold: true });
  wrapped.forEach((l, i) => S.text(l.startsWith('   ') ? x + 3 : x, y0 + 3.2 + i * lh, l.trim(), { h: 2.6 }));
}

function chooseScale(envFn, p, areaW, areaH) {
  for (const s of SCALES) {
    const e = envFn(p, s);
    if (e.w <= areaW && e.h <= areaH) return s;
  }
  return SCALES[SCALES.length - 1];
}

// opts.tags: draw numbered balloons (from dimensionList) next to the dimensions — for the chat preview.
export function buildDrawing(p, opts = {}) {
  const S = new Sheet(opts.tags ? dimensionTags(p) : null);
  const o = { drawnBy: opts.drawnBy || '', date: opts.date || new Date().toLocaleDateString('en-GB'), image: opts.image || null };
  // Frame
  S.rect(8, 8, SHEET_W - 16, SHEET_H - 16, 'thick');
  const aw = VIEW_AREA.x2 - VIEW_AREA.x1, ah = VIEW_AREA.y2 - VIEW_AREA.y1;
  let scale = null;

  if (p.kind === 'turned') {
    scale = chooseScale(turnedEnvelope, p, aw, ah);
    const e = turnedEnvelope(p, scale);
    const ox = VIEW_AREA.x1 + (aw - e.w) / 2 + 6;
    const oy = VIEW_AREA.y1 + (ah - e.h) / 2 + e.above + e.R * scale;
    drawTurned(S, p, scale, ox, oy);
  } else if (p.kind === 'plate') {
    scale = chooseScale(plateEnvelope, p, aw, ah);
    const e = plateEnvelope(p, scale);
    const ox = VIEW_AREA.x1 + (aw - e.w) / 2 + e.left;
    const oy = VIEW_AREA.y1 + (ah - e.h) / 2 + e.above;
    drawPlate(S, p, scale, ox, oy);
  } else if (p.kind === 'spring') {
    scale = chooseScale(springEnvelope, p, aw, ah);
    const e = springEnvelope(p, scale);
    const ox = VIEW_AREA.x1 + (aw - e.w) / 2 + 30;
    const oy = VIEW_AREA.y1 + ah / 2;
    drawSpring(S, p, scale, ox, oy);
  } else {
    if (o.image && o.image.w && o.image.h) {
      const k = Math.min(aw / o.image.w, ah / o.image.h);
      const w = o.image.w * k, h = o.image.h * k;
      S.image(VIEW_AREA.x1 + (aw - w) / 2, VIEW_AREA.y1 + (ah - h) / 2, w, h, o.image.src);
    } else {
      S.text(SHEET_W / 2, 80, 'SEE ATTACHED SKETCH / PHOTO', { h: 6, anchor: 'middle', bold: true });
    }
  }
  const viewEnd = S.prims.length;
  notesBlock(S, p);
  titleBlock(S, p, scale, o);
  return { sheet: S, scale, views: primsBox(S.prims.slice(1, viewEnd)) };
}

export function dimensionTags(p) {
  const tags = {};
  dimensionList(p).forEach((d) => d.keys.forEach((k) => { tags[k] = d; }));
  return tags;
}

// Bounding box (sheet mm) of a list of primitives.
export function primsBox(prims) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const add = (x, y) => { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); };
  for (const q of prims) {
    if (q.t === 'line') { add(q.x1, q.y1); add(q.x2, q.y2); }
    else if (q.t === 'circle' || q.t === 'arc') { add(q.cx - q.r, q.cy - q.r); add(q.cx + q.r, q.cy + q.r); }
    else if (q.t === 'poly') q.pts.forEach(([x, y]) => add(x, y));
    else if (q.t === 'image') { add(q.x, q.y); add(q.x + q.w, q.y + q.h); }
    else if (q.t === 'text') {
      const w = textWidth(q.text, q.h);
      if (q.rot) { add(q.x - q.h, q.y - w); add(q.x + q.h, q.y + w); }
      else {
        const left = q.anchor === 'middle' ? q.x - w / 2 : q.anchor === 'end' ? q.x - w : q.x;
        add(left, q.y - q.h); add(left + w, q.y + q.h * 0.3);
      }
    }
  }
  return Number.isFinite(x1) ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
}

// Views only, at 1:1, for DXF (no frame / title block).
export function buildViews11(p) {
  const S = new Sheet();
  if (p.kind === 'turned') drawTurned(S, p, 1, 0, 0);
  else if (p.kind === 'plate') drawPlate(S, p, 1, 0, 0);
  else if (p.kind === 'spring') drawSpring(S, p, 1, 0, 0);
  // Small info block under the views
  let maxY = 0, minX = Infinity;
  S.prims.forEach((q) => {
    const ys = q.t === 'line' ? [q.y1, q.y2] : q.t === 'circle' || q.t === 'arc' ? [q.cy + q.r] : q.t === 'poly' ? q.pts.map((a) => a[1]) : [q.y];
    const xs = q.t === 'line' ? [q.x1, q.x2] : q.t === 'circle' || q.t === 'arc' ? [q.cx - q.r] : q.t === 'poly' ? q.pts.map((a) => a[0]) : [q.x];
    maxY = Math.max(maxY, ...ys);
    minX = Math.min(minX, ...xs);
  });
  if (!Number.isFinite(minX)) minX = 0;
  const info = [displayName(p) + (p.partNo ? `  (${p.partNo})` : ''), `MATERIAL: ${p.material || '-'}`, `QTY: ${p.quantity || '-'}   SCALE 1:1   UNITS mm`, ...partNotes(p)];
  info.forEach((l, i) => S.text(minX, maxY + 12 + i * 5, l, { h: 3 }));
  return S;
}
