import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  Points,
  SRGBColorSpace,
  ShaderMaterial,
  Sphere,
  TextureLoader,
  Vector2,
  Vector3,
} from 'three';

const TAU = Math.PI * 2;
const WORLD_EDGE = 110;
const SEED = 0x5a17c9e3;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
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

function hash2(ix, iz, seed = SEED) {
  let value = Math.imul(ix | 0, 0x1f123bb5) ^ Math.imul(iz | 0, 0x5f356495) ^ seed;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, z, seed = SEED) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return ab + (cd - ab) * uz;
}

function fbm(x, z, seed = SEED) {
  let amplitude = 0.54;
  let frequency = 1;
  let total = 0;
  let normalization = 0;
  for (let octave = 0; octave < 4; octave += 1) {
    total += valueNoise(x * frequency, z * frequency, seed + octave * 1013) * amplitude;
    normalization += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return total / normalization;
}

function groundFlowYawAt(x, z) {
  // Broad correlated turns establish the resting direction of whole grass
  // lanes. The live gust shader bends those lanes further without erasing the
  // quieter patch-to-patch structure visible between gusts.
  const broad = (fbm(x * .024, z * .024, SEED + 8123) - .5) * 2;
  const cross = (fbm(x * .052 + 13, z * .052 - 7, SEED + 9157) - .5) * 2;
  const flowX = -.72 + broad * .86 + cross * .3;
  const flowZ = -.69 + cross * .78 - broad * .27;
  // Flowing-grass geometry points along local +Z before the instance yaw.
  return Math.atan2(-flowX, flowZ);
}

function qualityScale(quality) {
  if (typeof quality === 'number' && Number.isFinite(quality)) {
    return clamp(quality, 0.2, 1.25);
  }

  if (quality && typeof quality === 'object') {
    const numeric = quality.vegetationScale
      ?? quality.foliageDensity
      ?? quality.densityScale
      ?? quality.density;
    if (Number.isFinite(numeric)) return clamp(numeric, 0.2, 1.25);
    quality = quality.name ?? quality.preset ?? quality.level;
  }

  if (quality === 'low') return 0.38;
  if (quality === 'medium') return 0.64;
  return 1;
}

function paletteColor(palette, key, fallback) {
  const value = palette?.[key];
  return value?.isColor ? value.clone() : new Color(value ?? fallback);
}

function sharedUniforms(windUniforms, palette) {
  return {
    uTime: windUniforms?.uTime ?? { value: 0 },
    uWindStrength: windUniforms?.uWindStrength ?? { value: 0.72 },
    uWindDirection: windUniforms?.uWindDirection ?? { value: new Vector2(-0.82, -0.38).normalize() },
    uPlayerPos: windUniforms?.uPlayerPos ?? { value: new Vector3(0, 2, 88) },
    uFogColor: windUniforms?.uFogColor ?? { value: paletteColor(palette, 'fog', 0xc98557) },
    uFogDensity: windUniforms?.uFogDensity ?? { value: 0.0095 },
    // Matches atmosphere.js' low sunset key. Keeping this in the shared set
    // lets every vegetation layer use the same front light and translucency.
    uSunDirection: windUniforms?.uSunDirection
      ?? { value: new Vector3(-0.48, 0.105, -0.87).normalize() },
    uSunColor: windUniforms?.uSunColor
      ?? { value: paletteColor(palette, 'sun', 0xffc86f) },
  };
}

function makeBuffers(includePart = false) {
  return {
    positions: [],
    normals: [],
    uvs: [],
    flex: [],
    part: includePart ? [] : null,
  };
}

function appendVertex(buffers, position, normal, uv, flex, part = 0) {
  buffers.positions.push(position[0], position[1], position[2]);
  buffers.normals.push(normal[0], normal[1], normal[2]);
  buffers.uvs.push(uv[0], uv[1]);
  buffers.flex.push(flex);
  if (buffers.part) buffers.part.push(part);
}

function appendQuad(
  buffers,
  p00,
  p10,
  p11,
  p01,
  normal,
  flex0,
  flex1,
  part = 0,
) {
  appendVertex(buffers, p00, normal, [0, flex0], flex0, part);
  appendVertex(buffers, p10, normal, [1, flex0], flex0, part);
  appendVertex(buffers, p11, normal, [1, flex1], flex1, part);
  appendVertex(buffers, p00, normal, [0, flex0], flex0, part);
  appendVertex(buffers, p11, normal, [1, flex1], flex1, part);
  appendVertex(buffers, p01, normal, [0, flex1], flex1, part);
}

function appendTexturedQuad(
  buffers,
  p00,
  p10,
  p11,
  p01,
  normal,
  flex0,
  flex1,
) {
  appendVertex(buffers, p00, normal, [0, 0], flex0);
  appendVertex(buffers, p10, normal, [1, 0], flex1);
  appendVertex(buffers, p11, normal, [1, 1], flex1);
  appendVertex(buffers, p00, normal, [0, 0], flex0);
  appendVertex(buffers, p11, normal, [1, 1], flex1);
  appendVertex(buffers, p01, normal, [0, 1], flex0);
}

function appendTriangle(buffers, a, b, c, flex, part = 0) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];
  let nx = aby * acz - abz * acy;
  let ny = abz * acx - abx * acz;
  let nz = abx * acy - aby * acx;
  const length = Math.hypot(nx, ny, nz) || 1;
  nx /= length;
  ny /= length;
  nz /= length;
  const normal = [nx, ny, nz];
  appendVertex(buffers, a, normal, [0, 0], flex, part);
  appendVertex(buffers, b, normal, [1, 0], flex, part);
  appendVertex(buffers, c, normal, [0.5, 1], flex, part);
}

function finishGeometry(buffers) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(buffers.positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(buffers.normals), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(buffers.uvs), 2));
  geometry.setAttribute('aFlex', new BufferAttribute(new Float32Array(buffers.flex), 1));
  if (buffers.part) {
    geometry.setAttribute('aPart', new BufferAttribute(new Float32Array(buffers.part), 1));
  }
  return geometry;
}

function makeGrassTuftGeometry({
  blades = 6,
  segments = 3,
  width = 0.028,
  spread = 0.15,
} = {}) {
  const buffers = makeBuffers();
  for (let blade = 0; blade < blades; blade += 1) {
    // Each instance represents a loose patch, not a radial prop: blade roots
    // walk around a golden-angle spiral while their planes, heights, and lean
    // stay decorrelated. This fills ground continuously without broad cards.
    const angle = (blade / blades) * Math.PI + Math.sin(blade * 2.17) * 0.24;
    const sideX = Math.cos(angle);
    const sideZ = Math.sin(angle);
    const normal = [-sideZ, 0.075, sideX];
    const normalLength = Math.hypot(normal[0], normal[1], normal[2]);
    normal[0] /= normalLength;
    normal[1] /= normalLength;
    normal[2] /= normalLength;
    const height = 0.54 + 0.46 * (0.5 + 0.5 * Math.sin(blade * 4.73 + 0.7));
    const bladeWidth = width * (0.68 + 0.32 * (0.5 + 0.5 * Math.sin(blade * 3.11)));
    const rootRadius = spread * Math.sqrt((blade + 0.35) / blades);
    const rootAngle = blade * 2.399963;
    const rootX = Math.cos(rootAngle) * rootRadius;
    const rootZ = Math.sin(rootAngle) * rootRadius;
    const curveStrength = 0.065 + 0.075 * (0.5 + 0.5 * Math.sin(blade * 1.91 + 1.2));

    for (let segment = 0; segment < segments; segment += 1) {
      const t0 = segment / segments;
      const t1 = (segment + 1) / segments;
      const width0 = bladeWidth * (1 - 0.92 * t0);
      const width1 = bladeWidth * (1 - 0.92 * t1);
      const curve0 = curveStrength * (t0 * t0 + Math.sin(t0 * Math.PI) * 0.28);
      const curve1 = curveStrength * (t1 * t1 + Math.sin(t1 * Math.PI) * 0.28);
      const center0 = [rootX + normal[0] * curve0, t0 * height, rootZ + normal[2] * curve0];
      const center1 = [rootX + normal[0] * curve1, t1 * height, rootZ + normal[2] * curve1];
      appendQuad(
        buffers,
        [center0[0] - sideX * width0, center0[1], center0[2] - sideZ * width0],
        [center0[0] + sideX * width0, center0[1], center0[2] + sideZ * width0],
        [center1[0] + sideX * width1, center1[1], center1[2] + sideZ * width1],
        [center1[0] - sideX * width1, center1[1], center1[2] - sideZ * width1],
        normal,
        t0,
        t1,
      );
    }
  }
  return finishGeometry(buffers);
}

const FLOWING_GRASS_STYLES = [
  {
    blades: 5,
    segments: 2,
    width: .034,
    spread: .24,
    minHeight: .38,
    heightRange: .22,
    minReach: .4,
    reachRange: .35,
    drop: .7,
    fan: .78,
    curl: .18,
    crossEvery: 3,
    crossTurn: .95,
  },
  {
    blades: 10,
    segments: 5,
    width: .032,
    spread: .27,
    minHeight: .7,
    heightRange: .44,
    minReach: .5,
    reachRange: .34,
    drop: .68,
    fan: .4,
    curl: .18,
    crossEvery: 5,
    crossTurn: 1.02,
  },
  {
    blades: 8,
    segments: 4,
    width: .037,
    spread: .3,
    minHeight: .52,
    heightRange: .36,
    minReach: .62,
    reachRange: .36,
    drop: .82,
    fan: .62,
    curl: .23,
    crossEvery: 4,
    crossTurn: 1.18,
  },
];

function makeFlowingGrassGeometry(archetype = 0) {
  const buffers = makeBuffers();
  const style = FLOWING_GRASS_STYLES[archetype % FLOWING_GRASS_STYLES.length];

  for (let blade = 0; blade < style.blades; blade += 1) {
    const variation = .5 + .5 * Math.sin(blade * 4.73 + archetype * 1.31);
    let directionAngle = Math.sin(blade * 3.17 + archetype * .83) * style.fan;
    if (blade > 0 && blade % style.crossEvery === 0) {
      directionAngle += (blade % 2 === 0 ? 1 : -1) * style.crossTurn;
    }
    const dirX = Math.sin(directionAngle);
    const dirZ = Math.cos(directionAngle);
    const sideX = -dirZ;
    const sideZ = dirX;
    const rootRadius = style.spread * Math.sqrt((blade + .32) / style.blades);
    const rootAngle = blade * 2.399963 + archetype * .47;
    const rootX = Math.cos(rootAngle) * rootRadius;
    const rootZ = Math.sin(rootAngle) * rootRadius;
    const height = style.minHeight + style.heightRange * variation;
    const reach = style.minReach
      + style.reachRange * (.5 + .5 * Math.sin(blade * 2.11 + archetype * 1.7));
    const drop = style.drop * (.78 + variation * .32);
    const curlSign = blade % 2 === 0 ? 1 : -1;
    const bladeWidth = style.width * (.74 + variation * .38);

    const centerAt = (t) => {
      const arc = t * t * (3 - 2 * t);
      const sideways = Math.sin(t * Math.PI) * style.curl * curlSign
        * (.65 + variation * .45);
      return [
        rootX + dirX * reach * arc + sideX * sideways,
        height * (t - drop * Math.pow(t, 2.35)),
        rootZ + dirZ * reach * arc + sideZ * sideways,
      ];
    };

    for (let segment = 0; segment < style.segments; segment += 1) {
      const t0 = segment / style.segments;
      const t1 = (segment + 1) / style.segments;
      const center0 = centerAt(t0);
      const center1 = centerAt(t1);
      const tangent = [
        center1[0] - center0[0],
        center1[1] - center0[1],
        center1[2] - center0[2],
      ];
      let normal = [
        -sideZ * tangent[1],
        sideZ * tangent[0] - sideX * tangent[2],
        sideX * tangent[1],
      ];
      const normalLength = Math.hypot(normal[0], normal[1], normal[2]) || 1;
      normal = normal.map((component) => component / normalLength);
      const width0 = bladeWidth * (1 - .9 * t0);
      const width1 = bladeWidth * (1 - .9 * t1);
      appendQuad(
        buffers,
        [center0[0] - sideX * width0, center0[1], center0[2] - sideZ * width0],
        [center0[0] + sideX * width0, center0[1], center0[2] + sideZ * width0],
        [center1[0] + sideX * width1, center1[1], center1[2] + sideZ * width1],
        [center1[0] - sideX * width1, center1[1], center1[2] - sideZ * width1],
        normal,
        t0,
        t1,
      );
    }
  }
  return finishGeometry(buffers);
}

