import * as THREE from 'three';
import './styles.css';
import { createWindAudio } from './world/audio.js';
import { createAtmosphere } from './world/atmosphere.js';
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
    if (window.__BIOME_STATS__) {
      window.__BIOME_STATS__.naturalAssets = layer.stats;
      window.__BIOME_STATS__.naturalTreeAssetsLoaded = true;
      window.__BIOME_STATS__.vegetation = {
        ...window.__BIOME_STATS__.vegetation,
        drawCalls: Math.max(
          0,
          window.__BIOME_STATS__.vegetation.drawCalls
            - layer.stats.hiddenProceduralDrawCalls,
        ),
        proceduralTreeDrawCallsHidden: layer.stats.hiddenProceduralDrawCalls,
      };
    }
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
};

const startPreset = shotPresets[captureShot] ?? shotPresets.entry;
camera.fov = startPreset.fov ?? 58;
camera.updateProjectionMatrix();
const controller = createPlayerController(camera, renderer.domElement, {
  heightAt,
  colliders: landmarks.colliders,
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
  if (position.distanceToSquared(new THREE.Vector3(-27, position.y, -32)) < 28 * 28) {
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
  const names = ['entry', 'reveal', 'tree', 'river', 'meadow'];
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
  controls: ['WASD', 'mouse', 'Shift', 'P', 'R', '1-5'],
};
window.__BIOME_SET_SHOT__ = setShot;

renderer.setAnimationLoop(frame);
