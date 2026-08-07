import * as THREE from 'three';
import {
  COMPOUND_PLAN,
  COMPOUND_SITE,
  FEET_TO_METERS,
  planToWorld,
} from './site-layout.js';
import {
  applyBiomeAtmosphere,
  applyInstancedFoliageWind,
} from './biome-shared.js';

const VEGETATION_ASSET_ROOT = `${import.meta.env.BASE_URL}assets/vegetation/`;

function paletteColor(palette, key, fallback) {
  const value = palette?.[key] ?? fallback;
  return value?.isColor ? value.clone() : new THREE.Color(value);
}

function safeHeight(heightAt, x, z) {
  const value = heightAt?.(x, z);
  return Number.isFinite(value) ? value : 0;
}

function hash01(index, salt = 0) {
  let value = Math.imul(index + salt * 1013, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967295;
}

function addFernCard(specs, {
  planX,
  planZ,
  width,
  height,
  yaw,
  lean,
  baseLift,
  tint,
}) {
  specs.push({ planX, planZ, width, height, yaw, lean, baseLift, tint });
}

function addCrossedFernClump(specs, options, cardCount = 3) {
  for (let card = 0; card < cardCount; card += 1) {
    const spread = options.spread ?? 0.08;
    const angle = options.yaw + card * Math.PI / cardCount;
    addFernCard(specs, {
      ...options,
      planX: options.planX + Math.cos(angle) * spread,
      planZ: options.planZ + Math.sin(angle) * spread,
      width: options.width * (0.88 + card * 0.055),
      height: options.height * (0.9 + ((card + 1) % 3) * 0.065),
      yaw: angle,
      lean: (options.lean ?? 0) * (0.9 + card * 0.07),
      tint: (options.tint + card) % 4,
    });
  }
}

const SERVICE_EDGE_EXCLUSIONS = Object.freeze([
  { id: 'motor-court', rectangle: COMPOUND_PLAN.driveway, clearanceFeet: 2.0 },
  { id: 'service-lane', rectangle: COMPOUND_PLAN.serviceDrive, clearanceFeet: 2.0 },
  { id: 'guest-walk', rectangle: COMPOUND_PLAN.guestWalk, clearanceFeet: 1.5 },
  {
    id: 'guest-entry-and-link',
    rectangle: { x: 103.5, z: 76.5, width: 6.0, depth: 9.0 },
    clearanceFeet: 0.5,
  },
  {
    id: 'fab-west-door-apron',
    rectangle: { x: 98.0, z: 22.0, width: 6.5, depth: 10.0 },
    clearanceFeet: 0.5,
  },
  {
    id: 'fab-north-door-apron',
    rectangle: { x: 103.5, z: 7.0, width: 10.0, depth: 7.0 },
    clearanceFeet: 0.5,
  },
  {
    id: 'fab-south-person-apron',
    rectangle: { x: 114.5, z: 36.5, width: 10.5, depth: 8.5 },
    clearanceFeet: 0.5,
  },
  {
    id: 'fab-equipment-apron',
    rectangle: { x: 130.0, z: 35.5, width: 16.0, depth: 14.5 },
    clearanceFeet: 0.5,
  },
  {
    id: 'garage-person-door-apron',
    rectangle: { x: 32.0, z: 84.0, width: 10.0, depth: 9.0 },
    clearanceFeet: 0.5,
  },
  {
    id: 'garage-bay-apron',
    rectangle: { x: 38.0, z: 88.0, width: 30.0, depth: 36.0 },
    clearanceFeet: 0.5,
  },
]);

function pointToRectangleDistanceFeet(planX, planZ, rectangle) {
  const dx = Math.max(
    rectangle.x - planX,
    0,
    planX - (rectangle.x + rectangle.width),
  );
  const dz = Math.max(
    rectangle.z - planZ,
    0,
    planZ - (rectangle.z + rectangle.depth),
  );
  return Math.hypot(dx, dz);
}

function plantingFootprintFeet(candidate) {
  const leanedHeight = Math.abs(Math.sin(candidate.lean ?? 0)) * candidate.height * 0.82;
  return (
    candidate.width
    + leanedHeight
    + (candidate.spread ?? 0)
  ) / FEET_TO_METERS;
}

function validateServiceEdgePlantings(candidates) {
  const accepted = [];
  const rejected = [];
  const clearanceByExclusionFeet = Object.fromEntries(
    SERVICE_EDGE_EXCLUSIONS.map((exclusion) => [exclusion.id, Number.POSITIVE_INFINITY]),
  );
  let minimumHardscapeClearanceFeet = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const footprintFeet = plantingFootprintFeet(candidate);
    const hardscapeConflict = COMPOUND_PLAN.hardscapeRects.find((rectangle) => (
      pointToRectangleDistanceFeet(candidate.planX, candidate.planZ, rectangle)
        < footprintFeet + 0.12
    ));
    const accessConflict = SERVICE_EDGE_EXCLUSIONS.find((exclusion) => (
      pointToRectangleDistanceFeet(candidate.planX, candidate.planZ, exclusion.rectangle)
        < footprintFeet + exclusion.clearanceFeet
    ));
    if (hardscapeConflict || accessConflict) {
      rejected.push({
        zone: candidate.zone,
        planX: candidate.planX,
        planZ: candidate.planZ,
        reason: accessConflict?.id ?? hardscapeConflict?.id ?? 'hardscape',
      });
      continue;
    }
    accepted.push(candidate);
    for (const rectangle of COMPOUND_PLAN.hardscapeRects) {
      minimumHardscapeClearanceFeet = Math.min(
        minimumHardscapeClearanceFeet,
        pointToRectangleDistanceFeet(candidate.planX, candidate.planZ, rectangle)
          - footprintFeet,
      );
    }
    for (const exclusion of SERVICE_EDGE_EXCLUSIONS) {
      clearanceByExclusionFeet[exclusion.id] = Math.min(
        clearanceByExclusionFeet[exclusion.id],
        pointToRectangleDistanceFeet(candidate.planX, candidate.planZ, exclusion.rectangle)
          - footprintFeet,
      );
    }
  }
  return {
    accepted,
    rejected,
    clearanceByExclusionFeet,
    minimumHardscapeClearanceFeet,
  };
}