function makeFernClumpGeometry() {
  const buffers = makeBuffers();
  const frondCount = 7;
  for (let frond = 0; frond < frondCount; frond += 1) {
    const angle = frond * 2.399963 + Math.sin(frond * 1.71) * .24;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    const sideX = -dirZ;
    const sideZ = dirX;
    const height = .5 + .31 * (.5 + .5 * Math.sin(frond * 3.13 + .4));
    const reach = .11 + .24 * (.5 + .5 * Math.sin(frond * 2.37 + 1.1));
    const halfWidth = .2 + .12 * (.5 + .5 * Math.sin(frond * 4.17));
    const rootRadius = .025 + frond * .005;
    const root = [dirX * rootRadius, .012, dirZ * rootRadius];
    const top = [root[0] + dirX * reach, height, root[2] + dirZ * reach];
    const tangent = [top[0] - root[0], top[1] - root[1], top[2] - root[2]];
    let normal = [
      -sideZ * tangent[1],
      sideZ * tangent[0] - sideX * tangent[2],
      sideX * tangent[1],
    ];
    const normalLength = Math.hypot(normal[0], normal[1], normal[2]) || 1;
    normal = normal.map((component) => component / normalLength);
    appendTexturedQuad(
      buffers,
      [root[0] - sideX * halfWidth, root[1], root[2] - sideZ * halfWidth],
      [root[0] + sideX * halfWidth, root[1], root[2] + sideZ * halfWidth],
      [top[0] + sideX * halfWidth, top[1], top[2] + sideZ * halfWidth],
      [top[0] - sideX * halfWidth, top[1], top[2] - sideZ * halfWidth],
      normal,
      .08,
      1,
    );
  }
  return finishGeometry(buffers);
}

function makeLeafLitterPatchGeometry() {
  const buffers = makeBuffers();
  for (let leaf = 0; leaf < 5; leaf += 1) {
    const centerAngle = leaf * 2.399963 + .37;
    const radius = .08 + .055 * leaf;
    const center = [Math.cos(centerAngle) * radius, .006 + leaf * .001, Math.sin(centerAngle) * radius];
    const angle = leaf * 1.73 + .24;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    const sideX = -dirZ;
    const sideZ = dirX;
    const length = .12 + .045 * (.5 + .5 * Math.sin(leaf * 2.63));
    const width = .036 + .018 * (.5 + .5 * Math.sin(leaf * 4.11));
    const back = [center[0] - dirX * length * .42, center[1], center[2] - dirZ * length * .42];
    const front = [center[0] + dirX * length * .58, center[1] + .004, center[2] + dirZ * length * .58];
    const left = [center[0] + sideX * width, center[1] + .008, center[2] + sideZ * width];
    const right = [center[0] - sideX * width, center[1], center[2] - sideZ * width];
    appendTriangle(buffers, back, right, front, 0);
    appendTriangle(buffers, back, front, left, 0);
  }

  const twigAngle = 1.08;
  const twigDir = [Math.cos(twigAngle), Math.sin(twigAngle)];
  const twigSide = [-twigDir[1], twigDir[0]];
  appendQuad(
    buffers,
    [-twigDir[0] * .22 - twigSide[0] * .009, .011, -twigDir[1] * .22 - twigSide[1] * .009],
    [-twigDir[0] * .22 + twigSide[0] * .009, .011, -twigDir[1] * .22 + twigSide[1] * .009],
    [twigDir[0] * .22 + twigSide[0] * .005, .014, twigDir[1] * .22 + twigSide[1] * .005],
    [twigDir[0] * .22 - twigSide[0] * .005, .014, twigDir[1] * .22 - twigSide[1] * .005],
    [0, 1, 0],
    0,
    0,
  );
  return finishGeometry(buffers);
}

function makeFlowerClumpGeometry() {
  const buffers = makeBuffers(true);
  const heads = [
    { x: -0.11, z: 0.015, y: 0.73, rotation: 0.22, size: 1, petals: 7, segments: 2, stamens: 5 },
    { x: 0.115, z: -0.06, y: 0.61, rotation: 0.73, size: 0.84, petals: 7, segments: 2, stamens: 5 },
    // A low, simpler bloom closes gaps between instances without turning the
    // foreground into uniformly large starbursts.
    { x: 0.015, z: 0.14, y: 0.48, rotation: 1.41, size: 0.58, petals: 5, segments: 1, stamens: 3 },
    { x: -0.255, z: -0.14, y: 0.54, rotation: 2.08, size: 0.55, petals: 5, segments: 1, stamens: 2 },
    { x: 0.245, z: 0.17, y: 0.46, rotation: 2.77, size: 0.5, petals: 5, segments: 1, stamens: 2 },
  ];

  for (const head of heads) {
    for (let plane = 0; plane < 1; plane += 1) {
      const angle = plane * Math.PI * 0.5 + head.rotation;
      const sideX = Math.cos(angle) * 0.008;
      const sideZ = Math.sin(angle) * 0.008;
      const normal = [-Math.sin(angle), 0, Math.cos(angle)];
      appendQuad(
        buffers,
        [-sideX, 0, -sideZ],
        [sideX, 0, sideZ],
        [head.x + sideX, head.y, head.z + sideZ],
        [head.x - sideX, head.y, head.z - sideZ],
        normal,
        0,
        0.9,
        0,
      );
    }

    for (let petal = 0; petal < head.petals; petal += 1) {
      const angle = head.rotation + (petal / head.petals) * TAU;
      const radialX = Math.cos(angle);
      const radialZ = Math.sin(angle);
      const sideX = -radialZ;
      const sideZ = radialX;
      const petalLength = head.size * (0.235 + 0.034 * Math.sin(petal * 2.31 + head.rotation));

      for (let segment = 0; segment < head.segments; segment += 1) {
        const t0 = segment / head.segments;
        const t1 = (segment + 1) / head.segments;
        const radius0 = petalLength * t0;
        const radius1 = petalLength * t1;
        // A narrow rise and hooked fall gives the petals the recurved profile
        // that distinguishes higanbana from broad maple-like stars.
        const y0 = head.y + head.size * (Math.sin(t0 * Math.PI) * 0.052 - t0 * t0 * 0.092);
        const y1 = head.y + head.size * (Math.sin(t1 * Math.PI) * 0.052 - t1 * t1 * 0.092);
        const width0 = head.size * (0.0025 + Math.sin(t0 * Math.PI) * 0.015);
        const width1 = head.size * (0.0025 + Math.sin(t1 * Math.PI) * 0.015);
        const center0 = [head.x + radialX * radius0, y0, head.z + radialZ * radius0];
        const center1 = [head.x + radialX * radius1, y1, head.z + radialZ * radius1];
        appendQuad(
          buffers,
          [center0[0] - sideX * width0, center0[1], center0[2] - sideZ * width0],
          [center0[0] + sideX * width0, center0[1], center0[2] + sideZ * width0],
          [center1[0] + sideX * width1, center1[1], center1[2] + sideZ * width1],
          [center1[0] - sideX * width1, center1[1], center1[2] - sideZ * width1],
          [0, 1, 0],
          0.88 + t0 * 0.12,
          0.88 + t1 * 0.12,
          1,
        );
      }
    }

    // Hair-fine arcing stamens extend beyond the recurved petals.
    for (let stamen = 0; stamen < head.stamens; stamen += 1) {
      const angle = head.rotation + (stamen / head.stamens) * TAU + 0.31;
      const radialX = Math.cos(angle);
      const radialZ = Math.sin(angle);
      const sideX = -radialZ * 0.0024 * head.size;
      const sideZ = radialX * 0.0024 * head.size;
      const reach = 0.315 * head.size;
      const end = [
        head.x + radialX * reach,
        head.y + 0.055 * head.size,
        head.z + radialZ * reach,
      ];
      appendQuad(
        buffers,
        [head.x - sideX, head.y + 0.015, head.z - sideZ],
        [head.x + sideX, head.y + 0.015, head.z + sideZ],
        [end[0] + sideX * 0.24, end[1], end[2] + sideZ * 0.24],
        [end[0] - sideX * 0.24, end[1], end[2] - sideZ * 0.24],
        [0, 1, 0],
        0.94,
        1,
        2,
      );
    }
  }

  return finishGeometry(buffers);
}

const BAMBOO_ARCHETYPES = [
  { nodeCount: 7, leanX: 1.02, leanZ: -.46, curveX: .5, curveZ: .36, phase: .35 },
  { nodeCount: 8, leanX: -.58, leanZ: .92, curveX: .62, curveZ: .42, phase: 1.7 },
  { nodeCount: 6, leanX: 1.18, leanZ: .5, curveX: .42, curveZ: .58, phase: 3.15 },
];

function bambooAxisAt(archetype, t) {
  const config = BAMBOO_ARCHETYPES[archetype % BAMBOO_ARCHETYPES.length];
  const eased = t * t * (3 - 2 * t);
  const primary = Math.sin(t * Math.PI * 1.18 + config.phase) - Math.sin(config.phase);
  const secondary = Math.sin(t * Math.PI * 1.83 + config.phase * .61)
    - Math.sin(config.phase * .61);
  return [
    config.leanX * eased + primary * config.curveX * t,
    config.leanZ * eased + secondary * config.curveZ * t,
  ];
}

