import * as THREE from 'three';
import { createCompoundArchitecture } from './compound-architecture.js';
import { createCompoundExteriorConstruction } from './compound-exterior-construction.js';
import { createCompoundExteriorLiving } from './compound-exterior-living.js';
import { createCompoundInteriorHeroes } from './compound-interior-heroes.js';
import { createCompoundLandscapeDetails } from './compound-landscape.js';
import { createCompoundPrivateInteriors } from './compound-private-interiors.js';
import { createCompoundSecondaryElevations } from './compound-secondary-elevations.js';
import {
  COMPOUND_SITE,
  FEET_TO_METERS,
  planToLocal,
  planToWorld,
} from './site-layout.js';

const LOT_WIDTH_FT = 150;
const LOT_DEPTH_FT = 130;
const TEXTURE_PIXELS_PER_FOOT = 20;
const SURFACE_LIFT = 0.045;

const BUILDINGS = Object.freeze([
  { name: 'Main house', x: 18, y: 16, width: 80, depth: 26, squareFeet: 2080 },
  { name: 'Fab lab', x: 104, y: 12, width: 40, depth: 26, squareFeet: 1040 },
  { name: 'Garage', x: 16, y: 88, width: 24, depth: 36, squareFeet: 864 },
  { name: 'Guest house', x: 108, y: 76, width: 26, depth: 22, squareFeet: 572 },
]);

// Split so the massing-wall pass can treat them differently: doors (and
// overhead doors, sliders, and cased openings) become full-height gaps,
// windows keep a low sill.
const DOOR_OPENINGS = Object.freeze([
  // Main house south wall: the whole living band opens to the lanai —
  // mud door, kitchen slider, entry, dining slider, 16' great-room pocket
  // slider, primary suite slider.
  [19.7, 41.2, 3, 1.6], [28, 41.2, 6, 1.6], [43.2, 41.2, 3.5, 1.6],
  [51, 41.2, 10, 1.6], [66, 41.2, 16, 1.6], [88, 41.2, 8, 1.6],
  // Main house gallery-hall wall: kitchen pass, foyer, and great-room openings.
  [30, 29.2, 6, 1.6], [43, 29.2, 4, 1.6], [81, 29.2, 4, 1.6],
  // Main house bedroom-band doors off the hall.
  [19.5, 25.2, 3, 1.6], [23.8, 25.2, 2.8, 1.6], [30, 25.2, 3, 1.6],
  [42, 25.2, 3, 1.6], [51, 25.2, 3, 1.6], [62, 25.2, 3, 1.6],
  [73.6, 25.2, 2.8, 1.6], [91.5, 25.2, 3, 1.6],
  // Main house service corner and suite interconnects.
  [20, 33.2, 3, 1.6], [25.2, 31, 1.6, 2.8], [25.2, 36.5, 1.6, 3],
  [85.2, 19, 1.6, 3], [85.2, 26.8, 1.6, 3], [67.2, 19, 1.6, 3],
  // Fab lab: link entry lands in the design office, not the server room.
  [103.2, 25.5, 1.6, 3], [107, 11.2, 3, 1.6],
  [106, 21.2, 3, 1.6], [113.2, 28, 1.6, 3],
  [127.2, 16, 1.6, 3], [127.2, 28, 1.6, 3], [138, 23.2, 3, 1.6],
  [118, 37.2, 3, 1.6], [134, 37.2, 8, 1.6],
  // Guest house
  [107.2, 79, 1.6, 3], [121.2, 80, 1.6, 3], [121.2, 92, 1.6, 3],
  // Garage: person door onto the breezeway, overhead doors face the court.
  [35.5, 87.2, 3, 1.6],
  [39.2, 90.5, 1.6, 9], [39.2, 101.5, 1.6, 9], [39.2, 112.5, 1.6, 9],
]);

const WINDOW_OPENINGS = Object.freeze([
  // Main house north band (rear-yard windows; beds 2 and 3 sized for egress).
  [24, 15.2, 2.2, 1.6], [29, 15.2, 5, 1.6], [40, 15.2, 5, 1.6],
  [50.5, 15.2, 3, 1.6], [59, 15.2, 6, 1.6], [89.5, 15.2, 4, 1.6],
  [17.2, 36, 1.6, 4], [17.2, 26.6, 1.6, 2.8], [97.2, 30.5, 1.6, 5],
  // Fab lab
  [117, 11.2, 5, 1.6], [123.5, 11.2, 4, 1.6],
  [103.2, 14, 1.6, 3], [103.2, 32, 1.6, 4],
  [143.2, 15, 1.6, 4], [143.2, 30, 1.6, 4],
  // Guest house
  [112, 75.2, 5, 1.6], [125, 75.2, 4, 1.6], [113, 97.2, 5, 1.6],
  [133.2, 79.5, 1.6, 4], [126, 97.2, 3, 1.6],
  // Garage
  [15.2, 103, 1.6, 4],
]);

const OPENINGS = Object.freeze([...DOOR_OPENINGS, ...WINDOW_OPENINGS]);

