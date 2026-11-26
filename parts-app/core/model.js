// Part data model: one JSON spec per part is the single source of truth.
// The drawing, the 3D model, the DXF and the email text are all generated from it.
// All dimensions are in mm.

export const KINDS = {
  turned: 'חלק סיבובי (פין / מוט / ציר / תותב)',
  plate: 'פלטה / שייבה / בלוק',
  spring: 'קפיץ לחיצה',
  other: 'אחר (מורכב / ריתוך / הרכבה)',
};

export const PLATE_SHAPES = {
  rect: 'מלבן',
  obround: 'אובל (קצוות מעוגלים)',
  disc: 'עיגול',
};

export const MATERIALS = [
  'ST-37 (S235JR)', 'AISI 1020', 'AISI 1045', 'AISI 4140', 'AISI 304', 'AISI 316',
  'AL 6061-T6', 'AL 5052-H34', 'BRASS (CuZn39Pb3)', 'POM (Acetal) Black', 'POM (Acetal) White',
  'Spring steel (EN 10270-1 SH)',
];

export const FINISHES = [
  '', 'Paint RAL 7021', 'Paint RAL 7021 (no paint inside holes)', 'Zinc plated', 'Black oxide',
  'Hot-dip galvanized', 'Anodized natural', 'Anodized black', 'Nickel plated',
];

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function newPart(kind = 'turned') {
  const p = {
    id: uid(),
    name: '',
    partNo: '',
    kind,
    material: '',
    finish: '',
    quantity: 0,
    generalTolerance: 'ISO 2768-m',
    revision: 'A',
    notes: [],
    questions: [],
    estimated: [],
    estimatedDims: [], // keys from dimensionList() whose value is a guess, not read or measured
    fullSet: null, // null = automatic (see isComplex)
    turned: { segments: [{ length: 100, diameter: 20, thread: '', threadLength: 0, diaTol: '' }], chamferLeft: 1, chamferRight: 1, overallTol: '', bores: [], crossHoles: [] },
    plate: { shape: 'rect', length: 100, width: 50, thickness: 10, cornerRadius: 0, lengthTol: '', widthTol: '', thicknessTol: '', holes: [] },
    spring: { wireDiameter: 2, outerDiameter: 20, freeLength: 50, totalCoils: 8, activeCoils: 6, ends: 'Closed and ground', direction: 'Right hand' },
    imageIds: [],
    createdAt: Date.now(),
  };
  return p;
}

const num = (v, d = 0) => {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : d;
};
const str = (v) => (v == null ? '' : String(v)).trim();
const arr = (v) => (Array.isArray(v) ? v : []);

