import { ATLAS_WIDTH, decodeAtlas } from './atlas';

export interface Vertex {
  attr0: [number, number, number, number];
  attr1: [number, number, number, number];
}

function pushVert(
  dest: Vertex[],
  u: number,
  v: number,
  w: number,
  extra: number,
  a: number,
  b: number,
  c: number,
  d: number,
): void {
  dest.push({
    attr0: [u, v, w, extra],
    attr1: [a, b, c, d],
  });
}

function pushEggVert(
  dest: Vertex[],
  u: number,
  v: number,
  w: number,
  face: number,
  flagA6: boolean,
  flagA7: boolean,
): void {
  let du = u;
  let dv = v;
  let dw = w;
  if (face === 0) {
    du = 1;
    dv = 0;
    dw = 0;
  } else if (face === 1) {
    du = 0;
    dv = 1;
    dw = 0;
  } else if (face < 3) {
    du = 0;
    dv = 0;
    dw = 1;
  }
  pushVert(dest, u, v, w, flagA6 ? 1.0 : 0.0, du, dv, dw, flagA7 ? 1.0 : 0.0);
}

function packGuide(base: number, add: number, low: number): number {
  return (((base + add) << 8) & 0xff00) | low;
}

export interface Geometry {
  eggVerts: Vertex[];
  superVerts: Vertex[];
  guideVerts: Vertex[];
  pointVerts: Vertex[];
}

/** 8258AB90 / 8258AA78 / 8258A7F0 / 8258AE18 */
export function generateGeometry(): Geometry {
  const eggVerts: Vertex[] = [];
  for (let i = 0; i <= 4; i++) {
    const a7 = i !== 0;
    const a6 = i !== 4;
    for (let u = 0; u < 64; u++) {
      pushEggVert(eggVerts, u, 0, i, 2, a6, a7);
      pushEggVert(eggVerts, u + 1, 0, i, 2, a6, a7);
      pushEggVert(eggVerts, u + 1, 32, i, 2, a6, a7);
      pushEggVert(eggVerts, u, 32, i, 2, a6, a7);
    }
  }
  for (let j = 0; j <= 64; j++) {
    const a7 = j !== 0;
    const a6 = j !== 64;
    pushEggVert(eggVerts, j, 0, 0, 0, a6, a7);
    pushEggVert(eggVerts, j, 32, 0, 0, a6, a7);
    pushEggVert(eggVerts, j, 32, 4, 0, a6, a7);
    pushEggVert(eggVerts, j, 0, 4, 0, a6, a7);
  }
  for (let k = 0; k <= 32; k++) {
    const a7 = k !== 0;
    const a6 = k !== 32;
    for (let u = 0; u < 64; u++) {
      pushEggVert(eggVerts, u, k, 0, 1, a6, a7);
      pushEggVert(eggVerts, u + 1, k, 0, 1, a6, a7);
      pushEggVert(eggVerts, u + 1, k, 4, 1, a6, a7);
      pushEggVert(eggVerts, u, k, 4, 1, a6, a7);
    }
  }

  const kSuperV = [0.0, 32.0, 2.0, 30.0, 5.0, 27.0];
  const kSuperW = [0.0, 0.0, 3.0, 3.0, 4.0, 4.0];
  const superVerts: Vertex[] = [];
  for (let u = 0; u < 64; u++) {
    for (let line = 0; line < 6; line++) {
      pushVert(superVerts, u, kSuperV[line]!, kSuperW[line]!, 0.0, line, 0.0, 0.0, 0.0);
      pushVert(superVerts, u + 1, kSuperV[line]!, kSuperW[line]!, 0.0, line, 0.0, 0.0, 0.0);
    }
  }

  const guideVerts: Vertex[] = [];
  for (let base = 0; base < 248; base += 8) {
    const packed = [
      packGuide(base, 2, 0),
      packGuide(base, 4, 1),
      packGuide(base, 4, 1),
      packGuide(base, 4, 5),
      packGuide(base, 4, 5),
      packGuide(base, 6, 6),
      packGuide(base, 6, 2),
      packGuide(base, 2, 4),
      packGuide(base, 6, 0),
      packGuide(base, 6, 2),
      packGuide(base, 6, 2),
      packGuide(base, 8, 3),
      packGuide(base, 2, 4),
      packGuide(base, 2, 6),
      packGuide(base, 0, 3),
      packGuide(base, 2, 4),
      packGuide(base, 0, 1),
      packGuide(base, 0, 5),
      packGuide(base, 2, 0),
      packGuide(base, 0, 1),
      packGuide(base, 2, 6),
      packGuide(base, 0, 5),
      packGuide(base, 2, 6),
      packGuide(base, 4, 5),
      packGuide(base, 2, 2),
      packGuide(base, 0, 3),
      packGuide(base, 2, 2),
      packGuide(base, 2, 0),
      packGuide(base, 2, 2),
      packGuide(base, 6, 4),
      packGuide(base, 6, 4),
      packGuide(base, 6, 6),
      packGuide(base, 6, 4),
      packGuide(base, 8, 3),
      packGuide(base, 6, 6),
      packGuide(base, 8, 5),
      packGuide(base, 6, 0),
      packGuide(base, 8, 1),
      packGuide(base, 6, 0),
      packGuide(base, 4, 1),
    ];
    const styles = [
      140, 140, 140, 140, 140, 140, 140, 140, 140, 140, 140, 140, 140, 140, 140, 140,
      100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100,
      100, 100, 100, 100, 100, 100, 100, 100,
    ];
    for (let i = 0; i < 40; i++) {
      const u = (packed[i]! >> 8) & 0xff;
      const v = packed[i]! & 0xff;
      pushVert(guideVerts, u, styles[i]!, v, 0.0, 0.0, 0.0, 0.0, 0.0);
    }
  }
  pushVert(guideVerts, 248.0, 214.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  pushVert(guideVerts, 248.0, 214.0, 5.0, 0.0, 0.0, 0.0, 0.0, 0.0);

  const pointVerts: Vertex[] = [];
  const atlas = decodeAtlas();
  let rng = 0xcafebeef >>> 0;
  for (let w = 0; w < 4; w++) {
    for (let v = 0; v < 32; v++) {
      const mask = atlas[(16 + w) * ATLAS_WIDTH + v]!;
      for (let u = 0; u < 64; u++) {
        rng = (Math.imul(1664525, rng) + 1013904223) >>> 0;
        const nBirth = ((rng >>> 16) % 255) * (1.0 / 255.0);
        rng = (Math.imul(1664525, rng) + 1013904223) >>> 0;
        const n0 = ((rng >>> 16) % 255) * (1.0 / 255.0);
        rng = (Math.imul(1664525, rng) + 1013904223) >>> 0;
        const n1 = ((rng >>> 16) % 255) * (1.0 / 255.0);
        rng = (Math.imul(1664525, rng) + 1013904223) >>> 0;
        const n2 = ((rng >>> 16) % 255) * (1.0 / 255.0);
        const ox = n0 * 0.17453292 - (1.0 - n0) * 0.17453292;
        const oy = n1 * 3.0 - (1.0 - n1) * 2.0;
        const oz = n2 * 2.0 - (1.0 - n2) * 2.0;
        for (let c = 0; c < 6; c++) {
          pushVert(pointVerts, u, v, w, mask, ox, oy, oz, nBirth);
        }
      }
    }
  }

  return { eggVerts, superVerts, guideVerts, pointVerts };
}

/** Expand quad-list (4 verts) to triangle-list (6 verts). */
export function expandQuads(quads: Vertex[]): Vertex[] {
  const out: Vertex[] = [];
  const qCount = Math.floor(quads.length / 4);
  for (let q = 0; q < qCount; q++) {
    const a = quads[q * 4]!;
    const b = quads[q * 4 + 1]!;
    const c = quads[q * 4 + 2]!;
    const d = quads[q * 4 + 3]!;
    out.push(a, b, c, a, c, d);
  }
  return out;
}

export function packVertices(verts: Vertex[]): Float32Array {
  const data = new Float32Array(verts.length * 8);
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i]!;
    const o = i * 8;
    data[o] = v.attr0[0];
    data[o + 1] = v.attr0[1];
    data[o + 2] = v.attr0[2];
    data[o + 3] = v.attr0[3];
    data[o + 4] = v.attr1[0];
    data[o + 5] = v.attr1[1];
    data[o + 6] = v.attr1[2];
    data[o + 7] = v.attr1[3];
  }
  return data;
}

