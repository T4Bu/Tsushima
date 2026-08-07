import * as THREE from 'three';
import './styles.css';
import { createWindAudio } from './world/audio.js';
import { createAtmosphere } from './world/atmosphere.js';
import { createCompoundPlan } from './world/compound.js';
import { createPlayerController } from './world/controller.js';
import { createLandmarks } from './world/landmarks.js';
import { createNaturalTreeLayer } from './world/natural-assets.js';
import { createPostPipeline } from './world/post.js';
import {
  createTerrain,
  distanceToPath,
  distanceToRiver,
  heightAt,
  pathX,
  riverZ,
} from './world/terrain.js';
import { createVegetation } from './world/vegetation.js';
import { COMPOUND_SITE, planToWorld } from './world/site-layout.js';

const query = new URLSearchParams(window.location.search);
const captureShot = query.get('shot');
const quality = query.get('quality') ?? (window.devicePixelRatio > 1.8 ? 'medium' : 'high');
const fixedTime = query.has('time') ? Number(query.get('time')) : null;

const palette = Object.freeze({
  skyTop: 0x343847,
  skyHorizon: 0xb85838,
  sun: 0xffc86f,
  fog: 0x956044,
  shadowTeal: 0x0b1b1d,
  bamboo: 0x12342e,
  grassShadow: 0x3d2d1d,
  grassLit: 0x8d622f,
  grassTip: 0xc8974a,
  crimson: 0xc72329,
  crimsonDark: 0x701218,
  bark: 0x36291f,
  stone: 0x49453e,
  soil: 0x251c16,
  path: 0x55402d,
  water: 0x3b2924,
});

const windUniforms = {
  uTime: { value: 0 },
  uWindStrength: { value: 1 },
  uWindDirection: { value: new THREE.Vector2(-.72, -.69).normalize() },
  uPlayerPos: { value: new THREE.Vector3() },
  uFogColor: { value: new THREE.Color(palette.fog) },
  uFogDensity: { value: quality === 'low' ? .0054 : .0064 },
};

const app = document.querySelector('#app');
const loading = document.querySelector('#loading');
const welcome = document.querySelector('#welcome');
const enterButton = document.querySelector('#enter');
const hud = document.querySelector('#hud');
const reticle = document.querySelector('#reticle');
const hint = document.querySelector('#hint');
const locationKicker = document.querySelector('#location-kicker');
const locationName = document.querySelector('#location-name');
const windArrow = document.querySelector('#wind-arrow');

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: Boolean(captureShot),
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 1.5 : 1.15));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = .9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, .08, 520);
camera.name = 'Wanderer camera';

let elapsed = Number.isFinite(fixedTime) ? fixedTime : 0;
let started = Boolean(captureShot);
let photoMode = Boolean(captureShot);
let lastLocation = '';

const atmosphere = createAtmosphere(scene, { palette, renderer, windUniforms });
const terrain = createTerrain(scene, palette);
const landmarks = createLandmarks(scene, {
  heightAt,
  pathX,
  riverZ,
  palette,
  windUniforms,
});
const compoundPlan = createCompoundPlan(scene, {
  heightAt,
  palette,
  windUniforms,
  quality,
});
const vegetation = createVegetation(scene, {
  heightAt,
  pathX,
  riverZ,
  distanceToPath,
  distanceToRiver,
  palette,
  windUniforms,
  quality,
});

let naturalTrees = { stats: Object.freeze({ naturalTrees: 0, variants: 0, drawCalls: 0 }) };
let assetLoadFinished = false;
let naturalTreeAssetsLoaded = false;

function syncNaturalTreeStats(targetStats) {
  if (!targetStats || !naturalTreeAssetsLoaded) return;
  targetStats.naturalAssets = naturalTrees.stats;
  targetStats.naturalTreeAssetsLoaded = true;
  targetStats.vegetation = {
    ...targetStats.vegetation,
    drawCalls: Math.max(
      0,
      targetStats.vegetation.drawCalls
        - naturalTrees.stats.hiddenProceduralDrawCalls,
    ),
    proceduralTreeDrawCallsHidden: naturalTrees.stats.hiddenProceduralDrawCalls,
  };
}

