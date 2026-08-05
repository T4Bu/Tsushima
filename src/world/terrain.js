import * as THREE from 'three';

const TERRAIN_SIZE = 250;
const TERRAIN_HALF = TERRAIN_SIZE * 0.5;
const TERRAIN_SEGMENTS = 176;
const PATH_START_Z = TERRAIN_HALF - 1;
const PATH_END_Z = -TERRAIN_HALF + 1;

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

function createNoiseTexture(seed, { size = 128, contrast = 54, base = 205 } = {}) {
  const data = new Uint8Array(size * size * 4);
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      const broad = hash2(Math.floor(x / 5) + seed, Math.floor(z / 5) - seed);
      const fine = hash2(x + seed * 17, z - seed * 29);
      const fleck = fine > .965 ? -.36 : fine < .025 ? .18 : 0;
      const value = Math.round(Math.min(255, Math.max(72, base + (broad - .5) * contrast + fleck * 255)));
      const index = (z * size + x) * 4;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(46, 46);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
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
  target.lerp(bamboo, entry * (0.2 + block * 0.16));

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

function createTerrainMesh(palette) {
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

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setY(i, heightAt(x, z));
    groundColorAt(x, z, palette, color);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const detailTexture = createNoiseTexture(19, { contrast: 58, base: 218 });
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    map: detailTexture,
    bumpMap: detailTexture,
    bumpScale: .055,
    roughness: 0.96,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Sunset basin ground';
  mesh.receiveShadow = true;
  mesh.userData.biomeSurface = 'ground';
  return mesh;
}

function createPathMesh(palette) {
  const rows = 260;
  const columns = 5;
  const positions = new Float32Array(rows * columns * 3);
  const colors = new Float32Array(rows * columns * 3);
  const uvs = new Float32Array(rows * columns * 2);
  const indices = [];
  const pathColor = paletteColor(palette, 'path', 0x78583a);
  const soilColor = paletteColor(palette, 'soil', 0x443327);
  const color = new THREE.Color();

  for (let row = 0; row < rows; row += 1) {
    const along = row / (rows - 1);
    const z = lerp(PATH_START_Z, PATH_END_Z, along);
    const centerX = pathX(z);
    const derivative = pathDerivative(z);
    const normalLength = Math.sqrt(1 + derivative * derivative);
    const normalX = 1 / normalLength;
    const normalZ = -derivative / normalLength;
    const halfWidth = 2.15 + 0.28 * Math.sin(z * 0.067 + 0.8);

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

  const pathTexture = createNoiseTexture(53, { contrast: 72, base: 218 });
  pathTexture.repeat.set(8, 70);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    map: pathTexture,
    bumpMap: pathTexture,
    bumpScale: .085,
    roughness: 1,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
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

  const stoneCount = 520;
  const stoneGeometry = new THREE.IcosahedronGeometry(.085, 0);
  const stoneMaterial = new THREE.MeshStandardMaterial({
    color: paletteColor(palette, 'stone', 0x49453e),
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
    const size = .42 + random() * 1.55;
    scale.set(size * (1 + random()), size * (.35 + random() * .3), size * (.7 + random() * .8));
    matrix.compose(position, quaternion, scale);
    stones.setMatrixAt(i, matrix);
    color.copy(paletteColor(palette, 'stone', 0x49453e)).offsetHSL(0, -.08, (random() - .5) * .13);
    stones.setColorAt(i, color);
  }
  stones.instanceMatrix.needsUpdate = true;
  stones.instanceColor.needsUpdate = true;
  group.add(stones);

  const leafCount = 920;
  const leafGeometry = new THREE.CircleGeometry(.105, 4);
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
    const size = .48 + random() * .95;
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

function createWaterMesh(palette) {
  const rows = 241;
  const columns = 5;
  const positions = new Float32Array(rows * columns * 3);
  const colors = new Float32Array(rows * columns * 3);
  const baseHeights = new Float32Array(rows * columns);
  const waveWeights = new Float32Array(rows * columns);
  const indices = [];
  const sunColor = paletteColor(palette, 'sun', 0xffc86f);
  const copper = paletteColor(palette, 'water', 0xa95c39)
    .lerp(sunColor, .17);
  const shadow = paletteColor(palette, 'shadowTeal', 0x173b3a).lerp(copper, .34);
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
      color.copy(shadow).lerp(copper, 0.43 + waveWeights[vertex] * .27 + ripple * .18);
      if (ripple > .86) color.lerp(sunColor, (ripple - .86) * .48);
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

  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.38,
    metalness: 0.04,
    clearcoat: .28,
    clearcoatRoughness: .34,
    specularIntensity: .32,
    specularColor: new THREE.Color(0x8f6349),
    transparent: false,
    opacity: 1,
    depthWrite: true,
    side: THREE.DoubleSide,
    emissive: copper.clone().multiplyScalar(.3),
    emissiveIntensity: .62,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Animated copper stream';
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

  const terrain = createTerrainMesh(palette);
  const path = createPathMesh(palette);
  const water = createWaterMesh(palette);
  const pathLitter = createPathLitter(palette);
  group.add(terrain, path, water, pathLitter);
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
  }

  function dispose() {
    group.removeFromParent();
    terrain.geometry.dispose();
    terrain.material.map?.dispose();
    terrain.material.dispose();
    path.geometry.dispose();
    path.material.map?.dispose();
    path.material.dispose();
    water.geometry.dispose();
    water.material.dispose();
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
