// Reads a photo / hand sketch of a part with Claude and returns a part spec (see model.js).
import { normalizePart } from './model.js';

const seg = {
  type: 'object', additionalProperties: false,
  required: ['length', 'diameter', 'thread', 'threadLength', 'diaTol'],
  properties: {
    length: { type: 'number' },
    diameter: { type: 'number' },
    thread: { type: 'string', description: 'External thread spec like "M20" or "M20x1.5"; empty if none' },
    threadLength: { type: 'number', description: '0 = whole step is threaded' },
    diaTol: { type: 'string', description: 'Tolerance on this diameter, e.g. "h7" or "±0.05"; empty if none' },
  },
};

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['name', 'partNo', 'kind', 'material', 'finish', 'quantity', 'notes', 'questions', 'estimated', 'turned', 'plate', 'spring'],
  properties: {
    name: { type: 'string' },
    partNo: { type: 'string' },
    kind: { type: 'string', enum: ['turned', 'plate', 'spring', 'other'] },
    material: { type: 'string' },
    finish: { type: 'string' },
    quantity: { type: 'number' },
    notes: { type: 'array', items: { type: 'string' } },
    questions: { type: 'array', items: { type: 'string' } },
    estimated: { type: 'array', items: { type: 'string' } },
    turned: {
      type: 'object', additionalProperties: false,
      required: ['segments', 'chamferLeft', 'chamferRight', 'overallTol', 'bores', 'crossHoles'],
      properties: {
        segments: { type: 'array', items: seg },
        chamferLeft: { type: 'number' },
        chamferRight: { type: 'number' },
        overallTol: { type: 'string' },
        bores: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['end', 'diameter', 'depth', 'thread'],
            properties: {
              end: { type: 'string', enum: ['left', 'right'] },
              diameter: { type: 'number' },
              depth: { type: 'number', description: '0 = through' },
              thread: { type: 'string' },
            },
          },
        },
        crossHoles: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['diameter', 'x', 'thread'],
            properties: {
              diameter: { type: 'number' },
              x: { type: 'number', description: 'Distance from the LEFT end to the hole CENTER' },
              thread: { type: 'string' },
            },
          },
        },
      },
    },
    plate: {
      type: 'object', additionalProperties: false,
      required: ['shape', 'length', 'width', 'thickness', 'cornerRadius', 'holes'],
      properties: {
        shape: { type: 'string', enum: ['rect', 'obround', 'disc'] },
        length: { type: 'number' },
        width: { type: 'number' },
        thickness: { type: 'number' },
        cornerRadius: { type: 'number' },
        holes: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['x', 'y', 'diameter', 'thread', 'depth', 'tol'],
            properties: {
              x: { type: 'number', description: 'From the LEFT edge to the hole center' },
              y: { type: 'number', description: 'From the BOTTOM edge to the hole center' },
              diameter: { type: 'number' },
              thread: { type: 'string' },
              depth: { type: 'number', description: '0 = through' },
              tol: { type: 'string' },
            },
          },
        },
      },
    },
    spring: {
      type: 'object', additionalProperties: false,
      required: ['wireDiameter', 'outerDiameter', 'freeLength', 'totalCoils', 'activeCoils', 'ends'],
      properties: {
        wireDiameter: { type: 'number' },
        outerDiameter: { type: 'number' },
        freeLength: { type: 'number' },
        totalCoils: { type: 'number' },
        activeCoils: { type: 'number' },
        ends: { type: 'string' },
      },
    },
  },
};

