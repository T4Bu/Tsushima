import * as THREE from 'three';

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const IDENTITY_QUATERNION = new THREE.Quaternion();

function terrainHeight(heightAt, x, z) {
  const height = typeof heightAt === 'function' ? heightAt(x, z) : 0;
  return Number.isFinite(height) ? height : 0;
}

function pathCenter(pathX, z) {
  const x = typeof pathX === 'function' ? pathX(z) : 0;
  return Number.isFinite(x) ? x : 0;
}

function paletteColor(palette, key, fallback) {
  return new THREE.Color(palette?.[key] ?? fallback);
}

function pathYaw(pathX, z) {
  const x0 = pathCenter(pathX, z - 1.5);
  const x1 = pathCenter(pathX, z + 1.5);
  return Math.atan2(x1 - x0, 3);
}

function resolveRiverCrossing(riverZ, pathX) {
  if (Number.isFinite(riverZ)) return riverZ;
  if (typeof riverZ !== 'function') return -25;

  let closestZ = -25;
  let closestDistance = Infinity;
  for (let z = -56; z <= 8; z += .5) {
    const candidate = riverZ(pathCenter(pathX, z));
    if (!Number.isFinite(candidate)) continue;
    const distance = Math.abs(candidate - z);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestZ = z;
    }
  }
  return closestZ;
}