function makeBambooStalkGeometry(archetype = 0) {
  const buffers = makeBuffers();
  const config = BAMBOO_ARCHETYPES[archetype % BAMBOO_ARCHETYPES.length];
  const radialSegments = 8;
  const heightSegments = 18;
  const baseRadius = .076 + archetype * .003;

  for (let ySegment = 0; ySegment < heightSegments; ySegment += 1) {
    const t0 = ySegment / heightSegments;
    const t1 = (ySegment + 1) / heightSegments;
    const center0 = bambooAxisAt(archetype, t0);
    const center1 = bambooAxisAt(archetype, t1);
    const r0 = baseRadius * (1 - .23 * t0);
    const r1 = baseRadius * (1 - .23 * t1);
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const a0 = (radial / radialSegments) * TAU;
      const a1 = ((radial + 1) / radialSegments) * TAU;
      appendQuad(
        buffers,
        [center0[0] + Math.cos(a0) * r0, t0, center0[1] + Math.sin(a0) * r0],
        [center0[0] + Math.cos(a1) * r0, t0, center0[1] + Math.sin(a1) * r0],
        [center1[0] + Math.cos(a1) * r1, t1, center1[1] + Math.sin(a1) * r1],
        [center1[0] + Math.cos(a0) * r1, t1, center1[1] + Math.sin(a0) * r1],
        [Math.cos((a0 + a1) * .5), .055, Math.sin((a0 + a1) * .5)],
        t0,
        t1,
      );
    }
  }

  // Separate collars make the segmented culm readable at walking distance;
  // they replace the old identical sine-wave bulges with true node rings.
  for (let node = 1; node < config.nodeCount; node += 1) {
    const t = node / config.nodeCount + Math.sin(node * 2.17 + config.phase) * .004;
    const t0 = t - .0024;
    const t1 = t + .0024;
    const center0 = bambooAxisAt(archetype, t0);
    const center1 = bambooAxisAt(archetype, t1);
    const collarRadius = baseRadius * (1 - .23 * t) * 1.24;
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const a0 = (radial / radialSegments) * TAU;
      const a1 = ((radial + 1) / radialSegments) * TAU;
      appendQuad(
        buffers,
        [center0[0] + Math.cos(a0) * collarRadius, t0, center0[1] + Math.sin(a0) * collarRadius],
        [center0[0] + Math.cos(a1) * collarRadius, t0, center0[1] + Math.sin(a1) * collarRadius],
        [center1[0] + Math.cos(a1) * collarRadius, t1, center1[1] + Math.sin(a1) * collarRadius],
        [center1[0] + Math.cos(a0) * collarRadius, t1, center1[1] + Math.sin(a0) * collarRadius],
        [Math.cos((a0 + a1) * .5), .08, Math.sin((a0 + a1) * .5)],
        t0,
        t1,
      );
    }
  }
  return finishGeometry(buffers);
}

function appendBambooFrondCard(
  buffers,
  root,
  angle,
  reach,
  verticalHalfHeight,
  lateralHalfWidth,
  droop,
  flex,
  rolled,
) {
  const dirX = Math.cos(angle);
  const dirZ = Math.sin(angle);
  const sideX = -dirZ;
  const sideZ = dirX;
  const end = [
    root[0] + dirX * reach,
    root[1] - droop,
    root[2] + dirZ * reach,
  ];
  const widthVector = rolled
    ? [sideX * lateralHalfWidth, verticalHalfHeight * .32, sideZ * lateralHalfWidth]
    : [sideX * lateralHalfWidth * .12, verticalHalfHeight, sideZ * lateralHalfWidth * .12];
  const tangent = [dirX * reach, -droop, dirZ * reach];
  let normal = [
    tangent[1] * widthVector[2] - tangent[2] * widthVector[1],
    tangent[2] * widthVector[0] - tangent[0] * widthVector[2],
    tangent[0] * widthVector[1] - tangent[1] * widthVector[0],
  ];
  const normalLength = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  normal = normal.map((component) => component / normalLength);
  appendTexturedQuad(
    buffers,
    [root[0] - widthVector[0], root[1] - widthVector[1], root[2] - widthVector[2]],
    [end[0] - widthVector[0], end[1] - widthVector[1], end[2] - widthVector[2]],
    [end[0] + widthVector[0], end[1] + widthVector[1], end[2] + widthVector[2]],
    [root[0] + widthVector[0], root[1] + widthVector[1], root[2] + widthVector[2]],
    normal,
    flex,
    Math.min(1, flex + .18),
  );
}

function makeBambooLeafGeometry(archetype = 0) {
  const buffers = makeBuffers();
  const variants = [
    { tiers: 7, baseY: .38, topY: .975, reach: 1.82, phase: .2 },
    { tiers: 6, baseY: .44, topY: .99, reach: 2.02, phase: 1.45 },
    { tiers: 8, baseY: .34, topY: .955, reach: 1.66, phase: 2.8 },
  ];
  const config = variants[archetype % variants.length];

  for (let tier = 0; tier < config.tiers; tier += 1) {
    const level = tier / Math.max(1, config.tiers - 1);
    const y = config.baseY
      + level * (config.topY - config.baseY)
      + Math.sin(tier * 2.31 + config.phase) * .006;
    const axis = bambooAxisAt(archetype, y);
    const sprayCount = 1
      + (((tier + archetype) % 3 === 0) ? 1 : 0)
      + (tier === config.tiers - 1 ? 1 : 0);

    for (let spray = 0; spray < sprayCount; spray += 1) {
      const angle = tier * 2.399963
        + spray * (TAU / sprayCount)
        + config.phase
        + Math.sin(tier * 1.71 + spray * 2.23) * .19;
      const dirX = Math.cos(angle);
      const dirZ = Math.sin(angle);
      const reach = config.reach
        * (.78 + .16 * Math.sin(tier * 2.07 + spray * 1.31))
        * (1.04 - level * .22);
      const flex = .54 + level * .38;
      const root = [
        axis[0] + dirX * .02,
        y + Math.sin(tier * 1.3 + spray) * .004,
        axis[1] + dirZ * .02,
      ];
      const halfHeight = .052 + .009 * ((tier + archetype) % 3);
      const halfWidth = .13 + .018 * ((tier + spray + archetype) % 3);
      const droop = .012 + .004 * ((tier + spray) % 3);
      appendBambooFrondCard(
        buffers,
        root,
        angle,
        reach,
        halfHeight,
        halfWidth,
        droop,
        flex,
        false,
      );
      appendBambooFrondCard(
        buffers,
        root,
        angle + .035,
        reach * .96,
        halfHeight * .92,
        halfWidth * 1.08,
        droop * 1.18,
        Math.min(1, flex + .025),
        true,
      );
    }
  }
  return finishGeometry(buffers);
}

function appendTube(buffers, start, end, radius0, radius1, flex0, flex1, radialSegments = 6) {
  let ax = end[0] - start[0];
  let ay = end[1] - start[1];
  let az = end[2] - start[2];
  const axisLength = Math.hypot(ax, ay, az) || 1;
  ax /= axisLength;
  ay /= axisLength;
  az /= axisLength;

  const helper = Math.abs(ay) < 0.92 ? [0, 1, 0] : [1, 0, 0];
  let ux = ay * helper[2] - az * helper[1];
  let uy = az * helper[0] - ax * helper[2];
  let uz = ax * helper[1] - ay * helper[0];
  const uLength = Math.hypot(ux, uy, uz) || 1;
  ux /= uLength;
  uy /= uLength;
  uz /= uLength;
  const vx = ay * uz - az * uy;
  const vy = az * ux - ax * uz;
  const vz = ax * uy - ay * ux;

  for (let radial = 0; radial < radialSegments; radial += 1) {
    const a0 = (radial / radialSegments) * TAU;
    const a1 = ((radial + 1) / radialSegments) * TAU;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const n0 = [ux * c0 + vx * s0, uy * c0 + vy * s0, uz * c0 + vz * s0];
    const n1 = [ux * c1 + vx * s1, uy * c1 + vy * s1, uz * c1 + vz * s1];
    appendQuad(
      buffers,
      [start[0] + n0[0] * radius0, start[1] + n0[1] * radius0, start[2] + n0[2] * radius0],
      [start[0] + n1[0] * radius0, start[1] + n1[1] * radius0, start[2] + n1[2] * radius0],
      [end[0] + n1[0] * radius1, end[1] + n1[1] * radius1, end[2] + n1[2] * radius1],
      [end[0] + n0[0] * radius1, end[1] + n0[1] * radius1, end[2] + n0[2] * radius1],
      [(n0[0] + n1[0]) * 0.5, (n0[1] + n1[1]) * 0.5, (n0[2] + n1[2]) * 0.5],
      flex0,
      flex1,
    );
  }
}

function makeBroadleafTrunkGeometry(archetype = 0) {
  const buffers = makeBuffers();
  const variants = [
    [
      [[0, 0, 0], [0.015, 0.72, 0], 0.07, 0.037, 0, 0.55, 7],
      [[0.015, 0.7, 0], [0.035, 1, -0.015], 0.038, 0.015, 0.55, 0.9, 6],
      [[0.01, 0.45, 0], [0.43, 0.76, 0.12], 0.029, 0.009, 0.34, 0.74, 6],
      [[0, 0.52, 0], [-0.39, 0.81, -0.16], 0.027, 0.008, 0.4, 0.78, 6],
      [[0.02, 0.61, -0.005], [0.18, 0.9, -0.38], 0.022, 0.007, 0.48, 0.84, 6],
      [[0.015, 0.57, 0.005], [-0.16, 0.84, 0.36], 0.021, 0.007, 0.44, 0.81, 6],
    ],
    [
      [[0, 0, 0], [-0.025, 0.7, 0.015], 0.064, 0.034, 0, 0.56, 7],
      [[-0.025, 0.68, 0.015], [-0.1, 1.04, 0.055], 0.035, 0.012, 0.54, 0.94, 6],
      [[-0.015, 0.49, 0.01], [0.29, 0.84, 0.13], 0.026, 0.008, 0.38, 0.8, 6],
      [[-0.035, 0.57, 0.02], [-0.31, 0.91, -0.13], 0.024, 0.007, 0.44, 0.86, 6],
      [[-0.05, 0.66, 0.02], [0.13, 0.98, -0.27], 0.02, 0.006, 0.51, 0.91, 5],
      [[-0.055, 0.63, 0.03], [-0.2, 0.93, 0.29], 0.019, 0.006, 0.49, 0.89, 5],
    ],
    [
      [[0, 0, 0], [0.055, 0.67, -0.015], 0.074, 0.04, 0, 0.53, 7],
      [[0.055, 0.65, -0.015], [0.23, 0.99, -0.055], 0.041, 0.014, 0.52, 0.91, 6],
      [[0.035, 0.43, 0], [0.5, 0.7, 0.11], 0.031, 0.009, 0.33, 0.69, 6],
      [[0.08, 0.51, -0.01], [0.58, 0.82, -0.19], 0.027, 0.008, 0.4, 0.79, 6],
      [[0.13, 0.61, -0.025], [0.62, 0.92, 0.18], 0.024, 0.007, 0.47, 0.87, 6],
      [[0.12, 0.58, 0.005], [-0.22, 0.82, 0.29], 0.021, 0.006, 0.45, 0.8, 5],
      [[0.19, 0.71, -0.035], [0.42, 1.0, -0.3], 0.018, 0.005, 0.55, 0.92, 5],
    ],
  ];
  for (const args of variants[archetype % variants.length]) appendTube(buffers, ...args);
  return finishGeometry(buffers);
}

function appendOctahedron(buffers, center, rx, ry, rz, flex) {
  const top = [center[0], center[1] + ry, center[2]];
  const bottom = [center[0], center[1] - ry, center[2]];
  const east = [center[0] + rx, center[1], center[2]];
  const west = [center[0] - rx, center[1], center[2]];
  const north = [center[0], center[1], center[2] - rz];
  const south = [center[0], center[1], center[2] + rz];
  appendTriangle(buffers, top, east, north, flex);
  appendTriangle(buffers, top, south, east, flex);
  appendTriangle(buffers, top, west, south, flex);
  appendTriangle(buffers, top, north, west, flex);
  appendTriangle(buffers, bottom, north, east, flex);
  appendTriangle(buffers, bottom, east, south, flex);
  appendTriangle(buffers, bottom, south, west, flex);
  appendTriangle(buffers, bottom, west, north, flex);
}

