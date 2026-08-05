import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const TREE_URLS = [
  '/assets/trees/tree_0.glb',
  '/assets/trees/tree_3.glb',
];

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
  const placements = makePlacements({ count, heightAt, distanceToPath, distanceToRiver });
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
      variants: variants.length,
      drawCalls: resources.length,
      hiddenProceduralDrawCalls,
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