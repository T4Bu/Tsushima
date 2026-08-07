import * as THREE from 'three';
import {
  COMPOUND_PLAN,
  COMPOUND_SITE,
  FEET_TO_METERS,
  planToWorld,
  worldToPlan,
} from './site-layout.js';

const TERRAIN_SIZE = 250;
const TERRAIN_HALF = TERRAIN_SIZE * 0.5;
const TERRAIN_SEGMENTS = 176;
const PATH_START_Z = TERRAIN_HALF - 1;
const PATH_END_Z = -TERRAIN_HALF + 1;
const MATERIAL_ASSET_ROOT = `${import.meta.env.BASE_URL}assets/materials/`;

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const lerp = (a, b, t) => a + (b - a) * t;

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

// The meadow trail branches at its world-space centre near z=38, then follows
// a broad, gently bending contour toward the compound. The final control point
// is the authored 38' motor-court gate centre, so moving the site transform does
// not silently disconnect the landscape route from the architecture.
const mainGatePlanZ = COMPOUND_PLAN.lot.z + COMPOUND_PLAN.lot.depth;
const mainGateCenter = planToWorld(
  COMPOUND_PLAN.driveway.x + COMPOUND_PLAN.driveway.width * 0.5,
  mainGatePlanZ,
);
const mainGateWest = planToWorld(COMPOUND_PLAN.driveway.x, mainGatePlanZ);
const mainGateEast = planToWorld(
  COMPOUND_PLAN.driveway.x + COMPOUND_PLAN.driveway.width,
  mainGatePlanZ,
);

/** Shared deterministic world-XZ contract for the landscape-to-gate spur. */
export const GATE_ACCESS_ROUTE = Object.freeze([
  Object.freeze({ x: -7.5, z: 38 }),
  Object.freeze({ x: 8, z: 42 }),
  Object.freeze({ x: 27, z: 41 }),
  Object.freeze({ x: 42, z: 37 }),
  Object.freeze({ x: mainGateCenter.x, z: mainGateCenter.z }),
]);

const GATE_ACCESS_FLARE_LENGTH = 11;
const GATE_ACCESS_GATE_HALF_WIDTH = COMPOUND_PLAN.driveway.width * FEET_TO_METERS * 0.5 - 0.24;
const GATE_ACCESS_CURVE_SEGMENTS = 112;
const gateAccessCurve = new THREE.CatmullRomCurve3(
  GATE_ACCESS_ROUTE.map((point) => new THREE.Vector3(point.x, 0, point.z)),
  false,
  'centripetal',
);
gateAccessCurve.arcLengthDivisions = 320;

const gateAccessCurvePoints = gateAccessCurve.getSpacedPoints(GATE_ACCESS_CURVE_SEGMENTS);
const gateAccessGateAxisLength = Math.hypot(
  mainGateEast.x - mainGateWest.x,
  mainGateEast.z - mainGateWest.z,
);
const gateAccessGateAxis = Object.freeze({
  x: (mainGateEast.x - mainGateWest.x) / gateAccessGateAxisLength,
  z: (mainGateEast.z - mainGateWest.z) / gateAccessGateAxisLength,
});
let gateAccessRouteLength = 0;
const gateAccessSamples = gateAccessCurvePoints.map((point, index) => {
  if (index > 0) {
    const previous = gateAccessCurvePoints[index - 1];
    gateAccessRouteLength += Math.hypot(point.x - previous.x, point.z - previous.z);
  }
  return {
    x: point.x,
    z: point.z,
    distance: gateAccessRouteLength,
    axisX: 0,
    axisZ: 1,
  };
});

for (let index = 0; index < gateAccessSamples.length; index += 1) {
  const previous = gateAccessSamples[Math.max(0, index - 1)];
  const next = gateAccessSamples[Math.min(gateAccessSamples.length - 1, index + 1)];
  const tangentX = next.x - previous.x;
  const tangentZ = next.z - previous.z;
  const tangentLength = Math.max(0.0001, Math.hypot(tangentX, tangentZ));
  let axisX = -tangentZ / tangentLength;
  let axisZ = tangentX / tangentLength;
  const flare = smoothstep(
    gateAccessRouteLength - GATE_ACCESS_FLARE_LENGTH,
    gateAccessRouteLength,
    gateAccessSamples[index].distance,
  );
  let alignedGateAxisX = gateAccessGateAxis.x;
  let alignedGateAxisZ = gateAccessGateAxis.z;
  if (axisX * alignedGateAxisX + axisZ * alignedGateAxisZ < 0) {
    alignedGateAxisX *= -1;
    alignedGateAxisZ *= -1;
  }
  axisX = lerp(axisX, alignedGateAxisX, flare);
  axisZ = lerp(axisZ, alignedGateAxisZ, flare);
  const axisLength = Math.max(0.0001, Math.hypot(axisX, axisZ));
  gateAccessSamples[index].axisX = axisX / axisLength;
  gateAccessSamples[index].axisZ = axisZ / axisLength;
}

const gateAccessBounds = Object.freeze({
  minX: Math.min(...gateAccessSamples.map((sample) => sample.x)) - GATE_ACCESS_GATE_HALF_WIDTH - 3,
  maxX: Math.max(...gateAccessSamples.map((sample) => sample.x)) + GATE_ACCESS_GATE_HALF_WIDTH + 3,
  minZ: Math.min(...gateAccessSamples.map((sample) => sample.z)) - GATE_ACCESS_GATE_HALF_WIDTH - 3,
  maxZ: Math.max(...gateAccessSamples.map((sample) => sample.z)) + GATE_ACCESS_GATE_HALF_WIDTH + 3,
});

function isInsideGateAccessBounds(x, z, padding = 0) {
  return x >= gateAccessBounds.minX - padding
    && x <= gateAccessBounds.maxX + padding
    && z >= gateAccessBounds.minZ - padding
    && z <= gateAccessBounds.maxZ + padding;
}

