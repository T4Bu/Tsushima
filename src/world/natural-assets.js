import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  COMPOUND_PLAN,
  FEET_TO_METERS,
  isInsideCompoundHardscape,
  isInsideCompoundTreeClearance,
  planToWorld,
} from './site-layout.js';
import { gateAccessRouteClearance } from './terrain.js';

const TREE_URLS = [
  '/assets/trees/tree_0.glb',
  '/assets/trees/tree_2.glb',
];

const COMPOUND_PLANTING_QUALITY = Object.freeze({ low: 0, medium: 1, high: 2 });

const clamp01 = (value) => Math.min(1, Math.max(0, value));

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function tintTexture(texture, anisotropy) {
  if (!texture) return;
  texture.anisotropy = Math.min(anisotropy, 8);
  texture.needsUpdate = true;
}

function patchTreeMaterial(source, kind, windUniforms, assetHeight, anisotropy) {
  const material = source.clone();
  material.name = `Natural ${kind} material`;
  material.metalness = 0;
  material.roughness = kind === 'leaves' ? 0.84 : 0.92;
  material.envMapIntensity = 0.34;
  material.shadowSide = kind === 'leaves' ? THREE.DoubleSide : THREE.FrontSide;
  tintTexture(material.map, anisotropy);
  tintTexture(material.normalMap, anisotropy);
  tintTexture(material.roughnessMap, anisotropy);
  tintTexture(material.aoMap, anisotropy);

  if (kind === 'leaves') {
    material.alphaTest = Math.max(material.alphaTest || 0, 0.35);
    material.transparent = false;
    material.depthWrite = true;
    material.side = THREE.DoubleSide;
    material.color.multiply(new THREE.Color(0x95966d));
    material.emissive = new THREE.Color(0x321508);
    material.emissiveIntensity = 0.11;
  } else {
    material.color.multiply(new THREE.Color(0x8c7560));
  }

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTreeTime = windUniforms.uTime;
    shader.uniforms.uTreeWind = windUniforms.uWindStrength;
    shader.uniforms.uTreeDirection = windUniforms.uWindDirection;
    shader.uniforms.uTreeHeight = { value: Math.max(assetHeight, 1) };
    shader.uniforms.uTreeWarmScatter = {
      value: new THREE.Color(kind === 'leaves' ? 0xd8732f : 0x2e160d),
    };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTreeTime;
uniform float uTreeWind;
uniform float uTreeHeight;
uniform vec2 uTreeDirection;
varying float vTreeTip;
varying float vTreeGust;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
float treeTip = smoothstep(0.08, 0.94, position.y / uTreeHeight);
vec2 treeOrigin = vec2(modelMatrix[3].x, modelMatrix[3].z);
#ifdef USE_INSTANCING
treeOrigin += vec2(instanceMatrix[3].x, instanceMatrix[3].z);
#endif
float gustFront = sin(dot(treeOrigin, normalize(uTreeDirection)) * 0.052 - uTreeTime * 1.42);
float gustBody = 0.54 + 0.46 * sin(uTreeTime * 0.61 + dot(treeOrigin, vec2(0.017, -0.023)));
float treeGust = smoothstep(-0.48, 0.78, gustFront) * gustBody;
float sway = (0.20 + treeGust * 0.72) * treeTip * treeTip * uTreeWind;
transformed.x += uTreeDirection.x * sway + sin(uTreeTime * 0.93 + treeOrigin.x * 0.07) * treeTip * 0.06;
transformed.z += uTreeDirection.y * sway + cos(uTreeTime * 0.79 + treeOrigin.y * 0.06) * treeTip * 0.045;
vTreeTip = treeTip;
vTreeGust = treeGust;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uTreeWarmScatter;
varying float vTreeTip;
varying float vTreeGust;`,
      )
      .replace(
        '#include <dithering_fragment>',
        `float leafEdgeLight = vTreeTip * (0.022 + vTreeGust * 0.032);
gl_FragColor.rgb += uTreeWarmScatter * leafEdgeLight;
#include <dithering_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `natural-tree-${kind}-wind-v3`;
  material.needsUpdate = true;
  return material;
}

