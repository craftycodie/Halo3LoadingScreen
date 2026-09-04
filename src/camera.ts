function pin(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

interface Track {
  keys: Float32Array;
  keyCount: number;
}

const TRACK_THETA = new Float32Array([0.0, 0.34906584, 0.5, 1.4835298, 1.0, 2.7925267, 1000.0, 2443.4609]);
const TRACK_RADIUS = new Float32Array([0.0, 4.0, 0.5, 4.5, 1.0, 3.5, 1000.0, 3.5]);
const TRACK_HEIGHT = new Float32Array([0.0, -0.1, 0.3, 0.2, 0.5, 0.4, 1.0, 0.4, 1000.0, 0.4]);
const TRACK_LOOK_THETA = new Float32Array([0.0, 0.0, 1.0, 3.1415927, 1000.0, 3141.5925]);
const TRACK_LOOK_RADIUS = new Float32Array([0.0, 4.0, 0.275, 3.5, 0.4, 3.0, 1.0, 4.0, 1000.0, 4.0]);
const TRACK_LOOK_HEIGHT = new Float32Array([0.0, 0.0, 1.0, 0.0, 1000.0, 0.0]);
const TRACK_INTENSITY = new Float32Array([0.0, 0.0, 0.05, 1.0, 0.98, 1.0, 1.0, 1.0, 1000.0, 0.0]);
const TRACK_FADE_A = new Float32Array([0.0, 0.0, 0.2, 0.0, 0.4, 0.4, 0.98, 0.4, 1.0, 0.4, 1000.0, 0.0]);
const TRACK_FADE_B = new Float32Array([0.0, 1.0, 0.05, 0.7, 0.1, 0.0, 1000.0, 0.0]);

const TRACKS: Track[] = [
  { keys: TRACK_THETA, keyCount: TRACK_THETA.length / 2 },
  { keys: TRACK_RADIUS, keyCount: TRACK_RADIUS.length / 2 },
  { keys: TRACK_HEIGHT, keyCount: TRACK_HEIGHT.length / 2 },
  { keys: TRACK_LOOK_THETA, keyCount: TRACK_LOOK_THETA.length / 2 },
  { keys: TRACK_LOOK_RADIUS, keyCount: TRACK_LOOK_RADIUS.length / 2 },
  { keys: TRACK_LOOK_HEIGHT, keyCount: TRACK_LOOK_HEIGHT.length / 2 },
  { keys: TRACK_INTENSITY, keyCount: TRACK_INTENSITY.length / 2 },
  { keys: TRACK_FADE_A, keyCount: TRACK_FADE_A.length / 2 },
  { keys: TRACK_FADE_B, keyCount: TRACK_FADE_B.length / 2 },
];

function evalTrack(track: Track, t: number): number {
  t = t < 0.0 ? 0.0 : t;
  let index = 1;
  while (index < track.keyCount && track.keys[index * 2]! < t) {
    index++;
  }
  if (index >= track.keyCount) {
    index = track.keyCount - 1;
  }
  const t0 = track.keys[(index - 1) * 2]!;
  const v0 = track.keys[(index - 1) * 2 + 1]!;
  const t1 = track.keys[index * 2]!;
  const v1 = track.keys[index * 2 + 1]!;
  const denom = t1 - t0;
  if (Math.abs(denom) < 0.00001) {
    return v1;
  }
  return ((t - t0) / denom) * (v1 - v0) + v0;
}

export interface CameraEval {
  position: [number, number, number];
  lookAt: [number, number, number];
  intensity: number;
  fadeA: number;
  fadeB: number;
}

export function evalCamera(
  cameraT: number,
  progressT: number,
  eggActive: boolean,
): CameraEval {
  cameraT = pin(cameraT, 0.0, 1000.0);
  progressT = pin(progressT, 0.0, 1000.0);

  let theta =
    0.5 *
    (evalTrack(TRACKS[0]!, cameraT + 0.1) + evalTrack(TRACKS[0]!, cameraT - 0.1));
  let radius =
    0.5 *
    (evalTrack(TRACKS[1]!, cameraT + 0.1) + evalTrack(TRACKS[1]!, cameraT - 0.1));
  const height =
    0.5 *
    (evalTrack(TRACKS[2]!, cameraT + 0.1) + evalTrack(TRACKS[2]!, cameraT - 0.1));
  const lookTheta =
    0.5 *
    (evalTrack(TRACKS[3]!, cameraT + 0.1) + evalTrack(TRACKS[3]!, cameraT - 0.1));
  const lookRadius =
    0.5 *
    (evalTrack(TRACKS[4]!, cameraT + 0.1) + evalTrack(TRACKS[4]!, cameraT - 0.1));
  const lookHeight =
    0.5 *
    (evalTrack(TRACKS[5]!, cameraT - 0.1) + evalTrack(TRACKS[5]!, cameraT + 0.1));

  if (eggActive) {
    radius += 1.0;
  }

  return {
    position: [Math.cos(theta) * radius, height, Math.sin(theta) * radius],
    lookAt: [
      Math.cos(lookTheta) * lookRadius,
      lookHeight,
      Math.sin(lookTheta) * lookRadius,
    ],
    intensity: evalTrack(TRACKS[6]!, progressT),
    fadeA: evalTrack(TRACKS[7]!, progressT),
    fadeB: evalTrack(TRACKS[8]!, progressT),
  };
}

// Row-major world-view-projection.
export function buildWvp(
  position: [number, number, number],
  lookAt: [number, number, number],
  aspect: number,
  out: Float32Array,
): void {
  let fi = lookAt[0] - position[0];
  let fj = lookAt[1] - position[1];
  let fk = lookAt[2] - position[2];
  let flen = Math.sqrt(fi * fi + fj * fj + fk * fk);
  if (flen < 0.0001) {
    fi = 0;
    fj = 0;
    fk = 1;
    flen = 1;
  }
  fi /= flen;
  fj /= flen;
  fk /= flen;

  let ui = 0;
  let uj = 1;
  let uk = 0;
  let ri = uj * fk - uk * fj;
  let rj = uk * fi - ui * fk;
  let rk = ui * fj - uj * fi;
  let rlen = Math.sqrt(ri * ri + rj * rj + rk * rk);
  if (rlen < 0.0001) {
    ri = 1;
    rj = 0;
    rk = 0;
    rlen = 1;
  }
  ri /= rlen;
  rj /= rlen;
  rk /= rlen;

  ui = fj * rk - fk * rj;
  uj = fk * ri - fi * rk;
  uk = fi * rj - fj * ri;

  const view = new Float32Array([
    ri, ui, fi, 0.0,
    rj, uj, fj, 0.0,
    rk, uk, fk, 0.0,
    -(ri * position[0] + rj * position[1] + rk * position[2]),
    -(ui * position[0] + uj * position[1] + uk * position[2]),
    -(fi * position[0] + fj * position[1] + fk * position[2]),
    1.0,
  ]);

  const halfFov = 0.52359879;
  const s = 1.0 / Math.tan(halfFov);
  const zn = 0.01;
  const zf = 100.0;
  const proj = new Float32Array([
    s / aspect, 0.0, 0.0, 0.0,
    0.0, s, 0.0, 0.0,
    0.0, 0.0, zf / (zf - zn), 1.0,
    0.0, 0.0, (-zn * zf) / (zf - zn), 0.0,
  ]);

  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0.0;
      for (let k = 0; k < 4; k++) {
        sum += view[r * 4 + k]! * proj[k * 4 + c]!;
      }
      out[r * 4 + c] = sum;
    }
  }
}
