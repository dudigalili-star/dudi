// Renders sample drawings (chat preview with balloons, and the clean sheet) to PNG for a visual check.
// Run: node test/render-samples.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { normalizePart } from '../../parts-app/core/model.js';
import { buildDrawing, SHEET_W, SHEET_H } from '../../parts-app/core/drawing.js';
import { toSVG } from '../../parts-app/core/render.js';

export const SAMPLES = {
  shaft: {
    name: 'SHAFT M16', kind: 'turned', material: 'AISI 1045', quantity: 20,
    estimatedDims: ['turned.segments.1.diameter', 'turned.bores.0.threadDepth'],
    turned: {
      segments: [{ length: 30, diameter: 16, thread: 'M16', threadLength: 22 }, { length: 80, diameter: 25 }, { length: 25, diameter: 20, diaTol: 'h7' }],
      chamferLeft: 1, chamferRight: 1,
      bores: [{ end: 'right', diameter: 8, depth: 25, thread: 'M8', threadDepth: 18 }],
      crossHoles: [{ diameter: 6, x: 60 }, { diameter: 6, x: 90 }],
    },
  },
  flange: {
    name: 'MOUNTING PLATE', kind: 'plate', material: 'ST-37', quantity: 5,
    estimatedDims: ['plate.thickness', 'plate.holes.0.cboreDepth', 'plate.holes.1.cboreDepth', 'plate.holes.2.cboreDepth', 'plate.holes.3.cboreDepth'],
    plate: {
      shape: 'rect', length: 160, width: 90, thickness: 15, cornerRadius: 8,
      holes: [
        { x: 15, y: 15, diameter: 9, cboreDia: 15, cboreDepth: 9 }, { x: 145, y: 15, diameter: 9, cboreDia: 15, cboreDepth: 9 },
        { x: 15, y: 75, diameter: 9, cboreDia: 15, cboreDepth: 9 }, { x: 145, y: 75, diameter: 9, cboreDia: 15, cboreDepth: 9 },
        { x: 80, y: 45, diameter: 10, thread: 'M10', depth: 0, threadDepth: 0 },
        { x: 50, y: 45, diameter: 6.6, csinkDia: 13, csinkAngle: 90 },
      ],
    },
  },
  manyHoles: {
    name: 'COVER PLATE', kind: 'plate', material: 'AL 6061-T6', quantity: 10,
    plate: {
      shape: 'rect', length: 200, width: 120, thickness: 8,
      holes: [
        ...[20, 60, 100, 140, 180].map((x) => ({ x, y: 15, diameter: 6.6 })),
        ...[20, 60, 100, 140, 180].map((x) => ({ x, y: 105, diameter: 6.6 })),
        { x: 70, y: 60, diameter: 6, thread: 'M6', depth: 6, threadDepth: 5 }, { x: 130, y: 60, diameter: 6, thread: 'M6', depth: 6, threadDepth: 5 },
        { x: 100, y: 60, diameter: 30 },
      ],
    },
  },
};

export function renderPNG(p, { tags = false, crop = false } = {}) {
  const { sheet, views } = buildDrawing(p, { tags, drawnBy: 'TEST', date: '01/01/2026' });
  let svg;
  if (crop && views) {
    const m = 6;
    const x = Math.max(0, views.x - m), y = Math.max(0, views.y - m);
    const w = Math.min(SHEET_W - x, views.w + 2 * m), h = Math.min(SHEET_H - y, views.h + 2 * m);
    svg = toSVG(sheet, { width: w, height: h, viewBox: `${x} ${y} ${w} ${h}` });
  } else svg = toSVG(sheet);
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: 1800 }, background: '#fff', font: { loadSystemFonts: true, defaultFontFamily: 'Liberation Sans' } });
  return Buffer.from(r.render().asPng());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] || '.';
  fs.mkdirSync(out, { recursive: true });
  for (const [k, raw] of Object.entries(SAMPLES)) {
    const p = normalizePart(raw);
    fs.writeFileSync(path.join(out, `${k}-preview.png`), renderPNG(p, { tags: true, crop: true }));
    fs.writeFileSync(path.join(out, `${k}-sheet.png`), renderPNG(p));
  }
  console.log('written to', out);
}