const DOOR_SWINGS = Object.freeze([
  // Main house hinged doors (sliders and cased openings get no swing).
  'M19.7 42 L19.7 39 A3 3 0 0 1 22.7 42',
  'M43.2 42 L43.2 38.5 A3.5 3.5 0 0 1 46.7 42',
  'M19.5 26 L19.5 23 A3 3 0 0 1 22.5 26',
  'M26.6 26 L26.6 23.2 A2.8 2.8 0 0 0 23.8 26',
  'M30 26 L30 23 A3 3 0 0 1 33 26',
  'M42 26 L42 23 A3 3 0 0 1 45 26',
  'M54 26 L54 23 A3 3 0 0 0 51 26',
  'M62 26 L62 23 A3 3 0 0 1 65 26',
  'M73.6 26 L73.6 28.8 A2.8 2.8 0 0 0 76.4 26',
  'M91.5 26 L91.5 23 A3 3 0 0 1 94.5 26',
  'M20 34 L20 31 A3 3 0 0 1 23 34',
  'M26 31 L23.2 31 A2.8 2.8 0 0 0 26 33.8',
  'M26 36.5 L23 36.5 A3 3 0 0 0 26 39.5',
  'M86 19 L83 19 A3 3 0 0 0 86 22',
  'M86 26.8 L89 26.8 A3 3 0 0 1 86 29.8',
  'M68 19 L71 19 A3 3 0 0 1 68 22',
  // Fab lab
  'M104 25.5 L107 25.5 A3 3 0 0 1 104 28.5',
  'M107 12 L107 15 A3 3 0 0 0 110 12',
  'M106 22 L106 25 A3 3 0 0 0 109 22',
  'M114 28 L117 28 A3 3 0 0 1 114 31',
  'M128 16 L131 16 A3 3 0 0 1 128 19',
  'M128 28 L131 28 A3 3 0 0 1 128 31',
  'M138 24 L138 27 A3 3 0 0 0 141 24',
  'M118 38 L118 35 A3 3 0 0 1 121 38',
  // Guest house
  'M108 79 L111 79 A3 3 0 0 1 108 82',
  'M122 80 L125 80 A3 3 0 0 1 122 83',
  'M122 92 L125 92 A3 3 0 0 1 122 95',
  // Garage
  'M35.5 88 L35.5 91 A3 3 0 0 0 38.5 88',
]);

// Chest-high "study model" walls extruded from the plan ink. Floor ink alone
// reads roughly half size at eye level; a low vertical reference restores true
// perceived room scale while staying view-safe and collision-free.
const WALL_HEIGHT_METERS = 1.15;
const WINDOW_SILL_METERS = 0.5;
const WALL_SINK_METERS = 0.25;

// axis 'x': runs along +X at plan z = at; axis 'z': runs along +Z at plan x = at.
const wall = (axis, at, from, to, thick) => Object.freeze({ axis, at, from, to, thick });
const WALL_SEGMENTS = Object.freeze([
  // Main house shell (80' x 26' bar)
  wall('x', 16, 18, 98, .85), wall('x', 42, 18, 98, .85),
  wall('z', 18, 16, 42, .85), wall('z', 98, 16, 42, .85),
  // Bedroom-band wall and gallery-hall wall
  wall('x', 26, 18, 98, .45), wall('x', 30, 18, 86, .45),
  // Service corner: pantry over mud, both beside the kitchen
  wall('x', 34, 18, 26, .45), wall('z', 26, 30, 42, .45),
  // North band partitions: mech, powder, office, bed 3, bath 2, bed 2,
  // bed 2 closet, linen, W.I.C., primary bath
  wall('z', 23, 16, 26, .45), wall('z', 27, 16, 26, .45),
  wall('z', 37, 16, 26, .45), wall('z', 49, 16, 26, .45),
  wall('z', 56, 16, 26, .45), wall('z', 68, 16, 26, .45),
  wall('z', 73, 16, 26, .45), wall('z', 77, 16, 26, .45),
  // Primary suite separation (full depth)
  wall('z', 86, 16, 42, .45),
  // Fab lab shell
  wall('x', 12, 104, 144, .85), wall('x', 38, 104, 144, .85),
  wall('z', 104, 12, 38, .85), wall('z', 144, 12, 38, .85),
  // Fab lab partitions
  wall('z', 114, 12, 38, .45), wall('x', 22, 104, 114, .45),
  wall('z', 128, 12, 38, .45), wall('x', 24, 128, 144, .45),
  // Garage shell (gatehouse, doors facing the motor court)
  wall('x', 88, 16, 40, .85), wall('x', 124, 16, 40, .85),
  wall('z', 16, 88, 124, .85), wall('z', 40, 88, 124, .85),
  // Guest house shell
  wall('x', 76, 108, 134, .85), wall('x', 98, 108, 134, .85),
  wall('z', 108, 76, 98, .85), wall('z', 134, 76, 98, .85),
  // Guest house partitions
  wall('z', 122, 76, 98, .45), wall('x', 89, 122, 134, .45),
]);

/** Openings from the plan that pierce one wall segment, as spans along it. */
function wallCutSpans(segment) {
  const spans = [];
  const collect = (openings, kind) => {
    for (const [ox, oz, ow, od] of openings) {
      const across0 = segment.axis === 'x' ? oz : ox;
      const across1 = segment.axis === 'x' ? oz + od : ox + ow;
      if (!(across0 < segment.at && segment.at < across1)) continue;
      const from = Math.max(segment.from, segment.axis === 'x' ? ox : oz);
      const to = Math.min(segment.to, segment.axis === 'x' ? ox + ow : oz + od);
      if (to - from > 0.2) spans.push({ from, to, kind });
    }
  };
  collect(DOOR_OPENINGS, 'door');
  collect(WINDOW_OPENINGS, 'window');
  return spans.sort((a, b) => a.from - b.from);
}

function buildWallPieces() {
  const pieces = [];
  for (const segment of WALL_SEGMENTS) {
    let cursor = segment.from;
    for (const span of wallCutSpans(segment)) {
      if (span.from - cursor > 0.1) {
        pieces.push({ segment, from: cursor, to: span.from, height: WALL_HEIGHT_METERS });
      }
      if (span.kind === 'window') {
        pieces.push({ segment, from: span.from, to: span.to, height: WINDOW_SILL_METERS });
      }
      cursor = Math.max(cursor, span.to);
    }
    if (segment.to - cursor > 0.1) {
      pieces.push({ segment, from: cursor, to: segment.to, height: WALL_HEIGHT_METERS });
    }
  }
  return pieces;
}

