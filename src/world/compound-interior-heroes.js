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

function makeWovenRugTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');

  context.fillStyle = '#6b4434';
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Fine deterministic warp and weft keep the rug tactile in the close
  // interior view without requiring another downloaded texture asset.
  for (let y = 0; y < canvas.height; y += 3) {
    context.fillStyle = y % 9 === 0 ? 'rgba(229, 190, 132, .12)' : 'rgba(28, 31, 28, .08)';
    context.fillRect(0, y, canvas.width, 1);
  }
  for (let x = 0; x < canvas.width; x += 4) {
    context.fillStyle = x % 16 === 0 ? 'rgba(236, 208, 159, .07)' : 'rgba(22, 28, 27, .045)';
    context.fillRect(x, 0, 1, canvas.height);
  }

  let randomState = 0x4a71_93d5;
  const random = () => {
    randomState = Math.imul(randomState ^ (randomState >>> 15), 1 | randomState);
    randomState ^= randomState + Math.imul(randomState ^ (randomState >>> 7), 61 | randomState);
    return ((randomState ^ (randomState >>> 14)) >>> 0) / 4294967296;
  };
  for (let index = 0; index < 1450; index += 1) {
    const light = random() > 0.52;
    context.fillStyle = light ? 'rgba(231, 195, 143, .09)' : 'rgba(22, 28, 27, .075)';
    context.fillRect(
      Math.floor(random() * canvas.width),
      Math.floor(random() * canvas.height),
      1 + Math.floor(random() * 3),
      1,
    );
  }

  context.strokeStyle = 'rgba(32, 38, 35, .52)';
  context.lineWidth = 7;
  context.strokeRect(14, 14, canvas.width - 28, canvas.height - 28);
  context.strokeStyle = 'rgba(213, 166, 105, .34)';
  context.lineWidth = 3;
  context.strokeRect(27, 27, canvas.width - 54, canvas.height - 54);
  context.lineWidth = 4;
  context.beginPath();
  for (let x = 48; x <= canvas.width - 48; x += 52) {
    context.moveTo(x - 18, canvas.height * 0.5);
    context.lineTo(x, canvas.height * 0.5 - 24);
    context.lineTo(x + 18, canvas.height * 0.5);
    context.lineTo(x, canvas.height * 0.5 + 24);
    context.closePath();
  }
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'Great-room handwoven rug texture';
  texture.colorSpace = THREE.SRGBColorSpace;
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
 * Adds a small, aggressively batched layer of close-range interior detail.
 * The established architecture supplies all primary forms; this layer only
 * rounds, textures, or articulates the objects nearest the proof cameras.
 */
