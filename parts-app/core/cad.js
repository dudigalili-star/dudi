// 3D solid → STEP, using replicad (OpenCascade compiled to WebAssembly).
// The ~23 MB engine is loaded lazily, only when a STEP file is requested.
import { overallLength, displayName } from './model.js';
import { threadInfo } from './drawing.js';

let ready = null;

export function loadCAD(baseUrl = new URL('../vendor/', import.meta.url).href) {
  if (!ready) {
    ready = (async () => {
      const R = await import(new URL('cad.js', baseUrl).href);
      const OC = await R.opencascade({ locateFile: () => new URL('replicad_single.wasm', baseUrl).href });
      R.setOC(OC);
      return R;
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

export function buildSolid(R, p) {
  if (p.kind === 'turned') return turnedSolid(R, p);
  if (p.kind === 'plate') return plateSolid(R, p);
  throw new Error('3D model is available for turned parts and plates only');
}

// Axis along X, left end at x = 0.
function turnedSolid(R, p) {
  const t = p.turned;
  const segs = t.segments;
  const L = overallLength(p);
  const cl = Math.min(t.chamferLeft, segs[0].diameter / 2 - 0.01, segs[0].length / 2);
  const cr = Math.min(t.chamferRight, segs[segs.length - 1].diameter / 2 - 0.01, segs[segs.length - 1].length / 2);
  const pts = [[0, 0]];
  let x = 0;
  segs.forEach((g, i) => {
    const r = g.diameter / 2;
    const c0 = i === 0 ? cl : 0;
    const c1 = i === segs.length - 1 ? cr : 0;
    pts.push([x, r - c0]);
    if (c0 > 0) pts.push([x + c0, r]);
    x += g.length;
    if (c1 > 0) pts.push([x - c1, r]);
    pts.push([x, r - c1]);
  });
  pts.push([L, 0]);
  // drop consecutive duplicates (e.g. equal neighbouring diameters)
  const clean = pts.filter((q, i) => i === 0 || Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) > 1e-6);
  let pen = R.draw(clean[0]);
  clean.slice(1).forEach((q) => { pen = pen.lineTo(q); });
  let solid = pen.close().sketchOnPlane('XY').revolve([1, 0, 0]);

  const Dmax = Math.max(...segs.map((g) => g.diameter));
  t.bores.forEach((b) => {
    const d = b.thread ? threadInfo(b.thread, b.diameter).minor : b.diameter;
    const depth = b.depth > 0 ? Math.min(b.depth, L) : L + 2;
    const start = b.end === 'left' ? -1 : L + 1;
    const dir = b.end === 'left' ? [1, 0, 0] : [-1, 0, 0];
    solid = solid.cut(R.makeCylinder(d / 2, depth + 1, [start, 0, 0], dir));
  });
  t.crossHoles.forEach((h) => {
    const d = h.thread ? threadInfo(h.thread, h.diameter).minor : h.diameter;
    solid = solid.cut(R.makeCylinder(d / 2, Dmax + 4, [h.x, 0, -(Dmax / 2 + 2)], [0, 0, 1]));
  });
  return solid;
}

// Origin at the bottom-left corner, thickness along +Z.
function plateSolid(R, p) {
  const pl = p.plate;
  const L = pl.length, W = pl.width, T = pl.thickness;
  let profile;
  if (pl.shape === 'disc') profile = R.drawCircle(L / 2);
  else if (pl.shape === 'obround') profile = R.drawRoundedRectangle(L, W, Math.min(L, W) / 2 - 1e-3);
  else if (pl.cornerRadius > 0) profile = R.drawRoundedRectangle(L, W, pl.cornerRadius);
  else profile = R.drawRectangle(L, W);
  let solid = profile.translate(L / 2, W / 2).sketchOnPlane('XY').extrude(T);
  pl.holes.forEach((h) => {
    const d = h.thread ? threadInfo(h.thread, h.diameter).minor : h.diameter;
    const depth = h.depth > 0 ? Math.min(h.depth, T) : T + 2;
    // blind holes start at the top face
    const z0 = h.depth > 0 ? T - depth : -1;
    solid = solid.cut(R.makeCylinder(d / 2, depth + (h.depth > 0 ? 1 : 0), [h.x, h.y, z0], [0, 0, 1]));
  });
  return solid;
}

export async function makeSTEP(p) {
  const R = await loadCAD();
  const solid = buildSolid(R, p);
  const name = displayName(p).replace(/[^\w\- .]/g, '_');
  return R.exportSTEP([{ shape: solid, name }], { unit: 'MM', modelUnit: 'MM' });
}