createNaturalTreeLayer(scene, {
    renderer,
    heightAt,
    distanceToPath,
    distanceToRiver,
    windUniforms,
    quality,
  })
  .then((layer) => {
    naturalTrees = layer;
    naturalTreeAssetsLoaded = true;
    syncNaturalTreeStats(window.__BIOME_STATS__);
  })
  .catch((error) => {
    // The procedural woodland remains visible as a complete offline fallback.
    console.warn('Natural tree layer could not be loaded; using procedural trees.', error);
  })
  .finally(() => {
    assetLoadFinished = true;
  });

const shotPresets = {
  entry: {
    eye: new THREE.Vector3(pathX(92) + 1.5, 0, 92),
    target: new THREE.Vector3(pathX(52), 3.2, 52),
    fov: 56,
  },
  reveal: {
    eye: new THREE.Vector3(pathX(49) + 1.2, 0, 49),
    target: new THREE.Vector3(-24, 5, -31),
    fov: 52,
  },
  transition: {
    // Landscape-to-compound handoff from the gate-access spur: meadow and
    // native shoulders remain foreground context while the open gate is the
    // stable focal point. World-space eye coordinates intentionally match the
    // authored access route rather than the rotated compound plan.
    eye: new THREE.Vector3(8, 0, 44),
    target: (() => {
      const gate = planToWorld(59, 129);
      return new THREE.Vector3(gate.x, heightAt(gate.x, gate.z) + 1.42, gate.z);
    })(),
    fov: 46,
  },
  tree: {
    eye: new THREE.Vector3(4, 0, -10),
    target: new THREE.Vector3(-27, 7, -32),
    fov: 50,
  },
  river: {
    eye: new THREE.Vector3(32, 0, -36),
    target: new THREE.Vector3(11.8, -.7, -22.5),
    fov: 54,
  },
  meadow: {
    eye: new THREE.Vector3(-38, 0, 22),
    target: new THREE.Vector3(-9, 2.6, -29),
    fov: 52,
  },
  compound: {
    // Courtyard hero view: pool and pale terrace lead into the glazed living
    // bar, with the guest wing framing the right side of the composition.
    eye: new THREE.Vector3(
      planToWorld(100, 98).x,
      0,
      planToWorld(100, 98).z,
    ),
    target: new THREE.Vector3(
      planToWorld(62, 35).x,
      heightAt(planToWorld(62, 35).x, planToWorld(62, 35).z) + 1.68,
      planToWorld(62, 35).z,
    ),
    fov: 43,
  },
  courtyard: {
    eye: new THREE.Vector3(
      planToWorld(47, 88).x,
      0,
      planToWorld(47, 88).z,
    ),
    target: new THREE.Vector3(
      planToWorld(80, 35).x,
      heightAt(planToWorld(80, 35).x, planToWorld(80, 35).z) + 1.68,
      planToWorld(80, 35).z,
    ),
    fov: 45,
  },
  pooldetail: {
    // Low southwest pool-corner proof for water depth, coping dampness,
    // basin construction, ladder hardware, and the inhabited deck edge.
    eye: new THREE.Vector3(
      planToWorld(51.5, 81.5).x,
      0,
      planToWorld(51.5, 81.5).z,
    ),
    target: new THREE.Vector3(
      planToWorld(72, 66.5).x,
      heightAt(planToWorld(72, 66.5).x, planToWorld(72, 66.5).z) + 0.55,
      planToWorld(72, 66.5).z,
    ),
    fov: 42,
  },
  outdoorkitchen: {
    // West deck proof for the fitted outdoor kitchen and the small occupation
    // cues around the paired loungers, held clear of the pool collider.
    eye: new THREE.Vector3(
      planToWorld(52, 80.5).x,
      0,
      planToWorld(52, 80.5).z,
    ),
    target: new THREE.Vector3(
      planToWorld(42.6, 70).x,
      heightAt(planToWorld(42.6, 70).x, planToWorld(42.6, 70).z) + 0.85,
      planToWorld(42.6, 70).z,
    ),
    fov: 42,
  },
  arrival: {
    // The off-axis gatehouse frames the approach from the left while the full
    // motor-court throat remains visually and physically open.
    eye: new THREE.Vector3(
      planToWorld(70, 120).x,
      0,
      planToWorld(70, 120).z,
    ),
    target: new THREE.Vector3(
      planToWorld(58, 53).x,
      heightAt(planToWorld(58, 53).x, planToWorld(58, 53).z) + 1.72,
      planToWorld(58, 53).z,
    ),
    fov: 42,
  },
  guesthouse: {
    // Court-side proof of the guest/pool-house elevation. The eye uses the
    // cleared guest walk, keeping the linked entry, feature wall, glazing,
    // roof edge, and planted threshold together without foreground scrub.
    eye: new THREE.Vector3(
      planToWorld(80, 87).x,
      0,
      planToWorld(80, 87).z,
    ),
    target: new THREE.Vector3(
      planToWorld(108.5, 86.5).x,
      heightAt(planToWorld(108.5, 86.5).x, planToWorld(108.5, 86.5).z) + 1.36,
      planToWorld(108.5, 86.5).z,
    ),
    fov: 49,
  },
  guestbed: {
    // Guest-bedroom proof from the clear foot-of-bed zone. Looking straight
    // down the queen's long axis avoids the west-wall door leaf while keeping
    // the headboard, bedside layer, wardrobe edge, and east glazing readable.
    eye: new THREE.Vector3(
      planToWorld(129, 77.8).x,
      0,
      planToWorld(129, 77.8).z,
    ),
    target: new THREE.Vector3(
      planToWorld(129, 85.2).x,
      heightAt(planToWorld(129, 85.2).x, planToWorld(129, 85.2).z) + 0.86,
      planToWorld(129, 85.2).z,
    ),
    fov: 62,
  },
  greatroom: {
    // Interior proof view across the great room toward dining and kitchen.
    eye: new THREE.Vector3(
      planToWorld(82, 38.5).x,
      0,
      planToWorld(82, 38.5).z,
    ),
    target: new THREE.Vector3(
      planToWorld(58, 35.5).x,
      heightAt(planToWorld(58, 35.5).x, planToWorld(58, 35.5).z) + 1.28,
      planToWorld(58, 35.5).z,
    ),
    fov: 47,
  },
  primarysuite: {
    // Diagonal private-suite proof from the clear slider-side corner toward
    // the layered bed wall, bedside storage, wardrobe, and reading zone.
    eye: new THREE.Vector3(
      planToWorld(87.2, 40).x,
      0,
      planToWorld(87.2, 40).z,
    ),
    target: new THREE.Vector3(
      planToWorld(92, 33.8).x,
      heightAt(planToWorld(92, 33.8).x, planToWorld(92, 33.8).z) + 0.94,
      planToWorld(92, 33.8).z,
    ),
    fov: 58,
  },
  primarybath: {
    // Centered doorway proof from the clear suite circulation zone. The view
    // passes between the casing and open leaf to show the toilet, tub, shower,
    // vanity, limestone floor, glazing, and fittings as one room assembly.
    eye: new THREE.Vector3(
      planToWorld(93, 28).x,
      0,
      planToWorld(93, 28).z,
    ),
    target: new THREE.Vector3(
      planToWorld(92.4, 20.5).x,
      heightAt(planToWorld(92.4, 20.5).x, planToWorld(92.4, 20.5).z) + 0.92,
      planToWorld(92.4, 20.5).z,
    ),
    fov: 64,
  },
  bedroom: {
    // Bedroom 2 proof from the clear foot-and-window side of the room. This
    // sightline stays north of the open gallery door and reveals the full bed,
    // bedside layer, egress glazing, and private floor finish without clipping.
    eye: new THREE.Vector3(
      planToWorld(66.2, 19.5).x,
      0,
      planToWorld(66.2, 19.5).z,
    ),
    target: new THREE.Vector3(
      planToWorld(59.6, 19.5).x,
      heightAt(planToWorld(59.6, 19.5).x, planToWorld(59.6, 19.5).z) + 0.86,
      planToWorld(59.6, 19.5).z,
    ),
    fov: 62,
  },
  garage: {
    // A closer court-side proof keeps all three bays in frame while making the
    // upgraded mechanisms, cabinets, and task lighting readable.
    eye: new THREE.Vector3(
      planToWorld(62, 106).x,
      0,
      planToWorld(62, 106).z,
    ),
    target: new THREE.Vector3(
      planToWorld(27.5, 106).x,
      heightAt(planToWorld(27.5, 106).x, planToWorld(27.5, 106).z) + 1.36,
      planToWorld(27.5, 106).z,
    ),
    fov: 50,
  },
  garagebay: {
    // Inside the third bay, looking diagonally across the centre work run.
    // The angle proves cabinetry, shelving, pulls, and overhead mechanisms
    // at human scale while the wider garage preset retains the façade read.
    eye: new THREE.Vector3(
      planToWorld(33.5, 118).x,
      0,
      planToWorld(33.5, 118).z,
    ),
    target: new THREE.Vector3(
      planToWorld(18.5, 106.5).x,
      heightAt(planToWorld(18.5, 106.5).x, planToWorld(18.5, 106.5).z) + 1.35,
      planToWorld(18.5, 106.5).z,
    ),
    fov: 50,
  },
  fab: {
    // Inside the principal fabrication bay, clear of the partition walls.
    eye: new THREE.Vector3(
      planToWorld(125, 34).x,
      0,
      planToWorld(125, 34).z,
    ),
    target: new THREE.Vector3(
      planToWorld(118.5, 24).x,
      heightAt(planToWorld(118.5, 24).x, planToWorld(118.5, 24).z) + 1.24,
      planToWorld(118.5, 24).z,
    ),
    fov: 52,
  },
  fabmachine: {
    // Secondary machine proof from the clear aisle between the island bench
    // and CNC. The wider fab preset retains the tool-board context while this
    // view makes the carriage, spindle, clamps, bed, and controls dominant.
    eye: new THREE.Vector3(
      planToWorld(125.2, 24).x,
      0,
      planToWorld(125.2, 24).z,
    ),
    target: new THREE.Vector3(
      planToWorld(123.1, 19.6).x,
      heightAt(planToWorld(123.1, 19.6).x, planToWorld(123.1, 19.6).z) + 1.08,
      planToWorld(123.1, 19.6).z,
    ),
    fov: 49,
  },
  fabyard: {
    // Service-yard proof across the clear south apron: the personnel and
    // equipment canopies, clerestory, roof drainage, planting seam, and east
    // service return stay legible while the access route remains unobstructed.
    eye: new THREE.Vector3(
      planToWorld(119, 64).x,
      0,
      planToWorld(119, 64).z,
    ),
    target: new THREE.Vector3(
      planToWorld(124, 37.8).x,
      heightAt(planToWorld(124, 37.8).x, planToWorld(124, 37.8).z) + 1.48,
      planToWorld(124, 37.8).z,
    ),
    fov: 54,
  },
  lanai: {
    // Close exterior proof for soffit construction, fixtures, sliders, and
    // the furnished outdoor room without duplicating the wide pool hero.
    eye: new THREE.Vector3(
      planToWorld(98, 58).x,
      0,
      planToWorld(98, 58).z,
    ),
    target: new THREE.Vector3(
      planToWorld(70, 43).x,
      heightAt(planToWorld(70, 43).x, planToWorld(70, 43).z) + 1.42,
      planToWorld(70, 43).z,
    ),
    fov: 46,
  },
  lanaithreshold: {
    // Close façade proof that avoids the east planter foreground and keeps
    // the multi-track sliders, deep jambs, posts, beam, and soffit in view.
    eye: new THREE.Vector3(
      planToWorld(82, 58.5).x,
      0,
      planToWorld(82, 58.5).z,
    ),
    target: new THREE.Vector3(
      planToWorld(72, 43.2).x,
      heightAt(planToWorld(72, 43.2).x, planToWorld(72, 43.2).z) + 1.45,
      planToWorld(72, 43.2).z,
    ),
    fov: 40,
  },
  gate: {
    // Street-side proof of the open sliding gate, parked leaves, privacy
    // wings, and uninterrupted main motor-court opening.
    eye: new THREE.Vector3(
      planToWorld(62, 162).x,
      0,
      planToWorld(62, 162).z,
    ),
    target: new THREE.Vector3(
      planToWorld(59, 116).x,
      heightAt(planToWorld(59, 116).x, planToWorld(59, 116).z) + 1.34,
      planToWorld(59, 116).z,
    ),
    fov: 56,
  },
};