function safeHeight(heightAt, x, z) {
  const value = heightAt?.(x, z);
  return Number.isFinite(value) ? value : 0;
}

function colorChannels(value, fallback) {
  if (!Number.isInteger(value)) return fallback;
  return [
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  ];
}

function rgba(value, alpha, fallback = [20, 27, 27]) {
  const [red, green, blue] = colorChannels(value, fallback);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function rect(ctx, x, y, width, height, options = {}) {
  ctx.save();
  if (options.dash) ctx.setLineDash(options.dash);
  if (options.fill) {
    ctx.fillStyle = options.fill;
    ctx.fillRect(x, y, width, height);
  }
  if (options.stroke) {
    ctx.strokeStyle = options.stroke;
    ctx.lineWidth = options.lineWidth ?? 0.15;
    ctx.strokeRect(x, y, width, height);
  }
  ctx.restore();
}

function strokePath(ctx, pathData, options = {}) {
  ctx.save();
  ctx.strokeStyle = options.stroke;
  ctx.lineWidth = options.lineWidth ?? 0.15;
  ctx.lineCap = options.lineCap ?? 'square';
  ctx.lineJoin = options.lineJoin ?? 'miter';
  if (options.dash) ctx.setLineDash(options.dash);
  ctx.globalAlpha = options.alpha ?? 1;
  ctx.stroke(new Path2D(pathData));
  ctx.restore();
}

function label(ctx, text, x, y, size = 1.25, options = {}) {
  const lines = Array.isArray(text) ? text : [text];
  const lineHeight = options.lineHeight ?? size * 1.12;
  ctx.save();
  ctx.translate(x, y - ((lines.length - 1) * lineHeight) * 0.5);
  if (options.rotate) ctx.rotate(options.rotate);
  ctx.textAlign = options.align ?? 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${options.weight ?? 600} ${size}px Consolas, "Courier New", monospace`;
  ctx.letterSpacing = `${options.spacing ?? 0.06}px`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = options.haloWidth ?? Math.max(0.12, size * 0.12);
  ctx.strokeStyle = options.halo ?? 'rgba(238, 214, 169, 0.92)';
  ctx.fillStyle = options.fill ?? 'rgba(16, 28, 28, 0.96)';
  lines.forEach((line, index) => {
    const lineY = index * lineHeight;
    ctx.strokeText(line, 0, lineY);
    ctx.fillText(line, 0, lineY);
  });
  ctx.restore();
}

function drawSite(ctx, colors) {
  const {
    ink,
    secondaryInk,
    floor,
    floorOpening,
    siteWash,
    accent,
  } = colors;

  ctx.clearRect(0, 0, LOT_WIDTH_FT, LOT_DEPTH_FT);
  rect(ctx, 0, 0, LOT_WIDTH_FT, LOT_DEPTH_FT, { fill: siteWash });

  // A very quiet ten-foot module keeps the full-size drawing legible while
  // walking through it without competing with authored walls.
  ctx.save();
  ctx.strokeStyle = 'rgba(211, 171, 99, 0.075)';
  ctx.lineWidth = 0.055;
  for (let x = 10; x < LOT_WIDTH_FT; x += 10) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, LOT_DEPTH_FT);
    ctx.stroke();
  }
  for (let y = 10; y < LOT_DEPTH_FT; y += 10) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(LOT_WIDTH_FT, y);
    ctx.stroke();
  }
  ctx.restore();

  rect(ctx, 0.15, 0.15, 149.7, 129.7, {
    stroke: accent,
    lineWidth: 0.3,
    dash: [4, 1.2, 1, 1.2],
  });

  // Gated motor court behind the garage, its street stub, the fab lab's
  // gravel service drive along the east boundary, and the guest walk.
  rect(ctx, 40, 90, 38, 34, { fill: 'rgba(103, 77, 53, 0.28)' });
  rect(ctx, 48, 124, 22, 6, { fill: 'rgba(103, 77, 53, 0.28)' });
  rect(ctx, 134, 38, 12, 92, { fill: 'rgba(103, 77, 53, 0.16)' });
  strokePath(ctx, 'M40 90 H78 M78 90 V124 M40 124 H48 M70 124 H78 M48 124 V130 M70 124 V130 M134 38 V130 M146 38 V130 M74 84.5 H104 M74 88 H104', {
    stroke: secondaryInk,
    lineWidth: 0.18,
  });
  {
    let hatch = '';
    for (const row of [94, 106, 118]) {
      for (let x = 42; x <= 70; x += 6) hatch += `M${x} ${row} L${x + 6} ${row + 6} `;
    }
    for (let y = 44; y <= 118; y += 10) hatch += `M135 ${y} L145 ${y + 6} `;
    strokePath(ctx, hatch.trim(), {
      stroke: secondaryInk,
      lineWidth: 0.08,
      alpha: 0.7,
    });
  }
  // Gate leaves at the motor-court street opening.
  strokePath(ctx, 'M48 124 L58 122.4 M70 124 L60 122.4', {
    stroke: ink,
    lineWidth: 0.22,
  });

  // Central pool court: deck and pool sit directly off the lanai, framed by
  // the house, garage, breezeway, and guest house.
  rect(ctx, 40, 54, 64, 30, {
    fill: 'rgba(166, 120, 72, 0.25)',
    stroke: secondaryInk,
    lineWidth: 0.18,
  });
  rect(ctx, 56, 62, 32, 16, {
    fill: 'rgba(38, 112, 121, 0.48)',
    stroke: 'rgba(160, 217, 211, 0.92)',
    lineWidth: 0.35,
  });
  {
    let lanes = '';
    for (let y = 64; y <= 76; y += 2) lanes += `M57 ${y} H87 `;
    strokePath(ctx, lanes.trim(), {
      stroke: 'rgba(184, 225, 214, 0.48)',
      lineWidth: 0.08,
    });
  }
  strokePath(ctx, 'M56 76.5 A1.5 1.5 0 0 1 57.5 78 M56 75 A3 3 0 0 1 59 78', {
    stroke: 'rgba(211, 237, 225, 0.86)',
    lineWidth: 0.15,
  });

  // Pool barrier fence closing the court (IRC-style enclosure): house wall on
  // the north, garage on the south-west, fence with three gates elsewhere.
  strokePath(ctx, 'M98.4 42.4 H104.5 M104.5 42.4 V78 M104.5 84 V88 M104.5 88 H74 M70 88 H40 M34.5 88 V62 M34.5 58 V54 M34.5 54 V42.4', {
    stroke: accent,
    lineWidth: 0.24,
    dash: [1.6, 0.9],
  });

  // Six 8 x 3 foot kitchen beds beside the mud room and kitchen, outside the
  // pool fence so the garden is reachable without a gate.
  for (const x of [17.5, 26.5]) {
    for (const y of [48, 54, 60]) {
      rect(ctx, x, y, 8, 3, {
        fill: 'rgba(83, 104, 53, 0.38)',
        stroke: 'rgba(176, 155, 83, 0.86)',
        lineWidth: 0.18,
      });
      strokePath(ctx, `M${x + 1} ${y + 1.5} H${x + 7}`, {
        stroke: 'rgba(202, 176, 89, 0.42)',
        lineWidth: 0.07,
        dash: [0.4, 0.35],
      });
    }
  }

  // Existing-canopy symbols retained from the site plan. They are only ink on
  // the ground at this phase, not newly spawned trees or collision objects.
  ctx.save();
  ctx.strokeStyle = 'rgba(115, 137, 72, 0.84)';
  ctx.fillStyle = 'rgba(83, 111, 61, 0.18)';
  ctx.lineWidth = 0.15;
  for (const [x, y, radius] of [
    [59, 107, 3], [101, 47, 3], [24, 78, 3.5], [88, 112, 3.2], [130, 58, 3],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // The lanai (the compound's real living room) and the garage breezeway:
  // deck wash, plank lines, posts.
  rect(ctx, 36, 42, 62, 12, {
    fill: 'rgba(166, 120, 72, 0.22)',
    stroke: secondaryInk,
    lineWidth: 0.18,
  });
  rect(ctx, 35, 54, 5, 34, {
    fill: 'rgba(166, 120, 72, 0.18)',
    stroke: secondaryInk,
    lineWidth: 0.18,
  });
  {
    let planks = '';
    for (const x of [46, 52, 58, 64, 70, 76, 82, 88, 94]) planks += `M${x} 42 V54 `;
    for (const y of [60, 66, 72, 78, 84]) planks += `M35 ${y} H40 `;
    strokePath(ctx, planks.trim(), {
      stroke: secondaryInk,
      lineWidth: 0.06,
      alpha: 0.5,
    });
  }
  ctx.save();
  ctx.fillStyle = ink;
  for (const postX of [37, 45.6, 54.2, 62.8, 71.4, 80, 88.6, 96.9]) {
    ctx.fillRect(postX, 52.9, 0.9, 0.9);
  }
  for (const postY of [58, 66, 74, 82]) {
    ctx.fillRect(35.1, postY, 0.7, 0.7);
    ctx.fillRect(39.3, postY, 0.7, 0.7);
  }
  ctx.restore();

  // Covered links: house to fab lab, pool deck to guest house door.
  for (const [x, y, width, height] of [[98, 24, 6, 6], [104, 78, 4, 6]]) {
    rect(ctx, x, y, width, height, {
      fill: 'rgba(203, 135, 45, 0.14)',
      stroke: 'rgba(226, 166, 74, 0.9)',
      lineWidth: 0.22,
      dash: [1.2, 0.7],
    });
  }

  // The four slab footprints are exact plan rectangles.
  for (const building of BUILDINGS) {
    rect(ctx, building.x, building.y, building.width, building.depth, { fill: floor });
  }
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = floor;
  ctx.lineWidth = 0.85;
  for (const building of BUILDINGS) {
    ctx.strokeRect(building.x, building.y, building.width, building.depth);
  }
  ctx.restore();
  strokePath(ctx, 'M98 24 H104 M98 30 H104 M104 78 H108 M104 84 H108', { stroke: ink, lineWidth: 0.85 });

  // Main house partitions: bedroom band, gallery hall, service corner, suite.
  strokePath(ctx, 'M18 26 H98 M18 30 H86 M18 34 H26 M26 30 V42 M23 16 V26 M27 16 V26 M37 16 V26 M49 16 V26 M56 16 V26 M68 16 V26 M73 16 V26 M77 16 V26 M86 16 V42', {
    stroke: ink,
    lineWidth: 0.45,
  });
  strokePath(ctx, 'M114 12 V38 M104 22 H114 M128 12 V38 M128 24 H144', {
    stroke: ink,
    lineWidth: 0.45,
  });
  strokePath(ctx, 'M122 76 V98 M122 89 H134', {
    stroke: ink,
    lineWidth: 0.45,
  });

  // Cut the exact door/window gaps back through the heavy wall strokes, then
  // restore the slab tone so openings remain clear at a human-height view.
  for (const [x, y, width, height] of OPENINGS) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, width, height);
    ctx.restore();
    ctx.save();
    ctx.fillStyle = floorOpening;
    ctx.fillRect(x, y, width, height);
    ctx.restore();
  }

  // Window sashes, slider leaves, and overhead-door marks.
  strokePath(ctx, 'M24 16 H26.2 M29 16 H34 M40 16 H45 M50.5 16 H53.5 M59 16 H65 M89.5 16 H93.5 M18 36 V40 M18 26.6 V29.4 M98 30.5 V35.5 M117 12 H122 M123.5 12 H127.5 M104 14 V17 M104 32 V36 M144 15 V19 M144 30 V34 M112 76 H117 M125 76 H129 M113 98 H118 M134 79.5 V83.5 M126 98 H129 M16 103 V107', {
    stroke: 'rgba(213, 230, 213, 0.98)',
    lineWidth: 0.2,
  });
  strokePath(ctx, 'M28 41.65 H31.2 M30.8 42.35 H34 M51 41.65 H56.2 M55.8 42.35 H61 M66 41.65 H74.2 M73.8 42.35 H82 M88 41.65 H92.2 M91.8 42.35 H96', {
    stroke: 'rgba(213, 230, 213, 0.98)',
    lineWidth: 0.16,
  });
  strokePath(ctx, 'M40.6 90.5 V99.5 M40.6 101.5 V110.5 M40.6 112.5 V121.5 M134 37.6 H142', {
    stroke: 'rgba(213, 230, 213, 0.94)',
    lineWidth: 0.18,
    dash: [0.9, 0.6],
  });

  for (const path of DOOR_SWINGS) {
    strokePath(ctx, path, {
      stroke: 'rgba(207, 87, 52, 0.98)',
      lineWidth: 0.14,
      lineCap: 'round',
    });
  }

  drawFurniture(ctx, secondaryInk);
  drawLabels(ctx, colors);
  drawNorthArrowAndScale(ctx, colors);
}

function drawFurniture(ctx, furnitureInk) {
  const furnitureFill = 'rgba(116, 77, 48, 0.11)';
  const furnitureRect = (x, y, width, height, radius = 0) => {
    ctx.save();
    ctx.strokeStyle = furnitureInk;
    ctx.fillStyle = furnitureFill;
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };

  // Main house furniture and fixtures. These are deliberately quiet: they
  // confirm intended use without obscuring the architectural circulation.
  // Kitchen: north counter run and island facing the court.
  furnitureRect(26.5, 30.35, 15, 2.1);
  furnitureRect(30, 35, 8, 3.2);
  // Dining and great room, both against the south sliders.
  furnitureRect(52.5, 34.5, 7, 3.5, 0.4);
  furnitureRect(50, 30.35, 6, 1.4);
  furnitureRect(66.5, 35.5, 10, 3, 0.5);
  furnitureRect(78.5, 32.8, 2.7, 2.7, 0.5);
  furnitureRect(82, 32.8, 2.7, 2.7, 0.5);
  furnitureRect(68, 30.4, 10, 1.5);
  // Foyer bench.
  furnitureRect(47.3, 38.5, 1.5, 3);
  // Primary suite: bed wall, bath, walk-in closet.
  furnitureRect(89.2, 31.5, 6.5, 7, 0.3);
  furnitureRect(87.5, 31.5, 1.5, 1.5);
  furnitureRect(95.9, 31.5, 1.5, 1.5);
  furnitureRect(91, 39.5, 4, 1.4);
  furnitureRect(87, 16.7, 6, 1.9);
  furnitureRect(94.2, 16.7, 3.4, 4);
  furnitureRect(87, 22.3, 2.4, 2.9);
  furnitureRect(77.6, 16.7, 1.8, 8.6);
  furnitureRect(83.6, 16.7, 1.8, 8.6);
  // Beds 2 and 3, shared bath, office, powder, mech, mud, pantry.
  furnitureRect(58.8, 16.9, 6.5, 7, 0.3);
  furnitureRect(66, 21, 1.8, 4);
  furnitureRect(39.8, 16.9, 6.5, 7, 0.3);
  furnitureRect(46.6, 17, 2, 6);
  furnitureRect(49.7, 16.8, 4, 1.8);
  furnitureRect(49.7, 22.7, 5.6, 2.7);
  furnitureRect(27.6, 18.5, 2, 5.5);
  furnitureRect(32.5, 16.7, 4, 1.5);
  furnitureRect(23.6, 16.8, 3, 1.6);
  furnitureRect(23.8, 20, 2.3, 2.8);
  furnitureRect(18.7, 16.8, 3.6, 2.3);
  furnitureRect(22.8, 34.4, 3, 2.7);
  furnitureRect(18.5, 37.5, 1.5, 3.6);
  furnitureRect(18.6, 30.35, 5.5, 1.4);
  // Lanai and pool deck: outdoor dining, loungers, fire pit, and the
  // outdoor kitchen on the deck's west end — inside the pool fence, one
  // slider away from the indoor kitchen, beside the garden gate for herbs.
  furnitureRect(59, 45.8, 7, 3.4, 0.4);
  furnitureRect(41, 58, 2.4, 13);
  furnitureRect(41, 60.8, 3, 3.2);
  furnitureRect(45.8, 60.5, 2.2, 8);
  furnitureRect(48.6, 61.5, 1.2, 1.2, 0.6);
  furnitureRect(48.6, 64, 1.2, 1.2, 0.6);
  furnitureRect(48.6, 66.5, 1.2, 1.2, 0.6);
  furnitureRect(88, 80.4, 6, 2.6);
  furnitureRect(95, 80.4, 6, 2.6);
  furnitureRect(95, 68.5, 3.4, 3.4, 1.7);

  // Garage: two cars nose-in at the court doors, workbench, project bay.
  furnitureRect(22, 90.8, 15.5, 6.8, 1.4);
  furnitureRect(22, 102, 15.5, 6.8, 1.4);
  furnitureRect(16.6, 112, 2.2, 10);
  furnitureRect(20, 120.5, 6, 2.5);

  // Fab lab equipment footprints.
  for (const y of [12.8, 15.4, 18]) furnitureRect(105, y, 2.4, 2.2);
  furnitureRect(104.6, 29, 2.2, 7);
  furnitureRect(107.2, 35.2, 5.5, 2.2);
  furnitureRect(114.6, 12.8, 10, 2.4);
  furnitureRect(115, 34.9, 9, 2.4);
  furnitureRect(117.5, 21.5, 7, 4.5);
  furnitureRect(129.2, 14, 10, 4.6);
  furnitureRect(141.2, 14, 2.2, 8);
  furnitureRect(130, 28.5, 5, 4);
  furnitureRect(141.4, 26, 2.2, 10);

  // Guest house.
  furnitureRect(108.6, 76.8, 7, 2.2);
  furnitureRect(110, 90, 7, 2.8, 0.5);
  furnitureRect(114, 83.5, 3.4, 3.4, 1.7);
  furnitureRect(124.8, 79.2, 6.5, 7, 0.3);
  furnitureRect(122.6, 85.5, 2, 3);
  furnitureRect(122.6, 89.6, 4, 1.8);
  furnitureRect(129.8, 93.6, 3.6, 3.8);
}

function drawLabels(ctx, colors) {
  const common = { fill: colors.ink, halo: 'rgba(230, 205, 157, 0.9)' };
  const secondary = { ...common, fill: colors.secondaryInk, weight: 500 };

  label(ctx, 'MAIN HOUSE · 2,080 SF', 58, 13.2, 1.65, common);
  label(ctx, 'FAB LAB · 1,040 SF', 124, 9.6, 1.6, common);
  label(ctx, 'GARAGE · 864 SF', 27, 86, 1.4, common);
  label(ctx, 'GUEST HOUSE · 572 SF', 121, 100.8, 1.5, common);

  label(ctx, ['MUD', 'LAUNDRY'], 22, 38.2, 0.82, secondary);
  label(ctx, 'PANTRY', 22, 32.2, 0.62, secondary);
  label(ctx, ['KITCHEN', "16' × 12'"], 34.5, 37.8, 0.98, secondary);
  label(ctx, 'FOYER', 45.4, 36.5, 0.75, secondary);
  label(ctx, ['DINING', "14' × 12'"], 56, 37.8, 0.98, secondary);
  label(ctx, ['GREAT ROOM', "23' × 12'"], 74.5, 37.8, 1.08, secondary);
  label(ctx, ['PRIMARY', "12' × 16'"], 92, 35.5, 1.02, secondary);
  label(ctx, 'MECH', 20.5, 21, 0.66, { ...secondary, rotate: Math.PI * 0.5 });
  label(ctx, 'POWDER', 25, 21, 0.62, { ...secondary, rotate: Math.PI * 0.5 });
  label(ctx, ['OFFICE', "10' × 10'"], 32, 21, 0.82, secondary);
  label(ctx, ['BED 3', "12' × 10'"], 43, 21, 0.95, secondary);
  label(ctx, 'BATH 2', 52.5, 20.5, 0.68, { ...secondary, rotate: Math.PI * 0.5 });
  label(ctx, ['BED 2', "12' × 10'"], 62, 21, 0.95, secondary);
  label(ctx, 'CL.', 70.5, 21, 0.58, { ...secondary, rotate: Math.PI * 0.5 });
  label(ctx, 'LINEN', 75, 21, 0.55, { ...secondary, rotate: Math.PI * 0.5 });
  label(ctx, 'W.I.C.', 81.5, 21, 0.78, secondary);
  label(ctx, ['PRIMARY', 'BATH'], 91, 20.8, 0.78, secondary);
  label(ctx, "LANAI · 12' DEEP", 68, 48.3, 1.2, secondary);
  label(ctx, 'ENTRY', 42, 47.5, 0.78, secondary);
  label(ctx, 'BREEZEWAY', 37.5, 70, 0.72, { ...secondary, rotate: Math.PI * 0.5 });

  label(ctx, 'SERVER', 109, 17.4, 0.92, secondary);
  label(ctx, ['DESIGN', 'OFFICE'], 109, 30, 0.95, secondary);
  label(ctx, ['FAB FLOOR', 'ELEC + 3D PRINT'], 121, 25.5, 1.05, secondary);
  label(ctx, 'CNC SHOP', 136, 18.5, 1.05, secondary);
  label(ctx, 'WELDING', 136, 31, 1.05, secondary);

  label(ctx, ['LIVING +', 'KITCHENETTE'], 115, 86.5, 0.95, secondary);
  label(ctx, 'BEDROOM', 128, 83, 0.92, secondary);
  label(ctx, 'BATH', 128, 94, 0.85, secondary);
  label(ctx, ['2 CARS', '+ PROJECT BAY'], 28, 112.5, 0.98, { ...secondary, rotate: Math.PI * 0.5 });

  label(ctx, ['POOL', "32' × 16'"], 72, 70, 1.18, {
    fill: 'rgba(218, 238, 222, 0.98)',
    halo: 'rgba(25, 72, 78, 0.92)',
  });
  label(ctx, 'DECK', 95, 58.6, 0.95, secondary);
  label(ctx, 'OUTDOOR KITCHEN', 44.2, 70, 0.66, { ...secondary, rotate: Math.PI * 0.5 });
  label(ctx, 'POOL BARRIER FENCE', 56, 89.9, 0.66, secondary);
  label(ctx, 'KITCHEN GARDEN', 26.5, 66, 0.9, secondary);
  label(ctx, 'LAWN', 25, 74, 0.9, secondary);
  label(ctx, 'LAWN', 100, 112, 0.9, secondary);
  label(ctx, 'LINK', 101, 27, 0.7, { ...secondary, rotate: Math.PI * 0.5 });
  label(ctx, 'LINK', 106, 81, 0.6, { ...secondary, rotate: Math.PI * 0.5 });
  label(ctx, 'GUEST WALK', 89, 86.6, 0.68, secondary);
  label(ctx, 'MOTOR COURT', 59, 106.5, 1.05, secondary);
  label(ctx, 'GATE', 59, 121.6, 0.7, secondary);
  label(ctx, 'SERVICE DRIVE', 140, 98, 0.82, { ...secondary, rotate: Math.PI * 0.5 });
  label(ctx, 'DRIVEWAY / STREET', 59, 128.2, 0.92, secondary);
}

function drawNorthArrowAndScale(ctx, colors) {
  ctx.save();
  ctx.strokeStyle = colors.accent;
  ctx.fillStyle = colors.accent;
  ctx.lineWidth = 0.2;
  ctx.beginPath();
  ctx.arc(9, 74, 3.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(9, 76.2);
  ctx.lineTo(9, 71.1);
  ctx.lineTo(8.15, 72.5);
  ctx.moveTo(9, 71.1);
  ctx.lineTo(9.85, 72.5);
  ctx.stroke();
  ctx.restore();
  label(ctx, 'N', 9, 69.4, 1.15, {
    fill: colors.accent,
    halo: 'rgba(31, 27, 21, 0.84)',
  });

  // Ground-readable confirmation that no miniature or compression was used.
  label(ctx, 'FULL-SCALE LAYOUT · 1 PLAN FT = 1 WORLD FT', 100, 126.2, 0.9, {
    fill: colors.accent,
    halo: 'rgba(32, 26, 19, 0.9)',
  });
  ctx.save();
  ctx.strokeStyle = colors.accent;
  ctx.fillStyle = colors.accent;
  ctx.lineWidth = 0.18;
  ctx.strokeRect(124, 124.8, 10, 0.75);
  ctx.fillRect(124, 124.8, 5, 0.75);
  ctx.restore();
  label(ctx, "0     5'    10'", 129, 127, 0.72, {
    fill: colors.accent,
    halo: 'rgba(32, 26, 19, 0.9)',
  });
}

function makePlanTexture(palette) {
  const canvas = document.createElement('canvas');
  canvas.width = LOT_WIDTH_FT * TEXTURE_PIXELS_PER_FOOT;
  canvas.height = LOT_DEPTH_FT * TEXTURE_PIXELS_PER_FOOT;
  const ctx = canvas.getContext('2d', { alpha: true });
  ctx.setTransform(
    TEXTURE_PIXELS_PER_FOOT,
    0,
    0,
    TEXTURE_PIXELS_PER_FOOT,
    0,
    0,
  );

  const colors = {
    ink: rgba(palette.shadowTeal, 0.98, [9, 28, 29]),
    secondaryInk: rgba(palette.bark, 0.82, [63, 43, 30]),
    floor: 'rgba(216, 190, 143, 0.5)',
    floorOpening: 'rgba(216, 190, 143, 0.72)',
    siteWash: rgba(palette.soil, 0.16, [45, 32, 22]),
    accent: rgba(palette.grassTip, 0.96, [205, 157, 73]),
  };
  drawSite(ctx, colors);

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'Full-scale family compound floor-plan ink';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function makeMassingWalls(heightAt, pieces = buildWallPieces()) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0xd8c49c,
    roughness: 0.93,
    metalness: 0,
  });
  material.name = 'Massing study wall material';
  const mesh = new THREE.InstancedMesh(geometry, material, pieces.length);
  mesh.name = 'Chest-high massing study walls';

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  pieces.forEach((piece, index) => {
    const { segment } = piece;
    const centerAlong = (piece.from + piece.to) * 0.5;
    const planX = segment.axis === 'x' ? centerAlong : segment.at;
    const planZ = segment.axis === 'x' ? segment.at : centerAlong;
    const local = planToLocal(planX, planZ);
    const world = planToWorld(planX, planZ);
    const ground = safeHeight(heightAt, world.x, world.z);
    const lengthMeters = (piece.to - piece.from) * FEET_TO_METERS;
    const thickMeters = segment.thick * FEET_TO_METERS;
    if (segment.axis === 'x') scale.set(lengthMeters, piece.height + WALL_SINK_METERS, thickMeters);
    else scale.set(thickMeters, piece.height + WALL_SINK_METERS, lengthMeters);
    position.set(local.x, ground + (piece.height - WALL_SINK_METERS) * 0.5, local.z);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.name = 'Massing study walls (plan-aligned)';
  group.position.set(COMPOUND_SITE.centerX, 0, COMPOUND_SITE.centerZ);
  group.rotation.y = COMPOUND_SITE.yaw;
  group.add(mesh);
  return { group, geometry, material, count: pieces.length };
}

function makeTerrainConformingGeometry(heightAt) {
  // One vertex per plan foot makes the 1:1 overlay follow the meadow closely
  // enough that the player never steps through a floating slab on small rises.
  const xSegments = LOT_WIDTH_FT;
  const ySegments = LOT_DEPTH_FT;
  const rowLength = xSegments + 1;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let planY = 0; planY <= ySegments; planY += 1) {
    for (let planX = 0; planX <= xSegments; planX += 1) {
      const world = planToWorld(planX, planY);
      positions.push(
        world.x,
        safeHeight(heightAt, world.x, world.z) + SURFACE_LIFT,
        world.z,
      );
      uvs.push(planX / LOT_WIDTH_FT, 1 - planY / LOT_DEPTH_FT);
    }
  }

  for (let y = 0; y < ySegments; y += 1) {
    for (let x = 0; x < xSegments; x += 1) {
      const topLeft = y * rowLength + x;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + rowLength;
      const bottomRight = bottomLeft + 1;
      indices.push(
        topLeft, bottomLeft, topRight,
        topRight, bottomLeft, bottomRight,
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.name = 'One-foot terrain-conforming compound plan grid';
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Realizes the entire A-103 courtyard compound at exact 1:1 scale. The
 * original ground drawing and chest-high study walls are retained as a hidden
 * comparison layer that can be toggled at runtime.
 */
export function createCompoundPlan(scene, {
  heightAt,
  palette = {},
  windUniforms = null,
  quality = 'high',
} = {}) {
  const root = new THREE.Group();
  root.name = 'Walkable full-scale family compound';

  const blueprintLayer = new THREE.Group();
  blueprintLayer.name = 'Optional full-scale blueprint comparison';

  const texture = makePlanTexture(palette);
  const geometry = makeTerrainConformingGeometry(heightAt);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.012,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  material.name = 'Ground blueprint material';

  const plan = new THREE.Mesh(geometry, material);
  plan.name = 'A-103 site and floor plan · full scale';
  plan.receiveShadow = false;
  plan.castShadow = false;
  plan.renderOrder = 5;
  plan.frustumCulled = true;
  blueprintLayer.add(plan);

  // Low massing walls give the flat ink a vertical reference so rooms read at
  // their true size; they are deliberately see-over height and walkable
  // through — no colliders, still a planning surface rather than architecture.
  const wallPieces = buildWallPieces();
  const walls = makeMassingWalls(heightAt, wallPieces);
  blueprintLayer.add(walls.group);
  blueprintLayer.visible = false;
  root.add(blueprintLayer);

  const architecture = createCompoundArchitecture({
    heightAt,
    palette,
    windUniforms,
    wallPieces,
    doorOpenings: DOOR_OPENINGS,
    windowOpenings: WINDOW_OPENINGS,
  });
  root.add(architecture.root);
  const exteriorConstruction = createCompoundExteriorConstruction({
    heightAt,
    palette,
    doorOpenings: DOOR_OPENINGS,
    windowOpenings: WINDOW_OPENINGS,
  });
  root.add(exteriorConstruction.root);
  const secondaryElevations = createCompoundSecondaryElevations({
    heightAt,
    palette,
    doorOpenings: DOOR_OPENINGS,
    windowOpenings: WINDOW_OPENINGS,
  });
  root.add(secondaryElevations.root);
  const exteriorLiving = createCompoundExteriorLiving({ heightAt, palette });
  root.add(exteriorLiving.root);
  const interiorHeroes = createCompoundInteriorHeroes({ heightAt, palette });
  root.add(interiorHeroes.root);
  const privateInteriors = createCompoundPrivateInteriors({ heightAt, palette });
  root.add(privateInteriors.root);
  const landscapeDetails = createCompoundLandscapeDetails({
    heightAt,
    palette,
    windUniforms,
    quality,
  });
  root.add(landscapeDetails.root);
  scene.add(root);

  const triangles = LOT_WIDTH_FT * LOT_DEPTH_FT * 2;
  const stats = Object.freeze({
    walkable: true,
    realized: true,
    scale: '1:1',
    lotWidthFeet: LOT_WIDTH_FT,
    lotDepthFeet: LOT_DEPTH_FT,
    lotWidthMeters: COMPOUND_SITE.lotWidth ?? LOT_WIDTH_FT * FEET_TO_METERS,
    lotDepthMeters: COMPOUND_SITE.lotDepth ?? LOT_DEPTH_FT * FEET_TO_METERS,
    lotSquareFeet: LOT_WIDTH_FT * LOT_DEPTH_FT,
    structures: BUILDINGS.length,
    programmedSquareFeet: BUILDINGS.reduce((total, building) => total + building.squareFeet, 0),
    massingWallPieces: walls.count,
    blueprintAvailable: true,
    blueprintVisibleByDefault: false,
    architecture: architecture.stats,
    exteriorConstruction: exteriorConstruction.stats,
    secondaryElevations: secondaryElevations.stats,
    exteriorLiving: exteriorLiving.stats,
    interiorHeroes: interiorHeroes.stats,
    privateInteriors: privateInteriors.stats,
    landscapeDetails: landscapeDetails.stats,
    poolWater: architecture.stats.poolWater,
    drawCalls:
      architecture.stats.drawCalls
      + exteriorConstruction.stats.drawCalls
      + secondaryElevations.stats.drawCalls
      + exteriorLiving.stats.drawCalls
      + interiorHeroes.stats.drawCalls
      + privateInteriors.stats.drawCalls
      + landscapeDetails.stats.drawCalls,
    planningLayerTriangles: triangles + walls.count * 12,
    textureSize: `${LOT_WIDTH_FT * TEXTURE_PIXELS_PER_FOOT}x${LOT_DEPTH_FT * TEXTURE_PIXELS_PER_FOOT}`,
  });

  let blueprintVisible = false;
  function setBlueprintVisible(visible) {
    blueprintVisible = Boolean(visible);
    blueprintLayer.visible = blueprintVisible;
    architecture.root.visible = !blueprintVisible;
    exteriorConstruction.root.visible = !blueprintVisible;
    secondaryElevations.root.visible = !blueprintVisible;
    exteriorLiving.root.visible = !blueprintVisible;
    interiorHeroes.root.visible = !blueprintVisible;
    privateInteriors.root.visible = !blueprintVisible;
    landscapeDetails.root.visible = !blueprintVisible;
    architecture.colliders.forEach((collider) => {
      // Keep the pool boundary safe even while the architecture is replaced by
      // its planning layer; otherwise the player could be stranded inside the
      // water when the built scene is restored.
      collider.enabled = !blueprintVisible || collider.kind === 'pool-boundary';
    });
  }

  return {
    root,
    colliders: architecture.colliders,
    stats,
    setBlueprintVisible,
    get blueprintVisible() { return blueprintVisible; },
    update(elapsedSeconds) {
      architecture.update?.(elapsedSeconds);
    },
    dispose() {
      scene.remove(root);
      geometry.dispose();
      material.dispose();
      texture.dispose();
      walls.geometry.dispose();
      walls.material.dispose();
      architecture.dispose?.();
      exteriorConstruction.dispose?.();
      secondaryElevations.dispose?.();
      exteriorLiving.dispose?.();
      interiorHeroes.dispose?.();
      privateInteriors.dispose?.();
      landscapeDetails.dispose?.();
    },
  };
}