function gateAccessWidthAtDistance(distance) {
  const baseWidth = THREE.MathUtils.clamp(
    3.5 + 0.21 * Math.sin(distance * 0.17 + 0.55) + 0.07 * Math.sin(distance * 0.43),
    3.2,
    3.8,
  );
  const flare = smoothstep(
    gateAccessRouteLength - GATE_ACCESS_FLARE_LENGTH,
    gateAccessRouteLength,
    distance,
  );
  return lerp(baseWidth, GATE_ACCESS_GATE_HALF_WIDTH * 2, flare);
}

function nearestGateAccessRoutePoint(x, z) {
  let distanceSquared = Infinity;
  let alongDistance = 0;
  for (let index = 0; index < gateAccessSamples.length - 1; index += 1) {
    const start = gateAccessSamples[index];
    const end = gateAccessSamples[index + 1];
    const segmentX = end.x - start.x;
    const segmentZ = end.z - start.z;
    const segmentLengthSquared = segmentX * segmentX + segmentZ * segmentZ;
    const along = segmentLengthSquared > 0
      ? clamp01(((x - start.x) * segmentX + (z - start.z) * segmentZ) / segmentLengthSquared)
      : 0;
    const nearestX = start.x + segmentX * along;
    const nearestZ = start.z + segmentZ * along;
    const dx = x - nearestX;
    const dz = z - nearestZ;
    const candidate = dx * dx + dz * dz;
    if (candidate < distanceSquared) {
      distanceSquared = candidate;
      alongDistance = lerp(start.distance, end.distance, along);
    }
  }
  return { distance: Math.sqrt(distanceSquared), alongDistance };
}

function gateAccessSampleAtDistance(distance) {
  const samplePosition = clamp01(distance / Math.max(gateAccessRouteLength, 0.0001))
    * (gateAccessSamples.length - 1);
  const index = Math.min(gateAccessSamples.length - 2, Math.floor(samplePosition));
  const amount = samplePosition - index;
  const start = gateAccessSamples[index];
  const end = gateAccessSamples[index + 1];
  let axisX = lerp(start.axisX, end.axisX, amount);
  let axisZ = lerp(start.axisZ, end.axisZ, amount);
  const axisLength = Math.max(0.0001, Math.hypot(axisX, axisZ));
  axisX /= axisLength;
  axisZ /= axisLength;
  return {
    x: lerp(start.x, end.x, amount),
    z: lerp(start.z, end.z, amount),
    axisX,
    axisZ,
    distance: THREE.MathUtils.clamp(distance, 0, gateAccessRouteLength),
  };
}

/** Distance in metres to the gate-spur centre line. */
export function distanceToGateAccessRoute(x, z) {
  return nearestGateAccessRoutePoint(x, z).distance;
}

/** Local route half-width, including the final 11 m gate flare. */
export function gateAccessRouteHalfWidthAt(x, z) {
  const nearest = nearestGateAccessRoutePoint(x, z);
  return gateAccessWidthAtDistance(nearest.alongDistance) * 0.5;
}

/**
 * Signed distance from the surfaced route edge. Values <= 0 are on the route;
 * `extra` expands that mask for vegetation recovery and prop clearance.
 */
export function gateAccessRouteClearance(x, z, extra = 0) {
  const nearest = nearestGateAccessRoutePoint(x, z);
  return nearest.distance
    - gateAccessWidthAtDistance(nearest.alongDistance) * 0.5
    - Math.max(0, extra);
}

// Integer-only hashing keeps placement and terrain colors stable across runs.
function hash2(x, z) {
  let h = Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(z | 0, 0x5f356495);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967295;
}

function valueNoise(x, z, cellSize) {
  const gx = x / cellSize;
  const gz = z / cellSize;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);

  const a = lerp(hash2(ix, iz), hash2(ix + 1, iz), sx);
  const b = lerp(hash2(ix, iz + 1), hash2(ix + 1, iz + 1), sx);
  return lerp(a, b, sz) * 2 - 1;
}

/** Center X of the main trail for a world-space Z coordinate. */
export function pathX(z) {
  const fromEntry = z - 92;
  return (
    11 * Math.sin(fromEntry * 0.035) +
    3.5 * Math.sin(fromEntry * 0.098)
  );
}

function pathDerivative(z) {
  const fromEntry = z - 92;
  return (
    11 * 0.035 * Math.cos(fromEntry * 0.035) +
    3.5 * 0.098 * Math.cos(fromEntry * 0.098)
  );
}

/** Center Z of the shallow stream for a world-space X coordinate. */
export function riverZ(x) {
  return (
    -26 +
    6 * Math.sin((x + 18) * 0.035) +
    2 * Math.sin((x - 24) * 0.075)
  );
}

function riverDerivative(x) {
  return (
    6 * 0.035 * Math.cos((x + 18) * 0.035) +
    2 * 0.075 * Math.cos((x - 24) * 0.075)
  );
}

/** Approximate perpendicular distance to the trail center line. */
export function distanceToPath(x, z) {
  const dx = x - pathX(z);
  return Math.abs(dx) / Math.sqrt(1 + pathDerivative(z) ** 2);
}

/** Approximate perpendicular distance to the stream center line. */
export function distanceToRiver(x, z) {
  const dz = z - riverZ(x);
  return Math.abs(dz) / Math.sqrt(1 + riverDerivative(x) ** 2);
}

function macroHeightAt(x, z) {
  const basinRadius = Math.hypot(x * 0.84, z + 3);
  const basin = -2.15 * Math.exp(-(basinRadius * basinRadius) / (2 * 54 * 54));
  const rim = Math.max(0, basinRadius - 48);

  // The positive-Z ridge is the elevated bamboo entry. It eases down into
  // the open meadow instead of presenting the player with a hard terrace.
  const entryRidge =
    6.8 * smoothstep(58, 110, z) + 1.2 * smoothstep(98, 124, z);
  const sideRise = 2.15 * smoothstep(72, 124, Math.abs(x));
  const rollingRim = rim * rim * 0.00034;
  const broadFold =
    0.82 * valueNoise(x + 31, z - 19, 39) +
    0.38 * valueNoise(x - 73, z + 47, 20);

  return basin + entryRidge + sideRise + rollingRim + broadFold;
}