function makeServiceEdgePlantingCandidates() {
  const candidate = (
    zone,
    planX,
    planZ,
    width,
    height,
    yaw,
    lean,
    tint,
    cardCount,
  ) => ({
    zone,
    planX,
    planZ,
    width,
    height,
    yaw,
    lean,
    tint,
    cardCount,
    baseLift: height * 0.70,
    spread: 0.018 + (cardCount - 3) * 0.008,
  });

  return [
    // Guest/pool-house: two quiet masses animate the blank west return, with
    // lower layers under the north/south glazing. The entry link and 3.5-foot
    // guest walk remain outside every conservative frond footprint.
    candidate('guest', 105.3, 91.5, 0.34, 0.24, 0.42, 0.24, 1, 4),
    candidate('guest', 105.5, 95.3, 0.28, 0.20, 2.18, 0.19, 3, 3),
    candidate('guest', 111.8, 100.7, 0.36, 0.24, 4.52, 0.27, 0, 4),
    candidate('guest', 119.2, 100.7, 0.27, 0.18, 1.14, 0.18, 2, 3),
    candidate('guest', 128.8, 100.7, 0.38, 0.27, 5.36, 0.25, 1, 4),
    candidate('guest', 112.0, 73.3, 0.26, 0.18, 3.72, 0.19, 3, 3),
    candidate('guest', 120.8, 73.3, 0.37, 0.26, 0.66, 0.27, 0, 4),
    candidate('guest', 129.5, 73.3, 0.29, 0.20, 2.92, 0.21, 2, 3),

    // Fab lab: clustered shoulders bookend the personnel door and the larger
    // service opening. Nothing grows in the west link, door swings, loading
    // apron, or the twelve-foot service drive along the east facade.
    candidate('fab', 107.5, 40.7, 0.37, 0.27, 1.82, 0.28, 0, 4),
    candidate('fab', 112.3, 40.7, 0.27, 0.19, 5.02, 0.20, 2, 3),
    candidate('fab', 127.5, 40.7, 0.34, 0.23, 3.42, 0.25, 1, 4),
    candidate('fab', 101.3, 18.2, 0.36, 0.26, 0.92, 0.27, 3, 4),
    candidate('fab', 101.3, 34.8, 0.27, 0.19, 4.18, 0.18, 1, 3),
    candidate('fab', 116.0, 9.3, 0.35, 0.24, 2.66, 0.24, 0, 4),
    candidate('fab', 130.5, 9.3, 0.28, 0.19, 5.68, 0.19, 2, 3),
    candidate('fab', 139.0, 9.3, 0.36, 0.25, 1.36, 0.26, 3, 4),

    // Garage: the court-facing east wall stays entirely clean for all three
    // overhead bays. Loose, low understory is limited to the meadow-side west
    // and north shoulders plus a very low street-side foundation seam.
    candidate('garage', 13.3, 92.5, 0.28, 0.19, 4.94, 0.19, 2, 3),
    candidate('garage', 13.3, 99.0, 0.37, 0.25, 1.52, 0.26, 0, 4),
    candidate('garage', 13.3, 112.0, 0.27, 0.18, 3.12, 0.18, 3, 3),
    candidate('garage', 13.3, 119.8, 0.35, 0.24, 5.74, 0.24, 1, 4),
    candidate('garage', 19.0, 85.3, 0.29, 0.20, 2.38, 0.21, 2, 3),
    candidate('garage', 24.5, 85.3, 0.38, 0.27, 0.48, 0.27, 0, 4),
    candidate('garage', 28.8, 85.3, 0.27, 0.18, 4.08, 0.18, 3, 3),
    candidate('garage', 19.5, 126.3, 0.20, 0.14, 1.18, 0.14, 1, 3),
    candidate('garage', 27.0, 126.3, 0.22, 0.15, 3.88, 0.15, 2, 3),
    candidate('garage', 34.5, 126.3, 0.19, 0.13, 5.22, 0.13, 0, 3),

    // Meadow fringe: loose native clusters feather the flat pad back into the
    // basin along the west lawn, the rear-yard strip, the east street
    // frontage, and the fab-link lawn, so the lot boundary stops reading as a
    // cut line between two renderers. Every apron, walk, bay, and drive stays
    // inside the same validated exclusions as the service planting.
    candidate('fringe', 12.6, 48.5, 0.30, 0.21, 0.62, 0.22, 0, 4),
    candidate('fringe', 12.4, 58.0, 0.24, 0.16, 2.84, 0.17, 2, 3),
    candidate('fringe', 12.7, 68.5, 0.32, 0.22, 4.42, 0.24, 1, 4),
    candidate('fringe', 12.5, 78.0, 0.25, 0.17, 1.34, 0.18, 3, 3),
    candidate('fringe', 24.0, 12.4, 0.31, 0.21, 3.66, 0.23, 1, 4),
    candidate('fringe', 37.5, 12.2, 0.24, 0.16, 5.48, 0.17, 3, 3),
    candidate('fringe', 52.0, 12.5, 0.33, 0.23, 0.94, 0.24, 0, 4),
    candidate('fringe', 67.0, 12.3, 0.25, 0.17, 2.36, 0.18, 2, 3),
    candidate('fringe', 81.5, 12.5, 0.30, 0.21, 4.08, 0.22, 1, 4),
    candidate('fringe', 94.5, 12.3, 0.24, 0.16, 5.92, 0.17, 3, 3),
    candidate('fringe', 84.5, 126.4, 0.27, 0.18, 1.72, 0.19, 2, 3),
    candidate('fringe', 96.0, 126.5, 0.34, 0.23, 3.28, 0.24, 0, 4),
    candidate('fringe', 110.0, 126.4, 0.26, 0.17, 5.14, 0.18, 1, 3),
    candidate('fringe', 123.5, 126.5, 0.31, 0.21, 0.48, 0.22, 3, 4),
    candidate('fringe', 100.2, 55.0, 0.26, 0.18, 2.62, 0.19, 0, 3),
    candidate('fringe', 99.4, 66.5, 0.29, 0.20, 4.86, 0.21, 2, 3),
  ];
}