async function loadTreeVariant(loader, url, windUniforms, anisotropy) {
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const parts = [];
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    const geometry = object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const kind = /leave/i.test(object.material?.name || '') ? 'leaves' : 'branches';
    const assetHeight = geometry.boundingBox.max.y - geometry.boundingBox.min.y;
    const material = patchTreeMaterial(
      object.material,
      kind,
      windUniforms,
      assetHeight,
      anisotropy,
    );
    parts.push({ geometry, material, kind });
  });
  return parts;
}

function makePlacements({
  count,
  heightAt,
  distanceToPath,
  distanceToRiver,
}) {
  const random = mulberry32(0x5a17c9e3);
  const placements = [[], []];
  const heroMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(-27, heightAt(-27, -32) - 0.08, -32),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.015, 0.64, 0.018)),
    new THREE.Vector3(0.43, 0.335, 0.39),
  );
  placements[0].push({
    matrix: heroMatrix,
    x: -27,
    z: -32,
    scale: 0.43,
    hero: true,
  });
  let accepted = 0;
  for (let attempt = 0; attempt < 2800 && accepted < count; attempt += 1) {
    const x = (random() * 2 - 1) * 116;
    const z = (random() * 2 - 1) * 116;
    const radial = Math.hypot(x * 0.87, z + 3);
    const rim = smoothstep(38, 94, radial);
    const southWood = smoothstep(26, 83, -z);
    const northFrame = smoothstep(49, 106, z) * 0.28;
    const woodlandChance = clamp01(rim * 0.76 + southWood * 0.31 + northFrame);
    if (random() > woodlandChance) continue;
    if (distanceToPath(x, z) < 9.5 + random() * 3.5) continue;
    if (distanceToRiver(x, z) < 7.5 + random() * 4) continue;
    if (Math.hypot(x + 27, z + 32) < 22) continue;
    if (Math.hypot(x - 4, z - 53) < 13) continue;

    const variant = accepted % 2;
    const baseScale = 0.215 + random() * 0.115;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      (random() - 0.5) * 0.035,
      random() * Math.PI * 2,
      (random() - 0.5) * 0.028,
    ));
    matrix.compose(
      new THREE.Vector3(x, heightAt(x, z) - 0.06, z),
      quaternion,
      new THREE.Vector3(
        baseScale * (0.88 + random() * 0.18),
        baseScale * (0.92 + random() * 0.18),
        baseScale * (0.88 + random() * 0.18),
      ),
    );
    placements[variant].push({ matrix, x, z, scale: baseScale });
    accepted += 1;
  }
  return placements;
}

function isInsideOpenArrivalThreshold(planX, planZ, paddingMeters = 1.25) {
  const drive = COMPOUND_PLAN.driveway;
  const paddingFeet = paddingMeters / FEET_TO_METERS;
  return planX >= drive.x - paddingFeet
    && planX <= drive.x + drive.width + paddingFeet
    && planZ >= drive.z - paddingFeet
    && planZ <= drive.z + drive.depth + paddingFeet;
}

/**
 * Adds a restrained set of designed trees and tree-asset understory without
 * creating another material or mesh. The arrival-side cluster stays east of
 * the motor court, balancing the garage mass while leaving its full paved
 * throat open. Every active candidate is checked against the shared hardscape
 * contract as a final guard against future plan changes.
 */
