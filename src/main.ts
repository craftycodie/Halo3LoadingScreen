import { LoadingScreenRenderer } from './renderer';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const hintEl = document.getElementById('hint') as HTMLDivElement;
const escHintEl = document.getElementById('esc-hint') as HTMLDivElement;
const hudEl = document.getElementById('hud') as HTMLDivElement;
const eggEl = document.getElementById('egg') as HTMLInputElement;
const loopEl = document.getElementById('loop') as HTMLInputElement;
const pauseEl = document.getElementById('pause') as HTMLInputElement;
const freecamEl = document.getElementById('freecam') as HTMLInputElement;
const hdEl = document.getElementById('hd') as HTMLInputElement;
const loadEl = document.getElementById('loadSeconds') as HTMLInputElement;
const restartEl = document.getElementById('restart') as HTMLButtonElement;

const renderer = new LoadingScreenRenderer();
(window as unknown as { __ls: LoadingScreenRenderer }).__ls = renderer;

const keys = new Set<string>();

// Menu stays locked until the first ring join reveal finishes (or ?hud=1).
let controlsUnlocked = false;
let hudOpen = false;
// When false (`?hud=0`), unlock after the ring but do not auto-open the menu.
let openHudOnUnlock = true;

function parseBool(value: string | null, fallback: boolean): boolean {
  if (value == null || value === '') return fallback;
  const v = value.toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return fallback;
}

function readUrlParams(): void {
  const p = new URLSearchParams(location.search);
  eggEl.checked = parseBool(p.get('egg'), false);
  loopEl.checked = parseBool(p.get('loop'), false);
  freecamEl.checked = parseBool(p.get('freecam'), false);
  hdEl.checked = parseBool(p.get('hd'), true);
  const load = Number(p.get('load'));
  loadEl.value = String(Number.isFinite(load) && load > 0 ? Math.floor(load) : 30);
  const hudParam = p.get('hud');
  if (hudParam != null && hudParam !== '') {
    const wantOpen = parseBool(hudParam, false);
    openHudOnUnlock = wantOpen;
    if (wantOpen) {
      controlsUnlocked = true;
      hudOpen = true;
    }
  }
  const speed = Number(p.get('speed'));
  if (Number.isFinite(speed) && speed > 0) {
    renderer.setMoveSpeed(speed);
  }
}

function writeUrlParams(): void {
  const p = new URLSearchParams();
  if (eggEl.checked) p.set('egg', '1');
  if (loopEl.checked) p.set('loop', '1');
  if (freecamEl.checked) p.set('freecam', '1');
  if (!hdEl.checked) p.set('hd', '0');
  p.set('load', String(Math.max(1, Math.floor(Number(loadEl.value) || 30))));
  if (controlsUnlocked) {
    p.set('hud', hudOpen ? '1' : '0');
  } else if (!openHudOnUnlock) {
    p.set('hud', '0');
  }
  if (Math.abs(renderer.moveSpeed - 4) > 0.05) {
    p.set('speed', renderer.moveSpeed.toFixed(2));
  }
  const qs = p.toString();
  const next = qs ? `${location.pathname}?${qs}` : location.pathname;
  if (`${location.pathname}${location.search}` !== next) {
    history.replaceState(null, '', next);
  }
}

function setHudOpen(open: boolean): void {
  if (!controlsUnlocked) {
    hudOpen = false;
    hudEl.classList.remove('open');
    return;
  }
  hudOpen = open;
  openHudOnUnlock = open;
  hudEl.classList.toggle('open', hudOpen);
  writeUrlParams();
  updateHint();
}

function unlockControls(): void {
  if (controlsUnlocked) return;
  controlsUnlocked = true;
  setHudOpen(openHudOnUnlock);
}

function updateHint(): void {
  if (controlsUnlocked && hudOpen) {
    escHintEl.textContent = 'Esc hide controls';
    escHintEl.classList.add('visible');
  } else {
    escHintEl.textContent = '';
    escHintEl.classList.remove('visible');
  }
  hintEl.textContent = freecamEl.checked
    ? `Freecam · speed ${renderer.moveSpeed.toFixed(1)} · WASD · Q/E · Shift · scroll`
    : '';
}

function applyHudToRenderer(): void {
  renderer.eggActive = eggEl.checked;
  renderer.loop = loopEl.checked;
  const seconds = Number(loadEl.value);
  renderer.loadSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 30;
  renderer.hd = hdEl.checked;
  renderer.setFreecam(freecamEl.checked);
  canvas.classList.toggle('freecam', freecamEl.checked);
  writeUrlParams();
  updateHint();
}

async function main(): Promise<void> {
  try {
    await renderer.init(canvas);
    statusEl.textContent = '';
  } catch (err) {
    statusEl.textContent =
      err instanceof Error ? err.message : String(err);
    return;
  }

  readUrlParams();
  applyHudToRenderer();
  setHudOpen(hudOpen);

  eggEl.addEventListener('change', applyHudToRenderer);
  loopEl.addEventListener('change', applyHudToRenderer);
  freecamEl.addEventListener('change', () => {
    applyHudToRenderer();
    if (!freecamEl.checked && document.pointerLockElement === canvas) {
      document.exitPointerLock();
    }
  });
  hdEl.addEventListener('change', applyHudToRenderer);
  loadEl.addEventListener('change', applyHudToRenderer);
  restartEl.addEventListener('click', () => {
    applyHudToRenderer();
    renderer.restart();
  });

  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code !== 'Escape') return;

    if (document.pointerLockElement === canvas) {
      document.exitPointerLock();
      return;
    }
    if (controlsUnlocked) {
      setHudOpen(!hudOpen);
    }
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
  });

  canvas.addEventListener('click', () => {
    if (freecamEl.checked && document.pointerLockElement !== canvas) {
      void canvas.requestPointerLock();
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas || !freecamEl.checked) return;
    renderer.applyLook(e.movementX, e.movementY);
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!freecamEl.checked) return;
      e.preventDefault();
      renderer.adjustSpeed(e.deltaY);
      writeUrlParams();
      updateHint();
    },
    { passive: false },
  );

  // Offset so progress freezes while Pause is checked.
  let pauseOffsetMs = 0;
  let pausedAtMs = 0;
  let wasPaused = false;

  let lastT = performance.now();
  const tick = (t: number) => {
    const dt = Math.min(0.1, (t - lastT) * 0.001);
    lastT = t;

    const paused = pauseEl.checked;
    if (paused && !wasPaused) {
      pausedAtMs = t;
    } else if (!paused && wasPaused) {
      pauseOffsetMs += t - pausedAtMs;
    }
    wasPaused = paused;

    const simNow = paused ? pausedAtMs - pauseOffsetMs : t - pauseOffsetMs;
    renderer.setKeys(keys);
    renderer.frame(simNow, dt);
    if (!controlsUnlocked && renderer.firstPlayComplete) {
      unlockControls();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

void main();
