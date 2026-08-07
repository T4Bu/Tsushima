/** Blueprint dimensions are authored in feet; the biome uses metres. */
export const FEET_TO_METERS = 0.3048;

const degreesToRadians = (degrees) => degrees * Math.PI / 180;
const rectangle = (id, label, x, z, width, depth) => Object.freeze({
  id,
  label,
  x,
  z,
  width,
  depth,
});

// Courtyard scheme: an 80' x 26' single-loaded bar along the north of the
// lot, every living room opening south through a 12' lanai onto the pool
// court. 2,080 SF conditioned.
const MAIN_HOUSE = rectangle('main-house', 'Main house', 18, 16, 80, 26);
const FAB_LAB = rectangle('fab-lab', 'Fab lab', 104, 12, 40, 26);
// Rotated gatehouse at the street edge: its mass (with the court wall and
// hedge) closes the compound's south boundary; doors face the motor court.
const GARAGE = rectangle('garage', 'Garage', 16, 88, 24, 36);
const GUEST_HOUSE = rectangle('guest-house', 'Guest house', 108, 76, 26, 22);
const POOL_DECK = rectangle('pool-deck', 'Pool deck', 40, 54, 64, 30);
const POOL = rectangle('pool', 'Pool', 56, 62, 32, 16);

const BUILDINGS = Object.freeze({
  mainHouse: MAIN_HOUSE,
  fabLab: FAB_LAB,
  garage: GARAGE,
  guestHouse: GUEST_HOUSE,
});

const BUILDING_LIST = Object.freeze(Object.values(BUILDINGS));

const CANOPIES = Object.freeze([
  // The 12'-deep lanai is the compound's primary outdoor room: it fronts the
  // kitchen, dining, great room, and primary suite and faces the pool court.
  rectangle('lanai', 'South lanai', 36, 42, 62, 12),
  rectangle('breezeway', 'Garage breezeway', 35, 54, 5, 34),
  rectangle('canopy-house-fab-link', 'House to fab link', 98, 24, 6, 6),
  rectangle('canopy-deck-guest-link', 'Deck to guest link', 104, 78, 4, 6),
]);

// 3' working paths between beds so the garden is actually tendable. Sited
// just outside the kitchen and mud room, west of the breezeway.
const GARDEN_BEDS = Object.freeze([
  rectangle('garden-bed-1', 'Kitchen garden bed', 17.5, 48, 8, 3),
  rectangle('garden-bed-2', 'Kitchen garden bed', 26.5, 48, 8, 3),
  rectangle('garden-bed-3', 'Kitchen garden bed', 17.5, 54, 8, 3),
  rectangle('garden-bed-4', 'Kitchen garden bed', 26.5, 54, 8, 3),
  rectangle('garden-bed-5', 'Kitchen garden bed', 17.5, 60, 8, 3),
  rectangle('garden-bed-6', 'Kitchen garden bed', 26.5, 60, 8, 3),
]);

// Gated 38' motor court behind the garage: arrival, turning, guest parking.
const DRIVEWAY = rectangle('driveway', 'Motor court and drive', 40, 90, 38, 40);
const SERVICE_DRIVE = rectangle('service-drive', 'Fab lab service drive', 134, 38, 12, 92);
const ENTRY_WALK = rectangle('entry-walk', 'Court walk', 35, 54, 5, 34);
const GUEST_WALK = rectangle('guest-walk', 'Guest house walk', 74, 84.5, 30, 3.5);

// Built street-edge gate, parked leaves, returns, and privacy screens. These
// segmented masks deliberately leave the 38' main gate and 12' service gate
// openings untouched so meadow cover still meets the open thresholds.
const BOUNDARY_HARDSCAPE = Object.freeze([
  rectangle('boundary-west', 'West privacy wing and parked gate', 0.5, 128.3, 37.9, 1.4),
  rectangle('boundary-garage-return', 'Garage gate return', 38.3, 123.8, 1.8, 4.6),
  rectangle('boundary-east-screen', 'Motor-court east privacy screen', 77.9, 90.3, 1.7, 38.1),
  rectangle('boundary-east', 'East privacy wing and parked gate', 79.6, 128.3, 54.4, 1.4),
  rectangle('boundary-service-return', 'Service gate east return', 145.9, 128.3, 3.6, 1.4),
  // Full perimeter enclosure: the same fence language continues along the
  // west, north, and east lot boundaries, leaving only the two street gates.
  rectangle('boundary-perimeter-west', 'West perimeter fence', 0.25, 0.5, 1.0, 128.4),
  rectangle('boundary-perimeter-north', 'North perimeter fence', 0.25, 0.25, 149.5, 1.0),
  rectangle('boundary-perimeter-east', 'East perimeter fence', 148.75, 0.5, 1.0, 128.4),
]);

