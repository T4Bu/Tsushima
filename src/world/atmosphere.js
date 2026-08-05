import * as THREE from 'three';

const tempColor = new THREE.Color();

function makeSunTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,252,229,.98)');
  gradient.addColorStop(0.055, 'rgba(255,238,188,.94)');
  gradient.addColorStop(0.14, 'rgba(255,202,118,.5)');
  gradient.addColorStop(0.31, 'rgba(242,160,83,.105)');
  gradient.addColorStop(0.62, 'rgba(218,123,67,.018)');
  gradient.addColorStop(1, 'rgba(186,93,55,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeSky(palette, sunDirection) {
  const geometry = new THREE.SphereGeometry(420, 32, 20);
  const paleGold = new THREE.Color(palette.sun).lerp(new THREE.Color(0xffe2b1), .42);
  const horizon = new THREE.Color(palette.skyHorizon).lerp(paleGold, .64);
  const top = new THREE.Color(palette.skyTop).lerp(new THREE.Color(0x795868), .42);
  const lower = new THREE.Color(palette.shadowTeal)
    .lerp(new THREE.Color(palette.fog), .18);
  const copper = new THREE.Color(palette.skyHorizon)
    .lerp(new THREE.Color(0x9d5144), .38);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: top },
      uHorizon: { value: horizon },
      uLower: { value: lower },
      uCopper: { value: copper },
      uSun: { value: sunDirection.clone() },
      uSunColor: { value: paleGold.clone().multiplyScalar(.78) },
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
        vec3 sky = mix(uLower, uHorizon, smoothstep(0.015, .39, h));
        sky = mix(sky, uTop, smoothstep(.36, .96, h));
        float sunDot = max(dot(d, normalize(uSun)), 0.0);
        float halo = pow(sunDot, 29.0) * .14 + pow(sunDot, 420.0) * .74;
        float horizonBand = exp(-abs(d.y - .045) * 7.5);
        sky += uSunColor * halo;
        sky = mix(sky, uCopper, horizonBand * .055);
        float cloud = sin(d.x * 19.0 + d.z * 11.0 + d.y * 7.0)
                    * sin(d.x * 8.0 - d.z * 23.0);
        float cloudMask = smoothstep(.16, .76, cloud)
          * smoothstep(.28, .63, h) * (1.0 - smoothstep(.88, 1.0, h));
        float longWisp = smoothstep(.58, .94,
          sin(d.x * 10.0 - d.z * 3.4 + d.y * 16.0) * .5 + .5)
          * smoothstep(.42, .72, h) * (1.0 - smoothstep(.86, .99, h));
        sky = mix(sky, uCopper * .66, cloudMask * .11 + longWisp * .055);
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

