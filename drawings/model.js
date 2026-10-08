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
  })).filter((h) => h.diameter > 0);
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
