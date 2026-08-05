import * as THREE from 'three';

const tempColor = new THREE.Color();

function makeSunTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,247,218,.94)');
  gradient.addColorStop(0.045, 'rgba(255,226,157,.9)');
  gradient.addColorStop(0.13, 'rgba(255,181,92,.52)');
  gradient.addColorStop(0.34, 'rgba(224,112,52,.13)');
  gradient.addColorStop(0.68, 'rgba(173,70,35,.025)');
  gradient.addColorStop(1, 'rgba(130,50,28,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeSky(palette, sunDirection) {
  const geometry = new THREE.SphereGeometry(420, 32, 20);
  const lower = new THREE.Color(palette.shadowTeal)
    .lerp(new THREE.Color(palette.fog), .24);
  const copper = new THREE.Color(palette.skyHorizon)
    .lerp(new THREE.Color(palette.fog), .35);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(palette.skyTop) },
      uHorizon: { value: new THREE.Color(palette.skyHorizon) },
      uLower: { value: lower },
      uCopper: { value: copper },
      uSun: { value: sunDirection.clone() },
      uSunColor: { value: new THREE.Color(palette.sun).multiplyScalar(.72) },
    },
    vertexShader: /* glsl */`
      varying vec3 vWorldDir;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(world.xyz - cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vWorldDir;
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uLower;
      uniform vec3 uCopper;
      uniform vec3 uSun;
      uniform vec3 uSunColor;

      void main() {
        vec3 d = normalize(vWorldDir);
        float h = clamp(d.y * .72 + .34, 0.0, 1.0);
        vec3 sky = mix(uLower, uHorizon, smoothstep(0.03, .4, h));
        sky = mix(sky, uTop, smoothstep(.38, .98, h));
        float sunDot = max(dot(d, normalize(uSun)), 0.0);
        float halo = pow(sunDot, 34.0) * .2 + pow(sunDot, 360.0) * .68;
        float horizonBand = exp(-abs(d.y - .05) * 6.0);
        sky += uSunColor * halo;
        sky = mix(sky, uCopper, horizonBand * .11);
        float cloud = sin(d.x * 19.0 + d.z * 11.0 + d.y * 7.0)
                    * sin(d.x * 8.0 - d.z * 23.0);
        float cloudMask = smoothstep(.22, .8, cloud) * smoothstep(.28, .75, h);
        sky = mix(sky, uCopper * .72, cloudMask * .07);
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
  return new THREE.Mesh(geometry, material);
}

function silhouetteRandom(index, salt) {
  let value = Math.imul(index + 1, 0x45d9f3b) ^ Math.imul(salt + 17, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function makeProfileCrown(points, radialSegments = 7) {
  const geometry = new THREE.LatheGeometry(
    points.map(([radius, y]) => new THREE.Vector2(radius, y)),
    radialSegments,
  );
  geometry.computeVertexNormals();
  return geometry;
}

function createDistantTreeLine(scene, palette) {
  const group = new THREE.Group();
  group.name = 'Distant silhouette layers';
  const teal = new THREE.Color(palette.shadowTeal);
  const bark = new THREE.Color(palette.bark);
  const copper = new THREE.Color(palette.fog);
  const materialNear = new THREE.MeshBasicMaterial({
    color: teal.clone().lerp(bark, .34),
    fog: true,
  });
  const materialMid = new THREE.MeshBasicMaterial({
    color: teal.clone().lerp(copper, .2),
    fog: true,
  });
  const materialBack = new THREE.MeshBasicMaterial({
    color: teal.clone().lerp(copper, .34),
    fog: true,
  });

  const layers = [
    { radius: 108, depth: 10, count: 54, material: materialNear, y: -1.1, scale: 1 },
    { radius: 139, depth: 13, count: 68, material: materialMid, y: .2, scale: 1.16 },
    { radius: 169, depth: 18, count: 82, material: materialBack, y: 1.7, scale: 1.32 },
  ];

  const trunkGeometry = new THREE.CylinderGeometry(.34, .62, 1, 5);
  const crownGeometries = [
    makeProfileCrown([
      [.08, -.5], [.66, -.45], [.39, -.32], [.82, -.24], [.38, -.09],
      [.67, -.01], [.28, .15], [.49, .25], [.2, .39], [0, .5],
    ], 7),
    makeProfileCrown([
      [.1, -.5], [.42, -.45], [.31, -.26], [.49, -.18], [.26, .02],
      [.38, .12], [.17, .3], [.25, .39], [0, .5],
    ], 6),
    new THREE.DodecahedronGeometry(1, 0),
  ];
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  for (const [layerIndex, layer] of layers.entries()) {
    const trunks = new THREE.InstancedMesh(trunkGeometry, layer.material, layer.count);
    const crowns = crownGeometries.map(
      (geometry) => new THREE.InstancedMesh(geometry, layer.material, layer.count),
    );
    const crownCounts = [0, 0, 0];

    for (let i = 0; i < layer.count; i++) {
      const angleJitter = (silhouetteRandom(i, layerIndex * 19) - .5) * .88;
      const a = ((i + angleJitter) / layer.count) * Math.PI * 2 + layerIndex * .21;
      const r = layer.radius + (silhouetteRandom(i, layerIndex * 31 + 2) - .5) * layer.depth;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      const height = (8.5 + silhouetteRandom(i, layerIndex * 43 + 7) * 13.5) * layer.scale;
      const widthNoise = silhouetteRandom(i, layerIndex * 53 + 11);
      const yaw = silhouetteRandom(i, layerIndex * 61 + 13) * Math.PI * 2;
      const lean = (silhouetteRandom(i, layerIndex * 67 + 17) - .5) * .055;
      euler.set(lean, yaw, -lean * .65);
      quaternion.setFromEuler(euler);

      position.set(x, layer.y + height * .5, z);
      const trunkWidth = .48 + widthNoise * .55;
      scale.set(trunkWidth, height, trunkWidth * (.82 + widthNoise * .2));
      matrix.compose(position, quaternion, scale);
      trunks.setMatrixAt(i, matrix);

      const archetypeRoll = silhouetteRandom(i, layerIndex * 73 + 23);
      const archetype = archetypeRoll < .48 ? 0 : archetypeRoll < .78 ? 1 : 2;
      const crownIndex = crownCounts[archetype]++;
      if (archetype === 0) {
        const width = height * (.145 + widthNoise * .035);
        position.set(x, layer.y + height * .67, z);
        scale.set(width, height * .69, width * (.78 + widthNoise * .18));
      } else if (archetype === 1) {
        const width = height * (.092 + widthNoise * .025);
        position.set(x, layer.y + height * .69, z);
        scale.set(width, height * .76, width * (.82 + widthNoise * .15));
      } else {
        const width = height * (.17 + widthNoise * .045);
        position.set(
          x + Math.sin(yaw) * width * .22,
          layer.y + height * .76,
          z + Math.cos(yaw) * width * .22,
        );
        scale.set(width, width * (.46 + widthNoise * .18), width * (.72 + widthNoise * .2));
      }
      matrix.compose(position, quaternion, scale);
      crowns[archetype].setMatrixAt(crownIndex, matrix);
    }

    trunks.frustumCulled = false;
    group.add(trunks);
    for (let i = 0; i < crowns.length; i++) {
      crowns[i].count = crownCounts[i];
      crowns[i].instanceMatrix.needsUpdate = true;
      crowns[i].frustumCulled = false;
      group.add(crowns[i]);
    }
  }
  scene.add(group);
  return group;
}

function createLightShafts(scene, sunDirection, palette) {
  const group = new THREE.Group();
  group.name = 'Atmospheric light shafts';
  // Long transparent frusta reveal their polygon boundaries from most camera
  // angles. The sky shader now supplies the broad, edgeless sun haze instead;
  // keep this group for API/update compatibility and future true volumetrics.
  group.userData.sunDirection = sunDirection.clone();
  group.userData.color = new THREE.Color(palette.sun);
  scene.add(group);
  return group;
}

export function createAtmosphere(scene, { palette, renderer, windUniforms }) {
  const sunDirection = new THREE.Vector3(-.48, .105, -.87).normalize();
  const fogBase = new THREE.Color(palette.shadowTeal)
    .lerp(new THREE.Color(palette.fog), .72);
  const fogWarm = new THREE.Color(palette.fog)
    .lerp(new THREE.Color(0x88442f), .22);
  scene.fog = new THREE.FogExp2(fogBase, windUniforms.uFogDensity.value);
  scene.background = fogBase.clone();
  windUniforms.uFogColor.value.copy(fogBase);

  const sky = makeSky(palette, sunDirection);
  scene.add(sky);

  const sunTexture = makeSunTexture();
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunTexture,
    color: palette.sun,
    transparent: true,
    opacity: .55,
    blending: THREE.NormalBlending,
    depthWrite: false,
    fog: false,
    toneMapped: true,
  }));
  sun.position.copy(sunDirection).multiplyScalar(185);
  sun.scale.set(11.5, 11.5, 1);
  scene.add(sun);

  const hemi = new THREE.HemisphereLight(0xd8a078, palette.shadowTeal, 1.7);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0x6c5447, .56);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(palette.sun, 6.2);
  key.name = 'Low sunset key';
  key.position.copy(sunDirection).multiplyScalar(115);
  key.target.position.set(-8, 0, -12);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -72;
  key.shadow.camera.right = 72;
  key.shadow.camera.top = 72;
  key.shadow.camera.bottom = -72;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 240;
  key.shadow.bias = -.00025;
  key.shadow.normalBias = .035;
  scene.add(key, key.target);

  const silhouettes = createDistantTreeLine(scene, palette);
  const shafts = createLightShafts(scene, sunDirection, palette);

  if (renderer) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  return {
    sunDirection,
    keyLight: key,
    update(time, camera) {
      sky.position.copy(camera.position);
      sun.position.copy(camera.position).addScaledVector(sunDirection, 185);
      const pulse = .82 + Math.sin(time * .21) * .12 + Math.sin(time * .071) * .06;
      for (let i = 0; i < shafts.children.length; i++) {
        shafts.children[i].material.opacity = (.014 + i * .004) * pulse;
      }
      tempColor.copy(fogBase).lerp(fogWarm, .1 + .05 * Math.sin(time * .025));
      scene.fog.color.copy(tempColor);
      windUniforms.uFogColor.value.copy(tempColor);
    },
    dispose() {
      sky.geometry.dispose();
      sky.material.dispose();
      sunTexture.dispose();
      sun.material.dispose();
      silhouettes.traverse((obj) => {
        obj.geometry?.dispose();
        obj.material?.dispose();
      });
      shafts.traverse((obj) => {
        obj.geometry?.dispose();
        obj.material?.dispose();
      });
    },
  };
}