function makeBroadleafCanopyGeometry(archetype = 0) {
  const buffers = makeBuffers();
  const variants = [
    [
      [0.02, 0.92, -0.02, 0.29, 0.095, 0.24],
      [0.42, 0.755, 0.12, 0.27, 0.072, 0.19],
      [-0.39, 0.805, -0.16, 0.23, 0.12, 0.28],
      [0.18, 0.91, -0.38, 0.2, 0.075, 0.3],
      [-0.16, 0.855, 0.36, 0.3, 0.078, 0.2],
      [0.3, 0.84, -0.08, 0.19, 0.12, 0.18],
      [-0.24, 0.93, 0.075, 0.25, 0.07, 0.27],
      [0.08, 1.025, 0.09, 0.19, 0.095, 0.17],
      [-0.03, 0.76, -0.29, 0.16, 0.065, 0.21],
    ],
    [
      [-0.08, 0.99, 0.04, 0.22, 0.13, 0.2],
      [0.27, 0.83, 0.12, 0.21, 0.1, 0.18],
      [-0.3, 0.89, -0.1, 0.2, 0.145, 0.23],
      [0.1, 0.96, -0.27, 0.18, 0.105, 0.22],
      [-0.16, 0.94, 0.28, 0.2, 0.12, 0.2],
      [0.02, 1.09, -0.04, 0.17, 0.12, 0.16],
      [-0.04, 0.77, 0.02, 0.18, 0.09, 0.17],
    ],
    [
      [0.25, 0.92, -0.04, 0.3, 0.07, 0.24],
      [0.53, 0.79, 0.1, 0.3, 0.062, 0.2],
      [0.58, 0.9, -0.2, 0.27, 0.072, 0.25],
      [0.38, 1.0, 0.2, 0.28, 0.075, 0.22],
      [0.1, 0.82, 0.31, 0.25, 0.065, 0.21],
      [-0.2, 0.84, 0.27, 0.2, 0.09, 0.2],
      [0.18, 0.75, -0.28, 0.2, 0.065, 0.24],
      [0.68, 0.86, 0.04, 0.22, 0.06, 0.19],
    ],
  ];
  const clumps = variants[archetype % variants.length];
  for (const [x, y, z, rx, ry, rz] of clumps) {
    appendOctahedron(buffers, [x, y, z], rx, ry, rz, y);
  }
  return finishGeometry(buffers);
}

function buildInstanceData(targetCount, random, sample, maxAttemptsFactor = 30) {
  const offsets = new Float32Array(targetCount * 3);
  const scales = new Float32Array(targetCount * 2);
  const yaws = new Float32Array(targetCount);
  const tints = new Float32Array(targetCount);
  const phases = new Float32Array(targetCount);
  let count = 0;
  let attempts = 0;
  const maxAttempts = Math.max(targetCount * maxAttemptsFactor, 1000);

  while (count < targetCount && attempts < maxAttempts) {
    attempts += 1;
    const item = sample(random, count, attempts);
    if (!item) continue;
    const offsetIndex = count * 3;
    const scaleIndex = count * 2;
    offsets[offsetIndex] = item.x;
    offsets[offsetIndex + 1] = item.y;
    offsets[offsetIndex + 2] = item.z;
    scales[scaleIndex] = item.scaleX;
    scales[scaleIndex + 1] = item.scaleY;
    yaws[count] = item.yaw;
    tints[count] = item.tint;
    phases[count] = item.phase;
    count += 1;
  }

  return {
    count,
    offsets: offsets.subarray(0, count * 3),
    scales: scales.subarray(0, count * 2),
    yaws: yaws.subarray(0, count),
    tints: tints.subarray(0, count),
    phases: phases.subarray(0, count),
  };
}

function selectInstanceData(data, bucket, bucketCount) {
  const selected = [];
  for (let index = 0; index < data.count; index += 1) {
    const phaseBucket = Math.min(bucketCount - 1, Math.floor(data.phases[index] * bucketCount));
    if (phaseBucket === bucket) selected.push(index);
  }

  const count = selected.length;
  const offsets = new Float32Array(count * 3);
  const scales = new Float32Array(count * 2);
  const yaws = new Float32Array(count);
  const tints = new Float32Array(count);
  const phases = new Float32Array(count);

  selected.forEach((sourceIndex, targetIndex) => {
    offsets.set(data.offsets.subarray(sourceIndex * 3, sourceIndex * 3 + 3), targetIndex * 3);
    scales.set(data.scales.subarray(sourceIndex * 2, sourceIndex * 2 + 2), targetIndex * 2);
    yaws[targetIndex] = data.yaws[sourceIndex];
    tints[targetIndex] = data.tints[sourceIndex];
    phases[targetIndex] = data.phases[sourceIndex];
  });

  return { count, offsets, scales, yaws, tints, phases };
}

function scaleInstanceWidth(data, widthScale) {
  const scales = new Float32Array(data.scales);
  for (let index = 0; index < data.count; index += 1) {
    scales[index * 2] *= widthScale;
  }
  return { ...data, scales };
}

function makeInstancedGeometry(baseGeometry, data, boundingRadius = 180) {
  const geometry = new InstancedBufferGeometry();
  for (const [name, attribute] of Object.entries(baseGeometry.attributes)) {
    geometry.setAttribute(name, attribute);
  }
  geometry.setAttribute('aOffset', new InstancedBufferAttribute(data.offsets, 3));
  geometry.setAttribute('aScale', new InstancedBufferAttribute(data.scales, 2));
  geometry.setAttribute('aYaw', new InstancedBufferAttribute(data.yaws, 1));
  geometry.setAttribute('aTint', new InstancedBufferAttribute(data.tints, 1));
  geometry.setAttribute('aPhase', new InstancedBufferAttribute(data.phases, 1));
  geometry.instanceCount = data.count;
  geometry.boundingSphere = new Sphere(new Vector3(0, 4, 0), boundingRadius);
  return geometry;
}

// This field is deliberately shared verbatim by grass, flowers, bamboo,
// trees, and airborne debris. Large gust fronts are anchored in world space;
// per-instance phase is reserved for small flutter, so a wave reads as one
// event travelling through the whole biome instead of independent swaying.
const WIND_FIELD_GLSL = /* glsl */`
  vec3 sampleBiomeWind(vec2 worldXZ, float phase) {
    vec2 direction = normalize(uWindDirection + vec2(0.0001));
    vec2 across = vec2(-direction.y, direction.x);
    float alongWind = dot(worldXZ, direction);
    float crossWind = dot(worldXZ, across);
    float warpedFront = alongWind * 0.105 - uTime * 1.28
      + sin(crossWind * 0.035 + uTime * 0.19) * 1.35;
    float front = 0.5 + 0.5 * sin(warpedFront);
    float envelope = 0.5 + 0.5 * sin(
      alongWind * 0.043 - uTime * 0.47 + crossWind * 0.018
    );
    float gust = smoothstep(0.5, 0.88, front) * (0.42 + 0.58 * envelope);
    float flutter = sin(
      uTime * 3.8 + phase * 6.2831853 + alongWind * 0.31
    ) * 0.055;
    float eddy = sin(crossWind * 0.11 + uTime * 0.54 + alongWind * 0.019)
      * (0.05 + 0.09 * gust);
    vec2 windVector = direction * (0.16 + gust * 0.94 + flutter) + across * eddy;
    return vec3(windVector, gust);
  }
`;

const INSTANCED_VERTEX_SHADER = /* glsl */`
  precision highp float;
  attribute vec3 aOffset;
  attribute vec2 aScale;
  attribute float aYaw;
  attribute float aTint;
  attribute float aPhase;
  attribute float aFlex;

  uniform float uTime;
  uniform float uWindStrength;
  uniform vec2 uWindDirection;
  uniform vec3 uPlayerPos;
  uniform float uBendScale;
  uniform float uPlayerBend;
  uniform float uHardDistance;
  uniform float uShapeVariation;

  varying float vFlex;
  varying float vTint;
  varying float vVariation;
  varying float vFogDistance;
  varying vec2 vLeafUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vViewDirection;

  ${WIND_FIELD_GLSL}

  void main() {
    float c = cos(aYaw);
    float s = sin(aYaw);
    vec3 localPosition = position;
    float shapePhase = sin(aPhase * 6.2831853);
    localPosition.x += (aTint - 0.5) * uShapeVariation * localPosition.y;
    localPosition.z += shapePhase * uShapeVariation * 0.45 * localPosition.y;
    localPosition.xz *= aScale.x;
    localPosition.y *= aScale.y;
    localPosition.xz = mat2(c, -s, s, c) * localPosition.xz;

    vec3 worldPosition = localPosition + aOffset;
    float flex = clamp(aFlex, 0.0, 1.0);
    vec3 wind = sampleBiomeWind(aOffset.xz, aPhase);
    float bend = flex * flex * uBendScale * uWindStrength;
    worldPosition.xz += wind.xy * bend * aScale.y;

    vec2 playerDelta = worldPosition.xz - uPlayerPos.xz;
    float playerDistance = length(playerDelta);
    vec2 playerDirection = playerDelta / max(playerDistance, 0.001);
    float playerInfluence = (1.0 - smoothstep(0.22, 1.62, playerDistance))
      * flex * flex * uPlayerBend;
    worldPosition.xz += playerDirection * playerInfluence;
    worldPosition.y -= playerInfluence * 0.12;

    float instanceDistance = distance(cameraPosition.xz, aOffset.xz);
    if (instanceDistance > uHardDistance) worldPosition.y -= 10000.0;

    vec3 localNormal = normal;
    localNormal.xz /= max(aScale.x, 0.001);
    localNormal.y /= max(aScale.y, 0.001);
    localNormal.xz = mat2(c, -s, s, c) * localNormal.xz;
    vec3 worldNormal = normalize(mat3(modelMatrix) * localNormal);
    vFlex = flex;
    vTint = aTint;
    vVariation = fract(sin(dot(normal.xz, vec2(12.9898, 78.233)) + aPhase * 3.17) * 43758.5453);
    vLeafUv = uv;

    vec4 transformedWorld = modelMatrix * vec4(worldPosition, 1.0);
    vWorldPosition = transformedWorld.xyz;
    vWorldNormal = worldNormal;
    vViewDirection = cameraPosition - transformedWorld.xyz;
    vFogDistance = distance(cameraPosition, transformedWorld.xyz);
    gl_Position = projectionMatrix * viewMatrix * transformedWorld;
  }
`;

