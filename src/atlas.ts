import { RLE_DATA, RLE_IMAGES } from './data/rle';

export const ATLAS_WIDTH = 256;
export const ATLAS_HEIGHT = 122;

export function decodeAtlas(): Uint8Array {
  const atlas = new Uint8Array(ATLAS_WIDTH * ATLAS_HEIGHT);
  for (const entry of RLE_IMAGES) {
    const bits = entry.bits;
    const lowMask = (1 << (8 - bits)) - 1;
    const highMask = (1 << bits) - 1;
    let x = 0;
    let y = 0;
    for (let i = 0; i < entry.rleCount; i++) {
      const byte = RLE_DATA[entry.rleOffset + i]!;
      const value = (byte & lowMask) << bits;
      const runRaw = (byte >> (8 - bits)) & highMask;
      const runLen = (runRaw + 1) & 0xff;
      for (let k = 0; k < runLen; k++) {
        const px = entry.atlasX + x;
        const py = entry.atlasY + y;
        if (px <= 0xff && py <= 0x79) {
          atlas[(py << 8) + px] = value;
        }
        x++;
      }
      if (x === entry.width) {
        x = 0;
        y++;
      }
    }
  }
  return atlas;
}

export interface AtlasTextures {
  cell: Uint8Array;
  mask: Uint8Array;
  egg: Uint8Array;
  overlayA: Uint8Array;
  overlayB: Uint8Array;
  particle: Uint8Array;
  volume: Uint8Array;
}

function copyRect(
  atlas: Uint8Array,
  dest: Uint8Array,
  atlasY: number,
  width: number,
  height: number,
): void {
  for (let y = 0; y < height; y++) {
    dest.set(
      atlas.subarray((atlasY + y) * ATLAS_WIDTH, (atlasY + y) * ATLAS_WIDTH + width),
      y * width,
    );
  }
}

// Split atlas into GPU textures. `egg` is the birthday message glyph.
export function buildAtlasTextures(atlas: Uint8Array): AtlasTextures {
  const cell = new Uint8Array(16 * 16);
  const mask = new Uint8Array(32 * 4);
  const egg = new Uint8Array(138 * 10);
  const overlayA = new Uint8Array(123 * 47);
  const overlayB = new Uint8Array(256 * 32);
  copyRect(atlas, cell, 0, 16, 16);
  copyRect(atlas, mask, 16, 32, 4);
  copyRect(atlas, overlayA, 32, 123, 47);
  copyRect(atlas, overlayB, 80, 256, 32);
  copyRect(atlas, egg, 112, 138, 10);

  const particle = new Uint8Array(16 * 16);
  const pi = Math.PI;
  for (let y = 0; y < 16; y++) {
    const dy = 8.0 - (y + 0.5);
    for (let x = 0; x < 16; x++) {
      const dx = 8.0 - (x + 0.5);
      const dist = Math.sqrt(dx * dx + dy * dy);
      let value = 0.0;
      if (dist < 7.6190481) {
        value = (Math.cos(dist * 0.13124999 * pi) + 1.0) * 0.5;
      }
      particle[y * 16 + x] = Math.max(0, Math.min(255, Math.floor(value * 255.0)));
    }
  }

  const volume = new Uint8Array(64 * 32 * 4);
  let rng = 0xcafef2ef >>> 0;
  for (let w = 0; w < 4; w++) {
    for (let v = 0; v < 32; v++) {
      for (let u = 0; u < 64; u++) {
        rng = (Math.imul(1664525, rng) + 1013904223) >>> 0;
        rng = (Math.imul(1664525, rng) + 1013904223) >>> 0;
        volume[((w * 32 + v) * 64) + u] = (rng >>> 16) % 255;
      }
    }
  }

  return { cell, mask, egg, overlayA, overlayB, particle, volume };
}