function makeFernSpecs() {
  const specs = [];

  // Texture-authored fronds sit within the existing architectural planters.
  // They break up the folded-blade silhouette without replacing the graphic
  // lance leaves that carry the composition at distance.
  const planters = [
    [53, 55.8, 0.92],
    [96.5, 55.8, 0.94],
    [100.5, 80.4, 0.88],
    [38, 43.5, 0.76],
  ];
  planters.forEach(([planX, planZ, scale], index) => {
    for (let clump = 0; clump < 2; clump += 1) {
      const angle = index * 1.73 + clump * 2.4;
      addCrossedFernClump(specs, {
        planX: planX + Math.cos(angle) * 0.11 * scale,
        planZ: planZ + Math.sin(angle) * 0.11 * scale,
        width: (0.86 + clump * 0.08) * scale,
        height: (0.52 + clump * 0.08) * scale,
        yaw: angle + 0.45,
        lean: 0.34 + clump * 0.08,
        baseLift: 0.40 * scale,
        spread: 0.045,
        tint: index + clump,
      }, 5);
    }
  });

  // Low fern layers give the long raised beds a fine, overlapping edge. The
  // taller geometric blades remain as sparse accents behind this texture.
  const beds = [
    { x: 45.5, z: 55.4, width: 10.5 },
    { x: 98.0, z: 55.4, width: 10.0 },
    { x: 99.8, z: 80.9, width: 7.0 },
  ];
  beds.forEach((bed, bedIndex) => {
    const columns = Math.max(5, Math.round(bed.width / 1.2));
    for (let column = 0; column < columns; column += 1) {
      const along = columns === 1 ? 0 : column / (columns - 1) - 0.5;
      const offset = (hash01(column, bedIndex + 11) - 0.5) * 0.12;
      addCrossedFernClump(specs, {
        planX: bed.x + along * (bed.width - 0.8),
        planZ: bed.z + offset,
        width: 0.38 + hash01(column, bedIndex + 31) * 0.14,
        height: 0.23 + hash01(column, bedIndex + 47) * 0.10,
        yaw: bedIndex * 0.8 + column * 1.31,
        lean: 0.26 + hash01(column, bedIndex + 53) * 0.18,
        baseLift: 0.30,
        spread: 0.025,
        tint: column + bedIndex,
      }, 3);
    }
  });

  // A shallow planted bioswale resolves the dark grade-change strip between
  // motor court and pool deck. These cards stay sedge-low and collect in two
  // loose shoulders; the 5 ft stepping-stone corridor at x=56..61 and the
  // guest walk east of x=74 remain completely clear.
  const edgeClumps = [];
  const addBioswaleBand = (fromX, toX, count, salt) => {
    for (let index = 0; index < count; index += 1) {
      const along = count === 1 ? 0.5 : index / (count - 1);
      const planX = THREE.MathUtils.lerp(fromX, toX, along)
        + (hash01(index, salt) - 0.5) * 0.42;
      const planZ = 85.45
        + hash01(index, salt + 17) * 2.55
        + (index % 2) * 0.26;
      const clump = {
        planX,
        planZ,
        width: 0.24 + hash01(index, salt + 31) * 0.16,
        height: 0.16 + hash01(index, salt + 47) * 0.16,
        yaw: index * 1.71 + hash01(index, salt + 59) * 0.7,
        lean: 0.16 + hash01(index, salt + 71) * 0.20,
        baseLift: 0.075,
        spread: 0.022,
        tint: index + salt,
      };
      edgeClumps.push(clump);
      addCrossedFernClump(specs, clump, 3);
    }
  };
  addBioswaleBand(42.0, 54.7, 9, 401);
  addBioswaleBand(62.2, 72.2, 8, 433);

  const servicePlantings = validateServiceEdgePlantings(
    makeServiceEdgePlantingCandidates(),
  );
  const serviceCardsByZone = { guest: 0, fab: 0, garage: 0, fringe: 0 };
  const serviceClustersByZone = { guest: 0, fab: 0, garage: 0, fringe: 0 };
  servicePlantings.accepted.forEach((clump) => {
    addCrossedFernClump(specs, clump, clump.cardCount);
    serviceClustersByZone[clump.zone] += 1;
    serviceCardsByZone[clump.zone] += clump.cardCount;
  });

  return {
    specs,
    edgeClumpCount: edgeClumps.length,
    serviceClustersByZone,
    serviceCardsByZone,
    rejectedServicePlantings: servicePlantings.rejected,
    servicePlantingClearanceFeet: servicePlantings.clearanceByExclusionFeet,
    minimumServicePlantingHardscapeClearanceFeet:
      servicePlantings.minimumHardscapeClearanceFeet,
  };
}