// Ad-hoc capture pose for review sessions: ?shot=pose&pose=eyeX,eyeZ,targetX,
// targetZ[,fov[,targetHeight]] with coordinates in compound plan feet.
const poseParam = query.get('pose');
if (poseParam) {
  const [eyeX, eyeZ, targetX, targetZ, poseFov, targetHeight] = poseParam.split(',').map(Number);
  const eye = planToWorld(eyeX, eyeZ);
  const target = planToWorld(targetX, targetZ);
  shotPresets.pose = {
    eye: new THREE.Vector3(eye.x, 0, eye.z),
    target: new THREE.Vector3(
      target.x,
      heightAt(target.x, target.z) + (Number.isFinite(targetHeight) ? targetHeight : 1.68),
      target.z,
    ),
    fov: Number.isFinite(poseFov) ? poseFov : 50,
  };
}

const startPreset = shotPresets[captureShot] ?? shotPresets.entry;
camera.fov = startPreset.fov ?? 58;
camera.updateProjectionMatrix();
const controller = createPlayerController(camera, renderer.domElement, {
  heightAt,
  colliders: [...landmarks.colliders, ...compoundPlan.colliders],
  start: startPreset.eye,
  lookAt: startPreset.target,
  onLockChange(locked) {
    hint.classList.toggle('is-hidden', locked || !started || photoMode);
    reticle.classList.toggle('is-hidden', !locked || photoMode);
  },
  onPhotoMode(enabled) {
    photoMode = enabled;
    hud.classList.toggle('is-hidden', enabled);
    reticle.classList.toggle('is-hidden', enabled || !controller.locked);
    hint.classList.toggle('is-hidden', enabled || controller.locked);
    document.querySelector('#grain').style.opacity = enabled ? '.035' : '.055';
  },
});
if (captureShot) controller.enabled = false;