function makeBranchGeometry(branches, radialSegments = 7) {
  const positions = [];
  const normals = [];
  const indices = [];

  for (const branch of branches) {
    if (branch.length < 2) continue;
    const ringStart = positions.length / 3;
    const firstTangent = branch[1].point.clone().sub(branch[0].point).normalize();
    const reference = Math.abs(firstTangent.y) > .82
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < branch.length; i++) {
      const previous = branch[Math.max(0, i - 1)].point;
      const next = branch[Math.min(branch.length - 1, i + 1)].point;
      const tangent = next.clone().sub(previous).normalize();
      const side = new THREE.Vector3().crossVectors(tangent, reference);
      if (side.lengthSq() < .0001) side.crossVectors(tangent, new THREE.Vector3(0, 0, 1));
      side.normalize();
      const ringUp = new THREE.Vector3().crossVectors(side, tangent).normalize();

      for (let j = 0; j < radialSegments; j++) {
        const angle = (j / radialSegments) * Math.PI * 2;
        const radial = side.clone().multiplyScalar(Math.cos(angle))
          .addScaledVector(ringUp, Math.sin(angle));
        const point = branch[i].point.clone().addScaledVector(radial, branch[i].radius);
        positions.push(point.x, point.y, point.z);
        normals.push(radial.x, radial.y, radial.z);
      }
    }

    for (let i = 0; i < branch.length - 1; i++) {
      const a = ringStart + i * radialSegments;
      const b = a + radialSegments;
      for (let j = 0; j < radialSegments; j++) {
        const nextJ = (j + 1) % radialSegments;
        indices.push(a + j, b + j, b + nextJ);
        indices.push(a + j, b + nextJ, a + nextJ);
      }
    }

    const startCenter = positions.length / 3;
    const start = branch[0].point;
    positions.push(start.x, start.y, start.z);
    normals.push(-firstTangent.x, -firstTangent.y, -firstTangent.z);
    for (let j = 0; j < radialSegments; j++) {
      indices.push(startCenter, ringStart + (j + 1) % radialSegments, ringStart + j);
    }

    const endCenter = positions.length / 3;
    const end = branch[branch.length - 1].point;
    const endTangent = end.clone().sub(branch[branch.length - 2].point).normalize();
    positions.push(end.x, end.y, end.z);
    normals.push(endTangent.x, endTangent.y, endTangent.z);
    const endRing = ringStart + (branch.length - 1) * radialSegments;
    for (let j = 0; j < radialSegments; j++) {
      indices.push(endCenter, endRing + j, endRing + (j + 1) % radialSegments);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function branch(points) {
  return points.map(([x, y, z, radius]) => ({
    point: new THREE.Vector3(x, y, z),
    radius,
  }));
}

function makeClothGeometry(width, height, seed, baseColor) {
  const columns = 7;
  const rows = 11;
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];

  for (let row = 0; row <= rows; row++) {
    const v = row / rows;
    for (let column = 0; column <= columns; column++) {
      const u = column / columns;
      const hemTaper = 1 - v * .045;
      let x = u * width * hemTaper;
      let y = -v * height;
      if (column === columns) x += Math.sin((row + seed) * 2.37) * .065;
      if (row === rows) y += Math.sin((column + seed) * 3.11) * .11 - u * .08;
      positions.push(x, y, 0);
      normals.push(0, 0, 1);

      const weather = .68 + .23 * (Math.sin(column * 9.7 + row * 4.1 + seed) * .5 + .5);
      const vertexColor = baseColor.clone().multiplyScalar(weather);
      colors.push(vertexColor.r, vertexColor.g, vertexColor.b);
    }
  }

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column;
      const b = a + columns + 1;
      indices.push(a, a + 1, b + 1, a, b + 1, b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return {
    geometry,
    basePositions: Float32Array.from(positions),
    width,
    height,
    seed,
  };
}

function updateCloth(cloth, time, windStrength) {
  const attribute = cloth.geometry.attributes.position;
  const output = attribute.array;
  const input = cloth.basePositions;

  for (let i = 0; i < input.length; i += 3) {
    const baseX = input[i];
    const baseY = input[i + 1];
    const along = THREE.MathUtils.clamp(baseX / cloth.width, 0, 1);
    const down = THREE.MathUtils.clamp(-baseY / cloth.height, 0, 1);
    const anchored = along * along * (3 - 2 * along);
    const broadWave = Math.sin(time * 2.05 + cloth.seed + baseX * 1.65 - down * .7);
    const fineWave = Math.sin(time * 5.1 + cloth.seed * 1.9 + baseX * 4.4 + down * 2.2);
    const snap = Math.sin(time * .73 + cloth.seed * 4.7) * .5 + .5;

    output[i] = baseX - anchored * Math.abs(broadWave) * .045 * windStrength;
    output[i + 1] = baseY + anchored * fineWave * .035 * windStrength;
    output[i + 2] = anchored * (broadWave * .22 + fineWave * (.035 + snap * .045))
      * (.55 + windStrength * .6);
  }
  attribute.needsUpdate = true;
}

function makeCurvedBeamGeometry(length, height, depth, segments = 10) {
  const positions = [];
  const indices = [];
  const half = length * .5;

  for (let i = 0; i <= segments; i++) {
    const x = -half + (i / segments) * length;
    const edge = Math.abs(x / half);
    const rise = .18 * Math.pow(edge, 3.2);
    positions.push(
      x, rise - height * .5, -depth * .5,
      x, rise + height * .5, -depth * .5,
      x, rise - height * .5, depth * .5,
      x, rise + height * .5, depth * .5,
    );
  }

  for (let i = 0; i < segments; i++) {
    const a = i * 4;
    const b = a + 4;
    indices.push(
      a, b, b + 1, a, b + 1, a + 1,
      a + 2, a + 3, b + 3, a + 2, b + 3, b + 2,
      a + 1, b + 1, b + 3, a + 1, b + 3, a + 3,
      a, a + 2, b + 2, a, b + 2, b,
    );
  }
  indices.push(0, 1, 3, 0, 3, 2);
  const end = segments * 4;
  indices.push(end, end + 2, end + 3, end, end + 3, end + 1);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function matrixAt(position, scale, rotationY = 0, rotationZ = 0) {
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, rotationZ));
  return new THREE.Matrix4().compose(position, quaternion, scale);
}

function rotatedOffset(x, z, yaw) {
  return new THREE.Vector3(
    x * Math.cos(yaw) + z * Math.sin(yaw),
    0,
    -x * Math.sin(yaw) + z * Math.cos(yaw),
  );
}

function focusPoint(name, x, y, z, radius) {
  return { name, position: new THREE.Vector3(x, y, z), radius };
}

function collider(kind, x, y, z, radius, height) {
  const center = new THREE.Vector3(x, y, z);
  return { kind, center, position: center, radius, height };
}

/**
 * Adds the basin's authored navigation anchors. All meshes are procedural and share
 * a deliberately small material/geometry set so the silhouettes remain inexpensive.
 */
export function createLandmarks(scene, {
  heightAt,
  pathX,
  riverZ,
  palette,
  windUniforms,
} = {}) {
  const colliders = [];
  const focusPoints = [];
  const movingCloths = [];

  const bark = paletteColor(palette, 'bark', 0x4b3d31);
  const stone = paletteColor(palette, 'stone', 0x51483f);
  const crimson = paletteColor(palette, 'crimson', 0xd32225);
  const crimsonDark = paletteColor(palette, 'crimsonDark', 0x85151d);
  const bamboo = paletteColor(palette, 'bamboo', 0x163b34);
  const grassLit = paletteColor(palette, 'grassLit', 0xb88443);
  const sun = paletteColor(palette, 'sun', 0xffd17a);

  const barkMaterial = new THREE.MeshStandardMaterial({
    color: bark,
    roughness: .94,
    metalness: 0,
  });
  const darkWoodMaterial = new THREE.MeshStandardMaterial({
    color: bark.clone().multiplyScalar(.62),
    roughness: .98,
  });
  const stoneMaterial = new THREE.MeshStandardMaterial({
    color: stone,
    roughness: 1,
  });

  // Ancient wind-sculpted broadleaf: one continuous trunk/root mesh and one
  // instanced crown draw create a large readable silhouette.
  const treeX = -27;
  const treeZ = -32;
  const treeY = terrainHeight(heightAt, treeX, treeZ);
  const treeGroup = new THREE.Group();
  treeGroup.name = 'Ancient wind-sculpted tree';
  treeGroup.position.set(treeX, treeY, treeZ);

  const treeBranches = [
    // The trunk carries its lean well above the first split; keeping the center
    // bare makes the branch gesture legible from the meadow and river cameras.
    branch([[0, 0, 0, 1.48], [-.28, 1.7, .08, 1.28], [-.18, 3.8, .04, 1.02], [.18, 5.8, -.08, .82], [1.0, 7.8, -.18, .62], [2.05, 9.8, -.35, .43], [3.35, 11.8, -.5, .25], [4.85, 13.7, -.6, .10]]),
    branch([[-.02, 4.9, .02, .72], [-1.9, 6.9, -.15, .52], [-4.2, 8.8, -.38, .34], [-6.45, 10.3, -.7, .19], [-8.15, 11.15, -1.0, .07]]),
    branch([[-1.25, 6.3, -.05, .48], [-2.6, 8.7, .8, .32], [-3.8, 11.0, 1.25, .17], [-4.55, 12.55, 1.45, .06]]),
    branch([[.55, 6.65, -.1, .67], [3.0, 8.25, .12, .48], [5.75, 9.75, .05, .32], [8.65, 11.1, -.45, .19], [11.65, 12.0, -1.05, .10], [14.0, 12.35, -1.55, .04]]),
    branch([[1.65, 8.85, -.24, .48], [4.45, 10.55, -1.05, .34], [7.2, 12.25, -1.5, .21], [10.0, 13.2, -1.75, .10], [12.35, 13.15, -2.0, .04]]),
    branch([[2.15, 9.7, -.3, .39], [2.55, 12.1, .35, .24], [2.75, 14.25, .75, .07]]),
    branch([[-.1, 5.65, .08, .56], [-1.45, 7.5, 1.45, .37], [-2.45, 9.35, 3.0, .19], [-2.85, 11.05, 4.0, .06]]),
    // A snapped-off limb gives the lower silhouette an old, storm-damaged note.
    branch([[-.15, 4.15, .12, .54], [-2.0, 5.35, .7, .32], [-3.85, 5.95, 1.05, .13], [-4.75, 6.0, 1.0, .035]]),
    // High buttress roots stay visible above the flower layer before flattening
    // into long surface roots. They are part of the same trunk draw call.
    branch([[0, 1.5, 0, .84], [-1.7, .63, -.42, .61], [-4.05, .2, -.35, .31], [-6.05, .06, .55, .07]]),
    branch([[.08, 1.42, -.04, .78], [1.65, .57, -1.25, .56], [4.05, .17, -2.55, .27], [6.15, .05, -2.35, .065]]),
    branch([[.04, 1.36, .06, .71], [.72, .5, 1.9, .48], [2.25, .15, 4.0, .23], [3.95, .045, 5.25, .055]]),
    branch([[-.08, 1.25, .03, .65], [-1.55, .43, 1.5, .43], [-3.35, .13, 3.35, .19], [-4.45, .04, 4.15, .05]]),
    branch([[.04, 1.18, -.08, .62], [-.4, .36, -2.1, .40], [-1.65, .11, -4.15, .16], [-2.7, .04, -5.05, .045]]),
    branch([[.1, 1.08, -.02, .57], [1.9, .32, .8, .36], [4.15, .09, 1.45, .14], [5.25, .035, 1.9, .04]]),
  ];
  const trunk = new THREE.Mesh(makeBranchGeometry(treeBranches), barkMaterial);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  treeGroup.add(trunk);

  const crownGeometry = new THREE.IcosahedronGeometry(1, 1);
  const crownMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: .96,
    metalness: 0,
  });
  // Small, flattened pads trace separate branch tips instead of merging into a
  // single row of round blobs. The seventh value controls warm edge coloration.
  const crownLayout = [
    [-8.0, 11.25, -1.0, 2.25, .72, 1.65, .70],
    [-6.6, 12.0, -.35, 2.55, .82, 1.85, .46],
    [-5.6, 10.65, .65, 2.2, .68, 1.62, .64],
    [-4.6, 12.85, -1.15, 2.45, .8, 1.82, .32],
    [-3.35, 13.55, -.35, 2.65, .88, 1.95, .58],
    [-2.5, 11.75, 1.65, 2.25, .7, 1.7, .20],
    [-1.15, 14.15, .35, 2.4, .78, 1.8, .62],
    [.6, 14.75, -.55, 2.6, .86, 1.9, .76],
    [2.45, 15.0, .25, 2.75, .84, 2.0, .84],
    [3.75, 13.65, 1.7, 2.35, .7, 1.75, .28],
    [4.55, 14.7, -.85, 2.8, .84, 2.05, .67],
    [6.55, 14.25, -.25, 2.9, .8, 2.1, .54],
    [7.45, 12.55, 1.35, 2.35, .68, 1.72, .24],
    [8.6, 13.75, -1.2, 3.0, .82, 2.15, .62],
    [9.55, 11.75, .45, 2.45, .7, 1.82, .42],
    [10.75, 13.25, -2.0, 2.75, .76, 1.92, .73],
    [11.65, 11.25, -.45, 2.25, .64, 1.62, .76],
    [12.75, 12.65, -2.25, 2.45, .7, 1.72, .86],
    [14.4, 12.05, -2.55, 2.0, .61, 1.45, .95],
    [-5.2, 11.55, 2.45, 1.9, .6, 1.42, .38],
    [-.4, 12.8, 3.0, 2.15, .65, 1.58, .22],
    [2.0, 13.25, -2.9, 2.15, .64, 1.62, .44],
    [5.3, 12.25, 3.0, 2.25, .64, 1.7, .31],
    [7.8, 13.0, 2.35, 2.35, .66, 1.72, .48],
    [11.0, 12.4, 1.75, 2.15, .62, 1.55, .72],
  ];
  const crown = new THREE.InstancedMesh(crownGeometry, crownMaterial, crownLayout.length);
  crown.name = 'Wind-swept broadleaf crown';
  const leafDark = bamboo.clone().lerp(bark, .08);
  const leafMid = bamboo.clone().lerp(grassLit, .34);
  const leafWarm = grassLit.clone().lerp(sun, .18);
  for (let i = 0; i < crownLayout.length; i++) {
    const [x, y, z, sx, sy, sz, warmth] = crownLayout[i];
    crown.setMatrixAt(i, matrixAt(
      new THREE.Vector3(x, y, z),
      new THREE.Vector3(sx, sy, sz),
      i * .71,
      (i % 5 - 2) * .045,
    ));
    const clusterColor = leafDark.clone().lerp(leafMid, .22 + warmth * .48);
    if (warmth > .66) clusterColor.lerp(leafWarm, (warmth - .66) * .55);
    crown.setColorAt(i, clusterColor);
  }
  crown.instanceMatrix.needsUpdate = true;
  if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
  crown.castShadow = true;
  crown.receiveShadow = true;
  treeGroup.add(crown);
  scene.add(treeGroup);

  colliders.push(collider('ancient-tree', treeX, treeY + 5.5, treeZ, 1.25, 11));
  focusPoints.push(focusPoint('ancient-tree', treeX + 1.6, treeY + 6.5, treeZ, 15));

  // Three uneven banner poles sit inside the tree clearing. Crossbars and cloth
  // turn into the prevailing wind while the supporting poles remain rigid.
  const bannerDefinitions = [
    { x: treeX - 5.8, z: treeZ + 2.8, poleHeight: 8.8, width: 2.25, clothHeight: 4.35, color: crimson, seed: .7 },
    { x: treeX - 2.6, z: treeZ + 4.5, poleHeight: 7.5, width: 1.85, clothHeight: 3.75, color: grassLit.clone().lerp(sun, .22), seed: 2.1 },
    { x: treeX + 4.6, z: treeZ - 2.9, poleHeight: 7.9, width: 2.0, clothHeight: 4.0, color: crimsonDark.clone().lerp(bark, .18), seed: 4.4 },
  ];
  const poleGeometry = new THREE.CylinderGeometry(.075, .115, 1, 7);
  const poles = new THREE.InstancedMesh(poleGeometry, darkWoodMaterial, bannerDefinitions.length);
  poles.name = 'Three weathered banner poles';
  poles.castShadow = true;

  const initialDirection = windUniforms?.uWindDirection?.value;
  const initialWindX = Number.isFinite(initialDirection?.x) ? initialDirection.x : .82;
  const initialWindZ = Number.isFinite(initialDirection?.y) ? initialDirection.y : -.36;
  const initialBannerYaw = Math.atan2(-initialWindZ, initialWindX);

  for (let i = 0; i < bannerDefinitions.length; i++) {
    const definition = bannerDefinitions[i];
    const y = terrainHeight(heightAt, definition.x, definition.z);
    poles.setMatrixAt(i, matrixAt(
      new THREE.Vector3(definition.x, y + definition.poleHeight * .5, definition.z),
      new THREE.Vector3(1, definition.poleHeight, 1),
    ));

    const pivot = new THREE.Group();
    pivot.name = `Wind banner ${i + 1}`;
    pivot.position.set(definition.x, y + definition.poleHeight - .22, definition.z);
    pivot.rotation.y = initialBannerYaw;

    const crossbar = new THREE.Mesh(
      new THREE.CylinderGeometry(.048, .064, definition.width + .38, 6),
      darkWoodMaterial,
    );
    crossbar.rotation.z = -Math.PI * .5;
    crossbar.position.set(definition.width * .5 - .03, .08, 0);
    crossbar.castShadow = true;
    pivot.add(crossbar);

    const clothData = makeClothGeometry(
      definition.width,
      definition.clothHeight,
      definition.seed,
      definition.color,
    );
    const clothMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: .97,
      metalness: 0,
    });
    const clothMesh = new THREE.Mesh(clothData.geometry, clothMaterial);
    clothMesh.position.set(.08, -.05, 0);
    clothMesh.castShadow = true;
    pivot.add(clothMesh);
    scene.add(pivot);

    movingCloths.push({ ...clothData, pivot });
    colliders.push(collider('banner-pole', definition.x, y + definition.poleHeight * .5, definition.z, .13, definition.poleHeight));
  }
  poles.instanceMatrix.needsUpdate = true;
  scene.add(poles);

  // Torii at the bamboo exit. Its local Z axis follows the winding path, keeping
  // the gate perpendicular to the player's approach even if the route changes.
  const toriiZ = 54;
  const toriiX = pathCenter(pathX, toriiZ);
  const toriiYaw = pathYaw(pathX, toriiZ);
  const toriiPostOffset = 3.05;
  const leftPostOffset = rotatedOffset(-toriiPostOffset, 0, toriiYaw);
  const rightPostOffset = rotatedOffset(toriiPostOffset, 0, toriiYaw);
  const toriiY = Math.max(
    terrainHeight(heightAt, toriiX + leftPostOffset.x, toriiZ + leftPostOffset.z),
    terrainHeight(heightAt, toriiX + rightPostOffset.x, toriiZ + rightPostOffset.z),
  );
  const toriiGroup = new THREE.Group();
  toriiGroup.name = 'Weathered torii at bamboo exit';
  toriiGroup.position.set(toriiX, toriiY, toriiZ);
  toriiGroup.rotation.y = toriiYaw;

  const toriiColor = crimsonDark.clone().lerp(bark, .42);
  const toriiMaterial = new THREE.MeshStandardMaterial({
    color: toriiColor,
    roughness: .96,
    metalness: 0,
  });
  const toriiPostGeometry = new THREE.CylinderGeometry(.27, .43, 6.0, 9);
  const toriiPosts = new THREE.InstancedMesh(toriiPostGeometry, toriiMaterial, 2);
  toriiPosts.setMatrixAt(0, matrixAt(new THREE.Vector3(-toriiPostOffset, 3, 0), new THREE.Vector3(1, 1, 1), 0, .035));
  toriiPosts.setMatrixAt(1, matrixAt(new THREE.Vector3(toriiPostOffset, 3, 0), new THREE.Vector3(1, 1, 1), 0, -.035));
  toriiPosts.instanceMatrix.needsUpdate = true;
  toriiPosts.castShadow = true;
  toriiPosts.receiveShadow = true;
  toriiGroup.add(toriiPosts);

  const upperBeam = new THREE.Mesh(makeCurvedBeamGeometry(8.25, .52, .66), toriiMaterial);
  upperBeam.position.y = 6.12;
  upperBeam.castShadow = true;
  upperBeam.receiveShadow = true;
  toriiGroup.add(upperBeam);

  const lowerBeam = new THREE.Mesh(new THREE.BoxGeometry(6.75, .38, .48), toriiMaterial);
  lowerBeam.position.y = 5.32;
  lowerBeam.castShadow = true;
  lowerBeam.receiveShadow = true;
  toriiGroup.add(lowerBeam);

  const plaque = new THREE.Mesh(new THREE.BoxGeometry(1.1, .78, .26), darkWoodMaterial);
  plaque.position.set(0, 5.55, .02);
  plaque.castShadow = true;
  toriiGroup.add(plaque);
  scene.add(toriiGroup);

  const leftPostWorld = new THREE.Vector3(toriiX + leftPostOffset.x, toriiY + 3, toriiZ + leftPostOffset.z);
  const rightPostWorld = new THREE.Vector3(toriiX + rightPostOffset.x, toriiY + 3, toriiZ + rightPostOffset.z);
  colliders.push(
    collider('torii-post', leftPostWorld.x, leftPostWorld.y, leftPostWorld.z, .43, 6),
    collider('torii-post', rightPostWorld.x, rightPostWorld.y, rightPostWorld.z, .43, 6),
  );
  focusPoints.push(focusPoint('bamboo-exit-torii', toriiX, toriiY + 3.7, toriiZ, 10));

  // Paired stone lanterns just beyond the torii. Each architectural component is
  // instanced across both lanterns, keeping their combined draw count modest.
  const lanternZ = 42.5;
  const lanternScale = .72;
  const lanternPathX = pathCenter(pathX, lanternZ);
  const lanternYaw = pathYaw(pathX, lanternZ);
  const lanternRight = rotatedOffset(5.2, 0, lanternYaw);
  const lanternPositions = [-1, 1].map((side) => {
    const x = lanternPathX + lanternRight.x * side;
    const z = lanternZ + lanternRight.z * side;
    return new THREE.Vector3(x, terrainHeight(heightAt, x, z), z);
  });

  const lanternBase = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), stoneMaterial, 2);
  const lanternShaft = new THREE.InstancedMesh(new THREE.CylinderGeometry(.23, .31, 1, 4), stoneMaterial, 2);
  const lanternFrames = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), stoneMaterial, 12);
  const lanternRoof = new THREE.InstancedMesh(new THREE.ConeGeometry(.72, .46, 4), stoneMaterial, 2);
  const lanternCap = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), stoneMaterial, 2);
  const lanternGlow = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 8, 5),
    new THREE.MeshBasicMaterial({ color: sun, toneMapped: false }),
    2,
  );
  lanternBase.castShadow = true;
  lanternShaft.castShadow = true;
  lanternFrames.castShadow = true;
  lanternRoof.castShadow = true;
  lanternCap.castShadow = true;
  lanternGlow.frustumCulled = false;

  let frameIndex = 0;
  for (let i = 0; i < lanternPositions.length; i++) {
    const base = lanternPositions[i];
    lanternBase.setMatrixAt(i, matrixAt(
      new THREE.Vector3(base.x, base.y + .15 * lanternScale, base.z),
      new THREE.Vector3(.92, .3, .92).multiplyScalar(lanternScale),
      lanternYaw + Math.PI * .25,
    ));
    lanternShaft.setMatrixAt(i, matrixAt(
      new THREE.Vector3(base.x, base.y + .92 * lanternScale, base.z),
      new THREE.Vector3(1, 1.3, 1).multiplyScalar(lanternScale),
      lanternYaw + Math.PI * .25,
    ));

    for (const [ox, oz] of [[-.27, -.27], [.27, -.27], [-.27, .27], [.27, .27]]) {
      const offset = rotatedOffset(ox * lanternScale, oz * lanternScale, lanternYaw);
      lanternFrames.setMatrixAt(frameIndex++, matrixAt(
        new THREE.Vector3(base.x + offset.x, base.y + 1.83 * lanternScale, base.z + offset.z),
        new THREE.Vector3(.095, .57, .095).multiplyScalar(lanternScale),
        lanternYaw,
      ));
    }
    for (const y of [1.51, 2.15]) {
      lanternFrames.setMatrixAt(frameIndex++, matrixAt(
        new THREE.Vector3(base.x, base.y + y * lanternScale, base.z),
        new THREE.Vector3(.72, .11, .72).multiplyScalar(lanternScale),
        lanternYaw,
      ));
    }

    lanternRoof.setMatrixAt(i, matrixAt(
      new THREE.Vector3(base.x, base.y + 2.39 * lanternScale, base.z),
      new THREE.Vector3(lanternScale, lanternScale, lanternScale),
      lanternYaw + Math.PI * .25,
    ));
    lanternCap.setMatrixAt(i, matrixAt(
      new THREE.Vector3(base.x, base.y + 2.69 * lanternScale, base.z),
      new THREE.Vector3(.12, .16, .12).multiplyScalar(lanternScale),
    ));
    lanternGlow.setMatrixAt(i, matrixAt(
      new THREE.Vector3(base.x, base.y + 1.83 * lanternScale, base.z),
      new THREE.Vector3(.19, .25, .19).multiplyScalar(lanternScale),
    ));
    colliders.push(collider(
      'stone-lantern',
      base.x,
      base.y + 1.3 * lanternScale,
      base.z,
      .48 * lanternScale,
      2.7 * lanternScale,
    ));
  }
  for (const mesh of [lanternBase, lanternShaft, lanternFrames, lanternRoof, lanternCap, lanternGlow]) {
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  }

  // Timber bridge at the analytic path/river intersection. The deck has a subtle
  // arch so it reads clearly above the copper water from either approach.
  const bridgeZ = resolveRiverCrossing(riverZ, pathX);
  const bridgeX = pathCenter(pathX, bridgeZ);
  const bridgeYaw = pathYaw(pathX, bridgeZ);
  const bridgeForward = rotatedOffset(0, 4.0, bridgeYaw);
  const bridgeY = Math.max(
    terrainHeight(heightAt, bridgeX - bridgeForward.x, bridgeZ - bridgeForward.z),
    terrainHeight(heightAt, bridgeX + bridgeForward.x, bridgeZ + bridgeForward.z),
    terrainHeight(heightAt, bridgeX, bridgeZ),
  ) + .18;
  const bridgeGroup = new THREE.Group();
  bridgeGroup.name = 'Small timber footbridge';
  bridgeGroup.position.set(bridgeX, bridgeY, bridgeZ);
  bridgeGroup.rotation.y = bridgeYaw;

  const bridgeWood = new THREE.MeshStandardMaterial({
    color: bark.clone().lerp(grassLit, .14),
    roughness: .97,
  });
  const plankCount = 15;
  const bridgePlanks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bridgeWood, plankCount);
  bridgePlanks.castShadow = true;
  bridgePlanks.receiveShadow = true;
  for (let i = 0; i < plankCount; i++) {
    const t = i / (plankCount - 1);
    const z = THREE.MathUtils.lerp(-3.75, 3.75, t);
    const arch = .34 * (1 - Math.pow(z / 3.9, 2));
    bridgePlanks.setMatrixAt(i, matrixAt(
      new THREE.Vector3(0, arch, z),
      new THREE.Vector3(3.75 + Math.sin(i * 7.1) * .07, .17, .49),
      Math.sin(i * 5.7) * .008,
      Math.sin(i * 3.3) * .009,
    ));
  }
  bridgePlanks.instanceMatrix.needsUpdate = true;
  bridgeGroup.add(bridgePlanks);

  const bridgePosts = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bridgeWood, 8);
  bridgePosts.castShadow = true;
  let bridgePostIndex = 0;
  for (const x of [-1.82, 1.82]) {
    for (const z of [-3.35, -1.15, 1.15, 3.35]) {
      const arch = .34 * (1 - Math.pow(z / 3.9, 2));
      bridgePosts.setMatrixAt(bridgePostIndex++, matrixAt(
        new THREE.Vector3(x, arch + .62, z),
        new THREE.Vector3(.13, 1.35, .13),
        0,
        x > 0 ? -.025 : .025,
      ));
    }
  }
  bridgePosts.instanceMatrix.needsUpdate = true;
  bridgeGroup.add(bridgePosts);

  const bridgeRails = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bridgeWood, 2);
  bridgeRails.castShadow = true;
  bridgeRails.setMatrixAt(0, matrixAt(new THREE.Vector3(-1.82, 1.08, 0), new THREE.Vector3(.12, .13, 7.05)));
  bridgeRails.setMatrixAt(1, matrixAt(new THREE.Vector3(1.82, 1.08, 0), new THREE.Vector3(.12, .13, 7.05)));
  bridgeRails.instanceMatrix.needsUpdate = true;
  bridgeGroup.add(bridgeRails);
  scene.add(bridgeGroup);
  focusPoints.push(focusPoint('timber-footbridge', bridgeX, bridgeY + .7, bridgeZ, 8));

  // Faceted stone clusters break up the landmark bases and conceal root joins.
  const rockDefinitions = [
    [treeX - 4.4, treeZ - 1.8, 1.55, .72, 1.15, .2],
    [treeX - 2.9, treeZ + 2.4, 1.05, .48, .8, 1.1],
    [treeX + 3.8, treeZ - 3.6, 1.25, .58, 1.0, 2.5],
    [treeX + 5.1, treeZ - 2.4, .75, .36, .65, .8],
    [treeX - 5.1, treeZ + 3.4, .82, .4, .68, 1.9],
    [toriiX - 5.2, toriiZ + 1.1, 1.05, .46, .88, .3],
    [toriiX + 5.4, toriiZ - .8, 1.35, .62, 1.0, 2.2],
    [bridgeX - 3.7, bridgeZ - 2.6, .82, .34, .72, 1.4],
    [bridgeX + 4.0, bridgeZ + 2.8, 1.0, .42, .78, 2.8],
  ];
  const rockGeometry = new THREE.IcosahedronGeometry(1, 1);
  const rocks = new THREE.InstancedMesh(rockGeometry, stoneMaterial, rockDefinitions.length);
  rocks.name = 'Landmark stone clusters';
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  for (let i = 0; i < rockDefinitions.length; i++) {
    const [x, z, sx, sy, sz, yaw] = rockDefinitions[i];
    const y = terrainHeight(heightAt, x, z) + sy * .42;
    rocks.setMatrixAt(i, matrixAt(
      new THREE.Vector3(x, y, z),
      new THREE.Vector3(sx, sy, sz),
      yaw,
      Math.sin(i * 2.7) * .12,
    ));
    if (Math.max(sx, sz) > 1.15) {
      colliders.push(collider('rock', x, y, z, Math.max(sx, sz) * .62, sy * 2));
    }
  }
  rocks.instanceMatrix.needsUpdate = true;
  scene.add(rocks);

  let previousTime = 0;
  function update(time) {
    if (!Number.isFinite(time)) return;
    if (windUniforms?.uTime) windUniforms.uTime.value = time;

    const strengthValue = windUniforms?.uWindStrength?.value;
    const windStrength = THREE.MathUtils.clamp(Number.isFinite(strengthValue) ? strengthValue : 1, .15, 2.6);
    const direction = windUniforms?.uWindDirection?.value;
    let windX = Number.isFinite(direction?.x) ? direction.x : .82;
    let windZ = Number.isFinite(direction?.y) ? direction.y : -.36;
    const windLength = Math.hypot(windX, windZ) || 1;
    windX /= windLength;
    windZ /= windLength;

    const targetYaw = Math.atan2(-windZ, windX);
    const delta = Math.min(Math.max(time - previousTime, 0), .1);
    previousTime = time;
    const yawResponse = 1 - Math.exp(-delta * 1.8);
    for (const cloth of movingCloths) {
      let difference = targetYaw - cloth.pivot.rotation.y;
      difference = Math.atan2(Math.sin(difference), Math.cos(difference));
      cloth.pivot.rotation.y += difference * yawResponse;
      updateCloth(cloth, time, windStrength);
    }

    const crownSway = Math.sin(time * .74 + .8) * (.006 + windStrength * .006)
      + Math.sin(time * 1.53) * .0025 * windStrength;
    crown.rotation.z = -windX * crownSway;
    crown.rotation.x = windZ * crownSway;
  }

  update(0);
  return { update, colliders, focusPoints };
}