const FOLIAGE_FRAGMENT_SHADER = /* glsl */`
  precision highp float;
  uniform vec3 uBaseColor;
  uniform vec3 uLitColor;
  uniform vec3 uTipColor;
  uniform vec3 uFogColor;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uFogDensity;
  uniform float uFadeStart;
  uniform float uFadeEnd;
  uniform float uTransmissionStrength;
  uniform float uContactStrength;
  uniform float uAmbientStrength;

  varying float vFlex;
  varying float vTint;
  varying float vVariation;
  varying float vFogDistance;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vViewDirection;

  float ditherNoise(vec2 coordinate) {
    return fract(52.9829189 * fract(dot(coordinate, vec2(0.06711056, 0.00583715))));
  }

  void main() {
    float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, vFogDistance);
    if (fade < ditherNoise(gl_FragCoord.xy)) discard;

    vec3 normal = normalize(vWorldNormal);
    if (!gl_FrontFacing) normal = -normal;
    vec3 lightDirection = normalize(uSunDirection);
    vec3 viewDirection = normalize(vViewDirection);
    float facing = dot(normal, lightDirection);
    float frontLight = max(facing, 0.0);
    float wrappedLight = clamp((facing + 0.34) / 1.34, 0.0, 1.0);
    float backLight = pow(max(dot(-normal, lightDirection), 0.0), 1.35);
    float rim = pow(1.0 - abs(dot(normal, viewDirection)), 2.0);

    float pigmentMix = clamp(
      0.24 + wrappedLight * 0.53
        + (vTint - 0.5) * 0.21
        + (vVariation - 0.5) * 0.14,
      0.0,
      1.0
    );
    vec3 color = mix(uBaseColor, uLitColor, pigmentMix);
    float tipAmount = smoothstep(0.68, 1.0, vFlex)
      * (0.26 + wrappedLight * 0.34);
    color = mix(color, uTipColor, tipAmount);

    float rootContact = 1.0 - smoothstep(0.025, 0.58, vFlex);
    float contactShade = 1.0 - uContactStrength * rootContact
      * mix(1.0, 0.72, wrappedLight);
    color *= (uAmbientStrength + wrappedLight * 0.49 + frontLight * 0.16) * contactShade;

    float transmission = (backLight * 0.3 + rim * 0.045)
      * uTransmissionStrength * (0.22 + 0.78 * smoothstep(0.08, 0.9, vFlex));
    color += uSunColor * transmission;

    float fogAmount = 1.0 - exp(-uFogDensity * uFogDensity * vFogDistance * vFogDistance);
    vec3 warmFog = uFogColor * mix(0.94, 1.075, smoothstep(-2.0, 16.0, vWorldPosition.y));
    color = mix(color, warmFog, min(fogAmount, 0.96));
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const BAMBOO_FRAGMENT_SHADER = /* glsl */`
  precision highp float;
  uniform sampler2D uLeafMap;
  uniform vec3 uBaseColor;
  uniform vec3 uLitColor;
  uniform vec3 uTipColor;
  uniform vec3 uFogColor;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uFogDensity;
  uniform float uFadeStart;
  uniform float uFadeEnd;
  uniform float uTransmissionStrength;
  uniform float uTextureStrength;
  uniform float uSurfaceBrightness;

  varying float vFlex;
  varying float vTint;
  varying float vVariation;
  varying float vFogDistance;
  varying vec2 vLeafUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vViewDirection;

  float ditherNoise(vec2 coordinate) {
    return fract(52.9829189 * fract(dot(coordinate, vec2(0.06711056, 0.00583715))));
  }

  void main() {
    vec4 leaf = texture2D(uLeafMap, vLeafUv);
    float pixelNoise = ditherNoise(gl_FragCoord.xy + vLeafUv * 47.0);
    if (leaf.a < 0.34 + pixelNoise * 0.16) discard;

    float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, vFogDistance);
    if (fade < ditherNoise(gl_FragCoord.yx + 19.0)) discard;

    vec3 normal = normalize(vWorldNormal);
    if (!gl_FrontFacing) normal = -normal;
    vec3 lightDirection = normalize(uSunDirection);
    vec3 viewDirection = normalize(vViewDirection);
    float facing = dot(normal, lightDirection);
    float frontLight = max(facing, 0.0);
    float wrappedLight = clamp((facing + 0.46) / 1.46, 0.0, 1.0);
    float backLight = pow(max(dot(-normal, lightDirection), 0.0), 1.25);
    float rim = pow(1.0 - abs(dot(normal, viewDirection)), 1.8);

    float pigmentMix = clamp(
      0.34 + wrappedLight * 0.46 + (vTint - 0.5) * 0.18 + (vVariation - 0.5) * 0.1,
      0.0,
      1.0
    );
    vec3 paletteColor = mix(uBaseColor, uLitColor, pigmentMix);
    vec3 color = mix(paletteColor, leaf.rgb, uTextureStrength);
    color *= (0.49 + wrappedLight * 0.48 + frontLight * 0.12) * uSurfaceBrightness;
    color = mix(color, uTipColor, smoothstep(0.76, 1.0, vFlex) * 0.075);
    color += uSunColor * (backLight * 0.27 + rim * 0.055) * uTransmissionStrength;

    float fogAmount = 1.0 - exp(-uFogDensity * uFogDensity * vFogDistance * vFogDistance);
    vec3 warmFog = uFogColor * mix(0.94, 1.075, smoothstep(-2.0, 16.0, vWorldPosition.y));
    color = mix(color, warmFog, min(fogAmount, 0.96));
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const FLOWER_VERTEX_SHADER = /* glsl */`
  precision highp float;
  attribute vec3 aOffset;
  attribute vec2 aScale;
  attribute float aYaw;
  attribute float aTint;
  attribute float aPhase;
  attribute float aFlex;
  attribute float aPart;

  uniform float uTime;
  uniform float uWindStrength;
  uniform vec2 uWindDirection;
  uniform vec3 uPlayerPos;
  uniform float uHardDistance;

  varying float vFlex;
  varying float vTint;
  varying float vPart;
  varying float vFogDistance;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vViewDirection;

  ${WIND_FIELD_GLSL}

  void main() {
    float c = cos(aYaw);
    float s = sin(aYaw);
    vec3 localPosition = position;
    localPosition.xz *= aScale.x;
    localPosition.y *= aScale.y;
    localPosition.xz = mat2(c, -s, s, c) * localPosition.xz;
    vec3 worldPosition = localPosition + aOffset;

    float flex = clamp(aFlex, 0.0, 1.0);
    vec3 wind = sampleBiomeWind(aOffset.xz, aPhase);
    worldPosition.xz += wind.xy * flex * flex * uWindStrength * 0.31 * aScale.y;

    vec2 playerDelta = worldPosition.xz - uPlayerPos.xz;
    float playerDistance = length(playerDelta);
    float playerPush = (1.0 - smoothstep(0.2, 1.45, playerDistance)) * flex * flex;
    worldPosition.xz += playerDelta / max(playerDistance, 0.001) * playerPush * 0.58;
    worldPosition.y -= playerPush * 0.09;

    if (distance(cameraPosition.xz, aOffset.xz) > uHardDistance) worldPosition.y -= 10000.0;

    vec3 localNormal = normal;
    localNormal.xz /= max(aScale.x, 0.001);
    localNormal.y /= max(aScale.y, 0.001);
    localNormal.xz = mat2(c, -s, s, c) * localNormal.xz;
    vec3 worldNormal = normalize(mat3(modelMatrix) * localNormal);
    vFlex = flex;
    vTint = aTint;
    vPart = aPart;

    vec4 transformedWorld = modelMatrix * vec4(worldPosition, 1.0);
    vWorldPosition = transformedWorld.xyz;
    vWorldNormal = worldNormal;
    vViewDirection = cameraPosition - transformedWorld.xyz;
    vFogDistance = distance(cameraPosition, transformedWorld.xyz);
    gl_Position = projectionMatrix * viewMatrix * transformedWorld;
  }
`;