function rawGroundHeightAt(x, z) {
  const smallFold = 0.3 * valueNoise(x + 103, z - 61, 8.5);
  const leafScale = 0.08 * valueNoise(x - 13, z + 7, 2.6);
  return macroHeightAt(x, z) + smallFold + leafScale;
}

function pathGradeAt(z) {
  const x = pathX(z);
  // Following only the macro terrain produces a comfortably walkable grade
  // while preserving the larger descent from the bamboo ridge.
  return macroHeightAt(x, z) + 0.07 * Math.sin(z * 0.09);
}

function gateAccessGradeAt(distance) {
  const sample = gateAccessSampleAtDistance(distance);
  const start = gateAccessSamples[0];
  const startGradeOffset = pathGradeAt(start.z) - macroHeightAt(start.x, start.z);
  const trailTieIn = 1 - smoothstep(0, 12, sample.distance);
  const aggregateUndulation = 0.035
    * Math.sin(sample.distance * 0.19 + 0.55)
    * smoothstep(0, 6, sample.distance);
  return macroHeightAt(sample.x, sample.z)
    + startGradeOffset * trailTieIn
    + aggregateUndulation;
}

function riverSurfaceHeightAt(x) {
  // A gentle west-to-east fall keeps the stream reading as water rather than
  // a chain of disconnected puddles.
  return -1.02 - (x + TERRAIN_HALF) * 0.0041 + 0.1 * Math.sin(x * 0.025);
}

// Graded building pad: one level elevation across the whole compound lot,
// feathered back into the natural meadow over a short apron so the cut reads
// as site work rather than a floating terrace.
const COMPOUND_PAD_FEATHER_METERS = 7.5;
const COMPOUND_PAD_HEIGHT = macroHeightAt(COMPOUND_SITE.centerX, COMPOUND_SITE.centerZ);
const COMPOUND_PAD_REACH_X =
  (COMPOUND_SITE.lotWidth + COMPOUND_SITE.lotDepth) * 0.5 + COMPOUND_PAD_FEATHER_METERS + 2;

function compoundPadBlend(x, z) {
  // Cheap world-space reject before the plan-space transform.
  if (Math.abs(x - COMPOUND_SITE.centerX) > COMPOUND_PAD_REACH_X) return 0;
  if (Math.abs(z - COMPOUND_SITE.centerZ) > COMPOUND_PAD_REACH_X) return 0;
  const plan = worldToPlan(x, z);
  const lot = COMPOUND_PLAN.lot;
  const outsideXFeet = Math.max(lot.x - plan.x, plan.x - (lot.x + lot.width), 0);
  const outsideZFeet = Math.max(lot.z - plan.z, plan.z - (lot.z + lot.depth), 0);
  const outsideMeters = Math.hypot(outsideXFeet, outsideZFeet) * FEET_TO_METERS;
  return 1 - smoothstep(0, COMPOUND_PAD_FEATHER_METERS, outsideMeters);
}

/**
 * Deterministic world-space ground height. This is the single grounding
 * contract for the player, vegetation, props, trail, and terrain mesh.
 */
export function heightAt(x, z) {
  let height = rawGroundHeightAt(x, z);

  const pathDistance = distanceToPath(x, z);
  const pathBlend = 1 - smoothstep(2.0, 5.4, pathDistance);
  height = lerp(height, pathGradeAt(z), pathBlend * 0.94);

  // Grade only the lane and its soft shoulder. Outside the cheap bounding
  // rectangle the landscape follows exactly the same terrain function as it
  // did before the spur was added.
  if (isInsideGateAccessBounds(x, z)) {
    const nearest = nearestGateAccessRoutePoint(x, z);
    const halfWidth = gateAccessWidthAtDistance(nearest.alongDistance) * 0.5;
    const routeBlend = 1 - smoothstep(halfWidth * 0.82, halfWidth + 2.6, nearest.distance);
    height = lerp(height, gateAccessGradeAt(nearest.alongDistance), routeBlend * 0.96);
  }

  const riverDistance = distanceToRiver(x, z);
  const riverHalfWidth = 2.65 + 0.55 * (0.5 + 0.5 * Math.sin(x * 0.051));
  const bankBlend = 1 - smoothstep(riverHalfWidth, riverHalfWidth + 6.1, riverDistance);
  const channelCore = 1 - smoothstep(0, riverHalfWidth, riverDistance);
  const riverBed = riverSurfaceHeightAt(x) - 0.28 - 0.27 * channelCore;
  // Pin the channel to a shallow bed even where the macro basin happens to
  // fall lower; otherwise the water would become an accidental deep lake.
  height = lerp(height, riverBed, bankBlend);

  const padBlend = compoundPadBlend(x, z);
  if (padBlend > 0) height = lerp(height, COMPOUND_PAD_HEIGHT, padBlend);

  return height;
}

function paletteColor(palette, key, fallback) {
  const value = palette && palette[key] !== undefined ? palette[key] : fallback;
  return value && value.isColor ? value.clone() : new THREE.Color(value);
}

