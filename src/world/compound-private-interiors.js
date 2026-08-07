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

function makeTextileWeaveTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f8f7f3';
  context.fillRect(0, 0, canvas.width, canvas.height);

  // A neutral field of short, irregular warp and weft fibres keeps every
  // per-instance textile colour intact while giving mattresses, duvets,
  // pillows, rugs, and towels a tactile response in close views. Avoiding a
  // continuous orthogonal grid also prevents moire in the 1600x900 captures.
  for (let x = 1; x < canvas.width; x += 8) {
    context.fillStyle = x % 16
      ? 'rgba(74,68,61,.012)'
      : 'rgba(255,255,252,.018)';
    context.fillRect(x, 0, 1, canvas.height);
  }
  let state = 0x52b7_91d3;
  for (let index = 0; index < 760; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const x = state & 127;
    const y = (state >>> 9) & 127;
    const length = 3 + ((state >>> 18) & 7);
    context.fillStyle = state & 0x10000
      ? 'rgba(255,255,252,.030)'
      : 'rgba(58,52,47,.022)';
    if (state & 0x8000) context.fillRect(x, y, length, 1);
    else context.fillRect(x, y, 1, length);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'Private interior neutral textile weave';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.MirroredRepeatWrapping;
  texture.wrapT = THREE.MirroredRepeatWrapping;
  texture.repeat.set(2, 2);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  return texture;
}

