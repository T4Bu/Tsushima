import * as THREE from 'three';
import {
  COMPOUND_PLAN,
  COMPOUND_SITE,
  FEET_TO_METERS,
  planToLocal,
  planToWorld,
} from './site-layout.js';

const UP = new THREE.Vector3(0, 1, 0);
const SECONDARY_BUILDING_IDS = new Set(['guest-house', 'fab-lab', 'garage']);
const WINDOW_SILL = 0.72;
const WINDOW_HEAD = 2.38;
const DOOR_HEAD = 2.48;

const BUILDING_STYLE = Object.freeze({
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

function findSecondaryExterior(opening) {
  const axis = openingAxis(opening);
  const span = openingSpan(opening);
  for (const building of COMPOUND_PLAN.buildingList) {
    if (!SECONDARY_BUILDING_IDS.has(building.id)) continue;
    const z0 = rectangleZ(building);
    const z1 = z0 + building.depth;
    const x0 = building.x;
    const x1 = building.x + building.width;
    if (axis === 'x' && overlaps(span.from, span.to, x0, x1)) {
      if (Math.abs(span.at - z0) <= 0.12) {
        return { building, axis, span, side: 'north', normalX: 0, normalZ: -1 };
      }
      if (Math.abs(span.at - z1) <= 0.12) {
        return { building, axis, span, side: 'south', normalX: 0, normalZ: 1 };
      }
    }
    if (axis === 'z' && overlaps(span.from, span.to, z0, z1)) {
      if (Math.abs(span.at - x0) <= 0.12) {
        return { building, axis, span, side: 'west', normalX: -1, normalZ: 0 };
      }
      if (Math.abs(span.at - x1) <= 0.12) {
        return { building, axis, span, side: 'east', normalX: 1, normalZ: 0 };
      }
    }
  }
  return null;
}

function createInstancedMesh(name, geometry, material, entries, castShadow = true) {
  const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
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
 * Adds close-range construction and utility depth to the guest, fab, and
 * garage elevations. The layer is deliberately visual-only: return linings
 * sit outside each clear opening and utility equipment adds no colliders.
 */
export function createCompoundSecondaryElevations({
  heightAt,
  palette = {},
  doorOpenings = [],
  windowOpenings = [],
} = {}) {
  const root = new THREE.Group();
  root.name = 'Compound secondary-elevation detail layer';
  root.position.set(COMPOUND_SITE.centerX, 0, COMPOUND_SITE.centerZ);
  root.rotation.y = COMPOUND_SITE.yaw;
  root.userData.coordinateSystem = 'plan-aligned local metres; absolute world elevation';

  const charcoal = new THREE.Color(palette?.shadowTeal ?? 0x172523)
    .lerp(new THREE.Color(0x414945), 0.25);
  const reveal = new THREE.Color(0x2e3b39);
  const zinc = new THREE.Color(0x747a75);
  const steel = new THREE.Color(0x89918a);
  const warmMetal = new THREE.Color(0x9c7046);
  const casing = new THREE.Color(0x59615c);
  const equipment = new THREE.Color(0x39433f);
  const indicator = new THREE.Color(0x86aa92);

  const baseByBuilding = new Map();
  for (const building of COMPOUND_PLAN.buildingList) {
    if (SECONDARY_BUILDING_IDS.has(building.id)) {
      baseByBuilding.set(building.id, sampleTerraceHeight(heightAt, building));
    }
  }

  const boxEntries = [];
  const roundEntries = [];
  const downlightEntries = [];
  const counts = {
    detailedOpenings: 0,
    jambReturnPieces: 0,
    cornerTrimPieces: 0,
    raisedRoofPieces: 0,
    louverAssemblies: 0,
    louverPieces: 0,
    utilityCabinets: 0,
    utilityBoxPieces: 0,
    roundUtilityPieces: 0,
    serviceDownlights: 0,
    guestBenchPieces: 0,
    fabCanopyPieces: 0,
    fabCanopyBraces: 0,
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

  const addBox = (planX, planZ, ...args) => {
    const local = planToLocal(planX, planZ);
    addBoxLocal(local.x, local.z, ...args);
  };

  const addRodLocal = (start, end, diameter, color, target = roundEntries) => {
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length < 0.0001) return;
    const matrix = new THREE.Matrix4();
    matrix.compose(
      start.clone().add(end).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize()),
      new THREE.Vector3(diameter, length, diameter),
    );
    target.push({ matrix, color });
  };

  const surfacePoint = (planX, planZ, normalX, normalZ, offset) => {
    const local = planToLocal(planX, planZ);
    return new THREE.Vector3(local.x + normalX * offset, 0, local.z + normalZ * offset);
  };

  const addSurfaceBox = (
    planX,
    planZ,
    normalX,
    normalZ,
    offset,
    y,
    alongWidth,
    height,
    thickness,
    color,
  ) => {
    const point = surfacePoint(planX, planZ, normalX, normalZ, offset);
    addBoxLocal(
      point.x,
      point.z,
      y,
      normalX === 0 ? alongWidth : thickness,
      height,
      normalX === 0 ? thickness : alongWidth,
      color,
    );
  };

  // Deep return liners terminate just outside each clear span. The architecture
  // frame retains its exact opening width while these inner planes reveal the
  // wall's believable 9-inch construction depth at oblique viewing angles.
  const secondaryOpenings = [
    ...windowOpenings.map((opening, index) => normalizeOpening(opening, index, 'window')),
    ...doorOpenings.map((opening, index) => normalizeOpening(opening, index, 'door')),
  ];
  for (const opening of secondaryOpenings) {
    const exterior = findSecondaryExterior(opening);
    if (!exterior) continue;
    const { building, axis, span, normalX, normalZ } = exterior;
    const base = baseByBuilding.get(building.id) ?? 0;
    const style = BUILDING_STYLE[building.id];
    const centerAlong = (span.from + span.to) * 0.5;
    const planX = axis === 'x' ? centerAlong : span.at;
    const planZ = axis === 'x' ? span.at : centerAlong;
    const center = planToLocal(planX, planZ);
    const tangentX = axis === 'x' ? 1 : 0;
    const tangentZ = axis === 'z' ? 1 : 0;
    const spanMeters = (span.to - span.from) * FEET_TO_METERS;
    const sill = opening.kind === 'window' ? WINDOW_SILL : 0.035;
    const head = Math.min(
      opening.kind === 'window' ? WINDOW_HEAD : DOOR_HEAD,
      style.wallHeight - 0.18,
    );
    const centerY = base + (sill + head) * 0.5;
    const returnDepth = 0.235;
    const jambThickness = 0.032;

    for (const side of [-1, 1]) {
      addBoxLocal(
        center.x + tangentX * side * (spanMeters * 0.5 + jambThickness * 0.5)
          - normalX * 0.008,
        center.z + tangentZ * side * (spanMeters * 0.5 + jambThickness * 0.5)
          - normalZ * 0.008,
        centerY,
        axis === 'x' ? jambThickness : returnDepth,
        head - sill,
        axis === 'x' ? returnDepth : jambThickness,
        reveal,
      );
    }
    addBoxLocal(
      center.x - normalX * 0.008,
      center.z - normalZ * 0.008,
      base + head - 0.016,
      axis === 'x' ? spanMeters + jambThickness * 2 : returnDepth,
      0.032,
      axis === 'x' ? returnDepth : spanMeters + jambThickness * 2,
      reveal,
    );
    counts.jambReturnPieces += 3;

    if (opening.kind === 'window') {
      addBoxLocal(
        center.x - normalX * 0.008,
        center.z - normalZ * 0.008,
        base + sill + 0.015,
        axis === 'x' ? spanMeters + jambThickness * 2 : returnDepth,
        0.03,
        axis === 'x' ? returnDepth : spanMeters + jambThickness * 2,
        casing,
      );
      counts.jambReturnPieces += 1;
    } else if (spanMeters <= 1.35) {
      // Recessed downlight centered over each personnel/service door. It sits
      // beneath the overhang and contributes no new point light or collider.
      const lightPoint = surfacePoint(planX, planZ, normalX, normalZ, 0.20);
      const matrix = new THREE.Matrix4();
      matrix.compose(
        new THREE.Vector3(lightPoint.x, base + style.roofHeight - 0.088, lightPoint.z),
        new THREE.Quaternion(),
        new THREE.Vector3(0.17, 0.026, 0.17),
      );
      downlightEntries.push({ matrix, color: warmMetal });
      counts.serviceDownlights += 1;
    }
    counts.detailedOpenings += 1;
  }

  // Slim L-shaped corner closures give the secondary volumes a clear order of
  // assembly. They sit on wall faces rather than beyond the building corner,
  // so they do not change navigation around the structures.
  for (const building of COMPOUND_PLAN.buildingList) {
    if (!SECONDARY_BUILDING_IDS.has(building.id)) continue;
    const base = baseByBuilding.get(building.id) ?? 0;
    const style = BUILDING_STYLE[building.id];
    const z0 = rectangleZ(building);
    const z1 = z0 + building.depth;
    const x0 = building.x;
    const x1 = building.x + building.width;
    const trimHeight = style.wallHeight - 0.34;
    const trimY = base + 0.15 + trimHeight * 0.5;
    for (const [x, z, signX, signZ] of [
      [x0, z0, -1, -1],
      [x1, z0, 1, -1],
      [x0, z1, -1, 1],
      [x1, z1, 1, 1],
    ]) {
      const corner = planToLocal(x, z);
      addBoxLocal(corner.x + signX * 0.014, corner.z, trimY, 0.028, trimHeight, 0.11, zinc);
      addBoxLocal(corner.x, corner.z + signZ * 0.014, trimY, 0.11, trimHeight, 0.028, zinc);
      counts.cornerTrimPieces += 2;
    }
  }

  const addRaisedRoofEdge = (rectangle, topY) => {
    const z0 = rectangleZ(rectangle);
    const z1 = z0 + rectangle.depth;
    const x0 = rectangle.x;
    const x1 = rectangle.x + rectangle.width;
    const centerX = (x0 + x1) * 0.5;
    const centerZ = (z0 + z1) * 0.5;
    const width = rectangle.width * FEET_TO_METERS;
    const depth = rectangle.depth * FEET_TO_METERS;
    const capWidth = 0.20;
    const edgeOffsetFeet = capWidth * 0.5 / FEET_TO_METERS;

    addBox(centerX, z0, topY, width + capWidth, 0.025, capWidth, zinc);
    addBox(centerX, z1, topY, width + capWidth, 0.025, capWidth, zinc);
    addBox(x0, centerZ, topY, capWidth, 0.025, depth + capWidth, zinc);
    addBox(x1, centerZ, topY, capWidth, 0.025, depth + capWidth, zinc);
    addBox(centerX, z0 - edgeOffsetFeet, topY - 0.038, width + capWidth, 0.06, 0.018, charcoal);
    addBox(centerX, z1 + edgeOffsetFeet, topY - 0.038, width + capWidth, 0.06, 0.018, charcoal);
    addBox(x0 - edgeOffsetFeet, centerZ, topY - 0.038, 0.018, 0.06, depth + capWidth, charcoal);
    addBox(x1 + edgeOffsetFeet, centerZ, topY - 0.038, 0.018, 0.06, depth + capWidth, charcoal);
    counts.raisedRoofPieces += 8;
  };

  const guestBase = baseByBuilding.get('guest-house') ?? 0;
  const fabBase = baseByBuilding.get('fab-lab') ?? 0;
  const garageBase = baseByBuilding.get('garage') ?? 0;
  addRaisedRoofEdge(
    { x: 108, z: 76, width: 14, depth: 13 },
    guestBase + 3.620,
  );
  addRaisedRoofEdge(
    { x: 128, z: 12, width: 16, depth: 12 },
    fabBase + 4.165,
  );

  const addLouver = (planX, planZ, normalX, normalZ, base, centerY, width, height) => {
    addSurfaceBox(planX, planZ, normalX, normalZ, 0.083, base + centerY, width, height, 0.045, charcoal);
    const slatCount = Math.max(4, Math.floor(height / 0.075));
    for (let index = 0; index < slatCount; index += 1) {
      const y = base + centerY - height * 0.5 + (index + 0.5) * height / slatCount;
      addSurfaceBox(
        planX,
        planZ,
        normalX,
        normalZ,
        0.112,
        y,
        width - 0.09,
        0.026,
        0.06,
        zinc,
      );
      counts.louverPieces += 1;
    }
    counts.louverAssemblies += 1;
    counts.louverPieces += 1;
  };

  // Fab service-drive elevation: meter/disconnect bank, exposed conduit, one
  // high intake louver, and a separate exhaust hood make the workshop read as
  // a functioning fabrication space from its east and north approaches.
  addSurfaceBox(144, 25.4, 1, 0, 0.095, fabBase + 1.18, 0.82, 0.88, 0.09, equipment);
  addSurfaceBox(144, 26.15, 1, 0, 0.148, fabBase + 0.93, 0.34, 0.42, 0.055, casing);
  counts.utilityCabinets += 2;
  counts.utilityBoxPieces += 2;
  for (const [planZ, y] of [[25.12, 1.34], [25.68, 1.34]]) {
    const meter = surfacePoint(144, planZ, 1, 0, 0.158);
    addRodLocal(
      new THREE.Vector3(meter.x - 0.018, fabBase + y, meter.z),
      new THREE.Vector3(meter.x + 0.045, fabBase + y, meter.z),
      0.235,
      steel,
    );
    counts.roundUtilityPieces += 1;
  }
  for (const planZ of [25.12, 25.68, 26.15]) {
    const conduit = surfacePoint(144, planZ, 1, 0, 0.165);
    addRodLocal(
      new THREE.Vector3(conduit.x, fabBase + 0.16, conduit.z),
      new THREE.Vector3(conduit.x, fabBase + 0.76, conduit.z),
      0.034,
      zinc,
    );
    counts.roundUtilityPieces += 1;
  }
  const upperConduit = surfacePoint(144, 25.4, 1, 0, 0.165);
  addRodLocal(
    new THREE.Vector3(upperConduit.x, fabBase + 1.62, upperConduit.z),
    new THREE.Vector3(upperConduit.x, fabBase + 2.78, upperConduit.z),
    0.038,
    zinc,
  );
  counts.roundUtilityPieces += 1;
  addLouver(136.5, 12, 0, -1, fabBase, 2.34, 1.04, 0.48);
  addLouver(144, 35.8, 1, 0, fabBase, 2.16, 0.62, 0.46);

  // Guest mechanical side: a compact screened heat pump, bathroom exhaust,
  // refrigerant riser, and hose bib occupy non-circulation faces only.
  const condenser = planToLocal(135.7, 91.0);
  addBoxLocal(condenser.x, condenser.z, guestBase + 0.04, 0.94, 0.08, 0.88, casing);
  addBoxLocal(condenser.x, condenser.z, guestBase + 0.43, 0.70, 0.70, 0.70, equipment);
  addBoxLocal(condenser.x + 0.365, condenser.z, guestBase + 0.43, 0.025, 0.58, 0.58, charcoal);
  counts.utilityCabinets += 1;
  counts.utilityBoxPieces += 3;
  for (let index = 0; index < 6; index += 1) {
    addBoxLocal(
      condenser.x + 0.383,
      condenser.z,
      guestBase + 0.21 + index * 0.085,
      0.022,
      0.026,
      0.54,
      zinc,
    );
    counts.utilityBoxPieces += 1;
  }
  addRodLocal(
    new THREE.Vector3(condenser.x + 0.37, guestBase + 0.43, condenser.z - 0.018),
    new THREE.Vector3(condenser.x + 0.415, guestBase + 0.43, condenser.z - 0.018),
    0.38,
    charcoal,
  );
  counts.roundUtilityPieces += 1;
  const refrigerant = surfacePoint(134, 91.0, 1, 0, 0.12);
  addRodLocal(
    new THREE.Vector3(refrigerant.x, guestBase + 0.22, refrigerant.z),
    new THREE.Vector3(refrigerant.x, guestBase + 1.44, refrigerant.z),
    0.036,
    warmMetal,
  );
  counts.roundUtilityPieces += 1;
  addLouver(121.5, 98, 0, 1, guestBase, 2.12, 0.58, 0.42);
  const hose = surfacePoint(110.2, 98, 0, 1, 0.135);
  addRodLocal(
    new THREE.Vector3(hose.x, guestBase + 0.58, hose.z - 0.035),
    new THREE.Vector3(hose.x, guestBase + 0.58, hose.z + 0.13),
    0.032,
    warmMetal,
  );
  addRodLocal(
    new THREE.Vector3(hose.x, guestBase + 0.58, hose.z + 0.13),
    new THREE.Vector3(hose.x, guestBase + 0.47, hose.z + 0.13),
    0.028,
    warmMetal,
  );
  counts.roundUtilityPieces += 2;

  // A wall-mounted mineral bench gives the pool-house entry a human-scale
  // pause without narrowing the guest walk. Its shallow steel brackets stay
  // inside the same visual-only detail batch as the surrounding trims.
  addSurfaceBox(
    108,
    93.2,
    -1,
    0,
    0.24,
    guestBase + 0.49,
    1.50,
    0.085,
    0.48,
    casing,
  );
  for (const planZ of [91.75, 94.65]) {
    addSurfaceBox(
      108,
      planZ,
      -1,
      0,
      0.16,
      guestBase + 0.28,
      0.065,
      0.40,
      0.26,
      charcoal,
    );
  }
  counts.guestBenchPieces += 3;

  // Separate shallow canopies distinguish the fab personnel door from the
  // larger equipment opening. Folded outer fascias and paired tension braces
  // keep them legible as constructed assemblies rather than floating slabs.
  const addFabCanopy = (planX, width, depth, braceOffsets) => {
    addSurfaceBox(
      planX,
      38,
      0,
      1,
      depth * 0.5,
      fabBase + 2.70,
      width,
      0.09,
      depth,
      charcoal,
    );
    addSurfaceBox(
      planX,
      38,
      0,
      1,
      depth - 0.035,
      fabBase + 2.62,
      width,
      0.13,
      0.07,
      zinc,
    );
    counts.fabCanopyPieces += 2;
    for (const offset of braceOffsets) {
      const bracePlanX = planX + offset / FEET_TO_METERS;
      const wall = surfacePoint(bracePlanX, 38, 0, 1, 0.11);
      const outer = surfacePoint(bracePlanX, 38, 0, 1, depth - 0.09);
      addRodLocal(
        new THREE.Vector3(wall.x, fabBase + 2.43, wall.z),
        new THREE.Vector3(outer.x, fabBase + 2.66, outer.z),
        0.034,
        steel,
      );
      counts.fabCanopyBraces += 1;
      counts.roundUtilityPieces += 1;
    }
  };
  addFabCanopy(119.5, 1.30, 0.56, [-0.47, 0.47]);
  addFabCanopy(138.0, 2.82, 0.76, [-1.12, 1.12]);

  // Garage north/service wall: an EV-ready weatherproof cabinet and orderly
  // conduit run add plausible infrastructure away from all three vehicle bays.
  addSurfaceBox(21.7, 88, 0, -1, 0.095, garageBase + 1.16, 0.42, 0.66, 0.10, equipment);
  addSurfaceBox(21.7, 88, 0, -1, 0.154, garageBase + 1.23, 0.18, 0.22, 0.035, indicator);
  counts.utilityCabinets += 1;
  counts.utilityBoxPieces += 2;
  const garageConduit = surfacePoint(21.7, 88, 0, -1, 0.165);
  addRodLocal(
    new THREE.Vector3(garageConduit.x, garageBase + 1.50, garageConduit.z),
    new THREE.Vector3(garageConduit.x, garageBase + 2.66, garageConduit.z),
    0.036,
    zinc,
  );
  addRodLocal(
    new THREE.Vector3(garageConduit.x, garageBase + 0.30, garageConduit.z),
    new THREE.Vector3(garageConduit.x, garageBase + 0.82, garageConduit.z),
    0.04,
    charcoal,
  );
  addRodLocal(
    new THREE.Vector3(garageConduit.x, garageBase + 0.30, garageConduit.z),
    new THREE.Vector3(garageConduit.x + 0.48, garageBase + 0.30, garageConduit.z),
    0.04,
    charcoal,
  );
  counts.roundUtilityPieces += 3;
  addSurfaceBox(22.0, 88, 0, -1, 0.18, garageBase + 0.31, 0.18, 0.12, 0.10, charcoal);
  counts.utilityBoxPieces += 1;
  addLouver(16, 116.0, -1, 0, garageBase, 2.16, 0.66, 0.46);

  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  boxGeometry.name = 'Secondary elevation unit box';
  const cylinderGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 14, 1, false);
  cylinderGeometry.name = 'Secondary elevation round utility profile';
  const detailMaterial = new THREE.MeshStandardMaterial({
    name: 'Secondary elevation painted metal and reveals',
    color: 0xffffff,
    roughness: 0.56,
    metalness: 0.46,
  });
  const roundMaterial = new THREE.MeshStandardMaterial({
    name: 'Secondary elevation conduit and mechanical metal',
    color: 0xffffff,
    roughness: 0.38,
    metalness: 0.7,
  });
  const downlightMaterial = new THREE.MeshStandardMaterial({
    name: 'Secondary elevation warm recessed downlights',
    color: 0xffffff,
    roughness: 0.48,
    metalness: 0.22,
    emissive: 0xffa75d,
    emissiveIntensity: 2.2,
  });

  const meshes = [
    createInstancedMesh('Secondary opening returns and utility enclosures', boxGeometry, detailMaterial, boxEntries),
    createInstancedMesh('Secondary meters, conduits, fans, and hose fittings', cylinderGeometry, roundMaterial, roundEntries),
    createInstancedMesh('Secondary service-door downlights', cylinderGeometry, downlightMaterial, downlightEntries, false),
  ];
  root.add(...meshes);

  const stats = Object.freeze({
    drawCalls: meshes.length,
    instances: boxEntries.length + roundEntries.length + downlightEntries.length,
    boxInstances: boxEntries.length,
    roundUtilityInstances: roundEntries.length,
    serviceDownlights: counts.serviceDownlights,
    detailedOpenings: counts.detailedOpenings,
    jambReturnPieces: counts.jambReturnPieces,
    cornerTrimPieces: counts.cornerTrimPieces,
    raisedRoofPieces: counts.raisedRoofPieces,
    louverAssemblies: counts.louverAssemblies,
    louverPieces: counts.louverPieces,
    utilityCabinets: counts.utilityCabinets,
    utilityBoxPieces: counts.utilityBoxPieces,
    roundUtilityPieces: counts.roundUtilityPieces,
    guestBenchPieces: counts.guestBenchPieces,
    fabCanopyPieces: counts.fabCanopyPieces,
    fabCanopyBraces: counts.fabCanopyBraces,
    collidersAdded: 0,
  });
  root.userData.stats = stats;

  function dispose() {
    root.removeFromParent();
    boxGeometry.dispose();
    cylinderGeometry.dispose();
    detailMaterial.dispose();
    roundMaterial.dispose();
    downlightMaterial.dispose();
  }

  return { root, stats, dispose };
}