// Managed clearings keep tall meadow growth from hiding the plan without
// stripping the entire 0.45-acre lot to bare terrain: the walled pool court,
// the motor court and entry drive, the kitchen garden, and the fab-link lawn.
const MANAGED_OPEN_AREAS = Object.freeze([
  rectangle('pool-court', 'Pool court', 34, 42, 76, 48),
  rectangle('motor-court-green', 'Motor court and drive', 40, 88, 38, 42),
  rectangle('garden-west-lawn', 'Kitchen garden and west lawn', 16, 44, 19, 42),
  rectangle('fab-link-lawn', 'Fab link lawn', 98, 24, 12, 64),
]);

const AUTHORED_TREES = Object.freeze([
  Object.freeze({ x: 59, z: 107, radius: 3 }),
  Object.freeze({ x: 101, z: 47, radius: 3 }),
  Object.freeze({ x: 24, z: 78, radius: 3.5 }),
  Object.freeze({ x: 88, z: 112, radius: 3.2 }),
  Object.freeze({ x: 130, z: 58, radius: 3 }),
]);

const LOT = rectangle('lot', 'Family compound lot', 0, 0, 150, 130);
const PLAN_ANCHOR = Object.freeze({ x: 75, z: 65 });
const HARDSCAPE_RECTS = Object.freeze([
  ...BUILDING_LIST,
  POOL_DECK,
  ...CANOPIES,
  ...GARDEN_BEDS,
  DRIVEWAY,
  SERVICE_DRIVE,
  ENTRY_WALK,
  GUEST_WALK,
  ...BOUNDARY_HARDSCAPE,
]);

/**
 * Courtyard family compound plan (A-103): the A-102 program recomposed as a
 * Malibu/Hawaii-style compound. The buildings frame a central walled pool
 * court: main house bar along the north opening south through the lanai, the
 * garage as street-edge gatehouse behind a gated motor court, the guest house
 * on the court's east edge (doubling as pool house), and the fab lab screened
 * in the north-east corner with its own service drive. The garage sits
 * deliberately near the street as the compound's privacy wall — confirm the
 * front-setback variance with the local jurisdiction. Coordinates are feet
 * from the north-west lot corner, with +X east and +Z south. Elevations and
 * materials are intentionally outside this data model.
 */
export const COMPOUND_PLAN = Object.freeze({
  units: 'feet',
  anchor: PLAN_ANCHOR,
  lot: LOT,
  mainHouse: MAIN_HOUSE,
  fabLab: FAB_LAB,
  garage: GARAGE,
  guestHouse: GUEST_HOUSE,
  buildings: BUILDINGS,
  buildingList: BUILDING_LIST,
  poolDeck: POOL_DECK,
  pool: POOL,
  canopies: CANOPIES,
  gardenBeds: GARDEN_BEDS,
  driveway: DRIVEWAY,
  serviceDrive: SERVICE_DRIVE,
  entryWalk: ENTRY_WALK,
  guestWalk: GUEST_WALK,
  boundaryHardscape: BOUNDARY_HARDSCAPE,
  managedOpenAreas: MANAGED_OPEN_AREAS,
  authoredTrees: AUTHORED_TREES,
  hardscapeRects: HARDSCAPE_RECTS,
});

/**
 * World transform for the whole plan. The lot centre sits on the flattest
 * surveyed shelf in the eastern meadow; its slight rotation avoids aligning
 * the drawing mechanically to the world's axes.
 */
export const COMPOUND_SITE = Object.freeze({
  centerX: 60,
  centerZ: 16,
  yaw: degreesToRadians(-10),
  planAnchor: PLAN_ANCHOR,
  lotWidth: LOT.width * FEET_TO_METERS,
  lotDepth: LOT.depth * FEET_TO_METERS,
});

const mainHouseCenter = planToWorld(
  MAIN_HOUSE.x + MAIN_HOUSE.width * 0.5,
  MAIN_HOUSE.z + MAIN_HOUSE.depth * 0.5,
);

/** Backwards-compatible main-house view of the shared compound transform. */
export const HOUSE_SITE = Object.freeze({
  centerX: mainHouseCenter.x,
  centerZ: mainHouseCenter.z,
  yaw: COMPOUND_SITE.yaw,
  width: MAIN_HOUSE.width * FEET_TO_METERS,
  depth: MAIN_HOUSE.depth * FEET_TO_METERS,
  clearingPadding: 0.8,
  planRect: MAIN_HOUSE,
});