function createInstancedMesh(name, geometry, material, entries, options = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
  mesh.name = name;
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  mesh.renderOrder = options.renderOrder ?? 0;
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
 * Furnishes the main-house private band and guest house at one-to-one scale.
 * All pieces are visual-only and stay within deliberately audited furniture
 * envelopes, leaving the architectural wall and opening colliders authoritative.
 */
export function createCompoundPrivateInteriors({ heightAt, palette = {} } = {}) {
  const root = new THREE.Group();
  root.name = 'Compound private-interior fidelity layer';
  root.position.set(COMPOUND_SITE.centerX, 0, COMPOUND_SITE.centerZ);
  root.rotation.y = COMPOUND_SITE.yaw;
  root.userData.coordinateSystem = 'plan-aligned local metres; absolute world elevation';

  const mainBase = sampleTerraceHeight(heightAt, COMPOUND_PLAN.mainHouse);
  const guestBase = sampleTerraceHeight(heightAt, COMPOUND_PLAN.guestHouse);

  const paleOak = new THREE.Color(0xa97b4f);
  const oakEdge = new THREE.Color(0x684733);
  const walnut = new THREE.Color(0x4a332b);
  const charcoal = paletteColor(palette, 'shadowTeal', 0x172523)
    .lerp(new THREE.Color(0x393f3b), 0.22);
  const linen = new THREE.Color(0xd2c0a1);
  const warmWhite = new THREE.Color(0xe3d7c3);
  const sage = new THREE.Color(0x78806d);
  const rust = paletteColor(palette, 'crimsonDark', 0x87252a)
    .lerp(new THREE.Color(0xb4664a), 0.32);
  const ceramic = new THREE.Color(0xe2e0d7);
  const basinDark = new THREE.Color(0x46504c);
  const chrome = new THREE.Color(0xadb5af);
  const mirrorBlue = new THREE.Color(0x91a8a3);
  const glassBlue = new THREE.Color(0x8daead);
  const brass = new THREE.Color(0x9c7046);

  const hardEntries = [];
  const textileEntries = [];
  const ceramicEntries = [];
  const rodEntries = [];
  const mirrorEntries = [];
  const glassEntries = [];

  const counts = {
    beds: 0,
    fullBeds: 0,
    queenBeds: 0,
    kingBeds: 0,
    bedTextilePieces: 0,
    bedsideTables: 0,
    dressers: 0,
    wardrobeRuns: 0,
    wardrobeBays: 0,
    openWardrobeBays: 0,
    bathrooms: 0,
    vanities: 0,
    sinks: 0,
    mirrors: 0,
    toilets: 0,
    tubs: 0,
    showers: 0,
    showerGlassPanels: 0,
    towelSets: 0,
    livingFurniturePieces: 0,
    personalObjects: 0,
    privateDoorLeaves: 0,
    doorHardwarePieces: 0,
  };

  const addScaled = (
    entries,
    planX,
    planZ,
    y,
    width,
    height,
    depth,
    color,
    rotationY = 0,
    rotationX = 0,
    rotationZ = 0,
  ) => {
    if (!(width > 0 && height > 0 && depth > 0)) return;
    const local = planToLocal(planX, planZ);
    const matrix = new THREE.Matrix4();
    matrix.compose(
      new THREE.Vector3(local.x, y, local.z),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rotationX, rotationY, rotationZ, 'XYZ'),
      ),
      new THREE.Vector3(width, height, depth),
    );
    entries.push({ matrix, color });
  };

  const addFeet = (
    entries,
    planX,
    planZ,
    y,
    widthFeet,
    height,
    depthFeet,
    color,
    rotationY = 0,
  ) => addScaled(
    entries,
    planX,
    planZ,
    y,
    widthFeet * FEET_TO_METERS,
    height,
    depthFeet * FEET_TO_METERS,
    color,
    rotationY,
  );

  const offsetPlan = (planX, planZ, rotationY, alongFeet = 0, acrossFeet = 0) => ({
    x: planX + Math.cos(rotationY) * alongFeet + Math.sin(rotationY) * acrossFeet,
    z: planZ - Math.sin(rotationY) * alongFeet + Math.cos(rotationY) * acrossFeet,
  });

  const addRod = (
    fromX,
    fromZ,
    fromY,
    toX,
    toZ,
    toY,
    diameter,
    color,
  ) => {
    const from = planToLocal(fromX, fromZ);
    const to = planToLocal(toX, toZ);
    const start = new THREE.Vector3(from.x, fromY, from.z);
    const end = new THREE.Vector3(to.x, toY, to.z);
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

  const addBookStack = (planX, planZ, baseY, rotationY = 0, color = rust) => {
    addScaled(hardEntries, planX, planZ, baseY + 0.018, 0.24, 0.036, 0.16, color, rotationY);
    addScaled(hardEntries, planX + 0.06, planZ - 0.02, baseY + 0.055, 0.22, 0.034, 0.15, sage, rotationY + 0.08);
    counts.personalObjects += 2;
  };

  const addLamp = (planX, planZ, base, surfaceY, shadeColor = warmWhite) => {
    addRod(planX, planZ, base + surfaceY + 0.01, planX, planZ, base + surfaceY + 0.07, 0.18, brass);
    addRod(planX, planZ, base + surfaceY + 0.06, planX, planZ, base + surfaceY + 0.36, 0.025, brass);
    addScaled(
      textileEntries,
      planX,
      planZ,
      base + surfaceY + 0.41,
      0.30,
      0.25,
      0.30,
      shadeColor,
    );
    counts.personalObjects += 1;
  };

  const addNightstand = (planX, planZ, base, color = paleOak) => {
    addScaled(hardEntries, planX, planZ, base + 0.29, 0.46, 0.54, 0.43, color);
    addScaled(hardEntries, planX, planZ, base + 0.575, 0.50, 0.035, 0.47, oakEdge);
    addScaled(hardEntries, planX, planZ + 0.221 / FEET_TO_METERS, base + 0.37, 0.38, 0.18, 0.025, walnut);
    addRod(
      planX - 0.10 / FEET_TO_METERS,
      planZ + 0.236 / FEET_TO_METERS,
      base + 0.39,
      planX + 0.10 / FEET_TO_METERS,
      planZ + 0.236 / FEET_TO_METERS,
      base + 0.39,
      0.018,
      brass,
    );
    counts.bedsideTables += 1;
  };

  const addBed = ({
    planX,
    planZ,
    base,
    widthFeet,
    lengthFeet,
    rotationY,
    headSign,
    duvetColor,
    size,
  }) => {
    addFeet(hardEntries, planX, planZ, base + 0.13, widthFeet + 0.25, 0.22, lengthFeet, walnut, rotationY);
    addFeet(textileEntries, planX, planZ, base + 0.36, widthFeet, 0.25, lengthFeet, warmWhite, rotationY);

    const duvetCenter = offsetPlan(planX, planZ, rotationY, 0, -headSign * lengthFeet * 0.14);
    addFeet(
      textileEntries,
      duvetCenter.x,
      duvetCenter.z,
      base + 0.515,
      widthFeet - 0.24,
      0.10,
      lengthFeet * 0.62,
      duvetColor,
      rotationY,
    );
    const throwCenter = offsetPlan(planX, planZ, rotationY, 0, -headSign * lengthFeet * 0.36);
    addFeet(
      textileEntries,
      throwCenter.x,
      throwCenter.z,
      base + 0.585,
      widthFeet - 0.18,
      0.055,
      1.28,
      rust,
      rotationY,
    );

    const pillowAcross = headSign * (lengthFeet * 0.5 - 0.78);
    for (const along of [-widthFeet * 0.23, widthFeet * 0.23]) {
      const pillow = offsetPlan(planX, planZ, rotationY, along, pillowAcross);
      addScaled(
        textileEntries,
        pillow.x,
        pillow.z,
        base + 0.625,
        0.58,
        0.16,
        0.39,
        linen,
        rotationY,
        0,
        along < 0 ? -0.05 : 0.05,
      );
    }

    const headboard = offsetPlan(
      planX,
      planZ,
      rotationY,
      0,
      headSign * (lengthFeet * 0.5 - 0.10),
    );
    addScaled(
      hardEntries,
      headboard.x,
      headboard.z,
      base + 0.68,
      widthFeet * FEET_TO_METERS + 0.12,
      0.96,
      0.075,
      oakEdge,
      rotationY,
    );

    counts.beds += 1;
    counts.bedTextilePieces += 5;
    if (size === 'king') counts.kingBeds += 1;
    else if (size === 'queen') counts.queenBeds += 1;
    else counts.fullBeds += 1;
  };

  const addOpenDoor = ({
    hingeX,
    hingeZ,
    freeX,
    freeZ,
    base,
    color = paleOak,
  }) => {
    const deltaX = freeX - hingeX;
    const deltaZ = freeZ - hingeZ;
    const alongX = Math.abs(deltaX) >= Math.abs(deltaZ);
    const centerX = (hingeX + freeX) * 0.5;
    const centerZ = (hingeZ + freeZ) * 0.5;
    const leafFeet = Math.hypot(deltaX, deltaZ);
    const panelX = centerX + (alongX ? 0 : 0.027 / FEET_TO_METERS);
    const panelZ = centerZ + (alongX ? 0.027 / FEET_TO_METERS : 0);
    addScaled(
      hardEntries,
      centerX,
      centerZ,
      base + 1.12,
      alongX ? leafFeet * FEET_TO_METERS : 0.045,
      2.24,
      alongX ? 0.045 : leafFeet * FEET_TO_METERS,
      color,
    );
    addScaled(
      hardEntries,
      panelX,
      panelZ,
      base + 1.16,
      alongX ? (leafFeet - 0.28) * FEET_TO_METERS : 0.022,
      1.86,
      alongX ? 0.022 : (leafFeet - 0.28) * FEET_TO_METERS,
      oakEdge,
    );

    const handleOffset = 0.28 / leafFeet;
    const handleX = freeX - deltaX * handleOffset;
    const handleZ = freeZ - deltaZ * handleOffset;
    if (alongX) {
      addRod(handleX, handleZ - 0.09, base + 1.00, handleX, handleZ + 0.09, base + 1.00, 0.045, brass);
    } else {
      addRod(handleX - 0.09, handleZ, base + 1.00, handleX + 0.09, handleZ, base + 1.00, 0.045, brass);
    }
    counts.privateDoorLeaves += 1;
    counts.doorHardwarePieces += 1;
  };

  const addDresser = ({
    planX,
    planZ,
    base,
    widthFeet,
    depthFeet,
    rotationY = 0,
    frontSign = 1,
  }) => {
    addFeet(hardEntries, planX, planZ, base + 0.38, widthFeet, 0.72, depthFeet, walnut, rotationY);
    addFeet(hardEntries, planX, planZ, base + 0.765, widthFeet + 0.10, 0.05, depthFeet + 0.08, paleOak, rotationY);
    for (let drawer = 0; drawer < 3; drawer += 1) {
      const front = offsetPlan(planX, planZ, rotationY, 0, frontSign * (depthFeet * 0.5 + 0.025));
      addFeet(hardEntries, front.x, front.z, base + 0.19 + drawer * 0.22, widthFeet - 0.14, 0.18, 0.05, paleOak, rotationY);
      const left = offsetPlan(front.x, front.z, rotationY, -0.22, frontSign * 0.02);
      const right = offsetPlan(front.x, front.z, rotationY, 0.22, frontSign * 0.02);
      addRod(left.x, left.z, base + 0.20 + drawer * 0.22, right.x, right.z, base + 0.20 + drawer * 0.22, 0.016, brass);
    }
    counts.dressers += 1;
  };

  const addWardrobeRun = ({
    planX,
    planZ,
    base,
    widthFeet,
    depthFeet,
    rotationY = 0,
    frontSign = 1,
    bays = 2,
    openBay = -1,
  }) => {
    const height = 2.18;
    const panelFeet = 0.10;
    const bayWidth = widthFeet / bays;
    const back = offsetPlan(planX, planZ, rotationY, 0, -frontSign * (depthFeet * 0.5 - panelFeet * 0.5));
    addFeet(hardEntries, back.x, back.z, base + height * 0.5, widthFeet, height, panelFeet, walnut, rotationY);
    addFeet(hardEntries, planX, planZ, base + 0.04, widthFeet, 0.08, depthFeet, oakEdge, rotationY);
    addFeet(hardEntries, planX, planZ, base + height - 0.04, widthFeet, 0.08, depthFeet, oakEdge, rotationY);

    for (let index = 0; index <= bays; index += 1) {
      const along = -widthFeet * 0.5 + index * bayWidth;
      const side = offsetPlan(planX, planZ, rotationY, along, 0);
      addFeet(hardEntries, side.x, side.z, base + height * 0.5, panelFeet, height, depthFeet, oakEdge, rotationY);
    }

    for (let index = 0; index < bays; index += 1) {
      const along = -widthFeet * 0.5 + (index + 0.5) * bayWidth;
      if (index === openBay) {
        const shelf = offsetPlan(planX, planZ, rotationY, along, 0);
        addFeet(hardEntries, shelf.x, shelf.z, base + 0.48, bayWidth - 0.10, 0.055, depthFeet - 0.12, paleOak, rotationY);
        const rodStart = offsetPlan(planX, planZ, rotationY, along - bayWidth * 0.37, 0);
        const rodEnd = offsetPlan(planX, planZ, rotationY, along + bayWidth * 0.37, 0);
        addRod(rodStart.x, rodStart.z, base + 1.68, rodEnd.x, rodEnd.z, base + 1.68, 0.024, chrome);
        for (const clothingOffset of [-0.18, 0.18]) {
          const clothing = offsetPlan(planX, planZ, rotationY, along + clothingOffset, frontSign * 0.05);
          addScaled(textileEntries, clothing.x, clothing.z, base + 1.22, 0.34, 0.72, 0.10, clothingOffset < 0 ? sage : rust, rotationY);
        }
        counts.openWardrobeBays += 1;
        continue;
      }
      const front = offsetPlan(planX, planZ, rotationY, along, frontSign * (depthFeet * 0.5 + 0.018));
      addFeet(hardEntries, front.x, front.z, base + 1.10, bayWidth - 0.08, 2.02, 0.055, paleOak, rotationY);
      const handle = offsetPlan(front.x, front.z, rotationY, bayWidth * 0.30, frontSign * 0.02);
      addRod(handle.x, handle.z, base + 0.88, handle.x, handle.z, base + 1.32, 0.016, brass);
    }
    counts.wardrobeRuns += 1;
    counts.wardrobeBays += bays;
  };

  const addVanity = ({
    planX,
    planZ,
    base,
    widthFeet,
    depthFeet,
    rotationY = 0,
    frontSign = 1,
    sinks = 1,
  }) => {
    addFeet(hardEntries, planX, planZ, base + 0.40, widthFeet, 0.76, depthFeet, walnut, rotationY);
    addFeet(hardEntries, planX, planZ, base + 0.805, widthFeet + 0.10, 0.055, depthFeet + 0.08, ceramic, rotationY);
    const front = offsetPlan(planX, planZ, rotationY, 0, frontSign * (depthFeet * 0.5 + 0.022));
    for (let drawer = 0; drawer < 2; drawer += 1) {
      addFeet(hardEntries, front.x, front.z, base + 0.29 + drawer * 0.31, widthFeet - 0.14, 0.25, 0.05, paleOak, rotationY);
      const pullStart = offsetPlan(front.x, front.z, rotationY, -0.27, frontSign * 0.02);
      const pullEnd = offsetPlan(front.x, front.z, rotationY, 0.27, frontSign * 0.02);
      addRod(pullStart.x, pullStart.z, base + 0.31 + drawer * 0.31, pullEnd.x, pullEnd.z, base + 0.31 + drawer * 0.31, 0.016, brass);
    }

    for (let sinkIndex = 0; sinkIndex < sinks; sinkIndex += 1) {
      const along = sinks === 1 ? 0 : (sinkIndex === 0 ? -widthFeet * 0.25 : widthFeet * 0.25);
      const sink = offsetPlan(planX, planZ, rotationY, along, frontSign * 0.06);
      addScaled(ceramicEntries, sink.x, sink.z, base + 0.855, 0.42, 0.055, 0.29, basinDark, rotationY);
      const faucet = offsetPlan(planX, planZ, rotationY, along, -frontSign * depthFeet * 0.22);
      addRod(faucet.x, faucet.z, base + 0.84, faucet.x, faucet.z, base + 1.08, 0.022, chrome);
      const spout = offsetPlan(faucet.x, faucet.z, rotationY, 0, frontSign * 0.23);
      addRod(faucet.x, faucet.z, base + 1.08, spout.x, spout.z, base + 1.08, 0.022, chrome);
    }

    const mirror = offsetPlan(planX, planZ, rotationY, 0, -frontSign * (depthFeet * 0.5 + 0.04));
    addScaled(
      mirrorEntries,
      mirror.x,
      mirror.z,
      base + 1.55,
      widthFeet * FEET_TO_METERS - 0.16,
      0.82,
      0.026,
      mirrorBlue,
      rotationY,
    );
    counts.vanities += 1;
    counts.sinks += sinks;
    counts.mirrors += 1;
  };

  const addToilet = (planX, planZ, base, rotationY = 0) => {
    const pedestal = offsetPlan(planX, planZ, rotationY, 0, -0.05);
    const bowl = offsetPlan(planX, planZ, rotationY, 0, 0.18);
    const tank = offsetPlan(planX, planZ, rotationY, 0, -0.72);
    addScaled(ceramicEntries, pedestal.x, pedestal.z, base + 0.25, 0.30, 0.42, 0.38, ceramic, rotationY);
    addScaled(ceramicEntries, bowl.x, bowl.z, base + 0.48, 0.43, 0.24, 0.58, ceramic, rotationY);
    addScaled(ceramicEntries, bowl.x, bowl.z, base + 0.615, 0.36, 0.038, 0.47, charcoal, rotationY);
    addScaled(ceramicEntries, tank.x, tank.z, base + 0.73, 0.44, 0.55, 0.20, ceramic, rotationY);
    const flush = offsetPlan(tank.x, tank.z, rotationY, 0.12, 0);
    addRod(flush.x, flush.z, base + 1.015, flush.x, flush.z, base + 1.045, 0.035, chrome);
    counts.toilets += 1;
  };

  const addTub = ({ planX, planZ, base, widthFeet, depthFeet, rotationY = 0 }) => {
    addFeet(ceramicEntries, planX, planZ, base + 0.31, widthFeet, 0.58, depthFeet, ceramic, rotationY);
    addFeet(
      ceramicEntries,
      planX,
      planZ,
      base + 0.59,
      widthFeet - 0.55,
      0.045,
      depthFeet - 0.48,
      basinDark,
      rotationY,
    );
    const faucet = offsetPlan(planX, planZ, rotationY, widthFeet * 0.35, -depthFeet * 0.34);
    addRod(faucet.x, faucet.z, base + 0.58, faucet.x, faucet.z, base + 0.88, 0.024, chrome);
    const spout = offsetPlan(faucet.x, faucet.z, rotationY, 0, 0.28);
    addRod(faucet.x, faucet.z, base + 0.88, spout.x, spout.z, base + 0.88, 0.024, chrome);
    counts.tubs += 1;
  };

  const addShower = ({
    planX,
    planZ,
    base,
    widthFeet,
    depthFeet,
    rotationY = 0,
    frontSign = 1,
    sideSign = -1,
  }) => {
    addFeet(ceramicEntries, planX, planZ, base + 0.055, widthFeet, 0.11, depthFeet, ceramic, rotationY);
    const front = offsetPlan(planX, planZ, rotationY, widthFeet * -sideSign * 0.23, frontSign * depthFeet * 0.5);
    addFeet(
      glassEntries,
      front.x,
      front.z,
      base + 1.02,
      widthFeet * 0.54,
      1.86,
      0.055,
      glassBlue,
      rotationY,
    );
    const side = offsetPlan(planX, planZ, rotationY, sideSign * widthFeet * 0.5, frontSign * depthFeet * 0.05);
    addFeet(
      glassEntries,
      side.x,
      side.z,
      base + 1.02,
      depthFeet * 0.90,
      1.86,
      0.055,
      glassBlue,
      rotationY + Math.PI * 0.5,
    );

    const riser = offsetPlan(planX, planZ, rotationY, -sideSign * widthFeet * 0.34, -frontSign * depthFeet * 0.36);
    addRod(riser.x, riser.z, base + 0.30, riser.x, riser.z, base + 2.02, 0.025, chrome);
    const head = offsetPlan(riser.x, riser.z, rotationY, 0, frontSign * 0.32);
    addRod(riser.x, riser.z, base + 2.02, head.x, head.z, base + 2.02, 0.025, chrome);
    addRod(head.x, head.z, base + 1.98, head.x, head.z, base + 2.03, 0.18, chrome);
    counts.showers += 1;
    counts.showerGlassPanels += 2;
  };

  const addTowelSet = (planX, planZ, base, rotationY = 0, color = linen) => {
    const start = offsetPlan(planX, planZ, rotationY, -0.75, 0);
    const end = offsetPlan(planX, planZ, rotationY, 0.75, 0);
    addRod(start.x, start.z, base + 1.18, end.x, end.z, base + 1.18, 0.022, chrome);
    addFeet(textileEntries, planX, planZ, base + 0.91, 1.05, 0.50, 0.08, color, rotationY);
    counts.towelSets += 1;
  };

  // Beds 2 and 3 use full mattresses with their heads on solid partition
  // walls. This keeps both north egress windows and the south door approaches
  // unobstructed, with more than four feet clear at each foot/south side.
  addBed({
    planX: 40.70,
    planZ: 19.50,
    base: mainBase,
    widthFeet: 4.50,
    lengthFeet: 6.25,
    rotationY: Math.PI * 0.5,
    headSign: -1,
    duvetColor: sage,
    size: 'full',
  });
  addBed({
    planX: 59.70,
    planZ: 19.50,
    base: mainBase,
    widthFeet: 4.50,
    lengthFeet: 6.25,
    rotationY: Math.PI * 0.5,
    headSign: -1,
    duvetColor: linen,
    size: 'full',
  });
  addBed({
    planX: 91.90,
    planZ: 34.00,
    base: mainBase,
    widthFeet: 6.33,
    lengthFeet: 6.67,
    rotationY: 0,
    headSign: -1,
    duvetColor: linen,
    size: 'king',
  });
  addBed({
    planX: 129.00,
    planZ: 85.15,
    base: guestBase,
    widthFeet: 5.00,
    lengthFeet: 6.67,
    rotationY: 0,
    headSign: 1,
    duvetColor: sage,
    size: 'queen',
  });

  addNightstand(38.25, 23.00, mainBase);
  addLamp(38.25, 23.00, mainBase, 0.59, warmWhite);
  addBookStack(38.30, 22.82, mainBase + 0.60, 0.08);
  addNightstand(57.25, 23.00, mainBase, paleOak);
  addLamp(57.25, 23.00, mainBase, 0.59, linen);
  addBookStack(57.30, 22.82, mainBase + 0.60, -0.06, rust);
  addNightstand(87.70, 31.65, mainBase, walnut);
  addLamp(87.70, 31.65, mainBase, 0.59, sage);
  addBookStack(87.65, 31.45, mainBase + 0.60, 0.04, sage);
  addNightstand(96.10, 31.65, mainBase, walnut);
  addLamp(96.10, 31.65, mainBase, 0.59, warmWhite);
  addNightstand(132.55, 87.35, guestBase, paleOak);
  addLamp(132.55, 87.35, guestBase, 0.59, warmWhite);
  addBookStack(132.48, 87.14, guestBase + 0.60, -0.08, rust);

  addDresser({
    planX: 48.05,
    planZ: 19.40,
    base: mainBase,
    widthFeet: 3.20,
    depthFeet: 1.45,
    rotationY: Math.PI * 0.5,
    frontSign: -1,
  });
  addBookStack(47.86, 19.70, mainBase + 0.80, Math.PI * 0.5, sage);
  addDresser({
    planX: 58.40,
    planZ: 25.00,
    base: mainBase,
    widthFeet: 3.40,
    depthFeet: 1.35,
    rotationY: 0,
    frontSign: -1,
  });
  addBookStack(58.00, 24.82, mainBase + 0.80, 0.12, rust);

  // True-depth wardrobe carcasses are split around every door swing. An open
  // bay in each major closet exposes the hanging rail and stops the runs from
  // reading as shallow wall panels.
  addWardrobeRun({
    planX: 71.95,
    planZ: 21.10,
    base: mainBase,
    widthFeet: 8.10,
    depthFeet: 1.65,
    rotationY: Math.PI * 0.5,
    frontSign: -1,
    bays: 4,
    openBay: 1,
  });
  addWardrobeRun({
    planX: 78.05,
    planZ: 21.10,
    base: mainBase,
    widthFeet: 8.20,
    depthFeet: 1.65,
    rotationY: Math.PI * 0.5,
    frontSign: 1,
    bays: 4,
    openBay: 2,
  });
  addWardrobeRun({
    planX: 84.95,
    planZ: 17.70,
    base: mainBase,
    widthFeet: 2.15,
    depthFeet: 1.65,
    rotationY: Math.PI * 0.5,
    frontSign: -1,
    bays: 1,
  });
  addWardrobeRun({
    planX: 84.95,
    planZ: 23.75,
    base: mainBase,
    widthFeet: 3.55,
    depthFeet: 1.65,
    rotationY: Math.PI * 0.5,
    frontSign: -1,
    bays: 2,
  });
  addWardrobeRun({
    planX: 75.00,
    planZ: 17.15,
    base: mainBase,
    widthFeet: 2.80,
    depthFeet: 1.45,
    rotationY: 0,
    frontSign: 1,
    bays: 2,
    openBay: 0,
  });

  // Realized private doors follow the authored blueprint swing arcs and stay
  // fully open. The linen door is deliberately omitted: its southward leaf
  // would reduce the four-foot gallery below a credible passing width.
  addOpenDoor({ hingeX: 42, hingeZ: 26, freeX: 42, freeZ: 23, base: mainBase });
  addOpenDoor({ hingeX: 54, hingeZ: 26, freeX: 54, freeZ: 23, base: mainBase });
  addOpenDoor({ hingeX: 62, hingeZ: 26, freeX: 62, freeZ: 23, base: mainBase });
  addOpenDoor({ hingeX: 68, hingeZ: 19, freeX: 71, freeZ: 19, base: mainBase, color: walnut });
  addOpenDoor({ hingeX: 86, hingeZ: 19, freeX: 83, freeZ: 19, base: mainBase, color: walnut });
  addOpenDoor({ hingeX: 91.5, hingeZ: 26, freeX: 91.5, freeZ: 23, base: mainBase });
  addOpenDoor({ hingeX: 86, hingeZ: 26.8, freeX: 89, freeZ: 26.8, base: mainBase });
  addOpenDoor({ hingeX: 108, hingeZ: 79, freeX: 111, freeZ: 79, base: guestBase });
  addOpenDoor({ hingeX: 122, hingeZ: 80, freeX: 125, freeZ: 80, base: guestBase });
  addOpenDoor({ hingeX: 122, hingeZ: 92, freeX: 125, freeZ: 92, base: guestBase });
  addWardrobeRun({
    planX: 122.90,
    planZ: 86.30,
    base: guestBase,
    widthFeet: 4.00,
    depthFeet: 1.35,
    rotationY: Math.PI * 0.5,
    frontSign: 1,
    bays: 2,
    openBay: 0,
  });

  // Bath 2: a low tub remains beneath the north window, while shallow
  // opposing vanity/toilet zones retain a 31-inch central aisle.
  addTub({ planX: 52.50, planZ: 17.82, base: mainBase, widthFeet: 5.55, depthFeet: 2.55 });
  addVanity({
    planX: 49.95,
    planZ: 21.50,
    base: mainBase,
    widthFeet: 3.00,
    depthFeet: 1.45,
    rotationY: Math.PI * 0.5,
    frontSign: 1,
  });
  addToilet(54.10, 21.45, mainBase, 0);
  addTowelSet(54.95, 24.15, mainBase, Math.PI * 0.5, linen);
  counts.bathrooms += 1;

  // Primary bath: the soaking tub stays below the window, the separate shower
  // occupies the solid north-east corner, and the east-wall vanity leaves the
  // two suite doors and their approach zones clear.
  addTub({ planX: 88.90, planZ: 17.72, base: mainBase, widthFeet: 4.55, depthFeet: 2.35 });
  addShower({
    planX: 95.70,
    planZ: 18.10,
    base: mainBase,
    widthFeet: 3.20,
    depthFeet: 2.90,
    frontSign: 1,
    sideSign: -1,
  });
  addVanity({
    planX: 96.65,
    planZ: 22.45,
    base: mainBase,
    widthFeet: 4.45,
    depthFeet: 1.65,
    rotationY: Math.PI * 0.5,
    frontSign: -1,
    sinks: 2,
  });
  addToilet(88.45, 23.35, mainBase, 0);
  // Keep the towel rail on the solid south-wall pier west of the 3' doorway;
  // mounting it at the room centre would project the towel into the opening.
  addTowelSet(90.00, 25.58, mainBase, 0, sage);
  counts.bathrooms += 1;

  // Guest bath: a north-wall vanity, east-side toilet, and glass corner shower
  // keep the west entry and the south window completely unobstructed.
  addVanity({
    planX: 125.20,
    planZ: 90.05,
    base: guestBase,
    widthFeet: 4.75,
    depthFeet: 1.55,
    rotationY: 0,
    frontSign: 1,
  });
  addToilet(131.00, 91.45, guestBase, 0);
  addShower({
    planX: 131.55,
    planZ: 95.50,
    base: guestBase,
    widthFeet: 3.40,
    depthFeet: 3.35,
    frontSign: -1,
    sideSign: -1,
  });
  addTowelSet(128.10, 89.38, guestBase, 0, warmWhite);
  counts.bathrooms += 1;

  // Guest living layer complements the established sofa and dining table:
  // a tactile rug, low coffee table, reading lamp, and a few personal objects
  // add occupation without narrowing the clear west-side route between doors.
  addFeet(textileEntries, 114.80, 87.75, guestBase + 0.026, 8.00, 0.042, 5.10, rust, 0);
  addFeet(hardEntries, 114.80, 89.32, guestBase + 0.32, 4.00, 0.14, 1.58, paleOak, 0);
  for (const [x, z] of [[113.15, 88.73], [116.45, 88.73], [113.15, 89.91], [116.45, 89.91]]) {
    addRod(x, z, guestBase + 0.05, x, z, guestBase + 0.28, 0.045, charcoal);
  }
  addBookStack(114.25, 89.25, guestBase + 0.405, 0.05, sage);
  addScaled(ceramicEntries, 115.55, 89.25, guestBase + 0.455, 0.20, 0.095, 0.20, ceramic);
  counts.personalObjects += 1;
  addScaled(hardEntries, 119.25, 86.10, guestBase + 0.31, 0.48, 0.58, 0.48, walnut);
  addScaled(hardEntries, 119.25, 86.10, guestBase + 0.62, 0.52, 0.045, 0.52, paleOak);
  addLamp(119.25, 86.10, guestBase, 0.65, linen);
  counts.livingFurniturePieces += 3;

  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  boxGeometry.name = 'Private interior unit casework box';
  const roundedGeometry = new RoundedBoxGeometry(1, 1, 1, 3, 0.12);
  roundedGeometry.name = 'Private interior rounded textile and fixture form';
  const cylinderGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 14, 1, false);
  cylinderGeometry.name = 'Private interior unit hardware cylinder';
  const textileWeaveTexture = makeTextileWeaveTexture();

  const hardMaterial = new THREE.MeshStandardMaterial({
    name: 'Private interior wood and casework',
    color: 0xffffff,
    roughness: 0.54,
    metalness: 0.12,
  });
  const textileMaterial = new THREE.MeshStandardMaterial({
    name: 'Private interior mattresses, linens, and towels',
    color: 0xffffff,
    map: textileWeaveTexture,
    bumpMap: textileWeaveTexture,
    bumpScale: 0.004,
    roughness: 0.96,
    metalness: 0,
  });
  const ceramicMaterial = new THREE.MeshStandardMaterial({
    name: 'Private interior ceramic fixtures',
    color: 0xffffff,
    roughness: 0.20,
    metalness: 0,
  });
  const rodMaterial = new THREE.MeshStandardMaterial({
    name: 'Private interior metal hardware and plumbing',
    color: 0xffffff,
    roughness: 0.28,
    metalness: 0.76,
  });
  const mirrorMaterial = new THREE.MeshStandardMaterial({
    name: 'Private interior mirror faces',
    color: 0xffffff,
    roughness: 0.08,
    metalness: 0.82,
    envMapIntensity: 1.35,
  });
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    name: 'Private interior shower glass',
    color: 0xffffff,
    roughness: 0.08,
    metalness: 0,
    transmission: 0.38,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const meshes = [
    createInstancedMesh('Private hard furniture and storage', boxGeometry, hardMaterial, hardEntries),
    createInstancedMesh('Private rounded mattresses and linens', roundedGeometry, textileMaterial, textileEntries),
    createInstancedMesh('Private rounded bathroom fixtures', roundedGeometry, ceramicMaterial, ceramicEntries),
    createInstancedMesh('Private plumbing, rails, and hardware', cylinderGeometry, rodMaterial, rodEntries),
    createInstancedMesh('Private vanity mirrors', boxGeometry, mirrorMaterial, mirrorEntries, { castShadow: false }),
    createInstancedMesh('Private shower glazing', boxGeometry, glassMaterial, glassEntries, {
      castShadow: false,
      receiveShadow: false,
      renderOrder: 3,
    }),
  ];
  root.add(...meshes);

  const stats = Object.freeze({
    realized: true,
    scale: '1:1',
    drawCalls: meshes.length,
    instances:
      hardEntries.length
      + textileEntries.length
      + ceramicEntries.length
      + rodEntries.length
      + mirrorEntries.length
      + glassEntries.length,
    hardInstances: hardEntries.length,
    textileInstances: textileEntries.length,
    ceramicInstances: ceramicEntries.length,
    hardwareInstances: rodEntries.length,
    mirrorInstances: mirrorEntries.length,
    glassInstances: glassEntries.length,
    textureMaps: 1,
    beds: counts.beds,
    fullBeds: counts.fullBeds,
    queenBeds: counts.queenBeds,
    kingBeds: counts.kingBeds,
    bedTextilePieces: counts.bedTextilePieces,
    bedsideTables: counts.bedsideTables,
    dressers: counts.dressers,
    wardrobeRuns: counts.wardrobeRuns,
    wardrobeBays: counts.wardrobeBays,
    openWardrobeBays: counts.openWardrobeBays,
    bathrooms: counts.bathrooms,
    vanities: counts.vanities,
    sinks: counts.sinks,
    mirrors: counts.mirrors,
    toilets: counts.toilets,
    tubs: counts.tubs,
    showers: counts.showers,
    showerGlassPanels: counts.showerGlassPanels,
    towelSets: counts.towelSets,
    livingFurniturePieces: counts.livingFurniturePieces,
    personalObjects: counts.personalObjects,
    privateDoorLeaves: counts.privateDoorLeaves,
    doorHardwarePieces: counts.doorHardwarePieces,
    collidersAdded: 0,
    placementCentersPlanFeet: Object.freeze({
      bed3: Object.freeze([40.70, 19.50]),
      bed2: Object.freeze([59.70, 19.50]),
      primaryBed: Object.freeze([91.90, 34.00]),
      guestBed: Object.freeze([129.00, 85.15]),
      bath2: Object.freeze([52.50, 21.10]),
      primaryBath: Object.freeze([93.00, 20.30]),
      guestBath: Object.freeze([129.20, 92.60]),
      guestLiving: Object.freeze([114.80, 87.75]),
    }),
    minimumClearancesFeet: Object.freeze({
      designatedBedAccess: 2.51,
      closetAisle: 2.90,
      bathroomAisle: 2.60,
      guestLivingDoorRoute: 3.95,
      primarySliderRoute: 4.24,
    }),
  });
  root.userData.stats = stats;

  function dispose() {
    root.removeFromParent();
    boxGeometry.dispose();
    roundedGeometry.dispose();
    cylinderGeometry.dispose();
    textileWeaveTexture.dispose();
    hardMaterial.dispose();
    textileMaterial.dispose();
    ceramicMaterial.dispose();
    rodMaterial.dispose();
    mirrorMaterial.dispose();
    glassMaterial.dispose();
  }

  return { root, stats, dispose };
}