const FLOWER_FRAGMENT_SHADER = /* glsl */`
  precision highp float;
  uniform vec3 uStemColor;
  uniform vec3 uPetalColor;
  uniform vec3 uPetalDark;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirection;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uFadeStart;
  uniform float uFadeEnd;
  uniform float uTransmissionStrength;
  uniform float uContactStrength;

  varying float vFlex;
  varying float vTint;
  varying float vPart;
  varying float vFogDistance;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vViewDirection;

  float ditherNoise(vec2 coordinate) {
    return fract(52.9829189 * fract(dot(coordinate, vec2(0.06711056, 0.00583715))));
  }

  void main() {
    float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, vFogDistance);
    if (fade < ditherNoise(gl_FragCoord.xy)) discard;

    vec3 normal = normalize(vWorldNormal);
    if (!gl_FrontFacing) normal = -normal;
    vec3 lightDirection = normalize(uSunDirection);
    vec3 viewDirection = normalize(vViewDirection);
    float facing = dot(normal, lightDirection);
    float frontLight = max(facing, 0.0);
    float wrappedLight = clamp((facing + 0.38) / 1.38, 0.0, 1.0);
    float backLight = pow(max(dot(-normal, lightDirection), 0.0), 1.22);
    float rim = pow(1.0 - abs(dot(normal, viewDirection)), 2.0);

    vec3 petal = mix(
      uPetalDark,
      uPetalColor,
      clamp(0.28 + wrappedLight * 0.58 + vTint * 0.16, 0.0, 1.0)
    );
    bool isPetal = vPart > 0.5;
    vec3 color = isPetal
      ? petal * (0.52 + wrappedLight * 0.55 + frontLight * 0.12)
      : uStemColor * (0.38 + wrappedLight * 0.57);
    if (vPart > 1.5) color = mix(color, uSunColor, 0.12);

    float rootContact = (1.0 - smoothstep(0.025, 0.54, vFlex))
      * (isPetal ? 0.18 : 1.0);
    color *= 1.0 - uContactStrength * rootContact;
    float transmission = (backLight * 0.34 + rim * 0.055)
      * uTransmissionStrength * (isPetal ? 1.0 : 0.24);
    color += uSunColor * transmission;

    float fogAmount = 1.0 - exp(-uFogDensity * uFogDensity * vFogDistance * vFogDistance);
    vec3 warmFog = uFogColor * mix(0.95, 1.08, smoothstep(-2.0, 12.0, vWorldPosition.y));
    color = mix(color, warmFog, min(fogAmount, 0.96));
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function foliageMaterial(common, colors, options = {}) {
  return new ShaderMaterial({
    name: options.name ?? 'Biome foliage',
    uniforms: {
      ...common,
      uBaseColor: { value: colors.base },
      uLitColor: { value: colors.lit },
      uTipColor: { value: colors.tip },
      uBendScale: { value: options.bendScale ?? 0.24 },
      uPlayerBend: { value: options.playerBend ?? 0.62 },
      uHardDistance: { value: options.hardDistance ?? 125 },
      uShapeVariation: { value: options.shapeVariation ?? 0 },
      uFadeStart: { value: options.fadeStart ?? 68 },
      uFadeEnd: { value: options.fadeEnd ?? 116 },
      uTransmissionStrength: { value: options.transmissionStrength ?? 0.3 },
      uContactStrength: { value: options.contactStrength ?? 0.38 },
      uAmbientStrength: { value: options.ambientStrength ?? 0.43 },
    },
    vertexShader: INSTANCED_VERTEX_SHADER,
    fragmentShader: FOLIAGE_FRAGMENT_SHADER,
    side: DoubleSide,
    depthWrite: true,
    transparent: false,
    toneMapped: true,
  });
}

function makeCutoutFoliageMaterial(common, colors, leafMap, options = {}) {
  return new ShaderMaterial({
    name: options.name ?? 'Cutout foliage',
    uniforms: {
      ...common,
      uLeafMap: { value: leafMap },
      uBaseColor: { value: colors.base },
      uLitColor: { value: colors.lit },
      uTipColor: { value: colors.tip },
      uBendScale: { value: options.bendScale ?? 0.021 },
      uPlayerBend: { value: options.playerBend ?? 0.02 },
      uHardDistance: { value: options.hardDistance ?? 190 },
      uShapeVariation: { value: options.shapeVariation ?? 0.18 },
      uFadeStart: { value: options.fadeStart ?? 150 },
      uFadeEnd: { value: options.fadeEnd ?? 188 },
      uTransmissionStrength: { value: options.transmissionStrength ?? 0.62 },
      uTextureStrength: { value: options.textureStrength ?? .74 },
      uSurfaceBrightness: { value: options.surfaceBrightness ?? 1 },
    },
    vertexShader: INSTANCED_VERTEX_SHADER,
    fragmentShader: BAMBOO_FRAGMENT_SHADER,
    side: DoubleSide,
    depthWrite: true,
    transparent: false,
    toneMapped: true,
  });
}

function makeFlowerMaterial(common, palette) {
  return new ShaderMaterial({
    name: 'Crimson spider lilies',
    uniforms: {
      ...common,
      uStemColor: { value: paletteColor(palette, 'grassShadow', 0x564629) },
      uPetalColor: { value: paletteColor(palette, 'crimson', 0xd32225) },
      uPetalDark: { value: paletteColor(palette, 'crimsonDark', 0x85151d) },
      uSunColor: { value: paletteColor(palette, 'sun', 0xffc166) },
      uHardDistance: { value: 142 },
      uFadeStart: { value: 84 },
      uFadeEnd: { value: 136 },
      uTransmissionStrength: { value: 0.58 },
      uContactStrength: { value: 0.52 },
    },
    vertexShader: FLOWER_VERTEX_SHADER,
    fragmentShader: FLOWER_FRAGMENT_SHADER,
    side: DoubleSide,
    depthWrite: true,
    transparent: false,
    toneMapped: true,
  });
}

function makeParticleField(common, palette, count, random) {
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const speeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  const kinds = new Float32Array(count);

  for (let index = 0; index < count; index += 1) {
    const i3 = index * 3;
    positions[i3] = (random() * 2 - 1) * 48;
    positions[i3 + 1] = -1.4 + random() * 8.5;
    positions[i3 + 2] = (random() * 2 - 1) * 48;
    phases[index] = random();
    speeds[index] = 0.5 + random() * 0.8;
    sizes[index] = 0.2 + random() * 0.38;
    kinds[index] = random() < 0.58 ? 0 : 1;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aPhase', new BufferAttribute(phases, 1));
  geometry.setAttribute('aSpeed', new BufferAttribute(speeds, 1));
  geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
  geometry.setAttribute('aKind', new BufferAttribute(kinds, 1));

  const material = new ShaderMaterial({
    name: 'Windborne petals and leaves',
    uniforms: {
      ...common,
      uPetalColor: { value: paletteColor(palette, 'crimson', 0xd32225) },
      uLeafColor: { value: paletteColor(palette, 'grassTip', 0xe0b86a) },
    },
    vertexShader: /* glsl */`
      precision highp float;
      attribute float aPhase;
      attribute float aSpeed;
      attribute float aSize;
      attribute float aKind;
      uniform float uTime;
      uniform float uWindStrength;
      uniform vec2 uWindDirection;
      uniform vec3 uPlayerPos;
      varying float vKind;
      varying float vAngle;
      varying float vAlpha;
      varying float vFogDistance;

      ${WIND_FIELD_GLSL}

      void main() {
        vec2 direction = normalize(uWindDirection + vec2(0.0001));
        vec2 across = vec2(-direction.y, direction.x);
        float cycle = fract(aPhase + uTime * (0.022 + aSpeed * 0.018));
        vec2 baseLocalXZ = position.xz
          + direction * (cycle * 84.0 - 42.0) * (0.55 + uWindStrength * 0.45);
        vec3 wind = sampleBiomeWind(uPlayerPos.xz + baseLocalXZ, aPhase);
        vec2 localXZ = baseLocalXZ
          + wind.xy * (1.15 + aSpeed * 1.55) * uWindStrength;
        localXZ += across * sin(cycle * 12.566 + aPhase * 17.0 + uTime)
          * (0.35 + aSpeed * 0.62) * (0.45 + wind.z);
        localXZ = mod(localXZ + vec2(48.0), vec2(96.0)) - vec2(48.0);
        float flutter = sin(uTime * (2.1 + aSpeed) + aPhase * 31.0);
        vec3 worldPosition = uPlayerPos + vec3(
          localXZ.x,
          position.y + sin(cycle * 3.1415926) * 3.2
            + flutter * 0.55 + wind.z * 0.42,
          localXZ.y
        );
        vec4 viewPosition = viewMatrix * vec4(worldPosition, 1.0);
        vFogDistance = length(viewPosition.xyz);
        vKind = aKind;
        vAngle = aPhase * 18.0 + uTime * (1.4 + aSpeed * 1.7);
        vAlpha = smoothstep(0.0, 0.08, cycle) * (1.0 - smoothstep(0.88, 1.0, cycle));
        gl_PointSize = clamp(aSize * 290.0 / max(1.0, -viewPosition.z), 1.0, 13.0);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform vec3 uPetalColor;
      uniform vec3 uLeafColor;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      varying float vKind;
      varying float vAngle;
      varying float vAlpha;
      varying float vFogDistance;

      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float c = cos(vAngle);
        float s = sin(vAngle);
        p = mat2(c, -s, s, c) * p;
        float shape = abs(p.x) * 1.55 + abs(p.y) * 0.72;
        float alpha = (1.0 - smoothstep(0.34, 0.5, shape)) * vAlpha * 0.88;
        if (alpha < 0.025) discard;
        vec3 color = mix(uPetalColor, uLeafColor, step(0.5, vKind));
        float fogAmount = 1.0 - exp(-uFogDensity * uFogDensity * vFogDistance * vFogDistance);
        color = mix(color, uFogColor, min(fogAmount, 0.9));
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    toneMapped: true,
  });

  const points = new Points(geometry, material);
  points.name = 'Windborne petals and leaves';
  points.frustumCulled = false;
  points.renderOrder = 4;
  return points;
}

function addLayer(root, name, baseGeometry, data, material, boundingRadius = 180) {
  const geometry = makeInstancedGeometry(baseGeometry, data, boundingRadius);
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  root.add(mesh);
  return mesh;
}

/**
 * Builds the biome's animated vegetation as a small number of instanced draw calls.
 * Placement and motion are deterministic. Original alpha-cutout bamboo and
 * fern fronds preserve complex silhouettes while the dominant floor remains
 * opaque procedural geometry.
 */
