import * as THREE from 'three';
import {
  COMPOUND_PLAN,
  COMPOUND_SITE,
  FEET_TO_METERS,
  planToLocal,
  planToWorld,
} from './site-layout.js';

const UP = new THREE.Vector3(0, 1, 0);
const WINDOW_SILL = 0.72;
const WINDOW_HEAD = 2.38;
const DOOR_HEAD = 2.48;
const EXTERIOR_MATCH_TOLERANCE_FEET = 0.12;

const BUILDING_STYLE = Object.freeze({
  'main-house': Object.freeze({ wallHeight: 2.96, roofHeight: 3.02 }),
  'fab-lab': Object.freeze({ wallHeight: 3.34, roofHeight: 3.40 }),
  garage: Object.freeze({ wallHeight: 3.16, roofHeight: 3.22 }),
  'guest-house': Object.freeze({ wallHeight: 2.94, roofHeight: 3.00 }),
});

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

function normalizeOpening(value, index, kind) {
  if (Array.isArray(value)) {
    const [x = 0, z = 0, width = 0, depth = 0] = value;
    return { x, z, width, depth, index, kind };
  }
  return {
    x: value?.x ?? 0,
    z: value?.z ?? value?.y ?? 0,
    width: value?.width ?? value?.w ?? 0,
    depth: value?.depth ?? value?.d ?? 0,
    index,
    kind,
  };
}

function openingAxis(opening) {
  return opening.width >= opening.depth ? 'x' : 'z';
}

function openingSpan(opening) {
  return openingAxis(opening) === 'x'
    ? {
        from: opening.x,
        to: opening.x + opening.width,
        at: opening.z + opening.depth * 0.5,
      }
    : {
        from: opening.z,
        to: opening.z + opening.depth,
        at: opening.x + opening.width * 0.5,
      };
}

function overlaps(from, to, edgeFrom, edgeTo) {
  return to > edgeFrom + 0.01 && from < edgeTo - 0.01;
}

function findExteriorSide(opening) {
  const axis = openingAxis(opening);
  const span = openingSpan(opening);
  for (const building of COMPOUND_PLAN.buildingList) {
    const z0 = rectangleZ(building);
    const z1 = z0 + building.depth;
    const x0 = building.x;
    const x1 = building.x + building.width;
    if (axis === 'x' && overlaps(span.from, span.to, x0, x1)) {
      if (Math.abs(span.at - z0) <= EXTERIOR_MATCH_TOLERANCE_FEET) {
        return { building, axis, span, side: 'north', normalX: 0, normalZ: -1 };
      }
      if (Math.abs(span.at - z1) <= EXTERIOR_MATCH_TOLERANCE_FEET) {
        return { building, axis, span, side: 'south', normalX: 0, normalZ: 1 };
      }
    }
    if (axis === 'z' && overlaps(span.from, span.to, z0, z1)) {
      if (Math.abs(span.at - x0) <= EXTERIOR_MATCH_TOLERANCE_FEET) {
        return { building, axis, span, side: 'west', normalX: -1, normalZ: 0 };
      }
      if (Math.abs(span.at - x1) <= EXTERIOR_MATCH_TOLERANCE_FEET) {
        return { building, axis, span, side: 'east', normalX: 1, normalZ: 0 };
      }
    }
  }
  return null;
}