const post = createPostPipeline(renderer, scene, camera, { quality });
const windAudio = createWindAudio();
const clock = new THREE.Clock();

function updateLocation(position) {
  let kicker = 'Tsutsu Bamboo Ridge';
  let name = 'Crimson Wind Basin';
  const compoundDx = position.x - COMPOUND_SITE.centerX;
  const compoundDz = position.z - COMPOUND_SITE.centerZ;
  if (compoundDx * compoundDx + compoundDz * compoundDz < 40 * 40) {
    kicker = 'Eastern meadow';
    name = 'Courtyard Compound';
  } else if (position.distanceToSquared(new THREE.Vector3(-27, position.y, -32)) < 28 * 28) {
    kicker = 'Ancient sanctuary';
    name = 'The Wind-Shaped Tree';
  } else if (Math.abs(position.z - riverZ(position.x)) < 10) {
    kicker = 'Copper shallows';
    name = 'River of Reflections';
  } else if (position.z < 57) {
    kicker = 'Crimson floodplain';
    name = position.z < -48 ? 'Amber Woodland' : 'Spider Lily Basin';
  }
  const id = `${kicker}/${name}`;
  if (id !== lastLocation) {
    lastLocation = id;
    locationKicker.textContent = kicker;
    locationName.textContent = name;
  }
}