export function createVegetation(scene, {
  heightAt,
  pathX,
  riverZ,
  distanceToPath,
  distanceToRiver,
  palette,
  windUniforms,
  quality,
}) {
  const root = new Group();
  root.name = 'Procedural vegetation';
  scene.add(root);

  const density = qualityScale(quality);
  const random = mulberry32(SEED);
  const common = sharedUniforms(windUniforms, palette);
  const bambooFrondTexture = new TextureLoader().load('/assets/vegetation/bamboo-frond.png');
  bambooFrondTexture.colorSpace = SRGBColorSpace;
  bambooFrondTexture.anisotropy = 4;
  const fernTexture = new TextureLoader().load('/assets/vegetation/forest-fern.png');
  fernTexture.colorSpace = SRGBColorSpace;
  fernTexture.anisotropy = 4;

  const safeHeight = (x, z) => {
    const value = heightAt?.(x, z);
    return Number.isFinite(value) ? value : 0;
  };
  const pathDistance = (x, z) => {
    const value = distanceToPath
      ? distanceToPath(x, z)
      : x - (pathX?.(z) ?? 0);
    return Math.abs(Number.isFinite(value) ? value : 999);
  };
  const riverDistance = (x, z) => {
    const value = distanceToRiver
      ? distanceToRiver(x, z)
      : z - (riverZ?.(x) ?? -30);
    return Math.abs(Number.isFinite(value) ? value : 999);
  };

  // One authored-looking macro mask controls both lily density and the amount
  // of grass allowed through it. This preserves broad crimson islands instead
  // of interleaving equally tall red and gold noise everywhere.
  const flowerMassAt = (x, z) => {
    if (z < -59 || z > 61) return 0;
    const lobeA = Math.exp(-(((x + 37) / 68) ** 2 + ((z - 10) / 38) ** 2));
    const lobeB = Math.exp(-(((x - 35) / 62) ** 2 + ((z + 5) / 42) ** 2));
    const lobeC = Math.exp(-(((x + 2) / 78) ** 2 + ((z + 31) / 27) ** 2));
    const shape = Math.max(lobeA, lobeB, lobeC);
    const patchNoise = fbm(x * 0.044, z * 0.044, SEED + 911);
    const finerPatch = valueNoise(x * 0.13, z * 0.13, SEED + 2707);
    return clamp(shape * (0.28 + patchNoise * 0.84) * (0.66 + finerPatch * 0.4), 0, 0.96);
  };

  const forestFloorMaskAt = (x, z) => {
    const entryGrove = smoothstep(49, 91, z);
    const outerWoodland = smoothstep(48, 96, Math.abs(x));
    const southernWoodland = 1 - smoothstep(-76, -37, z);
    const canopyPatch = fbm(x * .041, z * .041, SEED + 6029);
    const habitat = Math.max(
      entryGrove * .96,
      outerWoodland * .72,
      southernWoodland * .54,
    );
    return clamp(habitat * (.58 + canopyPatch * .64), 0, 1);
  };

  const grassTarget = Math.round(22500 * density);
  const reedTarget = Math.round(1900 * density);
  const flowerTarget = Math.round(11200 * density);
  const forestSedgeTarget = Math.round(6000 * density);
  const meadowUnderstoryTarget = Math.round(10500 * density);
  const fernTarget = Math.round(1100 * density);
  const litterTarget = Math.round(4200 * density);
  const bambooTarget = Math.round(520 * Math.sqrt(density));
  const treeTarget = Math.round(54 * Math.sqrt(density));
  const particleTarget = Math.round(820 * Math.sqrt(density));

  const grassData = buildInstanceData(grassTarget, random, (rng) => {
    const x = (rng() * 2 - 1) * WORLD_EDGE;
    const z = (rng() * 2 - 1) * WORLD_EDGE;
    const edgeFade = 1 - smoothstep(98, 110, Math.max(Math.abs(x), Math.abs(z)));
    if (rng() > edgeFade) return null;
    const pathD = pathDistance(x, z);
    const riverD = riverDistance(x, z);
    if (pathD < 1.2 || riverD < 2.75) return null;

    const macro = fbm(x * 0.035, z * 0.035, SEED + 77);
    const flowerMass = flowerMassAt(x, z);
    const ridgeReduction = 1 - smoothstep(52, 83, z) * 0.48;
    const pathSoftEdge = smoothstep(1.2, 3.05, pathD);
    const riverSoftEdge = smoothstep(2.75, 7.5, riverD);
    const crimsonOpening = 1 - smoothstep(0.08, 0.9, flowerMass) * 0.42;
    const acceptance = (0.56 + macro * 0.5)
      * ridgeReduction
      * pathSoftEdge
      * riverSoftEdge
      * crimsonOpening;
    if (rng() > acceptance) return null;

    const heightBias = 0.82 + macro * 0.34;
    const flowerShortening = 1 - smoothstep(0.08, 0.78, flowerMass) * 0.48;
    const amberHeight = 1 + smoothstep(40, 82, -z) * 0.2;
    return {
      x,
      y: safeHeight(x, z) + 0.012,
      z,
      scaleX: .9 + rng() * .66,
      scaleY: (.58 + rng() * .64) * heightBias * flowerShortening * amberHeight,
      yaw: rng() * TAU,
      tint: clamp(macro * 0.74 + rng() * 0.26 - smoothstep(55, 95, z) * .12, 0, 1),
      phase: rng(),
    };
  }, 18);

  const reedData = buildInstanceData(reedTarget, random, (rng) => {
    const x = (rng() * 2 - 1) * 101;
    const centerZ = riverZ?.(x) ?? -30;
    const side = rng() < 0.5 ? -1 : 1;
    const z = centerZ + side * (2.9 + rng() * 7.2) + (rng() - 0.5) * 1.2;
    if (Math.abs(z) > WORLD_EDGE || pathDistance(x, z) < 1.8) return null;
    const riverD = riverDistance(x, z);
    if (riverD < 2.45 || riverD > 8.8) return null;
    const wetPatch = fbm(x * 0.061, z * 0.061, SEED + 401);
    if (rng() > 0.55 + wetPatch * 0.42) return null;
    return {
      x,
      y: safeHeight(x, z) + 0.01,
      z,
      scaleX: 0.56 + rng() * 0.48,
      scaleY: 0.94 + rng() * 0.67,
      yaw: rng() * TAU,
      tint: 0.35 + rng() * 0.65,
      phase: rng(),
    };
  }, 28);

  const flowerData = buildInstanceData(flowerTarget, random, (rng) => {
    const x = (rng() * 2 - 1) * 103;
    const z = -57 + rng() * 117;
    const pathD = pathDistance(x, z);
    const riverD = riverDistance(x, z);
    if (pathD < 1.82 || riverD < 3.2) return null;

    const patch = flowerMassAt(x, z);
    const patchNoise = fbm(x * 0.044, z * 0.044, SEED + 911);
    const softPath = smoothstep(1.82, 5.05, pathD);
    const softRiver = smoothstep(3.2, 7.6, riverD);
    if (rng() > clamp(patch * softPath * softRiver, 0, 0.96)) return null;

    return {
      x,
      y: safeHeight(x, z) + 0.016,
      z,
      scaleX: 0.72 + rng() * 0.46,
      scaleY: 0.76 + rng() * 0.38,
      yaw: rng() * TAU,
      tint: clamp(patchNoise * 0.72 + rng() * 0.34, 0, 1),
      phase: rng(),
    };
  }, 48);

  // Culms grow from shared clump centers rather than an even wall. Gaps between
  // those clumps let individual compound curves and crowns read from the path.
  const bambooRandom = mulberry32(SEED + 0x1703);
  const bambooClusters = [];
  for (let attempt = 0; attempt < 900 && bambooClusters.length < 94; attempt += 1) {
    const z = 57 + bambooRandom() * 52;
    const centerX = pathX?.(z) ?? 0;
    const side = bambooRandom() < .5 ? -1 : 1;
    const lateral = side * (5.2 + Math.pow(bambooRandom(), .7) * 45);
    const x = centerX + lateral + (bambooRandom() - .5) * 3.2;
    if (Math.abs(x) > 104 || pathDistance(x, z) < 4.65) continue;
    const groveNoise = fbm(x * .052, z * .052, SEED + 1703);
    if (bambooRandom() > .42 + groveNoise * .52) continue;
    bambooClusters.push({
      x,
      z,
      radius: 1.15 + bambooRandom() * 2.35,
      height: .88 + bambooRandom() * .2,
      tint: clamp(.14 + groveNoise * .68, 0, 1),
    });
  }

  const bambooData = buildInstanceData(bambooTarget, bambooRandom, (rng) => {
    const cluster = bambooClusters[Math.floor(rng() * bambooClusters.length)];
    const angle = rng() * TAU;
    const radius = Math.pow(rng(), .72) * cluster.radius;
    const x = cluster.x + Math.cos(angle) * radius;
    const z = cluster.z + Math.sin(angle) * radius;
    if (Math.abs(x) > 108 || z < 55 || z > 111 || pathDistance(x, z) < 3.75) return null;
    const groveNoise = fbm(x * .058, z * .058, SEED + 1703);
    const sapling = rng() < .28;
    return {
      x,
      y: safeHeight(x, z) - 0.025,
      z,
      scaleX: sapling ? .42 + rng() * .2 : .58 + rng() * .34,
      scaleY: (sapling ? 7.4 + rng() * 3.8 : 11.2 + rng() * 5.8) * cluster.height,
      yaw: rng() * TAU,
      tint: clamp(cluster.tint * .72 + groveNoise * .22 + rng() * .08, 0, 1),
      phase: rng(),
    };
  }, 42);

  const treeData = buildInstanceData(treeTarget, random, (rng) => {
    const x = (rng() * 2 - 1) * 104;
    const z = -88 + rng() * 139;
    const outerWoodland = smoothstep(43, 92, Math.abs(x));
    const southernWoodland = 1 - smoothstep(-61, -35, z);
    const treeChance = clamp(outerWoodland * 0.78 + southernWoodland * 0.44, 0, 0.95);
    if (rng() > treeChance) return null;
    if (pathDistance(x, z) < 5.1 || riverDistance(x, z) < 7.3) return null;
    const localNoise = fbm(x * 0.047, z * 0.047, SEED + 3301);
    return {
      x,
      y: safeHeight(x, z) - 0.035,
      z,
      scaleX: 4.25 + rng() * 2.2,
      scaleY: 7.1 + rng() * 3.7,
      yaw: rng() * TAU,
      tint: clamp(localNoise * 0.8 + rng() * 0.24, 0, 1),
      phase: rng(),
    };
  }, 55);

  const sedgeRandom = mulberry32(SEED + 0x61d9);
  const forestSedgeData = buildInstanceData(forestSedgeTarget, sedgeRandom, (rng) => {
    const entryBiased = rng() < .62;
    const x = (rng() * 2 - 1) * 106;
    const z = entryBiased ? 53 + rng() * 54 : (rng() * 2 - 1) * 106;
    const pathD = pathDistance(x, z);
    const riverD = riverDistance(x, z);
    if (pathD < 1.32 || riverD < 2.9) return null;
    const habitat = forestFloorMaskAt(x, z);
    const laneNoise = fbm(x * .066, z * .066, SEED + 6503);
    const flowerGuard = 1 - smoothstep(.14, .86, flowerMassAt(x, z)) * .68;
    const pathRecovery = smoothstep(1.32, 3.1, pathD);
    const riverRecovery = smoothstep(2.9, 6.8, riverD);
    const patch = smoothstep(.23, .78, laneNoise) * .66 + .34;
    if (rng() > habitat * flowerGuard * pathRecovery * riverRecovery * patch) return null;
    return {
      x,
      y: safeHeight(x, z) + .014,
      z,
      scaleX: 1.02 + rng() * .68,
      scaleY: .72 + rng() * .5,
      yaw: groundFlowYawAt(x, z) + (rng() - .5) * .6,
      tint: clamp(.14 + habitat * .28 + laneNoise * .4 + (rng() - .5) * .12, 0, 1),
      phase: rng(),
    };
  }, 64);

  // A short, continuous weave fills the central basin beneath the lilies. It
  // uses the inexpensive two-segment flowing archetype, so the meadow gains the
  // reference's overlapping ground-level arcs without turning into another
  // tall sedge field or obscuring the flower heads.
  const meadowUnderstoryRandom = mulberry32(SEED + 0xb45f);
  const meadowUnderstoryData = buildInstanceData(
    meadowUnderstoryTarget,
    meadowUnderstoryRandom,
    (rng) => {
      const x = (rng() * 2 - 1) * 84;
      const z = -58 + rng() * 116;
      const pathD = pathDistance(x, z);
      const riverD = riverDistance(x, z);
      if (pathD < 1.6 || riverD < 3.2) return null;

      const basinX = 1 - smoothstep(70, 84, Math.abs(x));
      const basinZ = smoothstep(-62, -50, z) * (1 - smoothstep(48, 60, z));
      const pathRecovery = smoothstep(1.6, 3.5, pathD);
      const riverRecovery = smoothstep(3.2, 7, riverD);
      const heroTreeClear = smoothstep(4.8, 8, Math.hypot(x + 27, z + 32));
      const continuity = .78 + fbm(x * .035, z * .035, SEED + 0xb45f) * .22;
      const flowers = flowerMassAt(x, z);
      const flowerPreserve = 1 - smoothstep(.2, .85, flowers) * .12;
      const acceptance = basinX * basinZ * pathRecovery * riverRecovery
        * heroTreeClear * continuity * flowerPreserve;
      if (rng() > acceptance) return null;

      return {
        x,
        y: safeHeight(x, z) + .009,
        z,
        scaleX: 1.25 + rng() * .75,
        scaleY: (.72 + rng() * .34) * (1 - flowers * .14),
        yaw: groundFlowYawAt(x, z) + (rng() - .5) * .85,
        tint: clamp(.12 + continuity * .42 + (rng() - .5) * .12, 0, 1),
        phase: rng(),
      };
    },
    64,
  );

  const fernRandom = mulberry32(SEED + 0x7f31);
  const fernData = buildInstanceData(fernTarget, fernRandom, (rng) => {
    const x = (rng() * 2 - 1) * 105;
    const z = (rng() * 2 - 1) * 105;
    const pathD = pathDistance(x, z);
    const riverD = riverDistance(x, z);
    if (pathD < 1.5 || riverD < 3.1) return null;
    const habitat = forestFloorMaskAt(x, z);
    const colonyNoise = fbm(x * .075 + 9, z * .075 - 4, SEED + 7207);
    const colony = smoothstep(.38, .76, colonyNoise);
    const flowerGuard = 1 - smoothstep(.08, .72, flowerMassAt(x, z)) * .82;
    if (rng() > habitat * flowerGuard * (.18 + colony * .94)) return null;
    return {
      x,
      y: safeHeight(x, z) + .018,
      z,
      scaleX: .72 + rng() * .52,
      scaleY: .68 + rng() * .42,
      yaw: rng() * TAU,
      tint: clamp(.16 + colonyNoise * .62 + (rng() - .5) * .12, 0, 1),
      phase: rng(),
    };
  }, 72);

  const litterRandom = mulberry32(SEED + 0x92ab);
  const litterData = buildInstanceData(litterTarget, litterRandom, (rng) => {
    const x = (rng() * 2 - 1) * 107;
    const z = (rng() * 2 - 1) * 107;
    const pathD = pathDistance(x, z);
    const riverD = riverDistance(x, z);
    if (pathD < .74 || riverD < 2.45) return null;
    const habitat = forestFloorMaskAt(x, z);
    const litterPatch = fbm(x * .092 - 5, z * .092 + 11, SEED + 7411);
    const flowerGuard = 1 - smoothstep(.2, .92, flowerMassAt(x, z)) * .42;
    if (rng() > habitat * flowerGuard * (.42 + litterPatch * .62)) return null;
    return {
      x,
      y: safeHeight(x, z) + .022,
      z,
      scaleX: .72 + rng() * .76,
      scaleY: 1,
      yaw: rng() * TAU,
      tint: clamp(.1 + litterPatch * .72 + (rng() - .5) * .18, 0, 1),
      phase: rng(),
    };
  }, 52);

  const grassBase = makeGrassTuftGeometry({
    blades: 6,
    segments: 3,
    width: .027,
    spread: .15,
  });
  const reedBase = makeGrassTuftGeometry({
    blades: 5,
    segments: 4,
    width: 0.021,
    spread: 0.095,
  });
  const sedgeArchetypeCount = density < .5 ? 1 : 2;
  const sedgeArchetypeData = Array.from({ length: sedgeArchetypeCount }, (_, archetype) => (
    selectInstanceData(forestSedgeData, archetype, sedgeArchetypeCount)
  ));
  const sedgeBases = Array.from({ length: sedgeArchetypeCount }, (_, archetype) => (
    makeFlowingGrassGeometry(archetype + 1)
  ));
  const meadowUnderstoryBase = makeFlowingGrassGeometry(0);
  const fernBase = makeFernClumpGeometry();
  const litterBase = makeLeafLitterPatchGeometry();
  const flowerBase = makeFlowerClumpGeometry();
  const bambooArchetypeData = [0, 1, 2].map((archetype) => (
    selectInstanceData(bambooData, archetype, 3)
  ));
  const bambooStalkBases = [0, 1, 2].map((archetype) => makeBambooStalkGeometry(archetype));
  const bambooCrownBases = [0, 1, 2].map((archetype) => makeBambooLeafGeometry(archetype));
  const treeArchetypeData = [0, 1, 2].map((archetype) => (
    selectInstanceData(treeData, archetype, 3)
  ));
  const treeTrunkBases = [0, 1, 2].map((archetype) => makeBroadleafTrunkGeometry(archetype));
  const treeCanopyBases = [0, 1, 2].map((archetype) => makeBroadleafCanopyGeometry(archetype));

  addLayer(root, 'Tawny grass', grassBase, grassData, foliageMaterial(common, {
    base: paletteColor(palette, 'grassShadow', 0x67502d)
      .lerp(paletteColor(palette, 'grassLit', 0xb88443), .18),
    lit: paletteColor(palette, 'grassLit', 0xb88443)
      .lerp(paletteColor(palette, 'grassTip', 0xe0b86a), .16),
    tip: paletteColor(palette, 'grassTip', 0xe0b86a)
      .lerp(paletteColor(palette, 'sun', 0xffd17a), 0.26),
  }, {
    name: 'Tawny grass material',
    bendScale: 0.3,
    playerBend: 0.72,
    shapeVariation: .08,
    hardDistance: 126,
    fadeStart: 70,
    fadeEnd: 118,
    transmissionStrength: 0.58,
    contactStrength: 0.46,
    ambientStrength: .56,
  }));

  const forestSedgeMaterials = [foliageMaterial(common, {
    base: paletteColor(palette, 'grassShadow', 0x67502d)
      .lerp(paletteColor(palette, 'grassLit', 0xb88443), .14),
    lit: paletteColor(palette, 'grassShadow', 0x67502d)
      .lerp(paletteColor(palette, 'grassTip', 0xe0b86a), .58),
    tip: paletteColor(palette, 'grassTip', 0xe0b86a)
      .lerp(paletteColor(palette, 'sun', 0xffd17a), .34),
  }, {
    name: 'Wind-combed forest sedge material',
    bendScale: .2,
    playerBend: .62,
    shapeVariation: .065,
    hardDistance: 82,
    fadeStart: 50,
    fadeEnd: 76,
    transmissionStrength: .78,
    contactStrength: .47,
    ambientStrength: .61,
  }), foliageMaterial(common, {
    base: paletteColor(palette, 'shadowTeal', 0x0b1b1d)
      .lerp(paletteColor(palette, 'grassShadow', 0x67502d), .56),
    lit: paletteColor(palette, 'grassShadow', 0x67502d)
      .lerp(paletteColor(palette, 'grassLit', 0xb88443), .34),
    tip: paletteColor(palette, 'grassLit', 0xb88443)
      .lerp(paletteColor(palette, 'grassTip', 0xe0b86a), .42),
  }, {
    name: 'Shadowed matted sedge material',
    bendScale: .17,
    playerBend: .62,
    shapeVariation: .08,
    hardDistance: 78,
    fadeStart: 46,
    fadeEnd: 72,
    transmissionStrength: .5,
    contactStrength: .53,
    ambientStrength: .51,
  })];

  let forestFloorDrawCalls = 0;
  sedgeArchetypeData.forEach((data, archetype) => {
    if (data.count === 0) return;
    addLayer(
      root,
      `Wind-combed forest sedge ${archetype + 1}`,
      sedgeBases[archetype],
      data,
      forestSedgeMaterials[archetype],
      145,
    );
    forestFloorDrawCalls += 1;
  });

  if (meadowUnderstoryData.count > 0) {
    addLayer(
      root,
      'Low matted meadow underlayer',
      meadowUnderstoryBase,
      meadowUnderstoryData,
      forestSedgeMaterials[1],
      125,
    );
    forestFloorDrawCalls += 1;
  }

  if (fernData.count > 0) {
    addLayer(root, 'Woodland fern colonies', fernBase, fernData, makeCutoutFoliageMaterial(common, {
      base: paletteColor(palette, 'shadowTeal', 0x0b1b1d),
      lit: paletteColor(palette, 'bamboo', 0x163b34)
        .lerp(paletteColor(palette, 'grassLit', 0xb88443), .28),
      tip: paletteColor(palette, 'grassTip', 0xe0b86a)
        .lerp(paletteColor(palette, 'sun', 0xffd17a), .28),
    }, fernTexture, {
      name: 'Woodland fern cutout material',
      bendScale: .1,
      playerBend: .3,
      shapeVariation: .055,
      hardDistance: 62,
      fadeStart: 36,
      fadeEnd: 57,
      transmissionStrength: .48,
      textureStrength: .38,
      surfaceBrightness: .55,
    }), 76);
    forestFloorDrawCalls += 1;
  }

  if (litterData.count > 0) {
    addLayer(root, 'Forest leaf litter', litterBase, litterData, foliageMaterial(common, {
      base: paletteColor(palette, 'bark', 0x4b3d31).multiplyScalar(.42),
      lit: paletteColor(palette, 'grassShadow', 0x67502d)
        .lerp(paletteColor(palette, 'grassLit', 0xb88443), .18),
      tip: paletteColor(palette, 'grassTip', 0xe0b86a).multiplyScalar(.68),
    }, {
      name: 'Forest leaf litter material',
      bendScale: 0,
      playerBend: 0,
      shapeVariation: 0,
      hardDistance: 70,
      fadeStart: 42,
      fadeEnd: 65,
      transmissionStrength: .04,
      contactStrength: .48,
    }), 82);
    forestFloorDrawCalls += 1;
  }

  addLayer(root, 'River reeds', reedBase, reedData, foliageMaterial(common, {
    base: paletteColor(palette, 'grassShadow', 0x574527).multiplyScalar(0.5),
    lit: paletteColor(palette, 'grassLit', 0xb88443).multiplyScalar(0.71),
    tip: paletteColor(palette, 'grassTip', 0xe0b86a).multiplyScalar(0.92),
  }, {
    name: 'River reed material',
    bendScale: 0.34,
    playerBend: 0.68,
    hardDistance: 132,
    fadeStart: 76,
    fadeEnd: 124,
    transmissionStrength: 0.29,
    contactStrength: 0.54,
  }));

  addLayer(root, 'Crimson flower field', flowerBase, flowerData, makeFlowerMaterial(common, palette));

  const bambooStalkMaterial = foliageMaterial(common, {
    base: paletteColor(palette, 'shadowTeal', 0x0b1b1d),
    lit: paletteColor(palette, 'bamboo', 0x163b34).lerp(new Color(0x506843), .12),
    tip: paletteColor(palette, 'bamboo', 0x163b34).lerp(new Color(0x768052), .2),
  }, {
    name: 'Bamboo stalk material',
    bendScale: 0.017,
    playerBend: 0.03,
    shapeVariation: .18,
    // Let distant culms dissolve before their crowns so the ridge reads as a
    // soft bamboo mass instead of a screen-space comb of one-pixel lines.
    hardDistance: 164,
    fadeStart: 108,
    fadeEnd: 158,
    transmissionStrength: 0.055,
    contactStrength: 0.34,
  });

  const bambooCrownMaterial = makeCutoutFoliageMaterial(common, {
    base: paletteColor(palette, 'shadowTeal', 0x0b1b1d),
    lit: paletteColor(palette, 'bamboo', 0x163b34).lerp(new Color(0x65784e), .18),
    tip: paletteColor(palette, 'bamboo', 0x163b34)
      .lerp(paletteColor(palette, 'sun', 0xffc86f), .22),
  }, bambooFrondTexture, {
    name: 'Bamboo leaf material',
    bendScale: 0.021,
    playerBend: 0.02,
    shapeVariation: .18,
    hardDistance: 190,
    fadeStart: 150,
    fadeEnd: 188,
    transmissionStrength: 0.62,
    contactStrength: 0.2,
  });

  let bambooDrawCalls = 0;
  bambooArchetypeData.forEach((data, archetype) => {
    if (data.count === 0) return;
    addLayer(
      root,
      `Bamboo stalks ${archetype + 1}`,
      bambooStalkBases[archetype],
      data,
      bambooStalkMaterial,
      195,
    );
    addLayer(
      root,
      `Bamboo crowns ${archetype + 1}`,
      bambooCrownBases[archetype],
      data,
      bambooCrownMaterial,
      195,
    );
    bambooDrawCalls += 2;
  });

  const treeTrunkMaterial = foliageMaterial(common, {
    base: paletteColor(palette, 'bark', 0x4b3d31).multiplyScalar(0.66),
    lit: paletteColor(palette, 'bark', 0x4b3d31),
    tip: paletteColor(palette, 'bark', 0x4b3d31).multiplyScalar(1.08),
  }, {
    name: 'Broadleaf bark material',
    bendScale: 0.004,
    playerBend: 0,
    hardDistance: 185,
    fadeStart: 145,
    fadeEnd: 180,
    transmissionStrength: 0,
    contactStrength: 0.26,
  });

  const treeCanopyMaterial = foliageMaterial(common, {
    base: paletteColor(palette, 'shadowTeal', 0x0b1b1d),
    lit: paletteColor(palette, 'bamboo', 0x163b34),
    tip: paletteColor(palette, 'grassLit', 0xb88443),
  }, {
    name: 'Broadleaf crown material',
    bendScale: 0.035,
    playerBend: 0,
    shapeVariation: 0.24,
    hardDistance: 190,
    fadeStart: 148,
    fadeEnd: 184,
    transmissionStrength: 0.38,
    contactStrength: 0.16,
  });

  let treeDrawCalls = 0;
  treeArchetypeData.forEach((data, archetype) => {
    if (data.count === 0) return;
    addLayer(
      root,
      `Secondary tree trunks ${archetype + 1}`,
      treeTrunkBases[archetype],
      data,
      treeTrunkMaterial,
      190,
    );
    addLayer(
      root,
      `Secondary tree crowns ${archetype + 1}`,
      treeCanopyBases[archetype],
      data,
      treeCanopyMaterial,
      195,
    );
    treeDrawCalls += 2;
  });

  const particles = makeParticleField(common, palette, particleTarget, random);
  root.add(particles);

  const stats = Object.freeze({
    grassTufts: grassData.count,
    forestSedgeTufts: forestSedgeData.count,
    meadowUnderstoryTufts: meadowUnderstoryData.count,
    reedTufts: reedData.count,
    totalTufts: grassData.count + forestSedgeData.count
      + meadowUnderstoryData.count + reedData.count,
    fernClumps: fernData.count,
    litterPatches: litterData.count,
    flowerClumps: flowerData.count,
    bambooStalks: bambooData.count,
    broadleafTrees: treeData.count,
    windborneParticles: particleTarget,
    bambooArchetypes: bambooArchetypeData.length,
    forestFloorDrawCalls,
    drawCalls: 4 + forestFloorDrawCalls + bambooDrawCalls + treeDrawCalls,
  });

  return {
    update(time, playerPosition) {
      if (Number.isFinite(time)) common.uTime.value = time;
      if (playerPosition) {
        if (common.uPlayerPos.value?.copy) common.uPlayerPos.value.copy(playerPosition);
        else common.uPlayerPos.value = playerPosition;
      }
    },
    stats,
  };
}