export function createCompoundInteriorHeroes({ heightAt, palette = {} } = {}) {
  const root = new THREE.Group();
  root.name = 'Compound interior hero-detail overlay';
  root.position.set(COMPOUND_SITE.centerX, 0, COMPOUND_SITE.centerZ);
  root.rotation.y = COMPOUND_SITE.yaw;
  root.userData.coordinateSystem = 'plan-aligned local metres; absolute world elevation';

  const mainBase = sampleTerraceHeight(heightAt, COMPOUND_PLAN.mainHouse);
  const garageBase = sampleTerraceHeight(heightAt, COMPOUND_PLAN.garage);
  const fabBase = sampleTerraceHeight(heightAt, COMPOUND_PLAN.fabLab);

  const linen = new THREE.Color(0xc7ae86);
  const linenShadow = new THREE.Color(0x92785d);
  const tobacco = new THREE.Color(0x84513a);
  const timber = new THREE.Color(0x9a5f34);
  const charcoal = paletteColor(palette, 'shadowTeal', 0x172523).lerp(new THREE.Color(0x353936), 0.24);
  const steel = paletteColor(palette, 'stone', 0x68706b).lerp(new THREE.Color(0x9aa29a), 0.28);
  const brass = new THREE.Color(0x9e7141);
  const signalRed = paletteColor(palette, 'crimsonDark', 0x87252a).lerp(new THREE.Color(0xd14a32), 0.28);

  const roundedEntries = [];
  const rodEntries = [];
  const torusEntries = [];
  const pendantEntries = [];

  const addRoundedLocal = (
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
    roundedEntries.push({ matrix, color });
  };

  const addRounded = (planX, planZ, ...args) => {
    const local = planToLocal(planX, planZ);
    addRoundedLocal(local.x, local.z, ...args);
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

  const addCylinder = (planX, planZ, y, diameter, height, color) => {
    addRod(planX, planZ, y - height * 0.5, planX, planZ, y + height * 0.5, diameter, color);
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

  const addPendant = (planX, planZ, y, scale, color) => {
    const local = planToLocal(planX, planZ);
    const matrix = new THREE.Matrix4();
    matrix.compose(
      new THREE.Vector3(local.x, y, local.z),
      new THREE.Quaternion(),
      new THREE.Vector3(scale, scale, scale),
    );
    pendantEntries.push({ matrix, color });
  };

  // Great-room upholstery: thin rounded caps and loose cushions sit directly
  // on the existing sofa blocks, replacing their hard top silhouette without
  // duplicating the established footprint.
  const mainSofaCenter = planToLocal(72.5, 35.3);
  const mainSofaWidth = 9.5 * FEET_TO_METERS;
  const mainCushionWidth = (mainSofaWidth - 0.36 - 0.07) / 3;
  for (let index = 0; index < 3; index += 1) {
    const along = -mainSofaWidth * 0.5 + 0.18 + mainCushionWidth * 0.5
      + index * (mainCushionWidth + 0.035);
    addRoundedLocal(
      mainSofaCenter.x + along,
      mainSofaCenter.z + 0.07,
      mainBase + 0.535,
      mainCushionWidth - 0.025,
      0.095,
      0.64,
      index === 1 ? linen : linenShadow.clone().lerp(linen, 0.72),
    );
  }
  addRounded(71.5, 34.78, mainBase + 0.73, 0.42, 0.40, 0.14, tobacco, -0.08, 0.08, 0.04);
  addRounded(73.6, 34.80, mainBase + 0.72, 0.39, 0.37, 0.14, linenShadow, -0.06, -0.1, -0.03);

  const sideSofaCenter = planToLocal(79.8, 37.4);
  const sideSofaWidth = 6.2 * FEET_TO_METERS;
  const sideCushionWidth = (sideSofaWidth - 0.36 - 0.035) / 2;
  for (let index = 0; index < 2; index += 1) {
    const along = -sideSofaWidth * 0.5 + 0.18 + sideCushionWidth * 0.5
      + index * (sideCushionWidth + 0.035);
    addRoundedLocal(
      sideSofaCenter.x - 0.07,
      sideSofaCenter.z + along,
      mainBase + 0.535,
      sideCushionWidth - 0.025,
      0.095,
      0.64,
      linenShadow.clone().lerp(linen, 0.74),
      0,
      -Math.PI * 0.5,
    );
  }

  // A rounded timber cap and a restrained tray give the coffee table a finer
  // edge highlight. Both remain within its existing plan footprint.
  addRounded(71.4, 38.3, mainBase + 0.465, 1.30, 0.075, 0.63, timber);
  addRounded(71.15, 38.27, mainBase + 0.515, 0.44, 0.035, 0.28, charcoal, 0, 0.05, 0);
  addCylinder(71.53, 38.28, mainBase + 0.55, 0.27, 0.07, steel);

  // Kitchen sink/faucet: a dark inset hides the block-model seam while a
  // half torus and two short rods create a proper gooseneck silhouette.
  addRounded(36.2, 36.55, mainBase + 1.005, 0.46, 0.026, 0.34, charcoal);
  addRounded(36.2, 36.55, mainBase + 1.021, 0.35, 0.015, 0.235, new THREE.Color(0x101817));
  const faucetCenter = planToLocal(36.2, 36.55);
  const faucetRadius = 0.19;
  addRodLocal(
    new THREE.Vector3(faucetCenter.x, mainBase + 1.02, faucetCenter.z - faucetRadius),
    new THREE.Vector3(faucetCenter.x, mainBase + 1.24, faucetCenter.z - faucetRadius),
    0.035,
    steel,
  );
  addRodLocal(
    new THREE.Vector3(faucetCenter.x, mainBase + 1.18, faucetCenter.z + faucetRadius),
    new THREE.Vector3(faucetCenter.x, mainBase + 1.24, faucetCenter.z + faucetRadius),
    0.035,
    steel,
  );
  addTorus(36.2, 36.55, mainBase + 1.24, faucetRadius * 2, steel, Math.PI * 0.5);
  addRod(36.55, 36.38, mainBase + 1.04, 36.55, 36.38, mainBase + 1.18, 0.025, steel);

  // Two warm island pendants sit above the rear third of the worktop so the
  // clear aisle between kitchen and dining remains visually unobstructed.
  for (const planX of [33.15, 36.25]) {
    addRod(planX, 36.55, mainBase + 2.47, planX, 36.55, mainBase + 2.86, 0.018, charcoal);
    addPendant(planX, 36.55, mainBase + 2.38, 0.46, brass);
  }

  // Garage door hardware: round torsion shafts, opener rails, and drums sit
  // over the existing rectangular tracks. Cabinet and drawer pulls remain
  // tight to their current faces and never project into the three bay lanes.
  for (const centerZ of [95, 106, 117]) {
    addRod(39.18, centerZ - 4.0, garageBase + 2.62, 39.18, centerZ + 4.0, garageBase + 2.62, 0.055, steel);
    // A thicker central spring barrel and paired collars remain readable from
    // the motor-court proof view, where a bare thin shaft disappears.
    addRod(39.17, centerZ - 1.05, garageBase + 2.62, 39.17, centerZ + 1.05, garageBase + 2.62, 0.105, charcoal);
    for (const collarOffset of [-1.13, 1.13]) {
      addRounded(39.14, centerZ + collarOffset, garageBase + 2.62, 0.12, 0.14, 0.12, steel);
    }
    addRod(31.9, centerZ, garageBase + 2.70, 38.9, centerZ, garageBase + 2.70, 0.038, charcoal);
    addRounded(31.9, centerZ, garageBase + 2.70, 0.43, 0.205, 0.32, charcoal);
    for (const offsetFeet of [-3.72, 3.72]) {
      addRod(
        39.18,
        centerZ + offsetFeet - 0.26,
        garageBase + 2.62,
        39.18,
        centerZ + offsetFeet + 0.26,
        garageBase + 2.62,
        0.17,
        charcoal,
      );
    }
    for (const edgeOffset of [-4.03, 4.03]) {
      for (const rollerY of [1.16, 1.84, 2.47]) {
        addRod(
          38.98,
          centerZ + edgeOffset,
          garageBase + rollerY,
          39.34,
          centerZ + edgeOffset,
          garageBase + rollerY,
          0.11,
          steel,
        );
      }
    }
  }
  for (const cabinetZ of [92.84, 95.34, 97.84]) {
    addCylinder(18.49, cabinetZ, garageBase + 1.13, 0.04, 0.30, brass);
  }
  for (const drawerZ of [101.2, 103.1, 105.0, 106.9, 108.8, 110.7]) {
    addRod(
      18.49,
      drawerZ - 0.34,
      garageBase + 0.56,
      18.49,
      drawerZ + 0.34,
      garageBase + 0.56,
      0.032,
      brass,
    );
  }

  // Fab-lab machine: a rounded carriage, linear guide, spindle, collet, and
  // bed clamps make the existing enclosure read as a CNC rather than shelving.
  addRounded(123.1, 19.93, fabBase + 1.24, 0.27, 0.38, 0.17, tobacco);
  addRounded(125.55, 20.04, fabBase + 1.28, 0.23, 0.30, 0.055, charcoal);
  addRounded(125.55, 20.07, fabBase + 1.30, 0.15, 0.15, 0.025, new THREE.Color(0x345e56));
  addRod(120.9, 19.91, fabBase + 1.40, 125.3, 19.91, fabBase + 1.40, 0.045, steel);
  addCylinder(123.1, 19.92, fabBase + 1.04, 0.10, 0.42, steel);
  addCylinder(123.1, 19.92, fabBase + 0.80, 0.035, 0.16, charcoal);
  addRod(125.78, 20.11, fabBase + 1.27, 125.78, 20.30, fabBase + 1.27, 0.10, signalRed);
  for (const [x, z] of [[121.6, 17.85], [124.55, 17.85], [121.6, 18.95], [124.55, 18.95]]) {
    addRounded(x, z, fabBase + 0.875, 0.22, 0.10, 0.14, steel);
  }

  // Cylindrical handles and shaped heads enrich the wall tool silhouettes
  // while staying on the solid board well clear of its door at plan z=28.
  for (const [index, toolZ] of [22.15, 23.25, 24.55, 25.75].entries()) {
    addRod(
      114.43,
      toolZ,
      fabBase + 1.18,
      114.43,
      toolZ + (index % 2 ? 0.12 : -0.08),
      fabBase + 1.64,
      0.035,
      index === 2 ? tobacco : steel,
    );
    addRounded(
      114.46,
      toolZ + 0.27,
      fabBase + 1.69,
      0.075,
      0.085,
      index % 2 ? 0.30 : 0.24,
      index === 2 ? charcoal : steel,
      0,
      0,
      index % 2 ? 0.12 : -0.08,
    );
  }

  const roundedGeometry = new RoundedBoxGeometry(1, 1, 1, 3, 0.12);
  roundedGeometry.name = 'Interior hero rounded unit box';
  const rodGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, false);
  rodGeometry.name = 'Interior hero round hardware unit';
  const torusGeometry = new THREE.TorusGeometry(0.5, 0.07, 8, 24, Math.PI);
  torusGeometry.name = 'Interior hero half torus';
  const pendantGeometry = new THREE.CylinderGeometry(0.22, 0.5, 1, 16, 1, false);
  pendantGeometry.name = 'Interior hero pendant shade';

  const detailMaterial = new THREE.MeshStandardMaterial({
    name: 'Interior hero tactile surfaces',
    color: 0xffffff,
    roughness: 0.7,
    metalness: 0.04,
  });
  const metalMaterial = new THREE.MeshStandardMaterial({
    name: 'Interior hero dark and brushed hardware',
    color: 0xffffff,
    roughness: 0.38,
    metalness: 0.68,
  });
  const pendantMaterial = new THREE.MeshStandardMaterial({
    name: 'Interior hero warm pendant shades',
    color: 0xffffff,
    roughness: 0.48,
    metalness: 0.44,
    emissive: 0x3b2413,
    emissiveIntensity: 0.12,
    side: THREE.DoubleSide,
  });

  const meshes = [
    createInstancedMesh('Rounded close-range furniture and machine details', roundedGeometry, detailMaterial, roundedEntries),
    createInstancedMesh('Round close-range mechanisms and tool hardware', rodGeometry, metalMaterial, rodEntries),
    createInstancedMesh('Curved kitchen gooseneck', torusGeometry, metalMaterial, torusEntries),
    createInstancedMesh('Warm kitchen pendant shades', pendantGeometry, pendantMaterial, pendantEntries),
  ];
  root.add(...meshes);

  const rugTexture = makeWovenRugTexture();
  const rugGeometry = new THREE.PlaneGeometry(15.0 * FEET_TO_METERS, 8.15 * FEET_TO_METERS);
  rugGeometry.rotateX(-Math.PI * 0.5);
  rugGeometry.name = 'Great-room woven rug overlay';
  const rugMaterial = new THREE.MeshStandardMaterial({
    name: 'Great-room woven textile',
    color: 0xffffff,
    map: rugTexture,
    roughness: 1,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const rug = new THREE.Mesh(rugGeometry, rugMaterial);
  rug.name = 'Textured great-room rug';
  const rugLocal = planToLocal(75, 36.25);
  // Finished slab top is base + .065; lift the textile just six millimetres
  // so it remains visible without reading as a floating platform.
  rug.position.set(rugLocal.x, mainBase + 0.071, rugLocal.z);
  rug.receiveShadow = true;
  root.add(rug);
  meshes.push(rug);

  const stats = Object.freeze({
    drawCalls: meshes.length,
    instancedDrawCalls: meshes.length - 1,
    instances: roundedEntries.length + rodEntries.length + torusEntries.length + pendantEntries.length,
    roundedDetails: roundedEntries.length,
    mechanismsAndTools: rodEntries.length,
    texturedRugs: 1,
    zones: Object.freeze(['great-room', 'kitchen', 'garage', 'fab-lab']),
  });
  root.userData.stats = stats;

  function dispose() {
    root.removeFromParent();
    roundedGeometry.dispose();
    rodGeometry.dispose();
    torusGeometry.dispose();
    pendantGeometry.dispose();
    rugGeometry.dispose();
    detailMaterial.dispose();
    metalMaterial.dispose();
    pendantMaterial.dispose();
    rugMaterial.dispose();
    rugTexture.dispose();
  }

  return { root, stats, dispose };
}