function createDistantTreeLine(scene, palette) {
  const group = new THREE.Group();
  group.name = 'Natural distant tree billboard layers';
  const paleHorizon = new THREE.Color(palette.skyHorizon)
    .lerp(new THREE.Color(palette.sun), .5);
  const teal = new THREE.Color(palette.shadowTeal);
  const loader = new THREE.TextureLoader();
  const treeMaps = [
    loader.load('/assets/trees/tree-sprite-0.png'),
    loader.load('/assets/trees/tree-sprite-3.png'),
  ];
  for (const map of treeMaps) {
    map.colorSpace = THREE.SRGBColorSpace;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.magFilter = THREE.LinearFilter;
    map.generateMipmaps = true;
  }

  const layers = [
    { radius: 104, depth: 13, count: 34, y: -1.0, size: 25, opacity: .86, tint: teal.clone().lerp(paleHorizon, .28) },
    { radius: 137, depth: 18, count: 44, y: .2, size: 30, opacity: .72, tint: teal.clone().lerp(paleHorizon, .48) },
    { radius: 171, depth: 24, count: 52, y: 1.5, size: 35, opacity: .58, tint: teal.clone().lerp(paleHorizon, .65) },
  ];

  for (const [layerIndex, layer] of layers.entries()) {
    for (let variant = 0; variant < treeMaps.length; variant++) {
      const positions = [];
      for (let i = variant; i < layer.count; i += treeMaps.length) {
        const angleJitter = (silhouetteRandom(i, layerIndex * 19) - .5) * .72;
        const angle = ((i + angleJitter) / layer.count) * Math.PI * 2 + layerIndex * .19;
        const radius = layer.radius
          + (silhouetteRandom(i, layerIndex * 31 + 2) - .5) * layer.depth;
        const treeSize = layer.size * (.82 + silhouetteRandom(i, layerIndex * 43 + 7) * .34);
        positions.push(
          Math.sin(angle) * radius,
          layer.y + treeSize * .31,
          Math.cos(angle) * radius,
        );
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        map: treeMaps[variant],
        color: layer.tint,
        size: layer.size,
        sizeAttenuation: true,
        transparent: true,
        opacity: layer.opacity,
        alphaTest: .055,
        depthWrite: false,
        fog: true,
      });
      const trees = new THREE.Points(geometry, material);
      trees.name = `Distant natural trees ${layerIndex + 1}.${variant + 1}`;
      trees.frustumCulled = false;
      trees.renderOrder = -3 + layerIndex;
      group.add(trees);
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

function hazeRandom(index, salt = 0) {
  const value = Math.sin((index + 1) * 91.731 + salt * 47.117) * 43758.5453;
  return value - Math.floor(value);
}

function createLayeredHaze(scene, palette) {
  const positions = [];
  const sizes = [];
  const opacities = [];

  // Low mist follows the same broad stream gesture as the terrain without
  // coupling this visual-only atmosphere module to the terrain implementation.
  for (let i = 0; i < 34; i++) {
    const x = THREE.MathUtils.lerp(-116, 116, i / 33) + (hazeRandom(i, 3) - .5) * 6;
    const z = -26
      + 6 * Math.sin((x + 18) * .035)
      + 2 * Math.sin((x - 24) * .075)
      + (hazeRandom(i, 5) - .5) * 5.5;
    positions.push(x, -.15 + hazeRandom(i, 7) * 1.4, z);
    sizes.push(24 + hazeRandom(i, 11) * 25);
    opacities.push(.035 + hazeRandom(i, 13) * .038);
  }

  // A second, lighter ring interrupts the otherwise uniform exponential fog
  // and separates the middle tree line from the far silhouette layer.
  for (let i = 0; i < 42; i++) {
    const angle = (i / 42) * Math.PI * 2 + (hazeRandom(i, 17) - .5) * .16;
    const radius = 82 + hazeRandom(i, 19) * 38;
    positions.push(
      Math.sin(angle) * radius,
      .8 + hazeRandom(i, 23) * 5.5,
      Math.cos(angle) * radius,
    );
    sizes.push(34 + hazeRandom(i, 29) * 36);
    opacities.push(.012 + hazeRandom(i, 31) * .018);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('aOpacity', new THREE.Float32BufferAttribute(opacities, 1));

  const color = new THREE.Color(palette.skyHorizon)
    .lerp(new THREE.Color(palette.sun), .58);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */`
      attribute float aSize;
      attribute float aOpacity;
      uniform float uTime;
      varying float vOpacity;

      void main() {
        vec3 mistPosition = position;
        mistPosition.x += sin(uTime * .035 + position.z * .017) * 1.2;
        mistPosition.y += sin(uTime * .08 + position.x * .023) * .12;
        vec4 viewPosition = modelViewMatrix * vec4(mistPosition, 1.0);
        float perspective = clamp(210.0 / max(-viewPosition.z, 1.0), .48, 4.2);
        gl_PointSize = min(aSize * perspective, 170.0);
        gl_Position = projectionMatrix * viewPosition;
        vOpacity = aOpacity;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      varying float vOpacity;

      void main() {
        vec2 centered = gl_PointCoord * 2.0 - 1.0;
        centered.y *= 1.7;
        float radius = dot(centered, centered);
        if (radius > 1.0) discard;
        float softness = pow(1.0 - smoothstep(.05, 1.0, radius), 1.8);
        gl_FragColor = vec4(uColor, softness * vOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    toneMapped: true,
  });
  const haze = new THREE.Points(geometry, material);
  haze.name = 'Layered river and distance haze';
  haze.frustumCulled = false;
  haze.renderOrder = 2;
  scene.add(haze);
  return haze;
}

export function createAtmosphere(scene, { palette, renderer, windUniforms }) {
  const sunDirection = new THREE.Vector3(-.48, .105, -.87).normalize();
  const paleGold = new THREE.Color(palette.sun).lerp(new THREE.Color(0xffe0ae), .36);
  const fogBase = new THREE.Color(0xb9846d).lerp(paleGold, .33);
  const fogWarm = fogBase.clone().lerp(paleGold, .12);
  const requestedFogDensity = windUniforms.uFogDensity.value;
  const tunedFogDensity = THREE.MathUtils.clamp(requestedFogDensity * 1.05, .0064, .0092);
  windUniforms.uFogDensity.value = tunedFogDensity;
  scene.fog = new THREE.FogExp2(fogBase, tunedFogDensity);
  scene.background = fogBase.clone();
  windUniforms.uFogColor.value.copy(fogBase);

  const sky = makeSky(palette, sunDirection);
  scene.add(sky);

  const sunTexture = makeSunTexture();
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunTexture,
    color: palette.sun,
    transparent: true,
    opacity: .43,
    blending: THREE.NormalBlending,
    depthWrite: false,
    fog: false,
    toneMapped: true,
  }));
  sun.position.copy(sunDirection).multiplyScalar(185);
  sun.scale.set(9.4, 9.4, 1);
  scene.add(sun);

  const hemi = new THREE.HemisphereLight(paleGold, palette.shadowTeal, 1.48);
  scene.add(hemi);

  const ambientColor = new THREE.Color(palette.shadowTeal)
    .lerp(new THREE.Color(0x6f7773), .46);
  const ambient = new THREE.AmbientLight(ambientColor, .82);
  scene.add(ambient);

  const coolFillColor = new THREE.Color(palette.shadowTeal)
    .lerp(new THREE.Color(0x829997), .58);
  const coolFill = new THREE.DirectionalLight(coolFillColor, 1.2);
  coolFill.name = 'Cool opposing shadow fill';
  coolFill.position.copy(sunDirection).multiplyScalar(-64);
  coolFill.position.y = 42;
  coolFill.target.position.set(0, 4, 0);
  scene.add(coolFill, coolFill.target);

  const key = new THREE.DirectionalLight(palette.sun, 5.15);
  key.name = 'Low sunset key';
  key.position.copy(sunDirection).multiplyScalar(115);
  key.target.position.set(-8, 0, -12);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const shadowHalfExtent = 58;
  key.shadow.camera.left = -shadowHalfExtent;
  key.shadow.camera.right = shadowHalfExtent;
  key.shadow.camera.top = shadowHalfExtent;
  key.shadow.camera.bottom = -shadowHalfExtent;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 210;
  key.shadow.bias = -.00025;
  key.shadow.normalBias = .045;
  key.shadow.radius = 2.2;
  scene.add(key, key.target);

  const silhouettes = createDistantTreeLine(scene, palette);
  const shafts = createLightShafts(scene, sunDirection, palette);
  const layeredHaze = createLayeredHaze(scene, palette);

  const shadowOffset = sunDirection.clone().multiplyScalar(115);
  const shadowForward = new THREE.Vector3();
  const shadowAnchor = new THREE.Vector3();
  const shadowTexel = (shadowHalfExtent * 2) / key.shadow.mapSize.x;

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
      layeredHaze.material.uniforms.uTime.value = time;

      // Keep high-resolution shadows centered slightly ahead of the player. The
      // world-space snap is deliberately coarse enough to prevent sub-texel crawl
      // while remaining invisible during normal walking.
      if (camera) {
        camera.getWorldDirection(shadowForward);
        shadowForward.y = 0;
        if (shadowForward.lengthSq() < .0001) shadowForward.set(0, 0, -1);
        shadowForward.normalize();
        shadowAnchor.copy(camera.position).addScaledVector(shadowForward, 13);
        shadowAnchor.y = 1.5;
        shadowAnchor.x = Math.round(shadowAnchor.x / shadowTexel) * shadowTexel;
        shadowAnchor.z = Math.round(shadowAnchor.z / shadowTexel) * shadowTexel;
        key.target.position.copy(shadowAnchor);
        key.position.copy(shadowAnchor).add(shadowOffset);
        key.target.updateMatrixWorld();
        key.updateMatrixWorld();
      }

      tempColor.copy(fogBase).lerp(fogWarm, .07 + .025 * Math.sin(time * .025));
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
      layeredHaze.geometry.dispose();
      layeredHaze.material.dispose();
    },
  };
}