// Bring any (possibly partial / AI-produced) object to a complete, valid part.
export function normalizePart(input) {
  const base = newPart(KINDS[input?.kind] ? input.kind : 'turned');
  const p = { ...base, ...input };
  p.id = str(input?.id) || base.id;
  p.name = str(p.name);
  p.partNo = str(p.partNo);
  p.material = str(p.material);
  p.finish = str(p.finish);
  p.quantity = Math.max(0, Math.round(num(p.quantity)));
  p.generalTolerance = str(p.generalTolerance) || 'ISO 2768-m';
  p.revision = str(p.revision) || 'A';
  p.notes = arr(p.notes).map(str).filter(Boolean);
  p.questions = arr(p.questions).map(str).filter(Boolean);
  p.estimated = arr(p.estimated).map(str).filter(Boolean);
  p.estimatedDims = [...new Set(arr(p.estimatedDims).map(str).filter(Boolean))];
  p.imageIds = arr(p.imageIds).map(str).filter(Boolean);
  p.fullSet = p.fullSet === true || p.fullSet === false ? p.fullSet : null;

  const t = { ...base.turned, ...(input?.turned || {}) };
  t.segments = arr(t.segments).map((s) => ({
    length: Math.max(0, num(s.length)),
    diameter: Math.max(0, num(s.diameter)),
    thread: str(s.thread),
    threadLength: Math.max(0, num(s.threadLength)),
    diaTol: str(s.diaTol),
  })).filter((s) => s.length > 0 && s.diameter > 0);
  if (!t.segments.length) t.segments = base.turned.segments;
  t.chamferLeft = Math.max(0, num(t.chamferLeft));
  t.chamferRight = Math.max(0, num(t.chamferRight));
  t.overallTol = str(t.overallTol);
  t.bores = arr(t.bores).map((b) => ({
    end: b.end === 'right' ? 'right' : 'left',
    diameter: Math.max(0, num(b.diameter)),
    depth: Math.max(0, num(b.depth)), // 0 = through
    thread: str(b.thread),
    threadDepth: Math.max(0, num(b.threadDepth)), // 0 = threaded over the whole bore
  })).filter((b) => b.diameter > 0);
  t.crossHoles = arr(t.crossHoles).map((h) => ({
    diameter: Math.max(0, num(h.diameter)),
    x: Math.max(0, num(h.x)),
    thread: str(h.thread),
  })).filter((h) => h.diameter > 0);
  p.turned = t;

  const pl = { ...base.plate, ...(input?.plate || {}) };
  pl.shape = PLATE_SHAPES[pl.shape] ? pl.shape : 'rect';
  pl.length = Math.max(0.1, num(pl.length, 100));
  pl.width = pl.shape === 'disc' ? pl.length : Math.max(0.1, num(pl.width, 50));
  pl.thickness = Math.max(0.1, num(pl.thickness, 5));
  pl.cornerRadius = Math.min(Math.max(0, num(pl.cornerRadius)), Math.min(pl.length, pl.width) / 2 - 0.01);
  pl.lengthTol = str(pl.lengthTol);
  pl.widthTol = str(pl.widthTol);
  pl.thicknessTol = str(pl.thicknessTol);
  pl.holes = arr(pl.holes).map((h) => ({
    x: num(h.x),
    y: num(h.y),
    diameter: Math.max(0, num(h.diameter)),
    thread: str(h.thread),
    depth: Math.max(0, num(h.depth)), // 0 = through
    tol: str(h.tol),
    threadDepth: Math.max(0, num(h.threadDepth)), // 0 = threaded over the whole hole
    cboreDia: Math.max(0, num(h.cboreDia)), // counterbore (0 = none)
    cboreDepth: Math.max(0, num(h.cboreDepth)),
    csinkDia: Math.max(0, num(h.csinkDia)), // countersink (0 = none)
    csinkAngle: num(h.csinkAngle) > 0 ? num(h.csinkAngle) : 90,
  })).filter((h) => h.diameter > 0);
  pl.holes.forEach((h) => {
    if (h.cboreDia <= h.diameter) { h.cboreDia = 0; h.cboreDepth = 0; }
    if (h.csinkDia <= h.diameter) h.csinkDia = 0;
  });
  p.plate = pl;

  const sp = { ...base.spring, ...(input?.spring || {}) };
  sp.wireDiameter = Math.max(0.1, num(sp.wireDiameter, 2));
  sp.outerDiameter = Math.max(sp.wireDiameter * 2.5, num(sp.outerDiameter, 20));
  sp.freeLength = Math.max(sp.wireDiameter, num(sp.freeLength, 50));
  sp.totalCoils = Math.max(1, num(sp.totalCoils, 8));
  sp.activeCoils = Math.max(0, num(sp.activeCoils, sp.totalCoils - 2));
  sp.ends = str(sp.ends) || 'Closed and ground';
  sp.direction = str(sp.direction) || 'Right hand';
  p.spring = sp;
  const valid = new Set(dimensionList(p).flatMap((d) => d.keys));
  p.estimatedDims = p.estimatedDims.filter((k) => valid.has(k));
  return p;
}

export function overallLength(p) {
  return p.turned.segments.reduce((a, s) => a + s.length, 0);
}

// "Complex" parts get the full set (PDF + STEP + DXF); simple ones get PDF only.
export function isComplex(p) {
  if (p.kind === 'turned') {
    const t = p.turned;
    return t.segments.length > 2 || t.bores.length > 0 || t.crossHoles.length > 0 || t.segments.some((s) => s.thread);
  }
  if (p.kind === 'plate') {
    return p.plate.holes.length > 4 || p.plate.holes.some((h) => h.thread || h.depth > 0);
  }
  return false; // springs and "other" are PDF only
}

export function wantsFullSet(p) {
  if (!canMake3D(p)) return false;
  return p.fullSet == null ? isComplex(p) : p.fullSet;
}

export function canMake3D(p) {
  return p.kind === 'turned' || p.kind === 'plate';
}

export function displayName(p) {
  return p.name || p.partNo || 'PART';
}

export function fileBase(p) {
  return displayName(p).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'PART';
}

export function fmt(n) {
  const r = Math.round(n * 100) / 100;
  return String(r);
}