export function fillOverlayQuad(
  out: Float32Array,
  anchorX: number,
  anchorY: number,
  texW: number,
  texH: number,
  scale: number,
  screenW: number,
  screenH: number,
): void {
  // Xbox 8258A518: right-aligned at anchor; size (tex*scale)/screen in NDC.
  // Pass a virtual screen sized to the RT aspect (e.g. 720 * aspect × 720) so
  // logos keep Xbox-relative size and correct texture aspect at any resolution.
  const ndcW = (texW / screenW) * scale;
  const ndcH = (texH / screenH) * scale;
  const left = anchorX - ndcW;
  const right = anchorX;
  const bottom = anchorY;
  const top = anchorY + ndcH;
  const corners = [
    [left, bottom, 0.0, 1.0],
    [right, bottom, 1.0, 1.0],
    [left, top, 0.0, 0.0],
    [left, top, 0.0, 0.0],
    [right, bottom, 1.0, 1.0],
    [right, top, 1.0, 0.0],
  ];
  for (let i = 0; i < 6; i++) {
    const o = i * 8;
    out[o] = corners[i]![0]!;
    out[o + 1] = corners[i]![1]!;
    out[o + 2] = 0.0;
    out[o + 3] = 1.0;
    out[o + 4] = corners[i]![2]!;
    out[o + 5] = corners[i]![3]!;
    out[o + 6] = 0.0;
    out[o + 7] = 1.0;
  }
}

export function fillFullscreenQuad(out: Float32Array): void {
  const corners = [
    [-1, -1, 0, 1],
    [1, -1, 1, 1],
    [-1, 1, 0, 0],
    [-1, 1, 0, 0],
    [1, -1, 1, 1],
    [1, 1, 1, 0],
  ];
  for (let i = 0; i < 6; i++) {
    const o = i * 8;
    out[o] = corners[i]![0]!;
    out[o + 1] = corners[i]![1]!;
    out[o + 2] = 0;
    out[o + 3] = 1;
    out[o + 4] = corners[i]![2]!;
    out[o + 5] = corners[i]![3]!;
    out[o + 6] = 0;
    out[o + 7] = 1;
  }
}