/** Converts blueprint feet to compound-root-local metres. */
export function planToLocal(planX, planZ) {
  return {
    x: (planX - PLAN_ANCHOR.x) * FEET_TO_METERS,
    z: (planZ - PLAN_ANCHOR.z) * FEET_TO_METERS,
  };
}

/** Converts compound-root-local metres to blueprint feet. */
export function localToPlan(localX, localZ) {
  return {
    x: localX / FEET_TO_METERS + PLAN_ANCHOR.x,
    z: localZ / FEET_TO_METERS + PLAN_ANCHOR.z,
  };
}

/** Converts blueprint feet directly to biome world XZ coordinates. */
export function planToWorld(planX, planZ) {
  const local = planToLocal(planX, planZ);
  const cosine = Math.cos(COMPOUND_SITE.yaw);
  const sine = Math.sin(COMPOUND_SITE.yaw);
  return {
    x: COMPOUND_SITE.centerX + cosine * local.x + sine * local.z,
    z: COMPOUND_SITE.centerZ - sine * local.x + cosine * local.z,
  };
}

/** Converts biome world XZ coordinates back to blueprint feet. */
export function worldToPlan(x, z) {
  const dx = x - COMPOUND_SITE.centerX;
  const dz = z - COMPOUND_SITE.centerZ;
  const cosine = Math.cos(COMPOUND_SITE.yaw);
  const sine = Math.sin(COMPOUND_SITE.yaw);
  return localToPlan(
    dx * cosine - dz * sine,
    dx * sine + dz * cosine,
  );
}

/** Tests a blueprint-space point against a plan rectangle. */
export function isInsidePlanRectangle(planX, planZ, planRectangle, paddingFeet = 0) {
  return planX >= planRectangle.x - paddingFeet
    && planX <= planRectangle.x + planRectangle.width + paddingFeet
    && planZ >= planRectangle.z - paddingFeet
    && planZ <= planRectangle.z + planRectangle.depth + paddingFeet;
}

/** Tests a world-space point against one blueprint rectangle. */
export function isInsideWorldRectangle(x, z, planRectangle, paddingMeters = 0) {
  const plan = worldToPlan(x, z);
  return isInsidePlanRectangle(
    plan.x,
    plan.z,
    planRectangle,
    paddingMeters / FEET_TO_METERS,
  );
}

/** Tests a world-space point against any rectangle in a plan collection. */
export function isInsideAnyWorldRectangle(x, z, rectangles, paddingMeters = 0) {
  const plan = worldToPlan(x, z);
  const paddingFeet = paddingMeters / FEET_TO_METERS;
  return rectangles.some((entry) => (
    isInsidePlanRectangle(plan.x, plan.z, entry, paddingFeet)
  ));
}

/** Tight mask for slabs, water, decks, covered links, paths, and garden beds. */
export function isInsideCompoundHardscape(x, z, paddingMeters = 0.18) {
  return isInsideAnyWorldRectangle(x, z, HARDSCAPE_RECTS, paddingMeters);
}

/**
 * Managed open rooms in the plan where waist-high meadow layers would obscure
 * circulation and the floor-plan overlay. This is deliberately not the whole
 * lot: low biome cover continues between the individual program elements.
 */
export function isInsideCompoundInterior(x, z, paddingMeters = 0) {
  return isInsideAnyWorldRectangle(x, z, MANAGED_OPEN_AREAS, paddingMeters);
}

/** Lot mask used to keep the full-scale planning surface readable at foot level. */
export function isInsideCompoundLot(x, z, paddingMeters = 0) {
  return isInsideWorldRectangle(x, z, LOT, paddingMeters);
}

/** Broad crown-safe clearing for procedural trees around the complete lot. */
export function isInsideCompoundTreeClearance(x, z, paddingMeters = 4.5) {
  return isInsideWorldRectangle(x, z, LOT, paddingMeters);
}

/** Converts a world-space XZ point into main-house-centred local metres. */
export function worldToHouseLocal(x, z) {
  const plan = worldToPlan(x, z);
  return planToLocal(plan.x, plan.z);
}

/** Backwards-compatible tight clearing test for the main-house footprint. */
export function isInsideHouseClearing(
  x,
  z,
  padding = HOUSE_SITE.clearingPadding,
) {
  return isInsideWorldRectangle(x, z, MAIN_HOUSE, padding);
}
