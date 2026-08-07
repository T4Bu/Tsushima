import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  COMPOUND_PLAN,
  COMPOUND_SITE,
  FEET_TO_METERS,
  planToLocal,
  planToWorld,
} from './site-layout.js';

const UP = new THREE.Vector3(0, 1, 0);

function safeHeight(heightAt, x, z) {
  const value = heightAt?.(x, z);
  return Number.isFinite(value) ? value : 0;
}

function rectangleZ(rectangle) {
  return rectangle.z ?? rectangle.y ?? 0;
}

function sampleTerraceHeight(heightAt, rectangle) {
  const z = rectangleZ(rectangle);
  let highest = -Infinity;
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const planX = rectangle.x + rectangle.width * column * 0.5;
      const planZ = z + rectangle.depth * row * 0.5;
      const world = planToWorld(planX, planZ);
      highest = Math.max(highest, safeHeight(heightAt, world.x, world.z));
    }
  }
  return Number.isFinite(highest) ? highest : 0;
}

function paletteColor(palette, key, fallback) {
  const value = palette?.[key] ?? fallback;
  return value?.isColor ? value.clone() : new THREE.Color(value);
}

function makeExteriorMicrograinTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = '#dedbd2';
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Neutral cross-grain gives cloth, honed stone, and oiled timber a close
  // response without forcing one material's distinctive pattern onto another.
  for (let y = 1; y < canvas.height; y += 3) {
    context.fillStyle = y % 9 === 1 ? 'rgba(255,255,255,.055)' : 'rgba(42,48,45,.035)';
    context.fillRect(0, y, canvas.width, 1);
  }
  for (let x = 2; x < canvas.width; x += 5) {
    context.fillStyle = x % 15 === 2 ? 'rgba(255,255,255,.035)' : 'rgba(47,43,37,.025)';
    context.fillRect(x, 0, 1, canvas.height);
  }

  let state = 0x54a1_87cd;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let index = 0; index < 620; index += 1) {
    const light = random() > 0.54;
    context.fillStyle = light ? 'rgba(255,255,255,.045)' : 'rgba(34,39,36,.038)';
    context.fillRect(
      Math.floor(random() * canvas.width),
      Math.floor(random() * canvas.height),
      1 + Math.floor(random() * 2),
      1,
    );
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'Exterior living neutral micrograin';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.MirroredRepeatWrapping;
  texture.wrapT = THREE.MirroredRepeatWrapping;
  texture.repeat.set(3, 3);
  texture.anisotropy = 4;
  return texture;
}