function makeLeafLitterSpecs() {
  const specs = [];
  const groundTransitionCounts = { guest: 0, fab: 0, garage: 0, service: 0 };
  const addStrip = (count, pointAt, salt) => {
    for (let index = 0; index < count; index += 1) {
      const [planX, planZ] = pointAt(index, count);
      specs.push({
        planX,
        planZ,
        width: 0.045 + hash01(index, salt) * 0.075,
        depth: 0.018 + hash01(index, salt + 13) * 0.035,
        yaw: hash01(index, salt + 29) * Math.PI,
        tint: index % 4,
      });
    }
  };
  const addAggregatePatch = (zone, count, bounds, salt) => {
    for (let index = 0; index < count; index += 1) {
      specs.push({
        planX: THREE.MathUtils.lerp(bounds.x0, bounds.x1, hash01(index, salt)),
        planZ: THREE.MathUtils.lerp(bounds.z0, bounds.z1, hash01(index, salt + 17)),
        width: 0.026 + hash01(index, salt + 31) * 0.052,
        depth: 0.012 + hash01(index, salt + 47) * 0.026,
        yaw: hash01(index, salt + 59) * Math.PI,
        tint: 4 + ((index + salt) % 4),
      });
      groundTransitionCounts[zone] += 1;
    }
  };

  addStrip(22, (index, count) => {
    const along = index / Math.max(1, count - 1);
    return [40.7 + along * 63.0, 84.18 + (hash01(index, 211) - 0.5) * 0.36];
  }, 193);
  addStrip(8, (index, count) => {
    const along = index / Math.max(1, count - 1);
    return [39.82 + (hash01(index, 227) - 0.5) * 0.30, 56.0 + along * 27.0];
  }, 223);
  addStrip(8, (index, count) => {
    const along = index / Math.max(1, count - 1);
    return [104.18 + (hash01(index, 241) - 0.5) * 0.30, 56.0 + along * 27.0];
  }, 239);

  // Fine stone and bark flecks make the outer foundations dissolve into the
  // meadow at close range without introducing another draw. Each patch is
  // intentionally broken around doors and paths instead of tracing a uniform
  // suburban border.
  addAggregatePatch('guest', 12, { x0: 104.8, x1: 106.8, z0: 89.5, z1: 97.0 }, 503);
  addAggregatePatch('guest', 10, { x0: 109.5, x1: 132.5, z0: 74.0, z1: 75.3 }, 521);
  addAggregatePatch('guest', 14, { x0: 109.5, x1: 132.5, z0: 98.6, z1: 100.5 }, 547);

  addAggregatePatch('fab', 12, { x0: 104.5, x1: 113.1, z0: 38.5, z1: 41.6 }, 571);
  addAggregatePatch('fab', 8, { x0: 125.6, x1: 129.3, z0: 38.5, z1: 41.4 }, 593);
  addAggregatePatch('fab', 7, { x0: 101.2, x1: 103.0, z0: 14.8, z1: 21.5 }, 613);
  addAggregatePatch('fab', 6, { x0: 101.2, x1: 103.0, z0: 33.0, z1: 37.2 }, 631);
  addAggregatePatch('fab', 10, { x0: 114.5, x1: 142.3, z0: 9.6, z1: 11.2 }, 653);

  addAggregatePatch('garage', 9, { x0: 13.5, x1: 15.4, z0: 89.5, z1: 101.2 }, 677);
  addAggregatePatch('garage', 10, { x0: 13.5, x1: 15.4, z0: 108.8, z1: 122.0 }, 701);
  addAggregatePatch('garage', 11, { x0: 16.8, x1: 30.5, z0: 85.8, z1: 87.3 }, 727);
  addAggregatePatch('garage', 10, { x0: 17.0, x1: 37.2, z0: 124.7, z1: 126.6 }, 751);

  // The service-drive aggregate is a visual seam only: these millimetre-thin
  // flecks have no collider and leave the full 12-foot equipment lane open.
  addAggregatePatch('service', 16, { x0: 134.05, x1: 135.0, z0: 42.0, z1: 73.0 }, 773);
  addAggregatePatch('service', 14, { x0: 134.05, x1: 135.0, z0: 101.0, z1: 127.0 }, 797);

  return { specs, groundTransitionCounts };
}

function makeWetnessTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 48;
  const context = canvas.getContext('2d');
  context.fillStyle = 'black';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.filter = 'blur(4px)';
  for (const [x, y, radiusX, radiusY, opacity] of [
    [21, 24, 18, 10, 0.72],
    [45, 18, 25, 9, 0.58],
    [69, 27, 20, 12, 0.67],
    [83, 19, 11, 7, 0.48],
  ]) {
    context.save();
    context.translate(x, y);
    context.scale(radiusX, radiusY);
    const gradient = context.createRadialGradient(0, 0, 0.08, 0, 0, 1);
    gradient.addColorStop(0, `rgba(255,255,255,${opacity})`);
    gradient.addColorStop(0.58, `rgba(210,210,210,${opacity * 0.72})`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(0, 0, 1, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
  context.filter = 'none';
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'Irregular pool-coping dampness mask';
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function makeWetnessSpecs() {
  const specs = [];
  const add = (planX, planZ, width, depth, yaw = 0) => {
    specs.push({ planX, planZ, width, depth, yaw });
  };
  for (let index = 0; index < 7; index += 1) {
    const x = 58.2 + index * 4.55;
    add(x, 61.55 + (hash01(index, 277) - 0.5) * 0.16, 0.70 + hash01(index, 281) * 0.58, 0.18 + hash01(index, 283) * 0.14, 0);
    add(x + 0.45, 78.45 + (hash01(index, 293) - 0.5) * 0.16, 0.65 + hash01(index, 307) * 0.62, 0.17 + hash01(index, 311) * 0.15, Math.PI);
  }
  for (let index = 0; index < 3; index += 1) {
    const z = 65.0 + index * 4.55;
    add(55.55, z, 0.64 + hash01(index, 317) * 0.30, 0.22, Math.PI * 0.5);
    add(88.45, z + 0.35, 0.64 + hash01(index, 331) * 0.30, 0.22, Math.PI * 0.5);
  }
  return specs;
}

function makeServiceSeamSpecs() {
  return [
    // Guest-house north/south aggregate feathering. These sit beyond the
    // foundation and never enter the west-side linked entry or guest walk.
    { zone: 'guest', planX: 114.0, planZ: 99.15, width: 1.00, depth: 0.35, yaw: 0.03 },
    { zone: 'guest', planX: 127.5, planZ: 99.20, width: 1.10, depth: 0.38, yaw: -0.025 },

    // Fab south shoulder is deliberately interrupted at both the 3-foot
    // personnel door and 8-foot loading opening rather than drawn as a curb.
    { zone: 'fab', planX: 107.8, planZ: 39.15, width: 1.45, depth: 0.55, yaw: 0.025 },
    { zone: 'fab', planX: 112.0, planZ: 39.35, width: 0.90, depth: 0.46, yaw: -0.035 },
    { zone: 'fab', planX: 127.2, planZ: 39.25, width: 1.05, depth: 0.50, yaw: 0.018 },

    // Garage transition remains on the meadow/street sides. The court-facing
    // bay slab receives no decal, plant, or object that could read as a stop.
    { zone: 'garage', planX: 14.8, planZ: 95.0, width: 0.38, depth: 1.25, yaw: 0.02 },
    { zone: 'garage', planX: 24.5, planZ: 86.7, width: 1.30, depth: 0.36, yaw: -0.02 },

    // A broken fines band quietly registers the west edge of the permeable
    // service lane. It is a transparent, collision-free surface treatment,
    // so all twelve feet remain usable by vehicles and fabrication equipment.
    { zone: 'service', planX: 134.28, planZ: 48.0, width: 0.42, depth: 1.95, yaw: 0.015 },
    { zone: 'service', planX: 134.34, planZ: 60.0, width: 0.38, depth: 1.65, yaw: -0.02 },
    { zone: 'service', planX: 134.26, planZ: 70.0, width: 0.40, depth: 1.35, yaw: 0.026 },
    { zone: 'service', planX: 134.32, planZ: 108.0, width: 0.44, depth: 2.05, yaw: -0.012 },
    { zone: 'service', planX: 134.25, planZ: 121.0, width: 0.46, depth: 1.65, yaw: 0.022 },
  ];
}

/**
 * Adds the fine botanical layer where managed architecture meets the basin.
 * Geometry stays instanced: one draw for every textured frond, one for all
 * leaf/aggregate flecks, and one shared-alpha draw for each ground treatment.
 */
export function createCompoundLandscapeDetails({
  heightAt,
  palette = {},
  windUniforms = null,
  quality = 'high',
} = {}) {
  const root = new THREE.Group();
  root.name = 'Compound texture-authored landscape details';
  // The authored planting lists are the high-quality contract; lower tiers
  // thin them the same way the wild vegetation reduces its populations.
  const keepDetail = quality === 'low'
    ? (_spec, index) => index % 3 !== 2
    : () => true;

  const loader = new THREE.TextureLoader();
  const fernTexture = loader.load(`${VEGETATION_ASSET_ROOT}bamboo-frond.png`);
  fernTexture.name = 'Compound courtyard bamboo-frond atlas';
  fernTexture.colorSpace = THREE.SRGBColorSpace;
  fernTexture.anisotropy = 4;

  const fernGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  fernGeometry.name = 'Stem-pivot courtyard frond card';
  fernGeometry.translate(0.48, 0.32, 0);
  const fernMaterial = new THREE.MeshStandardMaterial({
    name: 'Texture-authored courtyard frond material',
    map: fernTexture,
    emissiveMap: fernTexture,
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0,
    alphaTest: 0.27,
    side: THREE.DoubleSide,
    vertexColors: true,
    emissive: paletteColor(palette, 'grassLit', 0x9aaa68)
      .lerp(new THREE.Color(0x9aaa68), 0.72),
    emissiveIntensity: 0.52,
  });
  // Cards root at uv.y = 0, so the bend weight climbs the frond toward its
  // free tip exactly like the meadow blades that share this gust field.
  if (windUniforms) {
    applyInstancedFoliageWind(fernMaterial, windUniforms, {
      bendScale: 0.1,
      flutterScale: 0.02,
      weightExpression: 'smoothstep(0.06, 0.95, uv.y)',
      key: 'compound-frond',
    });
  }
  applyBiomeAtmosphere(fernMaterial, {
    palette,
    rimStrength: 0.1,
    key: 'compound-frond',
  });

  const {
    specs: allFernSpecs,
    edgeClumpCount,
    serviceClustersByZone,
    serviceCardsByZone,
    rejectedServicePlantings,
    servicePlantingClearanceFeet,
    minimumServicePlantingHardscapeClearanceFeet,
  } = makeFernSpecs();
  const fernSpecs = allFernSpecs.filter(keepDetail);
  const fernMesh = new THREE.InstancedMesh(fernGeometry, fernMaterial, fernSpecs.length);
  fernMesh.name = 'Layered texture-authored courtyard foliage';
  fernMesh.castShadow = true;
  fernMesh.receiveShadow = true;
  fernMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

  const fernTints = [0xffffff, 0xe5edcf, 0xf2dcae, 0xd6e3c5].map((value) => new THREE.Color(value));
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const yawQuaternion = new THREE.Quaternion();
  const leanQuaternion = new THREE.Quaternion();
  const upAxis = new THREE.Vector3(0, 1, 0);
  const cardAxis = new THREE.Vector3(0, 0, 1);
  const scale = new THREE.Vector3();
  fernSpecs.forEach((spec, index) => {
    const world = planToWorld(spec.planX, spec.planZ);
    position.set(
      world.x,
      safeHeight(heightAt, world.x, world.z) + spec.baseLift,
      world.z,
    );
    yawQuaternion.setFromAxisAngle(
      upAxis,
      COMPOUND_SITE.yaw + spec.yaw,
    );
    leanQuaternion.setFromAxisAngle(cardAxis, spec.lean ?? 0);
    quaternion.copy(yawQuaternion).multiply(leanQuaternion);
    scale.set(spec.width, spec.height, 1);
    matrix.compose(position, quaternion, scale);
    fernMesh.setMatrixAt(index, matrix);
    fernMesh.setColorAt(index, fernTints[spec.tint % fernTints.length]);
  });
  fernMesh.instanceMatrix.needsUpdate = true;
  if (fernMesh.instanceColor) fernMesh.instanceColor.needsUpdate = true;
  fernMesh.computeBoundingSphere();
  root.add(fernMesh);

  const litterGeometry = new THREE.CircleGeometry(0.5, 4);
  litterGeometry.name = 'Fine windblown leaf and aggregate fleck';
  litterGeometry.rotateX(-Math.PI * 0.5);
  litterGeometry.rotateY(Math.PI * 0.25);
  const litterMaterial = new THREE.MeshStandardMaterial({
    name: 'Dry courtyard litter and service-edge aggregate',
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
    vertexColors: true,
    emissive: 0x2d160b,
    emissiveIntensity: 0.16,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const {
    specs: allLitterSpecs,
    groundTransitionCounts,
  } = makeLeafLitterSpecs();
  const litterSpecs = allLitterSpecs.filter(keepDetail);
  const litterMesh = new THREE.InstancedMesh(litterGeometry, litterMaterial, litterSpecs.length);
  litterMesh.name = 'Windblown leaves and fine aggregate transitions';
  litterMesh.castShadow = false;
  litterMesh.receiveShadow = true;
  litterMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const litterTints = [
    0xa75131,
    0xd2a457,
    0x856447,
    0xc97a41,
    0x716553,
    0x94846b,
    0x5f6258,
    0xb0a083,
  ].map((value) => new THREE.Color(value));
  litterSpecs.forEach((spec, index) => {
    const world = planToWorld(spec.planX, spec.planZ);
    position.set(
      world.x,
      safeHeight(heightAt, world.x, world.z) + 0.076,
      world.z,
    );
    quaternion.setFromAxisAngle(
      upAxis,
      COMPOUND_SITE.yaw + spec.yaw,
    );
    scale.set(spec.width, 1, spec.depth);
    matrix.compose(position, quaternion, scale);
    litterMesh.setMatrixAt(index, matrix);
    litterMesh.setColorAt(index, litterTints[spec.tint]);
  });
  litterMesh.instanceMatrix.needsUpdate = true;
  if (litterMesh.instanceColor) litterMesh.instanceColor.needsUpdate = true;
  litterMesh.computeBoundingSphere();
  root.add(litterMesh);

  // Broken damp patches immediately outside the coping keep the water from
  // reading like a blue insert dropped into dry paving. The shared soft mask
  // stays restrained enough to disappear in the wide shot.
  const wetnessTexture = makeWetnessTexture();
  const wetnessGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  wetnessGeometry.name = 'Pool-edge dampness decal plane';
  wetnessGeometry.rotateX(-Math.PI * 0.5);
  const wetnessMaterial = new THREE.MeshStandardMaterial({
    name: 'Subtle damp limestone response',
    color: paletteColor(palette, 'shadowTeal', 0x263f3c).lerp(new THREE.Color(0x76847a), 0.38),
    roughness: 0.36,
    metalness: 0,
    alphaMap: wetnessTexture,
    transparent: true,
    opacity: 0.23,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  const wetnessSpecs = makeWetnessSpecs();
  const wetnessMesh = new THREE.InstancedMesh(
    wetnessGeometry,
    wetnessMaterial,
    wetnessSpecs.length,
  );
  wetnessMesh.name = 'Broken wet coping-edge patches';
  wetnessMesh.castShadow = false;
  wetnessMesh.receiveShadow = true;
  wetnessMesh.renderOrder = 2;
  wetnessMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  wetnessSpecs.forEach((spec, index) => {
    const world = planToWorld(spec.planX, spec.planZ);
    position.set(
      world.x,
      safeHeight(heightAt, world.x, world.z) + 0.079,
      world.z,
    );
    quaternion.setFromAxisAngle(
      upAxis,
      COMPOUND_SITE.yaw + spec.yaw,
    );
    scale.set(spec.width, 1, spec.depth);
    matrix.compose(position, quaternion, scale);
    wetnessMesh.setMatrixAt(index, matrix);
  });
  wetnessMesh.instanceMatrix.needsUpdate = true;
  wetnessMesh.computeBoundingSphere();
  root.add(wetnessMesh);

  // The same soft alpha authored for the damp coping doubles as an irregular
  // fines mask at the service-side transitions. Only the rough, warm-gray
  // response changes; no second texture or per-patch geometry is introduced.
  const serviceSeamMaterial = new THREE.MeshStandardMaterial({
    name: 'Compacted aggregate service-edge seam',
    color: paletteColor(palette, 'soil', 0x473b2f).lerp(new THREE.Color(0x8f826e), 0.52),
    roughness: 1,
    metalness: 0,
    alphaMap: wetnessTexture,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const serviceSeamSpecs = makeServiceSeamSpecs();
  const serviceSeamMesh = new THREE.InstancedMesh(
    wetnessGeometry,
    serviceSeamMaterial,
    serviceSeamSpecs.length,
  );
  serviceSeamMesh.name = 'Broken service-court aggregate seams';
  serviceSeamMesh.castShadow = false;
  serviceSeamMesh.receiveShadow = true;
  serviceSeamMesh.renderOrder = 2;
  serviceSeamMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  serviceSeamSpecs.forEach((spec, index) => {
    const world = planToWorld(spec.planX, spec.planZ);
    position.set(
      world.x,
      safeHeight(heightAt, world.x, world.z) + 0.080,
      world.z,
    );
    quaternion.setFromAxisAngle(
      upAxis,
      COMPOUND_SITE.yaw + spec.yaw,
    );
    scale.set(spec.width, 1, spec.depth);
    matrix.compose(position, quaternion, scale);
    serviceSeamMesh.setMatrixAt(index, matrix);
  });
  serviceSeamMesh.instanceMatrix.needsUpdate = true;
  serviceSeamMesh.computeBoundingSphere();
  root.add(serviceSeamMesh);

  const aggregateInstanceCount = Object.values(groundTransitionCounts)
    .reduce((total, count) => total + count, 0);
  const serviceSeamCounts = serviceSeamSpecs.reduce((counts, spec) => {
    counts[spec.zone] += 1;
    return counts;
  }, { guest: 0, fab: 0, garage: 0, service: 0 });

  return {
    root,
    stats: Object.freeze({
      drawCalls: 4,
      texturedFoliageCards: fernSpecs.length,
      nativeEdgeClusters: edgeClumpCount,
      guestEdgeClusters: serviceClustersByZone.guest,
      fabEdgeClusters: serviceClustersByZone.fab,
      garageEdgeClusters: serviceClustersByZone.garage,
      guestEdgeFoliageCards: serviceCardsByZone.guest,
      fabEdgeFoliageCards: serviceCardsByZone.fab,
      garageEdgeFoliageCards: serviceCardsByZone.garage,
      meadowFringeClusters: serviceClustersByZone.fringe,
      meadowFringeFoliageCards: serviceCardsByZone.fringe,
      windCoupled: Boolean(windUniforms),
      qualityTier: quality,
      rejectedServiceEdgeClusters: rejectedServicePlantings.length,
      rejectedServiceEdgeClusterDetails: Object.freeze(rejectedServicePlantings),
      servicePlantingClearanceFeet: Object.freeze(servicePlantingClearanceFeet),
      minimumServicePlantingHardscapeClearanceFeet,
      leafLitterInstances: litterSpecs.length - aggregateInstanceCount,
      groundTransitionAggregateInstances: aggregateInstanceCount,
      guestGroundTransitionInstances: groundTransitionCounts.guest,
      fabGroundTransitionInstances: groundTransitionCounts.fab,
      garageGroundTransitionInstances: groundTransitionCounts.garage,
      serviceDriveAggregateInstances: groundTransitionCounts.service,
      wetCopingPatches: wetnessSpecs.length,
      serviceCourtSeamPatches: serviceSeamSpecs.length,
      guestSeamPatches: serviceSeamCounts.guest,
      fabSeamPatches: serviceSeamCounts.fab,
      garageSeamPatches: serviceSeamCounts.garage,
      serviceDriveSeamPatches: serviceSeamCounts.service,
    }),
    dispose() {
      fernGeometry.dispose();
      fernMaterial.dispose();
      fernTexture.dispose();
      litterGeometry.dispose();
      litterMaterial.dispose();
      wetnessGeometry.dispose();
      wetnessMaterial.dispose();
      serviceSeamMaterial.dispose();
      wetnessTexture.dispose();
    },
  };
}
