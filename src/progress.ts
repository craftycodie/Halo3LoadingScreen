export const SLICE_COUNT = 32;
export const BUILD_SAMPLES = 2048;
export const CAMERA_HISTORY = 90;

export interface RingState {
  started: boolean;
  startTimeMs: number;
  lastTimeMs: number;
  fadeStartMs: number;
  rawRemainder: number;
  firstRemainder: number;
  smoothedFrac: number;
  filteredFrac: number;
  velocity: number;
  elapsedSeconds: number;
  completeElapsed: number;
  cameraTickAccum: number;
  buildTimes: Float32Array;
  sliceA: Float32Array;
  sliceB: Float32Array;
  lineStarts: Float32Array; // 16*6
  lineEnds: Float32Array; // 16*6
  cameraHistory: Float32Array;
  cameraHistoryCursor: number;
}

function pin(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function createRingState(): RingState {
  const state: RingState = {
    started: false,
    startTimeMs: 0,
    lastTimeMs: 0,
    fadeStartMs: 0xffffffff,
    rawRemainder: 1.0,
    firstRemainder: 1.0,
    smoothedFrac: 0.0,
    filteredFrac: 0.0,
    velocity: 0.025,
    elapsedSeconds: 0.0,
    completeElapsed: -1.0,
    cameraTickAccum: 0.0,
    buildTimes: new Float32Array(BUILD_SAMPLES),
    sliceA: new Float32Array(SLICE_COUNT),
    sliceB: new Float32Array(SLICE_COUNT),
    lineStarts: new Float32Array(16 * 6),
    lineEnds: new Float32Array(16 * 6),
    cameraHistory: new Float32Array(CAMERA_HISTORY),
    cameraHistoryCursor: 0,
  };
  resetRingState(state);
  return state;
}

export function resetRingState(state: RingState): void {
  state.started = false;
  state.startTimeMs = 0;
  state.lastTimeMs = 0;
  state.fadeStartMs = 0xffffffff;
  state.rawRemainder = 1.0;
  state.firstRemainder = 1.0;
  state.smoothedFrac = 0.0;
  state.filteredFrac = 0.0;
  state.velocity = 0.025;
  state.elapsedSeconds = 0.0;
  state.completeElapsed = -1.0;
  state.cameraTickAccum = 0.0;
  state.cameraHistoryCursor = 0;
  state.cameraHistory.fill(0);
  state.buildTimes.fill(1000.0);
  state.sliceA.fill(1.0);
  state.sliceB.fill(0.0);

  // 82588CE0: 16 chained groups
  let rng = (Math.imul(1664525, 0xcafe) + 1013904223) >>> 0;
  for (let group = 0; group < 16; group++) {
    for (let line = 0; line < 6; line++) {
      rng = (Math.imul(1664525, rng) + 1013904223) >>> 0;
      const unit = (rng >>> 16) * 0.000015259022;
      const offset = (unit * 0.5 - 0.25) * 0.0625;
      const idx = group * 6 + line;
      if (group === 0) {
        state.lineStarts[idx] = 0.025;
        state.lineEnds[idx] = offset + 0.0875;
      } else {
        state.lineStarts[idx] = state.lineEnds[(group - 1) * 6 + line]!;
        state.lineEnds[idx] = state.lineStarts[idx]! + offset + 0.0625;
      }
    }
  }
}

function applyCameraFilter(state: RingState, sample: number): void {
  let filtered = 0.0;
  const start = state.cameraHistoryCursor + 89;
  for (let i = 0; i < CAMERA_HISTORY; i++) {
    const slot = (start - i) % CAMERA_HISTORY;
    filtered += slot * 0.022222223 * state.cameraHistory[i]!;
  }
  state.filteredFrac = filtered * 0.011111111;
  state.cameraHistory[state.cameraHistoryCursor] = sample;
  state.cameraHistoryCursor = (state.cameraHistoryCursor + 1) % CAMERA_HISTORY;
}

function stampBuildTimes(
  state: RingState,
  oldFrac: number,
  newFrac: number,
  elapsed: number,
): void {
  for (let i = 0; i < BUILD_SAMPLES; i++) {
    let param = i * 0.00048828125;
    if (param > 0.5) {
      param = 1.0 - i * 0.00048828125;
    }
    param *= 2.0;
    if (param >= oldFrac && param < newFrac) {
      state.buildTimes[i] = elapsed;
    }
  }
}

/** 82588960 progress update. */
export function updateProgress(
  state: RingState,
  remainder: number,
  nowMs: number,
  simulatedLoadSeconds: number,
): void {
  remainder = pin(remainder, 0.0, 1.0);
  if (simulatedLoadSeconds > 0.0) {
    const simulatedElapsed = state.started
      ? (nowMs - state.startTimeMs) * 0.001
      : 0.0;
    remainder = pin(1.0 - simulatedElapsed / simulatedLoadSeconds, 0.0, 1.0);
  }

  if (!state.started) {
    state.started = true;
    state.startTimeMs = nowMs;
    state.lastTimeMs = nowMs;
    state.rawRemainder = remainder;
    state.firstRemainder = remainder;
    state.smoothedFrac = 0.0;
    state.velocity = 0.025;
    state.elapsedSeconds = 0.0;
    state.completeElapsed = -1.0;
    state.cameraTickAccum = 0.0;
    applyCameraFilter(state, 0.0);
    return;
  }

  const elapsed = (nowMs - state.startTimeMs) * 0.001;
  let dt = (nowMs - state.lastTimeMs) * 0.001;
  if (dt < 0.0) dt = 0.0;

  state.rawRemainder = remainder;
  state.lastTimeMs = nowMs;
  state.elapsedSeconds = elapsed;

  const k30hz = 1.0 / 30.0;
  if (elapsed >= 0.25) {
    let dropped = state.firstRemainder - remainder;
    if (dropped < 0.1) dropped = 0.1;

    let ideal = 1.0;
    const estimated = (state.firstRemainder / dropped) * elapsed;
    if (estimated >= 0.0001) {
      ideal = (1.0 - state.smoothedFrac) / (estimated - elapsed);
    }

    let ticks = dt * 30.0;
    if (ticks < 0.0) ticks = 0.0;
    let velocity = state.velocity;
    if (velocity >= ideal) {
      velocity *= Math.pow(0.95, ticks);
      if (velocity < ideal) velocity = ideal;
    } else {
      velocity *= Math.pow(1.05, ticks);
      if (velocity > ideal) velocity = ideal;
    }
    state.velocity = pin(velocity, 0.0055555557, 0.16666667);
  }

  const oldFrac = state.smoothedFrac;
  state.smoothedFrac = oldFrac + state.velocity * dt;
  if (state.smoothedFrac < 0.0) state.smoothedFrac = 0.0;

  // 90-tap is 90 Xbox frames (3 s wall-clock). Emit one sample per 1/30 s so
  // display refresh rate does not change the camera lag window. Progress and
  // velocity already use real dt (render FPS-independent).
  state.cameraTickAccum += dt;
  while (state.cameraTickAccum >= k30hz * 0.9) {
    applyCameraFilter(state, state.smoothedFrac);
    state.cameraTickAccum -= k30hz;
    if (state.cameraTickAccum < 0.0) state.cameraTickAccum = 0.0;
  }

  stampBuildTimes(state, oldFrac, state.smoothedFrac, elapsed);

  if (state.smoothedFrac >= 1.0 && state.completeElapsed < 0.0) {
    state.completeElapsed = elapsed;
  }
}

/** Fade wait latching (Xbox fade-out). Browser demo skips this when not looping. */
export function updateFadeOut(state: RingState, nowMs: number): boolean {
  if (state.smoothedFrac < 0.9) {
    return false;
  }
  if (state.smoothedFrac < 1.0 && state.velocity < 0.16666667) {
    return false;
  }
  if (state.fadeStartMs === 0xffffffff) {
    state.fadeStartMs = nowMs;
  }
  if (state.smoothedFrac < 1.0 || state.completeElapsed < 0.0) {
    return false;
  }
  if (state.elapsedSeconds - state.completeElapsed < 2.0) {
    return false;
  }
  const fadeElapsed = (nowMs - state.fadeStartMs) * 0.001;
  return fadeElapsed >= 3.0;
}

/** debug_loading_screen_loop: reset 3s after frac crosses 1 (no fade dim). */
export function shouldLoopReset(state: RingState): boolean {
  if (state.completeElapsed < 0.0) {
    return false;
  }
  return state.elapsedSeconds - state.completeElapsed >= 3.0;
}

export function computeFade(state: RingState, nowMs: number): number {
  if (state.fadeStartMs === 0xffffffff) {
    return 1.0;
  }
  const fadeDt = (nowMs - state.fadeStartMs) * 0.000344827586;
  return pin(1.0 - fadeDt, 0.0, 1.0);
}