function makeDesignedCompoundTreePlacements(heightAt, quality) {
  const authoredRoles = [
    'arrival-axis',
    'court-edge',
    'west-garden-edge',
    'arrival-canopy',
    'fab-buffer',
  ];
  const authoredCandidates = COMPOUND_PLAN.authoredTrees.map((tree, index) => ({
    id: `authored-compound-tree-${index + 1}`,
    planX: tree.x,
    planZ: tree.z,
    scale: 0.06 + tree.radius * 0.006,
    variant: index % 2,
    yaw: 0.55 + index * 2.39996,
    seed: index + 1,
    clearance: 0.65,
    minQuality: 0,
    role: authoredRoles[index] ?? 'authored-tree',
    authored: true,
  }));
  const designedCandidates = [
    // Three larger perimeter canopies soften the graded lot without forming a
    // regular suburban row or closing the long landscape views.
    { id: 'compound-perimeter-northwest', planX: 7, planZ: 8, scale: 0.17, variant: 1, yaw: 4.82, seed: 11, clearance: 1.0, minQuality: 1, role: 'perimeter-canopy' },
    { id: 'compound-perimeter-northeast', planX: 120, planZ: 5, scale: 0.16, variant: 0, yaw: 2.08, seed: 12, clearance: 1.0, minQuality: 1, role: 'perimeter-canopy' },
    { id: 'compound-perimeter-southeast', planX: 122, planZ: 119, scale: 0.18, variant: 1, yaw: 5.54, seed: 13, clearance: 1.0, minQuality: 1, role: 'perimeter-canopy' },

    // Small tree instances read as loose shrub/sapling masses beside the east
    // edge of the drive. Their irregular spacing preserves the open arrival
    // axis and avoids the clipped-box silhouette of a continuous hedge mesh.
    { id: 'arrival-understory-south', planX: 84.5, planZ: 123, scale: 0.062, variant: 0, yaw: 0.94, seed: 21, clearance: 0.5, minQuality: 2, role: 'arrival-understory' },
    { id: 'arrival-understory-mid', planX: 87, planZ: 106, scale: 0.078, variant: 1, yaw: 3.72, seed: 22, clearance: 0.55, minQuality: 2, role: 'arrival-understory' },
    { id: 'arrival-understory-north', planX: 84.8, planZ: 96, scale: 0.058, variant: 0, yaw: 5.18, seed: 23, clearance: 0.5, minQuality: 2, role: 'arrival-understory' },
    { id: 'arrival-understory-outer', planX: 91.5, planZ: 115.5, scale: 0.07, variant: 1, yaw: 1.86, seed: 24, clearance: 0.55, minQuality: 2, role: 'arrival-understory' },
  ];
  const candidates = [...authoredCandidates, ...designedCandidates];
  const qualityRank = COMPOUND_PLANTING_QUALITY[quality]
    ?? COMPOUND_PLANTING_QUALITY.high;
  const activeCandidates = candidates.filter((candidate) => (
    candidate.minQuality <= qualityRank
  ));
  const placements = [];
  const rejected = [];

  for (const candidate of activeCandidates) {
    const world = planToWorld(candidate.planX, candidate.planZ);
    const blocksHardscape = isInsideCompoundHardscape(
      world.x,
      world.z,
      candidate.clearance,
    );
    const blocksArrival = isInsideOpenArrivalThreshold(
      candidate.planX,
      candidate.planZ,
    );
    if (blocksHardscape || blocksArrival) {
      rejected.push({
        id: candidate.id,
        reason: blocksArrival ? 'arrival-threshold' : 'hardscape-clearance',
      });
      continue;
    }

    const leanX = (candidate.seed % 2 ? -1 : 1) * 0.012;
    const leanZ = ((candidate.seed + 1) % 3 - 1) * 0.014;
    const widthVariation = 0.94 + (candidate.seed % 3) * 0.035;
    const heightVariation = 1.02 + (candidate.seed % 2) * 0.045;
    const depthVariation = 0.96 + ((candidate.seed + 1) % 3) * 0.025;
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(world.x, heightAt(world.x, world.z) - 0.06, world.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(
        leanX,
        candidate.yaw,
        leanZ,
      )),
      new THREE.Vector3(
        candidate.scale * widthVariation,
        candidate.scale * heightVariation,
        candidate.scale * depthVariation,
      ),
    );
    placements.push({
      matrix,
      x: world.x,
      z: world.z,
      scale: candidate.scale,
      authored: candidate.authored ?? false,
      designed: true,
      id: candidate.id,
      role: candidate.role,
      variant: candidate.variant,
    });
  }

  return {
    placements,
    rejected,
    qualityOmitted: candidates.length - activeCandidates.length,
    arrivalThresholdOpen: !placements.some((placement) => {
      const candidate = activeCandidates.find((entry) => entry.id === placement.id);
      return candidate && isInsideOpenArrivalThreshold(candidate.planX, candidate.planZ);
    }),
  };
}

/**
 * A few deliberately low broadleaf clusters articulate alternating shoulders
 * of the access spur. They use the licensed tree assets at understory scale,
 * so no new material or draw call is introduced. The signed route contract is
 * the final guard: candidates must remain close enough to read as a shoulder
 * grouping while leaving a generous clear strip beyond the rendered lane.
 */