function createInstancedMesh(name, geometry, material, entries, options = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
  mesh.name = name;
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  for (let index = 0; index < entries.length; index += 1) {
    mesh.setMatrixAt(index, entries[index].matrix);
    mesh.setColorAt(index, entries[index].color);
  }
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/**
 * Adds the small-scale occupation missing from the primary pool-court views.
 * Primary slabs, furniture footprints, and collision remain owned by the
 * architecture layer; this overlay articulates them with rounded pads, a
 * working outdoor kitchen, pool ladder, towels, and table accessories.
 */
export function createCompoundExteriorLiving({ heightAt, palette = {} } = {}) {
  const root = new THREE.Group();
  root.name = 'Compound exterior living-detail overlay';
  root.position.set(COMPOUND_SITE.centerX, 0, COMPOUND_SITE.centerZ);
  root.rotation.y = COMPOUND_SITE.yaw;
  root.userData.coordinateSystem = 'plan-aligned local metres; absolute world elevation';

  const mainBase = sampleTerraceHeight(heightAt, COMPOUND_PLAN.mainHouse);
  const sand = new THREE.Color(0xd0bea3);
  const sandShadow = new THREE.Color(0xa18b70);
  const towel = new THREE.Color(0xe3ded1);
  const cedar = new THREE.Color(0x9e643d);
  const stone = new THREE.Color(0xd7d2c4);
  const charcoal = paletteColor(palette, 'shadowTeal', 0x172523)
    .lerp(new THREE.Color(0x414744), 0.28);
  const steel = paletteColor(palette, 'stone', 0x747c76)
    .lerp(new THREE.Color(0xb3bab2), 0.36);
  const crimson = paletteColor(palette, 'crimsonDark', 0x7e2529)
    .lerp(new THREE.Color(0xd14a38), 0.22);

  const tactileEntries = [];
  const equipmentEntries = [];
  const rodEntries = [];
  const torusEntries = [];

  const addRoundedLocal = (
    target,
    x,
    z,
    y,
    width,
    height,
    depth,
    color,
    rotationX = 0,
    rotationY = 0,
    rotationZ = 0,
  ) => {
    const matrix = new THREE.Matrix4();
    matrix.compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rotationX, rotationY, rotationZ, 'XYZ'),
      ),
      new THREE.Vector3(width, height, depth),
    );
    target.push({ matrix, color });
  };

  const addRounded = (target, planX, planZ, ...args) => {
    const local = planToLocal(planX, planZ);
    addRoundedLocal(target, local.x, local.z, ...args);
  };

  const addRodLocal = (start, end, diameter, color) => {
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length < 0.0001) return;
    const matrix = new THREE.Matrix4();
    matrix.compose(
      start.clone().add(end).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize()),
      new THREE.Vector3(diameter, length, diameter),
    );
    rodEntries.push({ matrix, color });
  };

  const addRod = (fromX, fromZ, fromY, toX, toZ, toY, diameter, color) => {
    const start = planToLocal(fromX, fromZ);
    const end = planToLocal(toX, toZ);
    addRodLocal(
      new THREE.Vector3(start.x, fromY, start.z),
      new THREE.Vector3(end.x, toY, end.z),
      diameter,
      color,
    );
  };

  const addTorus = (planX, planZ, y, scale, color, rotationY = 0) => {
    const local = planToLocal(planX, planZ);
    const matrix = new THREE.Matrix4();
    matrix.compose(
      new THREE.Vector3(local.x, y, local.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0)),
      new THREE.Vector3(scale, scale, scale),
    );
    torusEntries.push({ matrix, color });
  };

  // Rounded pads, head rests, loose cushions, and folded towels refine the
  // three established slab loungers without changing their footprints.
  for (const [index, planX, planZ] of [
    [0, 45, 59.9],
    [1, 49, 59.9],
    [2, 93, 61],
  ]) {
    const yaw = -0.08;
    addRounded(
      tactileEntries,
      planX,
      planZ + 0.18,
      mainBase + 0.445,
      0.66,
      0.105,
      1.05,
      index === 1 ? sandShadow.clone().lerp(sand, 0.72) : sand,
      0,
      yaw,
    );
    addRounded(
      tactileEntries,
      planX,
      planZ - 1.55,
      mainBase + 0.535,
      0.66,
      0.12,
      0.52,
      sandShadow.clone().lerp(sand, 0.80),
      -0.24,
      yaw,
    );
    addRounded(
      tactileEntries,
      planX + 0.08,
      planZ - 1.72,
      mainBase + 0.625,
      0.46,
      0.12,
      0.28,
      index === 2 ? crimson : towel,
      -0.18,
      yaw,
    );
    if (index < 2) {
      addRounded(
        tactileEntries,
        planX - 0.12,
        planZ + 0.65,
        mainBase + 0.525,
        0.44,
        0.075,
        0.35,
        index === 0 ? towel : crimson.clone().lerp(towel, 0.25),
        0,
        yaw + 0.04,
      );
    }
  }

  // A compact side table between the paired loungers carries two cups and a
  // low lantern, providing a human scale cue in the courtyard hero shots.
  addRounded(equipmentEntries, 47.05, 61.2, mainBase + 0.285, 0.52, 0.11, 0.52, charcoal);
  addRod(47.05, 61.2, mainBase + 0.06, 47.05, 61.2, mainBase + 0.25, 0.075, charcoal);
  for (const [x, z] of [[46.75, 61.05], [47.18, 61.04]]) {
    addRod(x, z, mainBase + 0.35, x, z, mainBase + 0.48, 0.075, steel);
  }
  addRounded(equipmentEntries, 47.32, 61.35, mainBase + 0.40, 0.17, 0.25, 0.17, crimson);

  // A twelve-foot outdoor-kitchen run occupies the planned west pool-deck
  // niche. Individual cabinet fronts, stone counter, inset sink, grill lid,
  // control knobs, and timber prep board keep it from reading as a monolith.
  const kitchenX = 42.45;
  const moduleZs = [66.5, 68.9, 71.3, 73.7];
  for (const [index, planZ] of moduleZs.entries()) {
    addRounded(
      equipmentEntries,
      kitchenX,
      planZ,
      mainBase + 0.47,
      0.68,
      0.82,
      0.68,
      charcoal,
    );
    addRounded(
      tactileEntries,
      kitchenX + 1.13,
      planZ,
      mainBase + 0.48,
      0.035,
      0.63,
      0.52,
      index === 2 ? charcoal : cedar,
    );
    addRod(
      kitchenX + 1.20,
      planZ - 0.45,
      mainBase + 0.51,
      kitchenX + 1.20,
      planZ + 0.45,
      mainBase + 0.51,
      0.026,
      steel,
    );
  }
  addRounded(
    tactileEntries,
    kitchenX,
    70.1,
    mainBase + 0.925,
    0.82,
    0.085,
    3.72,
    stone,
  );
  addRounded(tactileEntries, kitchenX, 67.0, mainBase + 0.977, 0.48, 0.026, 0.45, charcoal);
  addRounded(tactileEntries, kitchenX, 69.35, mainBase + 0.990, 0.56, 0.035, 0.42, cedar);
  addRounded(equipmentEntries, kitchenX, 72.65, mainBase + 1.10, 0.66, 0.30, 0.56, charcoal, -0.11);
  addRod(kitchenX - 0.72, 72.65, mainBase + 1.12, kitchenX + 0.72, 72.65, mainBase + 1.12, 0.038, steel);
  for (const planZ of [72.25, 72.52, 72.79, 73.06]) {
    addRod(kitchenX + 1.23, planZ, mainBase + 0.62, kitchenX + 1.31, planZ, mainBase + 0.62, 0.07, steel);
  }

  // The sink faucet uses the same half-torus vocabulary as the indoor island
  // but sits perpendicular to the long counter run.
  const faucetRadius = 0.19;
  addRod(
    kitchenX,
    66.38,
    mainBase + 0.96,
    kitchenX,
    66.38,
    mainBase + 1.18,
    0.035,
    steel,
  );
  addRod(
    kitchenX,
    67.62,
    mainBase + 1.12,
    kitchenX,
    67.62,
    mainBase + 1.18,
    0.035,
    steel,
  );
  addTorus(kitchenX, 67.0, mainBase + 1.18, faucetRadius * 2, steel, Math.PI * 0.5);

  // Twin U-shaped rails and submerged treads turn the pool's east edge into a
  // usable basin. All parts stay within the existing coping/collider envelope.
  const ladderCenterX = 88.0;
  const ladderOuterX = ladderCenterX + 0.95;
  const ladderInnerX = ladderCenterX - 0.95;
  const ladderZs = [69.9, 71.7];
  for (const planZ of ladderZs) {
    addTorus(ladderCenterX, planZ, mainBase + 0.26, 0.58, steel);
    addRod(ladderOuterX, planZ, mainBase + 0.08, ladderOuterX, planZ, mainBase + 0.26, 0.04, steel);
    addRod(ladderInnerX, planZ, mainBase - 0.52, ladderInnerX, planZ, mainBase + 0.26, 0.04, steel);
  }
  for (const y of [-0.10, -0.29, -0.48]) {
    addRod(ladderInnerX, ladderZs[0], mainBase + y, ladderInnerX, ladderZs[1], mainBase + y, 0.04, steel);
  }

  const roundedGeometry = new RoundedBoxGeometry(1, 1, 1, 3, 0.12);
  roundedGeometry.name = 'Exterior living rounded unit box';
  const rodGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, false);
  rodGeometry.name = 'Exterior living round hardware unit';
  const torusGeometry = new THREE.TorusGeometry(0.5, 0.07, 10, 28, Math.PI);
  torusGeometry.name = 'Exterior living half torus';

  const micrograinTexture = makeExteriorMicrograinTexture();

  const tactileMaterial = new THREE.MeshStandardMaterial({
    name: 'Exterior tactile fabrics, stone, and timber',
    color: 0xffffff,
    map: micrograinTexture,
    roughness: 0.76,
    metalness: 0.02,
  });
  const equipmentMaterial = new THREE.MeshStandardMaterial({
    name: 'Exterior powder-coated equipment',
    color: 0xffffff,
    roughness: 0.46,
    metalness: 0.36,
  });
  const metalMaterial = new THREE.MeshStandardMaterial({
    name: 'Exterior brushed metal hardware',
    color: 0xffffff,
    roughness: 0.28,
    metalness: 0.82,
  });

  const meshes = [
    createInstancedMesh('Rounded pool-court fabrics and work surfaces', roundedGeometry, tactileMaterial, tactileEntries),
    createInstancedMesh('Rounded outdoor-kitchen and table equipment', roundedGeometry, equipmentMaterial, equipmentEntries),
    createInstancedMesh('Pool and outdoor-kitchen round hardware', rodGeometry, metalMaterial, rodEntries),
    createInstancedMesh('Curved pool rails and outdoor faucet', torusGeometry, metalMaterial, torusEntries),
  ];
  root.add(...meshes);

  const stats = Object.freeze({
    drawCalls: meshes.length,
    instances: tactileEntries.length + equipmentEntries.length + rodEntries.length + torusEntries.length,
    roundedTactileDetails: tactileEntries.length,
    roundedEquipmentDetails: equipmentEntries.length,
    metalHardwareDetails: rodEntries.length + torusEntries.length,
    poolLadderTreads: 3,
    outdoorKitchenModules: moduleZs.length,
    refinedLoungers: 3,
    textureMaps: 1,
    zones: Object.freeze(['pool-deck', 'outdoor-kitchen', 'lanai-edge']),
  });
  root.userData.stats = stats;

  function dispose() {
    root.removeFromParent();
    roundedGeometry.dispose();
    rodGeometry.dispose();
    torusGeometry.dispose();
    tactileMaterial.dispose();
    equipmentMaterial.dispose();
    metalMaterial.dispose();
    micrograinTexture.dispose();
  }

  return { root, stats, dispose };
}
