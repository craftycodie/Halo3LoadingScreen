// Uniform buffer matching HLSL packoffset layout (86 × 16 = 1376 bytes).
export const CB_FLOATS = 86 * 4;
export const CB_BYTES = CB_FLOATS * 4;

export class LoadingConstants {
  readonly data = new Float32Array(CB_FLOATS);

  get mat(): Float32Array {
    return this.data.subarray(0, 16);
  }

  setTheta(v: [number, number, number, number]): void {
    this.data.set(v, 16);
  }

  setOther(v: [number, number, number, number]): void {
    this.data.set(v, 20);
  }

  setVertexTimescale(v: [number, number, number, number]): void {
    this.data.set(v, 24);
  }

  setPassModes(v: [number, number, number, number]): void {
    this.data.set(v, 28);
  }

  // Build stamps at c8 (float offset 32).
  setSliceTimes(buildTimes: Float32Array, slice: number): void {
    const window = 64 * slice;
    const wrap = slice === 31 ? buildTimes[0]! : buildTimes[64 * (slice + 1)]!;
    const base = 32;
    for (let i = 0; i < 65; i++) {
      const value = i === 64 ? wrap : buildTimes[window + i]!;
      const o = base + i * 4;
      this.data[o] = value;
      this.data[o + 1] = 0;
      this.data[o + 2] = 0;
      this.data[o + 3] = 0;
    }
  }

  // Birthday-egg UV scale/bias (c73).
  setEggScales(v: [number, number, number, number]): void {
    this.data.set(v, 292);
  }

  setPixelTimescale(v: [number, number, number, number]): void {
    this.data.set(v, 296);
  }

  setPixelInverseVolume(v: [number, number, number, number]): void {
    this.data.set(v, 300);
  }

  setPixelVolume(v: [number, number, number, number]): void {
    this.data.set(v, 304);
  }

  setCompositeControl(v: [number, number, number, number]): void {
    this.data.set(v, 308);
  }

  setLineConstant(line: number, start: number, end: number): void {
    const o = 312 + line * 4;
    this.data[o] = start;
    this.data[o + 1] = end;
    this.data[o + 2] = 0;
    this.data[o + 3] = 0;
  }
}

export const TWO_PI = 6.283185307179586;