function makeGateApproachEdgePlacements(heightAt, quality) {
  const candidates = [
    { id: 'gate-route-edge-1', x: 0.0, z: 43.6, scale: 0.050, variant: 0, yaw: 0.72, seed: 31, minQuality: 0 },
    { id: 'gate-route-edge-2', x: 12.5, z: 45.3, scale: 0.057, variant: 1, yaw: 3.34, seed: 32, minQuality: 1 },
    { id: 'gate-route-edge-3', x: 21.0, z: 38.3, scale: 0.046, variant: 0, yaw: 5.08, seed: 33, minQuality: 0 },
    { id: 'gate-route-edge-4', x: 31.0, z: 43.5, scale: 0.061, variant: 1, yaw: 1.92, seed: 34, minQuality: 2 },
    { id: 'gate-route-edge-5', x: 37.5, z: 34.8, scale: 0.052, variant: 0, yaw: 4.26, seed: 35, minQuality: 1 },
  ];
  const qualityRank = COMPOUND_PLANTING_QUALITY[quality]
    ?? COMPOUND_PLANTING_QUALITY.high;
  const activeCandidates = candidates.filter((candidate) => (
    candidate.minQuality <= qualityRank
  ));
  const placements = [];
  const rejected = [];

  for (const candidate of activeCandidates) {
    const edgeDistance = gateAccessRouteClearance(candidate.x, candidate.z);
    // 1.25 m protects mirrors/branches; 2.75 m keeps the groups visually tied
    // to the shoulder instead of becoming unrelated meadow trees.
    if (edgeDistance < 1.25 || edgeDistance > 2.75) {
      rejected.push({ id: candidate.id, edgeDistance });
      continue;
    }
    const leanX = (candidate.seed % 2 ? -1 : 1) * 0.014;
    const leanZ = ((candidate.seed + 1) % 3 - 1) * 0.012;
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(
        candidate.x,
        heightAt(candidate.x, candidate.z) - 0.055,
        candidate.z,
      ),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(
        leanX,
        candidate.yaw,
        leanZ,
      )),
      new THREE.Vector3(
        candidate.scale * (0.95 + (candidate.seed % 3) * 0.025),
        candidate.scale * (1.00 + (candidate.seed % 2) * 0.06),
        candidate.scale * (0.96 + ((candidate.seed + 1) % 3) * 0.02),
      ),
    );
    placements.push({
      matrix,
      x: candidate.x,
      z: candidate.z,
      scale: candidate.scale,
      designed: true,
      id: candidate.id,
      role: 'gate-route-edge',
      variant: candidate.variant,
    });
  }

  return {
    placements,
    rejected,
    qualityOmitted: candidates.length - activeCandidates.length,
  };
}

function hideProceduralTrees(scene) {
  let hiddenDrawCalls = 0;
  scene.traverse((object) => {
    if (/Secondary tree (trunks|crowns)/i.test(object.name) && object.visible) {
      object.visible = false;
      hiddenDrawCalls += 1;
    }
    if (object.name === 'Wind-swept broadleaf trunk') object.visible = false;
    if (object.name === 'Wind-swept broadleaf crown') object.visible = false;
  });
  return hiddenDrawCalls;
}

/**
 * Adds two instanced, texture-authored broadleaf tree variants around the basin.
 * Asset loading is awaited by main.js so captures and the loading veil cannot
 * race partially populated scenery.
 */