// Problems that would make the supplier come back with questions.
export function warnings(p) {
  const w = [];
  if (!p.name && !p.partNo) w.push('חסר שם / מספר חלק');
  if (!p.quantity) w.push('חסרה כמות');
  if (!p.material) w.push('חסר חומר (מנדי תניח חומר ברירת מחדל — עדיף לציין)');
  if (/hardened/i.test(p.material)) w.push('"Hardened steel" אינו חומר — ציין סוג פלדה (למשל AISI 1045) וקשיות HRC בהערה');
  if (p.kind === 'turned') {
    const t = p.turned;
    const L = overallLength(p);
    t.crossHoles.forEach((h, i) => {
      if (h.x <= 0 || h.x >= L) w.push(`חור רוחבי ${i + 1}: המיקום (${fmt(h.x)}) מחוץ לאורך החלק`);
    });
    t.bores.forEach((b, i) => {
      const seg = b.end === 'left' ? t.segments[0] : t.segments[t.segments.length - 1];
      if (b.diameter >= seg.diameter) w.push(`קדח ${i + 1}: הקוטר גדול מקוטר הקצה`);
      if (b.depth > L) w.push(`קדח ${i + 1}: העומק גדול מאורך החלק`);
    });
    t.segments.forEach((s, i) => {
      if (s.thread && !/^M\d/i.test(s.thread) && !/UN|NPT|G\s?\d|BSP/i.test(s.thread)) w.push(`מקטע ${i + 1}: הברגה "${s.thread}" — מומלץ פורמט כמו M20 או M20x1.5`);
    });
  }
  if (p.kind === 'plate') {
    const pl = p.plate;
    pl.holes.forEach((h, i) => {
      if (h.x - h.diameter / 2 < 0 || h.x + h.diameter / 2 > pl.length || h.y - h.diameter / 2 < 0 || h.y + h.diameter / 2 > pl.width) {
        w.push(`חור ${i + 1}: יוצא מגבולות הפלטה`);
      }
      if (h.depth > pl.thickness) w.push(`חור ${i + 1}: העומק גדול מהעובי`);
    });
  }
  if (p.kind === 'spring') {
    const s = p.spring;
    if (s.activeCoils > s.totalCoils) w.push('מספר כריכות פעילות גדול מהכריכות הכולל');
    if (s.wireDiameter * s.totalCoils > s.freeLength) w.push('האורך החופשי קצר מגובה הכריכות הצמודות (Solid length)');
  }
  return w;
}

/* ───────────── numbered dimension list (the measuring checklist) ───────────── */

// Holes that are drawn and called out together ("4x Ø8 THRU") are one group.
export function plateHoleGroup(h) {
  return [h.diameter, h.thread, h.depth, h.tol, h.threadDepth, h.cboreDia, h.cboreDepth, h.csinkDia, h.csinkAngle].join('|');
}
export function crossHoleGroup(h) {
  return `${h.diameter}|${h.thread}`;
}

// Many holes are dimensioned with a hole table (tags + X/Y table) instead of ordinate dimensions.
export function useHoleTable(p) {
  const hs = p.plate.holes;
  return hs.length > 6 || new Set(hs.map((h) => h.x)).size > 5 || new Set(hs.map((h) => h.y)).size > 5;
}

// Hole tags for the hole table: one letter per group, numbered within the group (A1, A2, B1…).
export function plateHoleTags(p) {
  const groups = [];
  return p.plate.holes.map((h) => {
    const g = plateHoleGroup(h);
    let gi = groups.indexOf(g);
    if (gi < 0) { groups.push(g); gi = groups.length - 1; }
    const n = p.plate.holes.slice(0, p.plate.holes.indexOf(h) + 1).filter((q) => plateHoleGroup(q) === g).length;
    return `${String.fromCharCode(65 + (gi % 26))}${n}`;
  });
}

const holeSize = (h) => h.thread || `Ø${fmt(h.diameter)}`;

