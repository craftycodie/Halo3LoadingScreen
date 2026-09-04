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

// Ring lattice face: bake atlas mask into attr0.w; flags in attr1.w (a6|a7|baked).
function pushRingVert(
  dest: Vertex[],
  u: number,
  v: number,
  w: number,
  face: number,
  flagA6: boolean,
  flagA7: boolean,
  maskByte = 255,
  bakeMask = false,
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
  if (bakeMask) {
    const flags = (flagA6 ? 1 : 0) + (flagA7 ? 2 : 0) + 4;
    pushVert(dest, u, v, w, maskByte * (1 / 255), du, dv, dw, flags);
  } else {
    pushVert(dest, u, v, w, flagA6 ? 1.0 : 0.0, du, dv, dw, flagA7 ? 1.0 : 0.0);
  }
}

function packGuide(base: number, add: number, low: number): number {
  return (((base + add) << 8) & 0xff00) | low;
}

export interface Geometry {
  ringVerts: Vertex[];
  outlineVerts: Vertex[];
  guideVerts: Vertex[];
  pointVerts: Vertex[];
}

export function generateGeometry(): Geometry {
  const atlas = decodeAtlas();
  const ringVerts: Vertex[] = [];

  // Concentric bands (fixed w): one quad per (u,v) cell; mask baked per cell.
  for (let i = 0; i <= 4; i++) {
    const a7 = i !== 0;
    const a6 = i !== 4;
    const maskRow = Math.min(i, 3);
    for (let u = 0; u < 64; u++) {
      for (let v = 0; v < 32; v++) {
        const maskByte = atlas[(16 + maskRow) * ATLAS_WIDTH + v]!;
        if (maskByte === 0) continue;
        pushRingVert(ringVerts, u, v, i, 2, a6, a7, maskByte, true);
        pushRingVert(ringVerts, u + 1, v, i, 2, a6, a7, maskByte, true);
        pushRingVert(ringVerts, u + 1, v + 1, i, 2, a6, a7, maskByte, true);
        pushRingVert(ringVerts, u, v + 1, i, 2, a6, a7, maskByte, true);
      }
    }
  }

  // Radial walls (fixed u).
  for (let j = 0; j <= 64; j++) {
    const a7 = j !== 0;
    const a6 = j !== 64;
    for (let v = 0; v < 32; v++) {
      for (let w = 0; w < 4; w++) {
        const maskByte = atlas[(16 + w) * ATLAS_WIDTH + v]!;
        if (maskByte === 0) continue;
        pushRingVert(ringVerts, j, v, w, 0, a6, a7, maskByte, true);
        pushRingVert(ringVerts, j, v + 1, w, 0, a6, a7, maskByte, true);
        pushRingVert(ringVerts, j, v + 1, w + 1, 0, a6, a7, maskByte, true);
        pushRingVert(ringVerts, j, v, w + 1, 0, a6, a7, maskByte, true);
      }
    }
  }

  // Floors (fixed v).
  for (let k = 0; k <= 32; k++) {
    const a7 = k !== 0;
    const a6 = k !== 32;
    const maskV = Math.min(k, 31);
    for (let u = 0; u < 64; u++) {
      for (let w = 0; w < 4; w++) {
        const maskByte = atlas[(16 + w) * ATLAS_WIDTH + maskV]!;
        if (maskByte === 0) continue;
        pushRingVert(ringVerts, u, k, w, 1, a6, a7, maskByte, true);
        pushRingVert(ringVerts, u + 1, k, w, 1, a6, a7, maskByte, true);
        pushRingVert(ringVerts, u + 1, k, w + 1, 1, a6, a7, maskByte, true);
        pushRingVert(ringVerts, u, k, w + 1, 1, a6, a7, maskByte, true);
      }
    }
  }

  const kOutlineV = [0.0, 32.0, 2.0, 30.0, 5.0, 27.0];
  const kOutlineW = [0.0, 0.0, 3.0, 3.0, 4.0, 4.0];
  const outlineVerts: Vertex[] = [];
  for (let u = 0; u < 64; u++) {
    for (let line = 0; line < 6; line++) {
      pushVert(outlineVerts, u, kOutlineV[line]!, kOutlineW[line]!, 0.0, line, 0.0, 0.0, 0.0);
      pushVert(outlineVerts, u + 1, kOutlineV[line]!, kOutlineW[line]!, 0.0, line, 0.0, 0.0, 0.0);
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

  return { ringVerts, outlineVerts, guideVerts, pointVerts };
}

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

// Line-list pairs to triangle quads (screen-space thickness in vs_lines).
export function expandLinesToQuads(lines: Vertex[]): Vertex[] {
  const out: Vertex[] = [];
  const segCount = Math.floor(lines.length / 2);
  for (let s = 0; s < segCount; s++) {
    const a = lines[s * 2]!;
    const b = lines[s * 2 + 1]!;
    const packed: Vertex = {
      attr0: [a.attr0[0], a.attr0[1], a.attr0[2], a.attr0[3]],
      attr1: [b.attr0[0], b.attr0[1], b.attr0[2], a.attr1[0]],
    };
    for (let i = 0; i < 6; i++) {
      out.push({
        attr0: [packed.attr0[0], packed.attr0[1], packed.attr0[2], packed.attr0[3]],
        attr1: [packed.attr1[0], packed.attr1[1], packed.attr1[2], packed.attr1[3]],
      });
    }
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

// Right-aligned overlay; pass a virtual screen (720 × aspect) for any RT size.
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
