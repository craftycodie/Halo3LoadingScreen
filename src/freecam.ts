export interface FreeCamState {
  enabled: boolean;
  position: [number, number, number];
  yaw: number;
  pitch: number;
  moveSpeed: number;
  lookSpeed: number;
}

export function createFreeCam(): FreeCamState {
  return {
    enabled: false,
    position: [5, 0.5, 0],
    yaw: Math.PI,
    pitch: -0.15,
    moveSpeed: 4.0,
    lookSpeed: 0.0025,
  };
}

export function freeCamLookAt(cam: FreeCamState): [number, number, number] {
  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const fx = sy * cp;
  const fy = sp;
  const fz = -cy * cp;
  return [
    cam.position[0] + fx,
    cam.position[1] + fy,
    cam.position[2] + fz,
  ];
}

export function syncFreeCamFromTrack(
  cam: FreeCamState,
  position: [number, number, number],
  lookAt: [number, number, number],
): void {
  cam.position = [position[0], position[1], position[2]];
  const dx = lookAt[0] - position[0];
  const dy = lookAt[1] - position[1];
  const dz = lookAt[2] - position[2];
  cam.yaw = Math.atan2(dx, -dz);
  const horiz = Math.sqrt(dx * dx + dz * dz);
  cam.pitch = Math.atan2(dy, Math.max(horiz, 1e-6));
}

// Returns true if any movement key is held.
export function updateFreeCam(
  cam: FreeCamState,
  keys: Set<string>,
  dt: number,
): void {
  if (!cam.enabled) return;

  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  const fx = sy * cp;
  const fy = sp;
  const fz = -cy * cp;
  const rx = cy;
  const rz = sy;

  let mx = 0;
  let my = 0;
  let mz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) {
    mx += fx;
    my += fy;
    mz += fz;
  }
  if (keys.has('KeyS') || keys.has('ArrowDown')) {
    mx -= fx;
    my -= fy;
    mz -= fz;
  }
  if (keys.has('KeyA') || keys.has('ArrowLeft')) {
    mx += rx;
    mz += rz;
  }
  if (keys.has('KeyD') || keys.has('ArrowRight')) {
    mx -= rx;
    mz -= rz;
  }
  if (keys.has('KeyE') || keys.has('Space')) my += 1;
  if (keys.has('KeyQ') || keys.has('ControlLeft') || keys.has('ControlRight')) my -= 1;

  const len = Math.sqrt(mx * mx + my * my + mz * mz);
  if (len > 1e-6) {
    const speed = cam.moveSpeed * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3 : 1);
    const s = (speed * dt) / len;
    cam.position[0] += mx * s;
    cam.position[1] += my * s;
    cam.position[2] += mz * s;
  }
}

export function applyFreeCamLook(cam: FreeCamState, dx: number, dy: number): void {
  if (!cam.enabled) return;
  cam.yaw -= dx * cam.lookSpeed;
  cam.pitch -= dy * cam.lookSpeed;
  const lim = Math.PI * 0.49;
  cam.pitch = Math.max(-lim, Math.min(lim, cam.pitch));
}

export function adjustFreeCamSpeed(cam: FreeCamState, wheelDeltaY: number): void {
  if (!cam.enabled) return;
  const factor = wheelDeltaY < 0 ? 1.1 : 1 / 1.1;
  cam.moveSpeed = Math.max(0.25, Math.min(80, cam.moveSpeed * factor));
}
