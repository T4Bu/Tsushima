import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const wish = new THREE.Vector3();

export function createPlayerController(camera, domElement, options) {
  const {
    heightAt,
    colliders = [],
    start = new THREE.Vector3(0, 0, 92),
    lookAt = new THREE.Vector3(0, 2.2, 35),
    onLockChange = () => {},
    onPhotoMode = () => {},
  } = options;

  const keys = new Set();
  const velocity = new THREE.Vector3();
  const position = start.clone();
  const standingHeight = 1.72;
  let yaw = 0;
  let pitch = 0;
  let locked = false;
  let photoMode = false;
  let enabled = true;
  let walking = 0;

  camera.rotation.order = 'YXZ';

  function aimAt(target) {
    camera.position.copy(position);
    camera.lookAt(target);
    yaw = camera.rotation.y;
    pitch = camera.rotation.x;
  }

  position.y = heightAt(position.x, position.z) + standingHeight;
  aimAt(lookAt);

  function setLocked(next) {
    locked = next;
    if (!locked) keys.clear();
    onLockChange(locked);
  }

  function lock() {
    if (!enabled || photoMode || locked) return;
    try {
      const request = domElement.requestPointerLock?.();
      request?.catch?.(() => {
        // Embedded/automated browser documents may reject pointer lock even
        // though ordinary top-level browsers support it. The scene remains
        // usable and the next click can retry without an unhandled error.
      });
    } catch {
      // Pointer lock is an enhancement; keep the rendered biome available.
    }
  }

  function unlock() {
    if (document.pointerLockElement === domElement) document.exitPointerLock?.();
  }

  function onPointerLockChange() {
    setLocked(document.pointerLockElement === domElement);
  }

  function onMouseMove(event) {
    if (!locked || !enabled) return;
    yaw -= event.movementX * .00165;
    pitch -= event.movementY * .00145;
    pitch = THREE.MathUtils.clamp(pitch, -1.30, 1.22);
  }

  function onKeyDown(event) {
    if (event.code === 'KeyP' && !event.repeat) {
      photoMode = !photoMode;
      if (photoMode) unlock();
      onPhotoMode(photoMode);
      return;
    }
    if (event.code === 'KeyR' && !event.repeat) {
      teleport(start, lookAt);
      return;
    }
    keys.add(event.code);
  }

  function onKeyUp(event) {
    keys.delete(event.code);
  }

  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('mousemove', onMouseMove);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function resolveColliders(candidate) {
    for (const collider of colliders) {
      const c = collider.position ?? collider.center ?? collider;
      const radius = (collider.radius ?? 1) + .32;
      const dx = candidate.x - c.x;
      const dz = candidate.z - c.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 0 && d2 < radius * radius) {
        const distance = Math.sqrt(d2);
        candidate.x = c.x + (dx / distance) * radius;
        candidate.z = c.z + (dz / distance) * radius;
      }
    }
    candidate.x = THREE.MathUtils.clamp(candidate.x, -116, 116);
    candidate.z = THREE.MathUtils.clamp(candidate.z, -116, 116);
  }

  function update(delta, elapsed) {
    delta = Math.min(delta, .05);
    if (locked && enabled) {
      forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      right.crossVectors(forward, UP);
      wish.set(0, 0, 0);
      if (keys.has('KeyW') || keys.has('ArrowUp')) wish.add(forward);
      if (keys.has('KeyS') || keys.has('ArrowDown')) wish.sub(forward);
      if (keys.has('KeyD') || keys.has('ArrowRight')) wish.add(right);
      if (keys.has('KeyA') || keys.has('ArrowLeft')) wish.sub(right);
      if (wish.lengthSq() > 0) wish.normalize();

      const sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight');
      const targetSpeed = sprinting ? 10.8 : 5.2;
      const response = 1 - Math.exp(-delta * (wish.lengthSq() ? 10 : 6));
      velocity.x = THREE.MathUtils.lerp(velocity.x, wish.x * targetSpeed, response);
      velocity.z = THREE.MathUtils.lerp(velocity.z, wish.z * targetSpeed, response);

      const candidate = position.clone().addScaledVector(velocity, delta);
      resolveColliders(candidate);
      position.x = candidate.x;
      position.z = candidate.z;
      walking = THREE.MathUtils.lerp(walking, Math.min(1, velocity.length() / 5), 1 - Math.exp(-delta * 7));
    } else {
      velocity.multiplyScalar(Math.exp(-delta * 7));
      walking = THREE.MathUtils.lerp(walking, 0, 1 - Math.exp(-delta * 5));
    }

    const ground = heightAt(position.x, position.z) + standingHeight;
    position.y = THREE.MathUtils.lerp(position.y, ground, 1 - Math.exp(-delta * 14));
    const bob = locked ? Math.sin(elapsed * 9.6) * .025 * walking : 0;
    camera.position.set(position.x, position.y + bob, position.z);
    camera.rotation.set(pitch + Math.sin(elapsed * 4.8) * .0018 * walking, yaw, 0);
  }

  function teleport(nextPosition, target) {
    position.copy(nextPosition);
    position.y = heightAt(position.x, position.z) + standingHeight;
    velocity.set(0, 0, 0);
    if (target) aimAt(target);
    else camera.position.copy(position);
  }

  return {
    update,
    lock,
    unlock,
    teleport,
    position,
    get locked() { return locked; },
    get photoMode() { return photoMode; },
    set enabled(value) { enabled = Boolean(value); },
    dispose() {
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    },
  };
}