export async function createNaturalTreeLayer(scene, {
  renderer,
  heightAt,
  distanceToPath,
  distanceToRiver,
  windUniforms,
  quality = 'high',
}) {
  const count = quality === 'low' ? 22 : quality === 'medium' ? 32 : 42;
  const generatedPlacements = makePlacements({
    count,
    heightAt,
    distanceToPath,
    distanceToRiver,
  });
  // Post-filter completed seeded arrays so clearing the complete compound lot
  // and access route cannot shift or reroll any placement elsewhere in the
  // biome. Route clearance includes a crown-safe setback beyond the lane.
  let siteClearedTrees = 0;
  let gateRouteClearedTrees = 0;
  const placements = generatedPlacements.map((variant) => variant.filter((placement) => {
    if (placement.hero) return true;
    if (isInsideCompoundTreeClearance(placement.x, placement.z)) {
      siteClearedTrees += 1;
      return false;
    }
    if (gateAccessRouteClearance(placement.x, placement.z, 3.4) <= 0) {
      gateRouteClearedTrees += 1;
      return false;
    }
    return true;
  }));
  const compoundPlantings = makeDesignedCompoundTreePlacements(heightAt, quality);
  compoundPlantings.placements.forEach((placement) => {
    placements[placement.variant].push(placement);
  });
  const gateApproachPlantings = makeGateApproachEdgePlacements(heightAt, quality);
  gateApproachPlantings.placements.forEach((placement) => {
    placements[placement.variant].push(placement);
  });
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  const loader = new GLTFLoader();
  const variants = await Promise.all(
    TREE_URLS.map((url) => loadTreeVariant(loader, url, windUniforms, anisotropy)),
  );

  const root = new THREE.Group();
  root.name = 'Natural licensed tree layer';
  const resources = [];
  for (let variant = 0; variant < variants.length; variant += 1) {
    for (const part of variants[variant]) {
      const mesh = new THREE.InstancedMesh(
        part.geometry,
        part.material,
        placements[variant].length,
      );
      mesh.name = `Natural tree ${variant + 1} ${part.kind}`;
      placements[variant].forEach((placement, index) => {
        mesh.setMatrixAt(index, placement.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      root.add(mesh);
      resources.push(mesh);
    }
  }

  const allPlacements = placements.flat();
  const contactGeometry = new THREE.CircleGeometry(1, 20);
  contactGeometry.rotateX(-Math.PI * 0.5);
  const contactMaterial = new THREE.MeshBasicMaterial({
    color: 0x071111,
    transparent: true,
    opacity: 0.31,
    depthWrite: false,
    blending: THREE.MultiplyBlending,
    fog: true,
  });
  const contacts = new THREE.InstancedMesh(contactGeometry, contactMaterial, allPlacements.length);
  contacts.name = 'Natural tree contact shadows';
  const contactQuaternion = new THREE.Quaternion();
  allPlacements.forEach((placement, index) => {
    const radius = 5.2 * placement.scale;
    contacts.setMatrixAt(index, new THREE.Matrix4().compose(
      new THREE.Vector3(placement.x, heightAt(placement.x, placement.z) + 0.035, placement.z),
      contactQuaternion,
      new THREE.Vector3(radius * 1.2, 1, radius),
    ));
  });
  contacts.instanceMatrix.needsUpdate = true;
  contacts.renderOrder = 1;
  root.add(contacts);
  resources.push(contacts);

  scene.add(root);
  const hiddenProceduralDrawCalls = hideProceduralTrees(scene);

  return {
    root,
    stats: Object.freeze({
      naturalTrees: allPlacements.length,
      designedCompoundPlantings: compoundPlantings.placements.length,
      authoredCompoundTrees: compoundPlantings.placements.filter((placement) => (
        placement.authored
      )).length,
      compoundPerimeterCanopies: compoundPlantings.placements.filter((placement) => (
        placement.role === 'perimeter-canopy'
      )).length,
      compoundArrivalPlantings: compoundPlantings.placements.filter((placement) => (
        placement.role.startsWith('arrival-')
      )).length,
      rejectedCompoundPlantings: compoundPlantings.rejected.length,
      compoundPlantingsOmittedForQuality: compoundPlantings.qualityOmitted,
      compoundArrivalThresholdOpen: compoundPlantings.arrivalThresholdOpen,
      gateApproachEdgePlantings: gateApproachPlantings.placements.length,
      rejectedGateApproachPlantings: gateApproachPlantings.rejected.length,
      gateApproachPlantingsOmittedForQuality: gateApproachPlantings.qualityOmitted,
      variants: variants.length,
      drawCalls: resources.length,
      hiddenProceduralDrawCalls,
      siteClearedTrees,
      gateRouteClearedTrees,
    }),
    dispose() {
      for (const mesh of resources) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      scene.remove(root);
    },
  };
}