// Every dimension that sets the size of the part, numbered the same way in the chat and on the preview.
// keys: paths into the part (a dimension shared by a group of holes has one key per hole).
export function dimensionList(p) {
  const out = [];
  const add = (keys, label, value) => out.push({ n: out.length + 1, keys: [].concat(keys), label, value });
  if (p.kind === 'turned') {
    const t = p.turned;
    const many = t.segments.length > 1;
    t.segments.forEach((g, i) => {
      const nm = many ? `מקטע ${i + 1}: ` : '';
      add(`turned.segments.${i}.length`, many ? `${nm}אורך` : 'אורך כולל', g.length);
      add(`turned.segments.${i}.diameter`, g.thread ? `${nm}קוטר הברגה ${g.thread}` : `${nm}קוטר`, g.diameter);
      if (g.thread && g.threadLength > 0) add(`turned.segments.${i}.threadLength`, `${nm}אורך הברגה`, g.threadLength);
    });
    if (t.chamferLeft > 0) add('turned.chamferLeft', 'פאזה בקצה השמאלי', t.chamferLeft);
    if (t.chamferRight > 0) add('turned.chamferRight', 'פאזה בקצה הימני', t.chamferRight);
    t.bores.forEach((b, i) => {
      const nm = `קדח ${b.end === 'left' ? 'משמאל' : 'מימין'}${t.bores.length > 1 ? ` ${i + 1}` : ''}`;
      add(`turned.bores.${i}.diameter`, `${nm}: ${b.thread ? `קוטר (${b.thread})` : 'קוטר'}`, b.diameter);
      if (b.depth > 0) add(`turned.bores.${i}.depth`, `${nm}: עומק`, b.depth);
      if (b.thread && b.threadDepth > 0) add(`turned.bores.${i}.threadDepth`, `${nm}: עומק הברגה`, b.threadDepth);
    });
    const seen = new Map();
    t.crossHoles.forEach((h, i) => {
      const g = crossHoleGroup(h);
      if (!seen.has(g)) seen.set(g, []);
      seen.get(g).push(i);
    });
    seen.forEach((idx) => {
      const h = t.crossHoles[idx[0]];
      add(idx.map((i) => `turned.crossHoles.${i}.diameter`), `חור רוחבי ${holeSize(h)}${idx.length > 1 ? ` (${idx.length} חורים)` : ''}: קוטר`, h.diameter);
    });
    [...t.crossHoles.keys()].sort((a, b) => t.crossHoles[a].x - t.crossHoles[b].x).forEach((i) => {
      add(`turned.crossHoles.${i}.x`, `חור רוחבי ${holeSize(t.crossHoles[i])}: מרחק מהקצה השמאלי`, t.crossHoles[i].x);
    });
  } else if (p.kind === 'plate') {
    const pl = p.plate;
    if (pl.shape === 'disc') add('plate.length', 'קוטר חיצוני', pl.length);
    else {
      add('plate.length', 'אורך', pl.length);
      add('plate.width', 'רוחב', pl.width);
    }
    add('plate.thickness', 'עובי', pl.thickness);
    if (pl.shape === 'rect' && pl.cornerRadius > 0) add('plate.cornerRadius', 'רדיוס פינות', pl.cornerRadius);
    const table = useHoleTable(p);
    const tags = plateHoleTags(p);
    const groups = new Map();
    pl.holes.forEach((h, i) => {
      const g = plateHoleGroup(h);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(i);
    });
    groups.forEach((idx) => {
      const h = pl.holes[idx[0]];
      const nm = `${table ? `חורים ${tags[idx[0]][0]}` : 'חור'} ${holeSize(h)}${idx.length > 1 ? ` (${idx.length})` : ''}`;
      const keys = (f) => idx.map((i) => `plate.holes.${i}.${f}`);
      add(keys('diameter'), `${nm}: קוטר`, h.diameter);
      if (h.depth > 0) add(keys('depth'), `${nm}: עומק`, h.depth);
      if (h.thread && h.threadDepth > 0) add(keys('threadDepth'), `${nm}: עומק הברגה`, h.threadDepth);
      if (h.cboreDia > 0) {
        add(keys('cboreDia'), `${nm}: קוטר שקיעה`, h.cboreDia);
        add(keys('cboreDepth'), `${nm}: עומק שקיעה`, h.cboreDepth);
      }
      if (h.csinkDia > 0) add(keys('csinkDia'), `${nm}: קוטר שקיעה קונית`, h.csinkDia);
    });
    // positions: per hole in a hole table, otherwise one per distinct X / Y (as dimensioned on the drawing)
    const placed = [...pl.holes.keys()].filter((i) => !(pl.shape === 'disc' && Math.abs(pl.holes[i].x - pl.length / 2) < 1e-6 && Math.abs(pl.holes[i].y - pl.width / 2) < 1e-6));
    if (table) {
      placed.forEach((i) => {
        add(`plate.holes.${i}.x`, `חור ${tags[i]}: X מהקצה השמאלי`, pl.holes[i].x);
        add(`plate.holes.${i}.y`, `חור ${tags[i]}: Y מהקצה התחתון`, pl.holes[i].y);
      });
    } else {
      for (const [axis, from] of [['x', 'מהקצה השמאלי'], ['y', 'מהקצה התחתון']]) {
        const vals = [...new Set(placed.map((i) => pl.holes[i][axis]))].sort((a, b) => a - b);
        vals.forEach((v) => {
          const idx = placed.filter((i) => pl.holes[i][axis] === v);
          add(idx.map((i) => `plate.holes.${i}.${axis}`), `מיקום חור${idx.length > 1 ? 'ים' : ''} ${axis.toUpperCase()} ${from}`, v);
        });
      }
    }
  } else if (p.kind === 'spring') {
    const s = p.spring;
    add('spring.wireDiameter', 'קוטר תיל', s.wireDiameter);
    add('spring.outerDiameter', 'קוטר חיצוני', s.outerDiameter);
    add('spring.freeLength', 'אורך חופשי', s.freeLength);
    add('spring.totalCoils', 'כריכות סה"כ', s.totalCoils);
    add('spring.activeCoils', 'כריכות פעילות', s.activeCoils);
  }
  const est = new Set(p.estimatedDims || []);
  out.forEach((d) => { d.estimated = d.keys.some((k) => est.has(k)); });
  return out;
}