const SYSTEM = `You convert photos of mechanical parts, and photos of hand-drawn or printed sketches of parts, into a precise part specification. A manufacturing drawing will be generated from your output and sent to a machining supplier in China for a price quotation, so every number you give will be manufactured.

How to read the input:
- Hand sketches usually have the real dimensions written on them (mm). Use the written numbers, never measure the sketch. Read digits carefully (1 vs 7, 3 vs 8, 102 vs 103).
- A photo of a real part has no written dimensions. Use any reference in the photo (ruler, coin, known thread, user-provided dimension) to estimate the rest in proportion, round to sensible values, and list EVERY estimated dimension in "estimated" (e.g. "Overall length 120 – estimated from photo").
- The user's text message overrides anything you infer from the image.

Part kinds and conventions (mm):
- "turned": pins, rods, shafts, bushings, spacers, bolts — anything made on a lathe. Describe it as coaxial steps (segments) from LEFT to RIGHT; the sum of segment lengths is the overall length. A plain rod is one segment. Chamfers are 45° sizes at the left/right ends (0 = none; use 0.5–1 if the sketch shows an unspecified chamfer, and mention it in "estimated"). Axial holes go in "bores" (end left/right, depth 0 = through, thread e.g. "M8"). Radial holes through the shaft go in "crossHoles" with x = distance from the LEFT end to the hole center.
- "plate": plates, flat bars, washers (including 2-hole washers), keys, blocks. length = X, width = Y, thickness = Z. shape "obround" for slot-like parts with fully rounded ends, "disc" for round washers (length = outer diameter). Holes: x from the LEFT edge and y from the BOTTOM edge to the hole center; depth 0 = through; thread e.g. "M6" for tapped holes.
- "spring": compression springs — wire diameter, OUTER diameter, free length, total and active coils.
- "other": welded assemblies, castings, multi-part assemblies, or anything that cannot be described by the kinds above. Put what you can read in "notes".
Fill the objects for kinds you are not using with zeros / empty arrays; they are ignored.

Other fields:
- name: short English part name as the user would call it (e.g. "PIN 258", "2-HOLE WASHER", "ROD Ø20x258"). partNo only if written.
- material: the real grade if known (e.g. "ST-37", "AISI 1020", "AISI 304", "POM (Acetal) Black", "Brass"). Never write vague names like "hardened steel" — if hardness is required, put the steel grade in material and "HARDEN TO xx HRC" in notes. Empty if unknown.
- finish: e.g. "Paint RAL 7021", "Zinc plated"; empty if none.
- quantity: number of pieces if given, else 0.
- notes: short English manufacturing notes that must appear on the drawing (welding, press fit, hardness, surface finish...). Do not repeat dimensions, material or finish.
- questions: in HEBREW, everything that is ambiguous or missing and that the supplier would ask about (unclear digit, missing chamfer size, hole reference point, thread pitch, which way a step faces, tolerance on a fit). Be specific. Empty if everything is clear.
- estimated: in HEBREW, list of dimensions you estimated rather than read.`;

export const DEFAULT_MODEL = 'claude-opus-5-5';

// images: [{base64, mediaType}] (may be empty when the part is described in text only).
// current: an existing part spec to revise with userText (corrections like "length 260").
export async function analyzeImages({ Anthropic, apiKey, model = DEFAULT_MODEL, images = [], userText = '', current = null, client = null }) {
  if (!client && !apiKey) throw new Error('חסר מפתח API של Anthropic (בהגדרות)');
  if (!images.length && !userText && !current) throw new Error('אין תמונה או תיאור לניתוח');
  const api = client || new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const content = [];
  images.forEach((img) => {
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } });
  });
  let text;
  if (current) {
    const { id, imageIds, createdAt, fullSet, ...spec } = current;
    text = `This is the current specification of the part:\n${JSON.stringify(spec)}\n\n`
      + `Apply my corrections below and return the complete updated specification. Keep everything I did not mention unchanged. `
      + `Remove questions and estimates that my corrections answer.\n\nCorrections:\n${userText}`;
  } else {
    text = (userText ? `Additional information from me (overrides the image):\n${userText}\n\n` : '')
      + (images.length ? 'Produce the part specification.' : 'There is no image; produce the part specification from my description.');
  }
  content.push({ type: 'text', text });

  const response = await api.beta.messages.create({
    model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('הבקשה נדחתה על ידי המודל' + (response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : ''));
  }
  if (response.stop_reason === 'max_tokens') throw new Error('התשובה נקטעה (max_tokens) — נסה שוב');
  const out = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let data;
  try {
    data = JSON.parse(out);
  } catch {
    throw new Error('לא התקבל JSON תקין מהמודל');
  }
  return normalizePart(data);
}

// Resize big phone photos before sending (keeps requests small and fast).
export async function fileToImage(file, maxSide = 1600, quality = 0.85) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('לא ניתן לקרוא את התמונה'));
      i.src = url;
    });
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = c.toDataURL('image/jpeg', quality);
    return { dataUrl, base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', w, h, name: file.name };
  } finally {
    URL.revokeObjectURL(url);
  }
}