function loadSurfaceMap(loader, setName, mapName, repeatX, repeatY, color = false) {
  const texture = loader.load(`${MATERIAL_ASSET_ROOT}${setName}_${mapName}.webp`);
  texture.name = `${setName} ${mapName}`;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 4;
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function loadTerrainSurfaceMaps() {
  const loader = new THREE.TextureLoader();
  const loadSet = (name, repeatX, repeatY) => ({
    albedo: loadSurfaceMap(loader, name, 'albedo', repeatX, repeatY, true),
    normal: loadSurfaceMap(loader, name, 'normal', repeatX, repeatY),
    orm: loadSurfaceMap(loader, name, 'orm', repeatX, repeatY),
  });

  return {
    ground: loadSet('forest', 70, 70),
    path: loadSet('path', 1.35, 3),
    bank: loadSet('bank', 1, 1),
  };
}

function disposeTerrainSurfaceMaps(surfaceMaps) {
  for (const set of Object.values(surfaceMaps)) {
    set.albedo.dispose();
    set.normal.dispose();
    set.orm.dispose();
  }
}

function applyRoughnessFloor(material, floor, cacheKey) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>\nroughnessFactor = max(roughnessFactor, ${floor.toFixed(3)});`,
    );
  };
  material.customProgramCacheKey = () => cacheKey;
}

function groundColorAt(x, z, palette, target) {
  const grassShadow = paletteColor(palette, 'grassShadow', 0x183d31);
  const grassLit = paletteColor(palette, 'grassLit', 0x6e8b45);
  const bamboo = paletteColor(palette, 'bamboo', 0x234f39);
  const soil = paletteColor(palette, 'soil', 0x443327);
  const stone = paletteColor(palette, 'stone', 0x6a665c);

  // A snapped hash supplies broad painterly color masses; low-frequency
  // interpolation prevents their borders from reading as a square grid.
  const blockX = Math.floor((x + TERRAIN_HALF) / 13);
  const blockZ = Math.floor((z + TERRAIN_HALF) / 13);
  const block = hash2(blockX, blockZ);
  const wash = 0.5 + 0.5 * valueNoise(x - 42, z + 17, 29);
  const lightMix = clamp01(0.18 + block * 0.42 + wash * 0.25);

  target.copy(grassShadow).lerp(grassLit, lightMix);

  const entry = smoothstep(62, 105, z);
  target.lerp(bamboo, entry * (0.46 + block * 0.16));

  const pathBank = 1 - smoothstep(3.5, 8.5, distanceToPath(x, z));
  target.lerp(soil, pathBank * 0.28);

  if (isInsideGateAccessBounds(x, z)) {
    const nearest = nearestGateAccessRoutePoint(x, z);
    const routeEdgeDistance = nearest.distance
      - gateAccessWidthAtDistance(nearest.alongDistance) * 0.5;
    const routeShoulder = 1 - smoothstep(0.15, 3.2, routeEdgeDistance);
    target.lerp(soil, routeShoulder * 0.3);
  }

  const riverBank = 1 - smoothstep(3.0, 10.5, distanceToRiver(x, z));
  target.lerp(soil, riverBank * 0.58);
  target.lerp(stone, riverBank * (0.05 + 0.13 * block));

  // Slightly darker low ground makes the sunlit ridges and meadow islands
  // separate even before vegetation is added.
  const lowland = 1 - smoothstep(-1.9, 1.7, heightAt(x, z));
  target.lerp(grassShadow, lowland * 0.18);
  return target;
}

function createTerrainMesh(palette, surfaceMaps) {
  const geometry = new THREE.PlaneGeometry(
    TERRAIN_SIZE,
    TERRAIN_SIZE,
    TERRAIN_SEGMENTS,
    TERRAIN_SEGMENTS,
  );
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  const neutralTint = new THREE.Color(0xffffff);

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setY(i, heightAt(x, z));
    groundColorAt(x, z, palette, color);
    // The scanned albedo supplies the fine color detail; vertex color now acts
    // as a broad biome tint instead of multiplying it down to near-black.
    const entryShade = smoothstep(58, 104, z);
    color.lerp(neutralTint, 0.68 - entryShade * 0.27);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    map: surfaceMaps.albedo,
    normalMap: surfaceMaps.normal,
    normalScale: new THREE.Vector2(.34, .34),
    aoMap: surfaceMaps.orm,
    aoMapIntensity: .72,
    roughnessMap: surfaceMaps.orm,
    roughness: 0.95,
    metalness: 0,
  });
  applyRoughnessFloor(material, .82, 'biome-dry-ground-roughness-v1');
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Sunset basin ground';
  mesh.receiveShadow = true;
  mesh.userData.biomeSurface = 'ground';
  return mesh;
}

function createPathMesh(palette, surfaceMaps) {
  const rows = 260;
  const columns = 5;
  const gateRows = gateAccessSamples.length;
  const gateColumns = 9;
  const mainVertexCount = rows * columns;
  const gateVertexCount = gateRows * gateColumns;
  const positions = new Float32Array((mainVertexCount + gateVertexCount) * 3);
  const colors = new Float32Array((mainVertexCount + gateVertexCount) * 3);
  const uvs = new Float32Array((mainVertexCount + gateVertexCount) * 2);
  const indices = [];
  const pathColor = paletteColor(palette, 'path', 0x78583a);
  const soilColor = paletteColor(palette, 'soil', 0x443327);
  const stoneColor = paletteColor(palette, 'stone', 0x6a665c);
  const bambooColor = paletteColor(palette, 'bamboo', 0x163b34);
  const color = new THREE.Color();
  const neutralTint = new THREE.Color(0xffffff);

  for (let row = 0; row < rows; row += 1) {
    const along = row / (rows - 1);
    const z = lerp(PATH_START_Z, PATH_END_Z, along);
    const centerX = pathX(z);
    const derivative = pathDerivative(z);
    const normalLength = Math.sqrt(1 + derivative * derivative);
    const normalX = 1 / normalLength;
    const normalZ = -derivative / normalLength;
    // Keep the route broad enough for comfortable traversal, but let the
    // meadow press into its edges instead of reading as a cleared road.
    const halfWidth = 1.78 + 0.22 * Math.sin(z * 0.067 + 0.8);

    for (let column = 0; column < columns; column += 1) {
      const across01 = column / (columns - 1);
      const across = lerp(-halfWidth, halfWidth, across01);
      const x = centerX + normalX * across;
      const vertexZ = z + normalZ * across;
      const vertex = row * columns + column;
      const offset = vertex * 3;
      positions[offset] = x;
      positions[offset + 1] = heightAt(x, vertexZ) + 0.045;
      positions[offset + 2] = vertexZ;

      const centerWeight = 1 - Math.abs(across01 * 2 - 1);
      const fleck = hash2(row, column + 701);
      color.copy(soilColor).lerp(pathColor, 0.52 + centerWeight * 0.34);
      color.offsetHSL(0, 0, (fleck - 0.5) * 0.055);
      const entryShade = smoothstep(58, 104, vertexZ);
      color.lerp(bambooColor, entryShade * 0.4);
      color.lerp(neutralTint, 0.58 - entryShade * 0.22);
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;

      const uvOffset = vertex * 2;
      uvs[uvOffset] = across01;
      uvs[uvOffset + 1] = along * 24;
    }
  }

  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  // Append the access spur to the existing path buffers so the full route is
  // still one mesh/material draw. Extra cross-path columns preserve texture
  // scale and silhouette quality through the broad motor-court flare.
  const gateUvWidth = 3.56;
  const gateUvLengthScale = 24 / (PATH_START_Z - PATH_END_Z);
  for (let row = 0; row < gateRows; row += 1) {
    const sample = gateAccessSamples[row];
    const halfWidth = gateAccessWidthAtDistance(sample.distance) * 0.5;

    for (let column = 0; column < gateColumns; column += 1) {
      const across01 = column / (gateColumns - 1);
      const across = lerp(-halfWidth, halfWidth, across01);
      const x = sample.x + sample.axisX * across;
      const z = sample.z + sample.axisZ * across;
      const vertex = mainVertexCount + row * gateColumns + column;
      const offset = vertex * 3;
      positions[offset] = x;
      positions[offset + 1] = heightAt(x, z) + 0.052;
      positions[offset + 2] = z;

      const centerWeight = 1 - Math.abs(across01 * 2 - 1);
      const edgeAggregate = smoothstep(0.62, 1, Math.abs(across) / halfWidth);
      const fleck = hash2(row + 1703, column + 1109);
      color.copy(soilColor).lerp(pathColor, 0.5 + centerWeight * 0.32);
      color.lerp(stoneColor, 0.045 + edgeAggregate * 0.105);
      color.offsetHSL(0, -0.015, (fleck - 0.5) * 0.05);
      color.lerp(neutralTint, 0.58);
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;

      const uvOffset = vertex * 2;
      uvs[uvOffset] = 0.5 + across / gateUvWidth;
      uvs[uvOffset + 1] = sample.distance * gateUvLengthScale;
    }
  }

  for (let row = 0; row < gateRows - 1; row += 1) {
    for (let column = 0; column < gateColumns - 1; column += 1) {
      const a = mainVertexCount + row * gateColumns + column;
      const b = a + 1;
      const c = a + gateColumns;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    map: surfaceMaps.albedo,
    normalMap: surfaceMaps.normal,
    normalScale: new THREE.Vector2(.55, .55),
    aoMap: surfaceMaps.orm,
    aoMapIntensity: .85,
    roughnessMap: surfaceMaps.orm,
    roughness: .94,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  applyRoughnessFloor(material, .78, 'biome-dry-path-roughness-v1');
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Winding dirt path and gate access spur';
  mesh.receiveShadow = true;
  mesh.userData.biomeSurface = 'path';
  mesh.userData.gateAccessRoute = Object.freeze({
    points: GATE_ACCESS_ROUTE,
    lengthMeters: gateAccessRouteLength,
    baseWidthMeters: Object.freeze([3.2, 3.8]),
    flareLengthMeters: GATE_ACCESS_FLARE_LENGTH,
    gateWidthMeters: GATE_ACCESS_GATE_HALF_WIDTH * 2,
  });
  return mesh;
}

function createPathLitter(palette) {
  const group = new THREE.Group();
  group.name = 'Path stones and fallen leaves';
  const random = (() => {
    let state = 0x8a13_6f25;
    return () => {
      state = Math.imul(state ^ (state >>> 15), 1 | state);
      state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
      return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const gateRandom = (() => {
    let state = 0x51ac_c355;
    return () => {
      state = Math.imul(state ^ (state >>> 15), 1 | state);
      state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
      return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();

  const mainStoneCount = 360;
  const gateStoneCount = 84;
  const stoneCount = mainStoneCount + gateStoneCount;
  const stoneGeometry = new THREE.IcosahedronGeometry(.072, 0);
  const stoneMaterial = new THREE.MeshStandardMaterial({
    color: paletteColor(palette, 'stone', 0x49453e)
      .lerp(paletteColor(palette, 'path', 0x78583a), .34),
    roughness: 1,
    vertexColors: true,
  });
  const stones = new THREE.InstancedMesh(stoneGeometry, stoneMaterial, stoneCount);
  stones.name = 'Path pebbles';
  stones.receiveShadow = true;
  for (let i = 0; i < mainStoneCount; i += 1) {
    const z = lerp(PATH_END_Z + 3, PATH_START_Z - 3, random());
    const width = 1.5 + random() * .6;
    const sideBias = random() < .68 ? (random() < .5 ? -.72 : .72) : 0;
    const x = pathX(z) + THREE.MathUtils.clamp((random() - .5) * 2 + sideBias, -width, width);
    position.set(x, heightAt(x, z) + .055, z);
    quaternion.setFromEuler(new THREE.Euler(random() * .35, random() * Math.PI, random() * .35));
    const size = .34 + random() * .82;
    scale.set(size * (1 + random()), size * (.35 + random() * .3), size * (.7 + random() * .8));
    matrix.compose(position, quaternion, scale);
    stones.setMatrixAt(i, matrix);
    color.copy(paletteColor(palette, 'stone', 0x49453e))
      .lerp(paletteColor(palette, 'path', 0x78583a), .28)
      .offsetHSL(0, -.08, .035 + (random() - .5) * .09);
    stones.setColorAt(i, color);
  }
  for (let i = mainStoneCount; i < stoneCount; i += 1) {
    const sample = gateAccessSampleAtDistance(
      lerp(1.4, gateAccessRouteLength - 0.8, gateRandom()),
    );
    const halfWidth = gateAccessWidthAtDistance(sample.distance) * 0.5;
    const sideBias = gateRandom() < 0.7 ? (gateRandom() < 0.5 ? -0.72 : 0.72) : 0;
    const lateral = THREE.MathUtils.clamp(
      (gateRandom() - 0.5) * halfWidth * 1.4 + sideBias * halfWidth,
      -halfWidth * 0.94,
      halfWidth * 0.94,
    );
    const x = sample.x + sample.axisX * lateral;
    const z = sample.z + sample.axisZ * lateral;
    position.set(x, heightAt(x, z) + 0.058, z);
    quaternion.setFromEuler(new THREE.Euler(
      gateRandom() * 0.35,
      gateRandom() * Math.PI,
      gateRandom() * 0.35,
    ));
    const size = 0.32 + gateRandom() * 0.86;
    scale.set(
      size * (1 + gateRandom()),
      size * (0.35 + gateRandom() * 0.3),
      size * (0.7 + gateRandom() * 0.8),
    );
    matrix.compose(position, quaternion, scale);
    stones.setMatrixAt(i, matrix);
    color.copy(paletteColor(palette, 'stone', 0x49453e))
      .lerp(paletteColor(palette, 'path', 0x78583a), 0.28)
      .offsetHSL(0, -0.08, 0.035 + (gateRandom() - 0.5) * 0.09);
    stones.setColorAt(i, color);
  }
  stones.instanceMatrix.needsUpdate = true;
  stones.instanceColor.needsUpdate = true;
  group.add(stones);

  const mainLeafCount = 760;
  const gateLeafCount = 118;
  const leafCount = mainLeafCount + gateLeafCount;
  const leafGeometry = new THREE.CircleGeometry(.076, 4);
  leafGeometry.rotateX(-Math.PI / 2);
  leafGeometry.rotateY(Math.PI / 4);
  const leafMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: .9,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  const leaves = new THREE.InstancedMesh(leafGeometry, leafMaterial, leafCount);
  leaves.name = 'Windblown path leaves';
  leaves.receiveShadow = true;
  const red = paletteColor(palette, 'crimsonDark', 0x701218);
  const gold = paletteColor(palette, 'grassTip', 0xc8974a);
  for (let i = 0; i < mainLeafCount; i += 1) {
    const z = lerp(PATH_END_Z + 2, PATH_START_Z - 2, random());
    const x = pathX(z) + (random() - .5) * 4.3;
    position.set(x, heightAt(x, z) + .066, z);
    quaternion.setFromEuler(new THREE.Euler((random() - .5) * .18, random() * Math.PI, (random() - .5) * .18));
    const size = .42 + random() * .72;
    scale.set(size * (1.1 + random()), 1, size * (.55 + random() * .35));
    matrix.compose(position, quaternion, scale);
    leaves.setMatrixAt(i, matrix);
    color.copy(red).lerp(gold, random() < .34 ? .72 : random() * .18).offsetHSL(0, 0, (random() - .5) * .08);
    leaves.setColorAt(i, color);
  }
  for (let i = mainLeafCount; i < leafCount; i += 1) {
    const sample = gateAccessSampleAtDistance(
      lerp(0.7, gateAccessRouteLength - 1.8, gateRandom()),
    );
    const halfWidth = gateAccessWidthAtDistance(sample.distance) * 0.5;
    const lateral = (gateRandom() - 0.5) * (halfWidth * 2 + 1.1);
    const x = sample.x + sample.axisX * lateral;
    const z = sample.z + sample.axisZ * lateral;
    position.set(x, heightAt(x, z) + 0.066, z);
    quaternion.setFromEuler(new THREE.Euler(
      (gateRandom() - 0.5) * 0.18,
      gateRandom() * Math.PI,
      (gateRandom() - 0.5) * 0.18,
    ));
    const size = 0.4 + gateRandom() * 0.74;
    scale.set(size * (1.1 + gateRandom()), 1, size * (0.55 + gateRandom() * 0.35));
    matrix.compose(position, quaternion, scale);
    leaves.setMatrixAt(i, matrix);
    color.copy(red)
      .lerp(gold, gateRandom() < 0.34 ? 0.72 : gateRandom() * 0.18)
      .offsetHSL(0, 0, (gateRandom() - 0.5) * 0.08);
    leaves.setColorAt(i, color);
  }
  leaves.instanceMatrix.needsUpdate = true;
  leaves.instanceColor.needsUpdate = true;
  group.add(leaves);
  return group;
}

function createBambooCanopyShade(palette) {
  const geometry = new THREE.PlaneGeometry(140, 70, 56, 28);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i) + 87;
    position.setXYZ(i, x, heightAt(x, z) + .052, z);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const shade = paletteColor(palette, 'bamboo', 0x163b34)
    .lerp(paletteColor(palette, 'shadowTeal', 0x0b1b1d), .62);
  const material = new THREE.ShaderMaterial({
    name: 'Dappled bamboo canopy shade',
    uniforms: { uShade: { value: shade } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec2 vWorldXZ;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldXZ = world.xz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uShade;
      varying vec2 vUv;
      varying vec2 vWorldXZ;
      void main() {
        float edge = smoothstep(0.0, .15, vUv.x)
          * smoothstep(0.0, .15, 1.0 - vUv.x)
          * smoothstep(0.0, .2, vUv.y)
          * smoothstep(0.0, .12, 1.0 - vUv.y);
        float broad = sin(vWorldXZ.x * .17 + vWorldXZ.y * .09)
          * sin(vWorldXZ.x * .071 - vWorldXZ.y * .14);
        float fine = sin(vWorldXZ.x * .63 + vWorldXZ.y * .47) * .5 + .5;
        float dapple = smoothstep(-.45, .62, broad) * (.45 + fine * .55);
        float alpha = edge * (.15 + dapple * .17);
        gl_FragColor = vec4(uShade, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Bamboo grove canopy shadow';
  mesh.renderOrder = 2;
  return mesh;
}

function createWetBankMesh(palette, surfaceMaps) {
  const rows = 241;
  const columns = 13;
  const positions = new Float32Array(rows * columns * 3);
  const uvs = new Float32Array(rows * columns * 2);
  const bankBlend = new Float32Array(rows * columns);
  const indices = [];

  for (let row = 0; row < rows; row += 1) {
    const along = row / (rows - 1);
    const centerX = lerp(-TERRAIN_HALF + 0.5, TERRAIN_HALF - 0.5, along);
    const centerZ = riverZ(centerX);
    const derivative = riverDerivative(centerX);
    const normalLength = Math.sqrt(1 + derivative * derivative);
    const normalX = -derivative / normalLength;
    const normalZ = 1 / normalLength;
    const waterHalfWidth = 2.5 + 0.55 * (0.5 + 0.5 * Math.sin(centerX * 0.051));
    const bankHalfWidth = waterHalfWidth + 5.5;

    for (let column = 0; column < columns; column += 1) {
      const acrossUnit = column / (columns - 1) * 2 - 1;
      const across = acrossUnit * bankHalfWidth;
      const x = centerX + normalX * across;
      const z = centerZ + normalZ * across;
      const vertex = row * columns + column;
      const offset = vertex * 3;
      positions[offset] = x;
      positions[offset + 1] = heightAt(x, z) + .038;
      positions[offset + 2] = z;

      // World-projected UVs keep the scan at roughly 3.4 m per tile and avoid
      // stretching as the stream bends through the basin.
      const uvOffset = vertex * 2;
      uvs[uvOffset] = x / 3.4;
      uvs[uvOffset + 1] = z / 3.4;
      bankBlend[vertex] = 1 - smoothstep(.64, 1, Math.abs(acrossUnit));
    }
  }

  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('bankBlend', new THREE.BufferAttribute(bankBlend, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const tint = paletteColor(palette, 'soil', 0x443327)
    .lerp(new THREE.Color(0x5f4d40), .28)
    .multiplyScalar(.62);
  const material = new THREE.MeshStandardMaterial({
    color: tint,
    map: surfaceMaps.albedo,
    normalMap: surfaceMaps.normal,
    normalScale: new THREE.Vector2(.48, .48),
    aoMap: surfaceMaps.orm,
    aoMapIntensity: .92,
    roughnessMap: surfaceMaps.orm,
    roughness: .72,
    metalness: 0,
    transparent: true,
    opacity: .98,
    depthWrite: false,
    alphaTest: .012,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  // Fade the scanned wet soil into the forest floor without another texture
  // fetch or a conspicuous hard ribbon edge.
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float bankBlend;\nvarying float vBankBlend;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvBankBlend = bankBlend;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vBankBlend;',
      )
      .replace(
        '#include <alphatest_fragment>',
        'diffuseColor.a *= vBankBlend;\n#include <alphatest_fragment>',
      )
      .replace(
        '#include <opaque_fragment>',
        'outgoingLight *= 0.46;\n#include <opaque_fragment>',
      );
  };
  material.customProgramCacheKey = () => 'biome-wet-bank-fade-v1';

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Wet stream bed and banks';
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.userData.biomeSurface = 'wet-bank';
  return mesh;
}

function createWaterMesh(palette) {
  const rows = 241;
  const columns = 9;
  const positions = new Float32Array(rows * columns * 3);
  const colors = new Float32Array(rows * columns * 3);
  const baseHeights = new Float32Array(rows * columns);
  const waveWeights = new Float32Array(rows * columns);
  const indices = [];
  const sunColor = paletteColor(palette, 'sun', 0xffc86f);
  // The sunset key is intentionally powerful; keep the diffuse water dark so
  // only its moving specular band blooms into gold instead of bleaching the
  // whole channel into a flat cream ribbon.
  const clearTint = paletteColor(palette, 'shadowTeal', 0x173b3a)
    .lerp(new THREE.Color(0x5b8a82), .56)
    .multiplyScalar(.48);
  const copper = paletteColor(palette, 'water', 0xa95c39)
    .lerp(sunColor, .38)
    .multiplyScalar(.56);
  const shadow = clearTint.clone().lerp(copper, .12);
  const color = new THREE.Color();

  for (let row = 0; row < rows; row += 1) {
    const along = row / (rows - 1);
    const centerX = lerp(-TERRAIN_HALF + 0.5, TERRAIN_HALF - 0.5, along);
    const centerZ = riverZ(centerX);
    const derivative = riverDerivative(centerX);
    const normalLength = Math.sqrt(1 + derivative * derivative);
    const normalX = -derivative / normalLength;
    const normalZ = 1 / normalLength;
    const halfWidth = 2.5 + 0.55 * (0.5 + 0.5 * Math.sin(centerX * 0.051));

    for (let column = 0; column < columns; column += 1) {
      const across01 = column / (columns - 1);
      const acrossUnit = across01 * 2 - 1;
      const across = acrossUnit * halfWidth;
      const x = centerX + normalX * across;
      const z = centerZ + normalZ * across;
      const vertex = row * columns + column;
      const offset = vertex * 3;
      const baseY = riverSurfaceHeightAt(centerX) - 0.035 * Math.abs(acrossUnit);

      positions[offset] = x;
      positions[offset + 1] = baseY;
      positions[offset + 2] = z;
      baseHeights[vertex] = baseY;
      waveWeights[vertex] = 0.18 + 0.82 * (1 - Math.abs(acrossUnit));

      const ripple = .5 + .25 * Math.sin(x * .47 + z * .31) + .25 * Math.sin(x * .19 - z * .68 + .9);
      color.copy(shadow).lerp(clearTint, .34 + waveWeights[vertex] * .24 + ripple * .18);
      if (ripple > .82) color.lerp(sunColor, (ripple - .82) * .64);
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    }
  }

  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  // A controlled unlit reflection model prevents the very strong sunset key
  // from washing every water-facing normal to white. Surface geometry still
  // carries the animated normals; the shader turns those ripples into a narrow
  // gold track over a dark teal/copper body.
  const material = new THREE.ShaderMaterial({
    name: 'Copper stream reflection',
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uDeep: { value: clearTint.clone().multiplyScalar(.78) },
        uCopper: { value: copper.clone().multiplyScalar(.92) },
        uSunColor: { value: sunColor.clone() },
        uSunDirection: { value: new THREE.Vector3(-.48, .105, -.87).normalize() },
      },
    ]),
    vertexShader: /* glsl */`
      varying vec3 vColor;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      varying vec3 vViewDirection;
      #include <fog_pars_vertex>
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vColor = color;
        vWorldPosition = world.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vViewDirection = cameraPosition - world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uCopper;
      uniform vec3 uSunColor;
      uniform vec3 uSunDirection;
      varying vec3 vColor;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;
      varying vec3 vViewDirection;
      #include <fog_pars_fragment>
      void main() {
        vec3 viewDirection = normalize(vViewDirection);
        vec3 rippleNormal = normalize(vWorldNormal + vec3(
          sin(vWorldPosition.z * 1.31 - uTime * 1.8) * .055,
          0.0,
          cos(vWorldPosition.x * .72 + uTime * 1.35) * .042
        ));
        if (!gl_FrontFacing) rippleNormal = -rippleNormal;
        float facing = clamp(dot(rippleNormal, viewDirection), 0.0, 1.0);
        float fresnel = pow(1.0 - facing, 3.0);
        vec3 halfVector = normalize(viewDirection + normalize(uSunDirection));
        float sunGlint = pow(max(dot(rippleNormal, halfVector), 0.0), 92.0);
        float brokenTrack = .56 + .44 * sin(
          vWorldPosition.x * .83 + vWorldPosition.z * .36 + uTime * 2.1
        );
        sunGlint *= .42 + .58 * smoothstep(.32, .9, brokenTrack);
        vec3 reflection = mix(uDeep, uCopper, .16 + fresnel * .58);
        vec3 color = mix(vColor * .72, reflection, .52 + fresnel * .34);
        color += uSunColor * sunGlint * 2.35;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
    vertexColors: true,
    side: THREE.DoubleSide,
    depthWrite: true,
    transparent: false,
    fog: true,
    toneMapped: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Clear reflective stream';
  mesh.receiveShadow = true;
  mesh.renderOrder = 3;
  mesh.userData.biomeSurface = 'water';
  mesh.userData.baseHeights = baseHeights;
  mesh.userData.waveWeights = waveWeights;
  return mesh;
}

/**
 * Build the 250 m sunset basin. `update(elapsedSeconds)` should be called once
 * per frame to animate the stream. All returned meshes share `heightAt`'s
 * world-space convention and can be independently hidden or inspected.
 */
export function createTerrain(scene, palette = {}) {
  const group = new THREE.Group();
  group.name = 'Sunset basin terrain system';

  const surfaceMaps = loadTerrainSurfaceMaps();
  const terrain = createTerrainMesh(palette, surfaceMaps.ground);
  const path = createPathMesh(palette, surfaceMaps.path);
  const wetBanks = createWetBankMesh(palette, surfaceMaps.bank);
  const water = createWaterMesh(palette);
  const pathLitter = createPathLitter(palette);
  const bambooShade = createBambooCanopyShade(palette);
  group.add(terrain, path, wetBanks, water, pathLitter, bambooShade);
  scene.add(group);

  const waterPosition = water.geometry.attributes.position;
  const { baseHeights, waveWeights } = water.userData;

  function update(elapsedSeconds = 0) {
    const time = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
    for (let i = 0; i < waterPosition.count; i += 1) {
      const x = waterPosition.getX(i);
      const z = waterPosition.getZ(i);
      const longRipple = Math.sin(x * 0.21 + time * 1.25);
      const crossRipple = Math.sin(z * 0.74 - time * 1.8 + x * 0.045);
      const glintRipple = Math.sin((x + z) * 0.42 + time * 2.35);
      const wave = longRipple * 0.035 + crossRipple * 0.018 + glintRipple * 0.008;
      waterPosition.setY(i, baseHeights[i] + wave * waveWeights[i]);
    }
    waterPosition.needsUpdate = true;
    water.geometry.computeVertexNormals();
    water.material.uniforms.uTime.value = time;
  }

  function dispose() {
    group.removeFromParent();
    terrain.geometry.dispose();
    terrain.material.dispose();
    path.geometry.dispose();
    path.material.dispose();
    wetBanks.geometry.dispose();
    wetBanks.material.dispose();
    water.geometry.dispose();
    water.material.dispose();
    bambooShade.geometry.dispose();
    bambooShade.material.dispose();
    disposeTerrainSurfaceMaps(surfaceMaps);
    pathLitter.traverse((object) => {
      object.geometry?.dispose();
      object.material?.dispose();
    });
  }

  water.userData.update = update;
  group.userData.update = update;

  return {
    group,
    terrain,
    path,
    water,
    pathLitter,
    update,
    dispose,
    size: TERRAIN_SIZE,
  };
}