function setPath(obj, key, value) {
  const parts = key.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    o = o?.[parts[i]];
    if (o == null) return false;
  }
  if (typeof o[parts.at(-1)] !== 'number') return false;
  o[parts.at(-1)] = value;
  return true;
}

const CONFIRM_ALL = /(אשר|אישור|מאשר)\s*(את\s*)?(ה)?כל|הכל\s*(נכון|תקין|מאושר|בסדר)|all\s*ok|confirm\s*all/i;
const CONFIRM_SOME = /(?:^|[\s,;])(?:אשר|אישור|מאשר|נכון|ok|✓|✔)\s*:?\s*((?:\d{1,3}(?:\s*[,\s]\s*|\s*ו\s*|\s*-\s*)?)+)/gi;
const ASSIGN = /(?:^|[\s,;(])(\d{1,3})\s*=\s*(\d+(?:[.,]\d+)?)(?=$|[\s,;)])/g;

// Answers to the checklist, handled locally (no AI): "3=8.5", "אישור 1 2 5", "אשר הכל".
// Returns the updated part, what changed, and the rest of the message (for the AI), or null if nothing matched.
export function applyDimAnswers(part, text) {
  const list = dimensionList(part);
  const p = JSON.parse(JSON.stringify(part));
  const est = new Set(p.estimatedDims);
  const set = [], confirmed = [];
  let rest = String(text);
  rest = rest.replace(ASSIGN, (m, n, v) => {
    const d = list[Number(n) - 1];
    if (!d) return m;
    const val = parseFloat(v.replace(',', '.'));
    d.keys.forEach((k) => { setPath(p, k, val); est.delete(k); });
    set.push({ ...d, value: val });
    return ' ';
  });
  rest = rest.replace(CONFIRM_SOME, (m, nums) => {
    const ns = [];
    for (const r of nums.matchAll(/(\d{1,3})(?:\s*-\s*(\d{1,3}))?/g)) {
      const a = Number(r[1]), b = r[2] ? Number(r[2]) : a;
      for (let i = Math.min(a, b); i <= Math.max(a, b) && i - Math.min(a, b) < 200; i++) ns.push(i);
    }
    const hit = ns.map((i) => list[i - 1]).filter(Boolean);
    if (!hit.length) return m;
    hit.forEach((d) => { d.keys.forEach((k) => est.delete(k)); confirmed.push(d); });
    return ' ';
  });
  if (CONFIRM_ALL.test(rest)) {
    list.filter((d) => d.estimated).forEach((d) => confirmed.push(d));
    est.clear();
    rest = rest.replace(CONFIRM_ALL, ' ');
  }
  if (!set.length && !confirmed.length) return null;
  p.estimatedDims = [...est];
  rest = rest.replace(/^[\s,;.\-–ו]+|[\s,;.\-–]+$/g, '').replace(/\s{2,}/g, ' ');
  if (!/[\p{L}\d]/u.test(rest)) rest = '';
  return { part: normalizePart(p), set, confirmed, rest };
}