function createInstancedMesh(name, geometry, material, entries, options = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
  mesh.name = name;
  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  entries.forEach((entry, index) => {
    mesh.setMatrixAt(index, entry.matrix);
    mesh.setColorAt(index, entry.color);
  });
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/**
 * Procedural exterior construction details. Every piece is visual-only and
 * remains outside the architecture collider contract, so flashings and drain
 * cues do not narrow the authored clear openings.
 */
export function createCompoundExteriorConstruction({
  heightAt,
  palette = {},
  doorOpenings = [],
  windowOpenings = [],
} = {}) {
  const root = new THREE.Group();
  root.name = 'Compound exterior construction detail layer';
  root.position.set(COMPOUND_SITE.centerX, 0, COMPOUND_SITE.centerZ);
  root.rotation.y = COMPOUND_SITE.yaw;
  root.userData.coordinateSystem = 'plan-aligned local metres; absolute world elevation';

  const zinc = new THREE.Color(0x777b75);
  const zincShadow = new THREE.Color(0x444c49);
  const charcoal = new THREE.Color(palette?.shadowTeal ?? 0x172523)
    .lerp(new THREE.Color(0x3d4541), 0.22);
  const bronze = new THREE.Color(0x9a7044);
  const drainDark = new THREE.Color(0x15211f);
  const runoffTints = [0x4b554e, 0x5c5b50, 0x3e4b48].map((value) => new THREE.Color(value));

  const baseByBuilding = new Map();
  for (const building of COMPOUND_PLAN.buildingList) {
    baseByBuilding.set(building.id, sampleTerraceHeight(heightAt, building));
  }

  const boxEntries = [];
  const rodEntries = [];
  const runoffEntries = [];
  const counts = {
    copingCaps: 0,
    copingDripEdges: 0,
    roofDrainAssemblies: 0,
    roofDrainPieces: 0,
    exteriorOpenings: 0,
    headFlashings: 0,
    sillFlashings: 0,
    thresholds: 0,
    linearDrainChannels: 0,
    linearDrainSlots: 0,
    doorHardwarePieces: 0,
    lanaiPostFaces: 0,
    lanaiPostShoes: 0,
    lanaiBeams: 0,
    lanaiGutters: 0,
    lanaiDownspouts: 0,
    runoffStreaks: 0,
  };

  const addBoxLocal = (
    x,
    z,
    y,
    width,
    height,
    depth,
    color,
    rotationY = 0,
  ) => {
    if (!(width > 0 && height > 0 && depth > 0)) return;
    const matrix = new THREE.Matrix4();
    matrix.compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(UP, rotationY),
      new THREE.Vector3(width, height, depth),
    );
    boxEntries.push({ matrix, color });
  };

  const addRunoffLocal = (
    x,
    z,
    y,
    width,
    height,
    depth,
    color,
  ) => {
    const matrix = new THREE.Matrix4();
    matrix.compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion(),
      new THREE.Vector3(width, height, depth),
    );
    runoffEntries.push({ matrix, color });
  };

  const addBox = (planX, planZ, ...args) => {
    const local = planToLocal(planX, planZ);
    addBoxLocal(local.x, local.z, ...args);
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

  const addOffsetBox = (
    planX,
    planZ,
    normalX,
    normalZ,
    offset,
    y,
    width,
    height,
    depth,
    color,
  ) => {
    const local = planToLocal(planX, planZ);
    addBoxLocal(
      local.x + normalX * offset,
      local.z + normalZ * offset,
      y,
      width,
      height,
      depth,
      color,
    );
  };

  // Folded zinc coping overlays the pale parapet cap by only a few
  // millimetres. Horizontal caps catch the sky; darker outer hems provide the
  // shadow line that makes the low roof assembly legible at compound scale.
  for (const building of COMPOUND_PLAN.buildingList) {
    const base = baseByBuilding.get(building.id) ?? 0;
    const style = BUILDING_STYLE[building.id] ?? BUILDING_STYLE['main-house'];
    const z0 = rectangleZ(building);
    const z1 = z0 + building.depth;
    const x0 = building.x;
    const x1 = building.x + building.width;
    const centerX = (x0 + x1) * 0.5;
    const centerZ = (z0 + z1) * 0.5;
    const width = building.width * FEET_TO_METERS;
    const depth = building.depth * FEET_TO_METERS;
    const capY = base + style.roofHeight + 0.516;
    const lipY = capY - 0.042;
    const capOutset = 0.13;

    addBox(centerX, z0, capY, width + capOutset * 2, 0.026, 0.25, zinc);
    addBox(centerX, z1, capY, width + capOutset * 2, 0.026, 0.25, zinc);
    addBox(x0, centerZ, capY, 0.25, 0.026, depth + capOutset * 2, zinc);
    addBox(x1, centerZ, capY, 0.25, 0.026, depth + capOutset * 2, zinc);
    counts.copingCaps += 4;

    addBox(centerX, z0 - 0.41, lipY, width + capOutset * 2, 0.072, 0.018, zincShadow);
    addBox(centerX, z1 + 0.41, lipY, width + capOutset * 2, 0.072, 0.018, zincShadow);
    addBox(x0 - 0.41, centerZ, lipY, 0.018, 0.072, depth + capOutset * 2, zincShadow);
    addBox(x1 + 0.41, centerZ, lipY, 0.018, 0.072, depth + capOutset * 2, zincShadow);
    counts.copingDripEdges += 4;
  }

  const addRoofDrain = (buildingId, side, alongPlan) => {
    const building = COMPOUND_PLAN.buildings[buildingId];
    if (!building) return;
    const base = baseByBuilding.get(building.id) ?? 0;
    const style = BUILDING_STYLE[building.id] ?? BUILDING_STYLE['main-house'];
    const z0 = rectangleZ(building);
    const z1 = z0 + building.depth;
    const x0 = building.x;
    const x1 = building.x + building.width;
    const horizontal = side === 'north' || side === 'south';
    const normalX = side === 'west' ? -1 : side === 'east' ? 1 : 0;
    const normalZ = side === 'north' ? -1 : side === 'south' ? 1 : 0;
    const planX = horizontal ? alongPlan : (side === 'west' ? x0 : x1);
    const planZ = horizontal ? (side === 'north' ? z0 : z1) : alongPlan;
    const local = planToLocal(planX, planZ);
    const topY = base + style.roofHeight + 0.29;
    const pipeBottom = base + 0.14;
    const pipeTop = topY - 0.02;
    const outward = 0.165;
    const alongWidth = 0.34;

    addBoxLocal(
      local.x + normalX * 0.148,
      local.z + normalZ * 0.148,
      topY,
      horizontal ? alongWidth : 0.026,
      0.14,
      horizontal ? 0.026 : alongWidth,
      drainDark,
    );
    addBoxLocal(
      local.x + normalX * outward,
      local.z + normalZ * outward,
      (pipeBottom + pipeTop) * 0.5,
      horizontal ? 0.075 : 0.064,
      pipeTop - pipeBottom,
      horizontal ? 0.064 : 0.075,
      zincShadow,
    );
    addBoxLocal(
      local.x + normalX * 0.30,
      local.z + normalZ * 0.30,
      pipeBottom + 0.015,
      horizontal ? 0.09 : 0.31,
      0.064,
      horizontal ? 0.31 : 0.09,
      zincShadow,
    );
    for (const height of [base + 0.92, base + 1.92]) {
      addBoxLocal(
        local.x + normalX * (outward + 0.006),
        local.z + normalZ * (outward + 0.006),
        height,
        horizontal ? 0.105 : 0.035,
        0.036,
        horizontal ? 0.035 : 0.105,
        zinc,
      );
    }

    // Three narrow mineral streaks sit behind each downspout/scupper. Their
    // different starts and widths avoid a decal-like stripe, while the very
    // low-opacity rough material keeps the mark subordinate to real shadow.
    const tangentX = horizontal ? 1 : 0;
    const tangentZ = horizontal ? 0 : 1;
    for (let streak = 0; streak < 3; streak += 1) {
      const tangentOffset = (streak - 1) * 0.075;
      const streakTop = topY - 0.16 - streak * 0.10;
      const streakBottom = base + 0.20 + (streak % 2) * 0.13;
      const streakHeight = streakTop - streakBottom;
      const streakWidth = 0.050 + streak * 0.017;
      addRunoffLocal(
        local.x + normalX * 0.138 + tangentX * tangentOffset,
        local.z + normalZ * 0.138 + tangentZ * tangentOffset,
        streakBottom + streakHeight * 0.5,
        horizontal ? streakWidth : 0.007,
        streakHeight,
        horizontal ? 0.007 : streakWidth,
        runoffTints[streak],
      );
      counts.runoffStreaks += 1;
    }
    counts.roofDrainAssemblies += 1;
    counts.roofDrainPieces += 5;
  };

  addRoofDrain('mainHouse', 'south', 25.2);
  addRoofDrain('mainHouse', 'south', 85.0);
  addRoofDrain('garage', 'east', 89.2);
  addRoofDrain('garage', 'east', 122.8);
  addRoofDrain('fabLab', 'south', 130.0);
  addRoofDrain('guestHouse', 'south', 132.2);

  // The lanai's original 90 mm posts and thin slatted edge establish layout,
  // but need a construction hierarchy at arm's length. Slightly heavier post
  // faces, zinc shoes, a continuous outer beam, and a folded gutter all reuse
  // this layer's existing sheet-metal draw. Downspouts sit on the solid foyer
  // pier and far suite end, clear of sliders and the west breezeway.
  const lanai = COMPOUND_PLAN.canopies.find((canopy) => canopy.id === 'lanai');
  if (lanai) {
    const mainBase = baseByBuilding.get('main-house') ?? 0;
    const lanaiZ = rectangleZ(lanai);
    const outerZ = lanaiZ + lanai.depth - 0.20;
    const top = mainBase + 2.76;
    const centerX = lanai.x + lanai.width * 0.5;
    const width = lanai.width * FEET_TO_METERS;

    addBox(centerX, outerZ, top - 0.14, width, 0.22, 0.15, charcoal);
    addBox(centerX, outerZ + 0.38, top + 0.075, width + 0.08, 0.11, 0.12, zincShadow);
    counts.lanaiBeams += 1;
    counts.lanaiGutters += 1;

    const postXs = [36, 48.4, 60.8, 73.2, 85.6, 98];
    for (const planX of postXs) {
      addBox(planX, outerZ, mainBase + 1.35, 0.12, 2.70, 0.12, charcoal);
      addBox(planX, outerZ, mainBase + 0.055, 0.19, 0.10, 0.19, zincShadow);
      addBox(planX, outerZ, mainBase + 0.115, 0.15, 0.035, 0.15, zinc);
      counts.lanaiPostFaces += 1;
      counts.lanaiPostShoes += 2;
    }

    for (const planX of [48.4, 97.6]) {
      addBox(planX, outerZ + 0.40, mainBase + 1.38, 0.072, 2.54, 0.066, zincShadow);
      addBox(planX + 0.46, outerZ + 0.40, mainBase + 0.11, 0.34, 0.065, 0.075, zincShadow);
      for (const y of [mainBase + 0.82, mainBase + 1.82]) {
        addBox(planX, outerZ + 0.42, y, 0.10, 0.035, 0.095, zinc);
      }
      counts.lanaiDownspouts += 1;
    }
  }

  const normalizedOpenings = [
    ...windowOpenings.map((opening, index) => normalizeOpening(opening, index, 'window')),
    ...doorOpenings.map((opening, index) => normalizeOpening(opening, index, 'door')),
  ];

  for (const opening of normalizedOpenings) {
    const exterior = findExteriorSide(opening);
    if (!exterior) continue;
    counts.exteriorOpenings += 1;
    const { building, axis, span, normalX, normalZ } = exterior;
    const base = baseByBuilding.get(building.id) ?? 0;
    const style = BUILDING_STYLE[building.id] ?? BUILDING_STYLE['main-house'];
    const centerAlong = (span.from + span.to) * 0.5;
    const planX = axis === 'x' ? centerAlong : span.at;
    const planZ = axis === 'x' ? span.at : centerAlong;
    const spanMeters = (span.to - span.from) * FEET_TO_METERS;
    const head = Math.min(
      opening.kind === 'window' ? WINDOW_HEAD : DOOR_HEAD,
      style.wallHeight - 0.18,
    );
    const flashingLength = spanMeters + 0.14;
    const headWidth = axis === 'x' ? flashingLength : 0.16;
    const headDepth = axis === 'x' ? 0.16 : flashingLength;

    addOffsetBox(
      planX,
      planZ,
      normalX,
      normalZ,
      0.095,
      base + head + 0.028,
      headWidth,
      0.026,
      headDepth,
      zinc,
    );
    addOffsetBox(
      planX,
      planZ,
      normalX,
      normalZ,
      0.174,
      base + head + 0.001,
      axis === 'x' ? flashingLength : 0.018,
      0.046,
      axis === 'x' ? 0.018 : flashingLength,
      zincShadow,
    );
    counts.headFlashings += 2;

    if (opening.kind === 'window') {
      addOffsetBox(
        planX,
        planZ,
        normalX,
        normalZ,
        0.105,
        base + WINDOW_SILL + 0.008,
        axis === 'x' ? spanMeters + 0.10 : 0.18,
        0.024,
        axis === 'x' ? 0.18 : spanMeters + 0.10,
        zinc,
      );
      addOffsetBox(
        planX,
        planZ,
        normalX,
        normalZ,
        0.188,
        base + WINDOW_SILL - 0.018,
        axis === 'x' ? spanMeters + 0.10 : 0.018,
        0.042,
        axis === 'x' ? 0.018 : spanMeters + 0.10,
        zincShadow,
      );
      counts.sillFlashings += 2;
      continue;
    }

    // A thin flush threshold bridges the frame without affecting collision.
    // Wide exterior openings gain a separate slot drain beyond it so rainwater
    // detailing reinforces rather than interrupts the accessible floor plane.
    addOffsetBox(
      planX,
      planZ,
      normalX,
      normalZ,
      0.045,
      base + 0.074,
      axis === 'x' ? Math.max(0.35, spanMeters - 0.08) : 0.19,
      0.022,
      axis === 'x' ? 0.19 : Math.max(0.35, spanMeters - 0.08),
      zincShadow,
    );
    counts.thresholds += 1;

    const isGarageBay = building.id === 'garage' && spanMeters > 2.1;
    const isWideDoor = spanMeters > 1.35;
    if (isWideDoor) {
      addOffsetBox(
        planX,
        planZ,
        normalX,
        normalZ,
        isGarageBay ? 0.31 : 0.255,
        base + 0.071,
        axis === 'x' ? spanMeters - 0.10 : 0.14,
        0.018,
        axis === 'x' ? 0.14 : spanMeters - 0.10,
        drainDark,
      );
      counts.linearDrainChannels += 1;

      const slotCount = Math.max(3, Math.floor(spanMeters / 0.24));
      const center = planToLocal(planX, planZ);
      for (let slot = 0; slot < slotCount; slot += 1) {
        const along = spanMeters * (slot + 0.5) / slotCount - spanMeters * 0.5;
        addBoxLocal(
          center.x + normalX * (isGarageBay ? 0.31 : 0.255) + (axis === 'x' ? along : 0),
          center.z + normalZ * (isGarageBay ? 0.31 : 0.255) + (axis === 'z' ? along : 0),
          base + 0.082,
          axis === 'x' ? 0.025 : 0.16,
          0.008,
          axis === 'x' ? 0.16 : 0.025,
          zinc,
        );
      }
      counts.linearDrainSlots += slotCount;

      if (!isGarageBay) {
        // Flush pull on the parked stack, held close to the jamb rather than
        // projecting into the clear sliding-door opening.
        const pullAlong = span.from + Math.min(span.to - span.from, 3) * 0.76;
        const pullPlanX = axis === 'x' ? pullAlong : span.at;
        const pullPlanZ = axis === 'x' ? span.at : pullAlong;
        addOffsetBox(
          pullPlanX,
          pullPlanZ,
          normalX,
          normalZ,
          0.13,
          base + 1.07,
          axis === 'x' ? 0.065 : 0.024,
          0.28,
          axis === 'x' ? 0.024 : 0.065,
          bronze,
        );
        counts.doorHardwarePieces += 1;
      }
      continue;
    }

    // Match the existing held-open cedar leaf and put a round pull over the
    // original block handle. This is visual-only and does not create a new
    // collider in the open doorway.
    const doorWidth = Math.max(0.62, spanMeters - 0.1);
    const angle = opening.index % 2 ? 0.48 : -0.48;
    const hingeAlong = span.from + 0.05 / FEET_TO_METERS;
    const hingePlanX = axis === 'x' ? hingeAlong : span.at;
    const hingePlanZ = axis === 'x' ? span.at : hingeAlong;
    const hinge = planToLocal(hingePlanX, hingePlanZ);
    const handleDistance = doorWidth * 0.83;
    const handle = axis === 'x'
      ? {
          x: hinge.x + Math.cos(angle) * handleDistance,
          z: hinge.z - Math.sin(angle) * handleDistance,
        }
      : {
          x: hinge.x + Math.sin(angle) * handleDistance,
          z: hinge.z + Math.cos(angle) * handleDistance,
        };
    addBoxLocal(
      handle.x,
      handle.z,
      base + 1.02,
      axis === 'x' ? 0.068 : 0.026,
      0.24,
      axis === 'x' ? 0.026 : 0.068,
      charcoal,
      angle,
    );
    addRodLocal(
      new THREE.Vector3(handle.x, base + 0.91, handle.z),
      new THREE.Vector3(handle.x, base + 1.13, handle.z),
      0.032,
      bronze,
    );
    counts.doorHardwarePieces += 2;
  }

  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  boxGeometry.name = 'Exterior sheet-metal unit profile';
  const rodGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, false);
  rodGeometry.name = 'Exterior round hardware unit profile';
  const metalMaterial = new THREE.MeshStandardMaterial({
    name: 'Exterior zinc, bronze, and drain hardware',
    color: 0xffffff,
    roughness: 0.38,
    metalness: 0.72,
  });
  const runoffMaterial = new THREE.MeshStandardMaterial({
    name: 'Subtle drain-aligned mineral runoff',
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const meshes = [
    createInstancedMesh('Folded roof and opening sheet metal', boxGeometry, metalMaterial, boxEntries),
    createInstancedMesh('Round exterior door hardware', rodGeometry, metalMaterial, rodEntries),
    createInstancedMesh(
      'Drain-aligned exterior mineral runoff',
      boxGeometry,
      runoffMaterial,
      runoffEntries,
      { castShadow: false, receiveShadow: false },
    ),
  ];
  root.add(...meshes);

  const stats = Object.freeze({
    drawCalls: meshes.length,
    instances: boxEntries.length + rodEntries.length,
    boxInstances: boxEntries.length,
    roundHardwareInstances: rodEntries.length,
    copingCaps: counts.copingCaps,
    copingDripEdges: counts.copingDripEdges,
    roofDrainAssemblies: counts.roofDrainAssemblies,
    roofDrainPieces: counts.roofDrainPieces,
    exteriorOpenings: counts.exteriorOpenings,
    headFlashingPieces: counts.headFlashings,
    sillFlashingPieces: counts.sillFlashings,
    thresholds: counts.thresholds,
    linearDrainChannels: counts.linearDrainChannels,
    linearDrainSlots: counts.linearDrainSlots,
    doorHardwarePieces: counts.doorHardwarePieces,
    lanaiPostFaces: counts.lanaiPostFaces,
    lanaiPostShoes: counts.lanaiPostShoes,
    lanaiBeams: counts.lanaiBeams,
    lanaiGutters: counts.lanaiGutters,
    lanaiDownspouts: counts.lanaiDownspouts,
    runoffStreaks: counts.runoffStreaks,
  });
  root.userData.stats = stats;

  function dispose() {
    root.removeFromParent();
    boxGeometry.dispose();
    rodGeometry.dispose();
    metalMaterial.dispose();
    runoffMaterial.dispose();
  }

  return { root, stats, dispose };
}
