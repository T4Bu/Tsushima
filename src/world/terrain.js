import * as THREE from 'three';

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

function riverSurfaceHeightAt(x) {
  // A gentle west-to-east fall keeps the stream reading as water rather than
  // a chain of disconnected puddles.
  return -1.02 - (x + TERRAIN_HALF) * 0.0041 + 0.1 * Math.sin(x * 0.025);
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

  const riverDistance = distanceToRiver(x, z);
  const riverHalfWidth = 2.65 + 0.55 * (0.5 + 0.5 * Math.sin(x * 0.051));
  const bankBlend = 1 - smoothstep(riverHalfWidth, riverHalfWidth + 6.1, riverDistance);
  const channelCore = 1 - smoothstep(0, riverHalfWidth, riverDistance);
  const riverBed = riverSurfaceHeightAt(x) - 0.28 - 0.27 * channelCore;
  // Pin the channel to a shallow bed even where the macro basin happens to
  // fall lower; otherwise the water would become an accidental deep lake.
  height = lerp(height, riverBed, bankBlend);

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
  const positions = new Float32Array(rows * columns * 3);
  const colors = new Float32Array(rows * columns * 3);
  const uvs = new Float32Array(rows * columns * 2);
  const indices = [];
  const pathColor = paletteColor(palette, 'path', 0x78583a);
  const soilColor = paletteColor(palette, 'soil', 0x443327);
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
  mesh.name = 'Winding dirt path';
  mesh.receiveShadow = true;
  mesh.userData.biomeSurface = 'path';
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
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();

  const stoneCount = 360;
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
  for (let i = 0; i < stoneCount; i += 1) {
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
  stones.instanceMatrix.needsUpdate = true;
  stones.instanceColor.needsUpdate = true;
  group.add(stones);

  const leafCount = 760;
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
  for (let i = 0; i < leafCount; i += 1) {
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