function setShot(name) {
  const preset = shotPresets[name];
  if (!preset) return;
  camera.fov = preset.fov ?? 58;
  camera.updateProjectionMatrix();
  controller.teleport(preset.eye, preset.target);
}

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyB' && !event.repeat) {
    compoundPlan.setBlueprintVisible?.(!compoundPlan.blueprintVisible);
    return;
  }
  const names = ['entry', 'reveal', 'tree', 'river', 'meadow', 'compound'];
  const index = Number(event.key) - 1;
  if (index >= 0 && index < names.length) setShot(names[index]);
});

function begin() {
  if (!started) {
    started = true;
    welcome.classList.add('is-gone');
    hud.classList.remove('is-hidden');
  }
  windAudio.start();
  controller.lock();
}

enterButton.addEventListener('click', begin);
renderer.domElement.addEventListener('click', () => {
  if (started && !photoMode && !controller.locked) controller.lock();
});

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 1.5 : 1.15));
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  post.resize(width, height);
}
window.addEventListener('resize', resize);

let frameCount = 0;
let experienceReady = false;
function frame() {
  const delta = Math.min(clock.getDelta(), .05);
  if (!Number.isFinite(fixedTime)) elapsed += delta;
  windUniforms.uTime.value = elapsed;
  const broadGust = .82 + .28 * Math.sin(elapsed * .31) + .16 * Math.sin(elapsed * .79 + 1.8);
  windUniforms.uWindStrength.value = Math.max(.45, broadGust);
  windAudio.update(windUniforms.uWindStrength.value, controller.position.z > 58);
  controller.update(delta, elapsed);
  windUniforms.uPlayerPos.value.copy(controller.position);
  terrain.update?.(elapsed, controller.position);
  vegetation.update?.(elapsed, controller.position);
  landmarks.update?.(elapsed, controller.position);
  compoundPlan.update?.(elapsed, controller.position);
  atmosphere.update(elapsed, camera);
  updateLocation(controller.position);

  const windAngle = Math.atan2(windUniforms.uWindDirection.value.x, -windUniforms.uWindDirection.value.y) * 180 / Math.PI;
  windArrow.style.transform = `rotate(${windAngle}deg)`;
  post.render(delta, elapsed, photoMode);

  frameCount++;
  if (!experienceReady && frameCount >= 2 && assetLoadFinished) {
    experienceReady = true;
    loading.classList.add('is-done');
    if (captureShot) {
      welcome.classList.add('is-gone');
      hud.classList.add('is-hidden');
      hint.classList.add('is-hidden');
      reticle.classList.add('is-hidden');
    }
    window.__BIOME_READY__ = true;
  }
}

window.__BIOME_READY__ = false;
window.__BIOME_STATS__ = {
  quality,
  procedural: true,
  hybridAssets: true,
  naturalTreeAssetsLoaded: false,
  worldSizeMeters: 250,
  vegetation: vegetation.stats ?? {},
  naturalAssets: naturalTrees.stats ?? {},
  compoundPlan: compoundPlan.stats ?? {},
  controls: ['WASD', 'mouse', 'Shift', 'P', 'B', 'R', '1-6'],
};
// Cached assets can finish before the public diagnostics object is assigned.
// Sync once here as well as in the promise callback so capture metadata never
// reports the procedural fallback while the natural layer is actually visible.
syncNaturalTreeStats(window.__BIOME_STATS__);
window.__BIOME_SET_SHOT__ = setShot;

renderer.setAnimationLoop(frame);
