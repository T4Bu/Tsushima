import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  COMPOUND_PLAN,
  COMPOUND_SITE,
  FEET_TO_METERS,
  planToLocal,
  planToWorld,
} from './site-layout.js';
import {
  BIOME_SUN_DIRECTION,
  applyBiomeAtmosphere,
  applyInstancedFoliageWind,
} from './biome-shared.js';

const INCHES_2 = 0.0508;
const INCHES_3 = 0.0762;
const ROOF_OVERHANG = 0.28;
const FOUNDATION_DEPTH = 0.46;
const WINDOW_SILL = 0.72;
const WINDOW_HEAD = 2.38;
const DOOR_HEAD = 2.48;
const FINISHED_SURFACE_LIFT = 0.008;
const ARCHITECTURE_ASSET_ROOT = `${import.meta.env.BASE_URL}assets/architecture/`;

const BUILDING_STYLE = Object.freeze({
  'main-house': { wallHeight: 2.96, roofHeight: 3.02 },
  'fab-lab': { wallHeight: 3.34, roofHeight: 3.40 },
  garage: { wallHeight: 3.16, roofHeight: 3.22 },
  'guest-house': { wallHeight: 2.94, roofHeight: 3.00 },
});

function safeHeight(heightAt, x, z) {
  const value = heightAt?.(x, z);
  return Number.isFinite(value) ? value : 0;
}

function paletteColor(palette, key, fallback) {
  return new THREE.Color(palette?.[key] ?? fallback);
}

function rectangleZ(rectangle) {
  return rectangle.z ?? rectangle.y ?? 0;
}

function normalizeOpening(value) {
  if (Array.isArray(value)) {
    const [x = 0, z = 0, width = 0, depth = 0] = value;
    return { x, z, width, depth };
  }
  return {
    x: value?.x ?? 0,
    z: value?.z ?? value?.y ?? 0,
    width: value?.width ?? value?.w ?? 0,
    depth: value?.depth ?? value?.d ?? 0,
  };
}

function openingAxis(opening) {
  return opening.width >= opening.depth ? 'x' : 'z';
}

function openingSpan(opening) {
  return openingAxis(opening) === 'x'
    ? { from: opening.x, to: opening.x + opening.width, at: opening.z + opening.depth * 0.5 }
    : { from: opening.z, to: opening.z + opening.depth, at: opening.x + opening.width * 0.5 };
}

function segmentKey(segment) {
  return [segment.axis, segment.at, segment.from, segment.to, segment.thick].join(':');
}

function uniqueSegments(wallPieces) {
  const found = new Map();
  for (const piece of wallPieces) {
    if (!piece?.segment) continue;
    found.set(segmentKey(piece.segment), piece.segment);
  }
  return [...found.values()];
}

function matchingSegment(opening, segments) {
  const axis = openingAxis(opening);
  const span = openingSpan(opening);
  let best = null;
  let bestDistance = Infinity;
  for (const segment of segments) {
    if (segment.axis !== axis) continue;
    const across0 = axis === 'x' ? opening.z : opening.x;
    const across1 = across0 + (axis === 'x' ? opening.depth : opening.width);
    if (segment.at < across0 - 0.02 || segment.at > across1 + 0.02) continue;
    if (span.to < segment.from || span.from > segment.to) continue;
    const distance = Math.abs(segment.at - span.at);
    if (distance < bestDistance) {
      best = segment;
      bestDistance = distance;
    }
  }
  return best;
}

function isWindowSillPiece(piece, windows) {
  if ((piece.height ?? Infinity) < 1) return true;
  const segment = piece.segment;
  const center = (piece.from + piece.to) * 0.5;
  return windows.some((opening) => {
    if (openingAxis(opening) !== segment.axis) return false;
    const span = openingSpan(opening);
    const across0 = segment.axis === 'x' ? opening.z : opening.x;
    const across1 = across0 + (segment.axis === 'x' ? opening.depth : opening.width);
    return segment.at >= across0 && segment.at <= across1
      && center > span.from - 0.02 && center < span.to + 0.02;
  });
}

function buildingAt(planX, planZ) {
  let best = null;
  let bestDistance = Infinity;
  for (const rectangle of COMPOUND_PLAN.buildingList) {
    const z = rectangleZ(rectangle);
    const dx = Math.max(rectangle.x - planX, 0, planX - rectangle.x - rectangle.width);
    const dz = Math.max(z - planZ, 0, planZ - z - rectangle.depth);
    const distance = dx * dx + dz * dz;
    if (distance < bestDistance) {
      best = rectangle;
      bestDistance = distance;
    }
  }
  return best;
}

function sampleTerraceHeight(heightAt, rectangle) {
  const z = rectangleZ(rectangle);
  let highest = -Infinity;
  // A level architecture datum per volume. Sampling a 3x3 grid prevents a
  // corner of the terrain from poking through a slab while the deep plinth
  // hides the small downhill reveal.
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const planX = rectangle.x + rectangle.width * column * 0.5;
      const planZ = z + rectangle.depth * row * 0.5;
      const world = planToWorld(planX, planZ);
      highest = Math.max(highest, safeHeight(heightAt, world.x, world.z));
    }
  }
  return Number.isFinite(highest) ? highest : 0;
}

function transformForBox(x, y, z, width, height, depth, rotationY = 0) {
  const matrix = new THREE.Matrix4();
  matrix.compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY),
    new THREE.Vector3(width, height, depth),
  );
  return matrix;
}

function instanceHash01(index, salt = 0) {
  let value = Math.imul(index + 1 + salt * 977, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967295;
}

class InstanceBatch {
  constructor(name, geometry, material, {
    castShadow = true,
    receiveShadow = true,
    tintJitter = null,
  } = {}) {
    this.name = name;
    this.geometry = geometry;
    this.material = material;
    this.castShadow = castShadow;
    this.receiveShadow = receiveShadow;
    // { amount, warmth }: deterministic per-instance colour variation, the
    // instanced-box equivalent of the vegetation system's aTint attribute.
    // Reserved for elements whose instances are whole objects (leaves,
    // planters) — wall pieces share one field so no tint seams appear.
    this.tintJitter = tintJitter;
    this.matrices = [];
  }

  add(x, y, z, width, height, depth, rotationY = 0) {
    if (!(width > 0 && height > 0 && depth > 0)) return;
    this.matrices.push(transformForBox(x, y, z, width, height, depth, rotationY));
  }

  build(root) {
    if (!this.matrices.length) return null;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, this.matrices.length);
    mesh.name = this.name;
    this.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    if (this.tintJitter) {
      const { amount = 0.12, warmth = 0.6 } = this.tintJitter;
      const tint = new THREE.Color();
      this.matrices.forEach((_matrix, index) => {
        const spread = (instanceHash01(index, 31) - 0.5) * 2 * amount;
        tint.setRGB(
          1 + spread,
          1 + spread * (1 - 0.35 * warmth),
          1 + spread * (1 - 0.7 * warmth),
        );
        mesh.setColorAt(index, tint);
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    mesh.castShadow = this.castShadow;
    mesh.receiveShadow = this.receiveShadow;
    mesh.frustumCulled = true;
    root.add(mesh);
    return mesh;
  }
}

function standardMaterial(name, color, options = {}) {
  const material = new THREE.MeshStandardMaterial({
    name,
    color,
    roughness: options.roughness ?? 0.78,
    metalness: options.metalness ?? 0,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    depthWrite: options.depthWrite ?? true,
    side: options.side ?? THREE.FrontSide,
  });
  if (options.projectedSurface) {
    applyProjectedSurface(material, options.projectedSurface);
  }
  return material;
}

function loadArchitectureTexture(loader, fileName, name, onTextureError) {
  const texture = loader.load(
    `${ARCHITECTURE_ASSET_ROOT}${fileName}`,
    undefined,
    undefined,
    () => onTextureError?.(texture),
  );
  texture.name = name;
  texture.colorSpace = THREE.SRGBColorSpace;
  // Mirroring makes the generated material scans edge-safe even where a
  // long wall or terrace crosses several tiles. Projection happens in the
  // shader, so Texture.repeat intentionally stays at its default value.
  texture.wrapS = THREE.MirroredRepeatWrapping;
  texture.wrapT = THREE.MirroredRepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  return texture;
}

function loadArchitectureTextures(onTextureError) {
  const loader = new THREE.TextureLoader();
  const load = (fileName, name) => loadArchitectureTexture(loader, fileName, name, onTextureError);
  return {
    stucco: load('mineral-stucco.webp', 'Generated mineral stucco albedo'),
    paleStone: load('pale-limestone.webp', 'Generated pale limestone albedo'),
    featureStone: load('vein-cut-limestone.webp', 'Generated vein-cut limestone albedo'),
    cedar: load('oiled-cedar.webp', 'Generated oiled cedar albedo'),
    aggregate: load('permeable-aggregate.webp', 'Generated permeable aggregate albedo'),
  };
}

function glslFloat(value) {
  return Number(value).toFixed(4);
}

/**
 * Applies a texture in compound-local metres rather than BoxGeometry UVs.
 * Every architectural box shares one unit mesh and receives its dimensions
 * through an instance matrix; ordinary UVs would therefore stretch a single
 * texel field across both a 20 m wall and a 7 cm slat. Face-weighted local
 * projection keeps those surfaces at one stable physical scale without
 * splitting batches or increasing draw calls.
 */
function applyProjectedSurface(material, {
  map,
  scale = 1,
  colorStrength = 0.7,
  roughnessVariation = 0.08,
  roughnessFloor = 0.68,
  bumpStrength = 0.35,
  blendSharpness = 12,
  weatherBaseY = 0,
  weatherHeight = 0,
  weatherStrength = 0,
  weatherRoughness = 0,
  weatherFrequency = 0.55,
  exteriorWeathering = null,
  interiorFinish = null,
  floorBoards = null,
  hardscapeWear = null,
  macroVariation = null,
  groundContact = null,
} = {}) {
  if (!map) return material;
  const scaleX = Array.isArray(scale) ? scale[0] : scale;
  const scaleY = Array.isArray(scale) ? (scale[1] ?? scale[0]) : scale;
  const weatherEnabled = weatherHeight > 0 && weatherStrength > 0;
  const weatherAggregateStrength = exteriorWeathering?.aggregateStrength ?? 0;
  const weatherRunoffStrength = exteriorWeathering?.runoffStrength ?? 0;
  const weatherCornerStrength = exteriorWeathering?.cornerStrength ?? 0;
  const weatherDetailRoughness = exteriorWeathering?.detailRoughness ?? 0;
  const weatherRegions = Array.isArray(exteriorWeathering?.regions)
    ? exteriorWeathering.regions.map((region) => ({
        xMin: Math.min(region.xMin, region.xMax),
        xMax: Math.max(region.xMin, region.xMax),
        zMin: Math.min(region.zMin, region.zMax),
        zMax: Math.max(region.zMin, region.zMax),
        weatherStrength: region.weatherStrength ?? 1,
        detailStrength: region.detailStrength ?? 1,
        tint: Array.isArray(region.tint) ? region.tint : [0, 0, 0],
      }))
    : [];
  const exteriorMaskEnabled = weatherRegions.length > 0;
  const exteriorRegionFragment = exteriorMaskEnabled
    ? weatherRegions.map((region, index) => `
  float architectureExteriorRegion${index}WithinX =
    step(${glslFloat(region.xMin - 0.28)}, vArchitecturePosition.x)
    * step(vArchitecturePosition.x, ${glslFloat(region.xMax + 0.28)});
  float architectureExteriorRegion${index}WithinZ =
    step(${glslFloat(region.zMin - 0.28)}, vArchitecturePosition.z)
    * step(vArchitecturePosition.z, ${glslFloat(region.zMax + 0.28)});
  float architectureExteriorRegion${index}West =
    (1.0 - smoothstep(
      0.08,
      0.26,
      abs(vArchitecturePosition.x - ${glslFloat(region.xMin)})
    ))
    * architectureExteriorRegion${index}WithinZ
    * smoothstep(0.55, 0.92, -architectureWeatherDirection.x);
  float architectureExteriorRegion${index}East =
    (1.0 - smoothstep(
      0.08,
      0.26,
      abs(vArchitecturePosition.x - ${glslFloat(region.xMax)})
    ))
    * architectureExteriorRegion${index}WithinZ
    * smoothstep(0.55, 0.92, architectureWeatherDirection.x);
  float architectureExteriorRegion${index}North =
    (1.0 - smoothstep(
      0.08,
      0.26,
      abs(vArchitecturePosition.z - ${glslFloat(region.zMin)})
    ))
    * architectureExteriorRegion${index}WithinX
    * smoothstep(0.55, 0.92, -architectureWeatherDirection.z);
  float architectureExteriorRegion${index}South =
    (1.0 - smoothstep(
      0.08,
      0.26,
      abs(vArchitecturePosition.z - ${glslFloat(region.zMax)})
    ))
    * architectureExteriorRegion${index}WithinX
    * smoothstep(0.55, 0.92, architectureWeatherDirection.z);
  float architectureExteriorRegion${index}Mask = clamp(max(
    max(architectureExteriorRegion${index}West, architectureExteriorRegion${index}East),
    max(architectureExteriorRegion${index}North, architectureExteriorRegion${index}South)
  ), 0.0, 1.0);
  float architectureExteriorRegion${index}Corner = clamp(
    max(architectureExteriorRegion${index}West, architectureExteriorRegion${index}East)
      * (1.0 - smoothstep(
        0.08,
        0.82,
        min(
          abs(vArchitecturePosition.z - ${glslFloat(region.zMin)}),
          abs(vArchitecturePosition.z - ${glslFloat(region.zMax)})
        )
      ))
    + max(architectureExteriorRegion${index}North, architectureExteriorRegion${index}South)
      * (1.0 - smoothstep(
        0.08,
        0.82,
        min(
          abs(vArchitecturePosition.x - ${glslFloat(region.xMin)}),
          abs(vArchitecturePosition.x - ${glslFloat(region.xMax)})
        )
      )),
    0.0,
    1.0
  );`).join('')
    : '';
  const exteriorWeatherMask = exteriorMaskEnabled
    ? weatherRegions.reduce(
        (expression, region, index) => `max(${expression}, architectureExteriorRegion${index}Mask * ${glslFloat(region.weatherStrength)})`,
        '0.0',
      )
    : '1.0';
  const exteriorDetailMask = exteriorMaskEnabled
    ? weatherRegions.reduce(
        (expression, region, index) => `max(${expression}, architectureExteriorRegion${index}Mask * ${glslFloat(region.detailStrength)})`,
        '0.0',
      )
    : '0.0';
  const exteriorCornerMask = exteriorMaskEnabled
    ? weatherRegions.reduce(
        (expression, region, index) => `max(${expression}, architectureExteriorRegion${index}Corner * ${glslFloat(region.detailStrength)})`,
        '0.0',
      )
    : '0.0';
  const exteriorTint = exteriorMaskEnabled
    ? weatherRegions.map((region, index) => {
        const [red = 0, green = 0, blue = 0] = region.tint;
        return `architectureExteriorRegion${index}Mask * vec3(${glslFloat(red)}, ${glslFloat(green)}, ${glslFloat(blue)})`;
      }).join(' + ')
    : 'vec3(0.0)';
  const interiorFinishRegions = Array.isArray(interiorFinish?.regions)
    ? interiorFinish.regions.map((region) => ({
        xMin: Math.min(region.xMin, region.xMax),
        xMax: Math.max(region.xMin, region.xMax),
        zMin: Math.min(region.zMin, region.zMax),
        zMax: Math.max(region.zMin, region.zMax),
        label: region.label ?? 'private interior',
      }))
    : [];
  const interiorFinishTint = Array.isArray(interiorFinish?.tint)
    ? interiorFinish.tint
    : [0, 0, 0];
  const interiorFinishRoughness = interiorFinish?.roughnessShift ?? 0;
  const interiorFinishVariation = interiorFinish?.variationStrength ?? 0;
  const interiorFinishFrequency = interiorFinish?.frequency ?? 0.42;
  const interiorFinishFeather = Math.max(0.001, interiorFinish?.feather ?? 0.035);
  const interiorFinishFace = interiorFinish?.face ?? 'all';
  const interiorFinishExcludeExterior = interiorFinish?.excludeExterior === true;
  const interiorFinishEnabled = interiorFinishRegions.length > 0 && (
    interiorFinishTint.some((value) => Math.abs(value) > 0.0001)
    || Math.abs(interiorFinishRoughness) > 0.0001
    || interiorFinishVariation > 0.0001
  );
  const interiorFinishRegionFragment = interiorFinishEnabled
    ? interiorFinishRegions.map((region, index) => `
  float architectureInteriorFinishRegion${index} =
    smoothstep(
      ${glslFloat(region.xMin)},
      ${glslFloat(region.xMin + interiorFinishFeather)},
      vArchitecturePosition.x
    )
    * (1.0 - smoothstep(
      ${glslFloat(region.xMax - interiorFinishFeather)},
      ${glslFloat(region.xMax)},
      vArchitecturePosition.x
    ))
    * smoothstep(
      ${glslFloat(region.zMin)},
      ${glslFloat(region.zMin + interiorFinishFeather)},
      vArchitecturePosition.z
    )
    * (1.0 - smoothstep(
      ${glslFloat(region.zMax - interiorFinishFeather)},
      ${glslFloat(region.zMax)},
      vArchitecturePosition.z
    ));`).join('')
    : '';
  const interiorFinishRegionMask = interiorFinishEnabled
    ? interiorFinishRegions.slice(1).reduce(
        (expression, _region, index) => `max(${expression}, architectureInteriorFinishRegion${index + 1})`,
        'architectureInteriorFinishRegion0',
      )
    : '0.0';
  const interiorFinishFaceMask = interiorFinishFace === 'vertical'
    ? `(1.0 - smoothstep(
      0.18,
      0.55,
      abs(normalize(vArchitectureNormal)).y
    ))`
    : interiorFinishFace === 'upward'
      ? `smoothstep(
      0.72,
      0.96,
      normalize(vArchitectureNormal).y
    )`
      : '1.0';
  const interiorFinishExteriorMask = interiorFinishExcludeExterior
    && weatherEnabled
    && exteriorMaskEnabled
    ? '(1.0 - architectureExteriorWeatherMask)'
    : '1.0';
  const [interiorTintRed = 0, interiorTintGreen = 0, interiorTintBlue = 0] = interiorFinishTint;
  const interiorFinishFragment = interiorFinishEnabled
    ? `
  ${interiorFinishRegionFragment}
  float architectureInteriorFinishMask = clamp(
    ${interiorFinishRegionMask}
      * ${interiorFinishFaceMask}
      * ${interiorFinishExteriorMask},
    0.0,
    1.0
  );
  float architectureInteriorFinishWave = 0.5 + 0.5 * sin(
    dot(
      vArchitecturePosition.xz,
      vec2(
        ${glslFloat(interiorFinishFrequency)},
        ${glslFloat(interiorFinishFrequency * 0.61)}
      )
    )
      + vArchitecturePosition.y * ${glslFloat(interiorFinishFrequency * 0.37)}
  );
  diffuseColor.rgb *= vec3(1.0) + vec3(
    ${glslFloat(interiorTintRed)},
    ${glslFloat(interiorTintGreen)},
    ${glslFloat(interiorTintBlue)}
  ) * architectureInteriorFinishMask;
  diffuseColor.rgb *= 1.0 + (
    architectureInteriorFinishWave - 0.5
  ) * ${glslFloat(interiorFinishVariation)} * architectureInteriorFinishMask;
  float architectureInteriorFinishRoughnessShift =
    architectureInteriorFinishMask * ${glslFloat(interiorFinishRoughness)};`
    : '';
  const interiorFinishRoughnessFragment = interiorFinishEnabled
    ? `
      + architectureInteriorFinishRoughnessShift`
    : '';
  const floorBoardWidth = floorBoards?.width ?? 0;
  const floorBoardLength = floorBoards?.length ?? 0;
  const floorBoardSeamStrength = floorBoards?.seamStrength ?? 0;
  const floorBoardSeamRoughness = floorBoards?.seamRoughness ?? 0;
  const floorBoardToneStrength = floorBoards?.toneStrength ?? 0;
  const floorBoardAxis = floorBoards?.axis === 'x' ? 'x' : 'z';
  const floorBoardsEnabled = floorBoardWidth > 0
    && floorBoardLength > 0
    && (floorBoardSeamStrength > 0 || floorBoardSeamRoughness > 0 || floorBoardToneStrength > 0);
  const floorBoardPoint = floorBoardAxis === 'x'
    ? 'vArchitecturePosition.zx'
    : 'vArchitecturePosition.xz';
  const floorBoardsFragment = floorBoardsEnabled
    ? `
  float architectureFloorBoardFace = smoothstep(
    0.72,
    0.96,
    normalize(vArchitectureNormal).y
  );
  vec2 architectureFloorBoardPoint = ${floorBoardPoint};
  float architectureFloorBoardAcross =
    architectureFloorBoardPoint.x / ${glslFloat(floorBoardWidth)};
  float architectureFloorBoardRow = floor(architectureFloorBoardAcross);
  float architectureFloorBoardAlong = (
    architectureFloorBoardPoint.y
      + mod(architectureFloorBoardRow, 2.0) * ${glslFloat(floorBoardLength * 0.5)}
  ) / ${glslFloat(floorBoardLength)};
  float architectureFloorBoardAcrossEdge = abs(
    fract(architectureFloorBoardAcross) - 0.5
  );
  float architectureFloorBoardAlongEdge = abs(
    fract(architectureFloorBoardAlong) - 0.5
  );
  float architectureFloorBoardAcrossAA = max(
    fwidth(architectureFloorBoardAcross) * 1.35,
    0.008
  );
  float architectureFloorBoardAlongAA = max(
    fwidth(architectureFloorBoardAlong) * 1.35,
    0.008
  );
  float architectureFloorBoardAcrossSeam = smoothstep(
    0.5 - architectureFloorBoardAcrossAA,
    0.5,
    architectureFloorBoardAcrossEdge
  );
  float architectureFloorBoardAlongSeam = smoothstep(
    0.5 - architectureFloorBoardAlongAA,
    0.5,
    architectureFloorBoardAlongEdge
  );
  float architectureFloorBoardSeam = max(
    architectureFloorBoardAcrossSeam,
    architectureFloorBoardAlongSeam * 0.68
  ) * architectureFloorBoardFace;
  float architectureFloorBoardTone = fract(
    sin(architectureFloorBoardRow * 12.9898 + 4.17) * 43758.5453
  );
  diffuseColor.rgb *= 1.0
    - architectureFloorBoardSeam * ${glslFloat(floorBoardSeamStrength)};
  diffuseColor.rgb *= 1.0 + (
    architectureFloorBoardTone - 0.5
  ) * ${glslFloat(floorBoardToneStrength)} * architectureFloorBoardFace;
  float architectureFloorBoardRoughnessShift =
    architectureFloorBoardSeam * ${glslFloat(floorBoardSeamRoughness)};`
    : '';
  const floorBoardsRoughnessFragment = floorBoardsEnabled
    ? `
      + architectureFloorBoardRoughnessShift`
    : '';
  const weatherFragment = weatherEnabled
    ? `
  vec3 architectureWeatherDirection = normalize(vArchitectureNormal);
  vec3 architectureWeatherNormal = abs(normalize(vArchitectureNormal));
  ${exteriorRegionFragment}
  float architectureExteriorWeatherMask = clamp(${exteriorWeatherMask}, 0.0, 1.0);
  float architectureExteriorDetailMask = clamp(${exteriorDetailMask}, 0.0, 1.0);
  float architectureExteriorCornerWeather = clamp(${exteriorCornerMask}, 0.0, 1.0);
  vec3 architectureExteriorTint = ${exteriorTint};
  float architectureVerticalFace = 1.0 - smoothstep(
    0.18,
    0.55,
    architectureWeatherNormal.y
  );
  float architectureWeatherAlong = dot(
    vArchitecturePosition.xz,
    architectureWeatherNormal.zx
  );
  float architectureWeatherMacro = 0.5 + 0.5 * sin(
    architectureWeatherAlong * ${glslFloat(weatherFrequency)}
      + 1.7 * sin(
        architectureWeatherAlong * ${glslFloat(weatherFrequency * 0.37)} + 1.1
      )
  );
  float architectureWeatherRise = ${glslFloat(weatherHeight)} * mix(
    0.72,
    1.15,
    architectureWeatherMacro
  );
  float architectureWeatherHeight = max(
    vArchitecturePosition.y - ${glslFloat(weatherBaseY)},
    0.0
  );
  float architectureWeathering = architectureVerticalFace
    * (1.0 - smoothstep(0.04, architectureWeatherRise, architectureWeatherHeight))
    * mix(0.65, 1.0, architectureWeatherMacro)
    * architectureExteriorWeatherMask;
  float architectureExteriorAggregate = clamp(
    0.5
      + 0.26 * sin(
        architectureWeatherAlong * 1.43 + architectureWeatherHeight * 2.10
      )
      + 0.22 * sin(
        architectureWeatherAlong * 0.47 - architectureWeatherHeight * 3.70 + 1.8
      ),
    0.0,
    1.0
  );
  float architectureRunoffField = 0.5 + 0.5 * sin(
    architectureWeatherAlong * 3.70
      + 1.4 * sin(architectureWeatherAlong * 0.61 + 2.3)
  );
  float architectureExteriorRunoff = architectureVerticalFace
    * architectureExteriorDetailMask
    * smoothstep(0.72, 0.93, architectureRunoffField)
    * smoothstep(0.42, 2.55, architectureWeatherHeight)
    * mix(0.58, 1.0, architectureWeatherMacro);
  diffuseColor.rgb *= vec3(1.0) + architectureExteriorTint;
  diffuseColor.rgb *= 1.0 + (
    architectureExteriorAggregate - 0.5
  ) * ${glslFloat(weatherAggregateStrength)} * architectureExteriorDetailMask;
  diffuseColor.rgb *= 1.0
    - architectureWeathering * ${glslFloat(weatherStrength)}
    - architectureExteriorRunoff * ${glslFloat(weatherRunoffStrength)}
    - architectureExteriorCornerWeather * ${glslFloat(weatherCornerStrength)};`
    : '';
  const weatherRoughnessFragment = weatherEnabled
    ? `
      + architectureWeathering * ${glslFloat(weatherRoughness)}
      + architectureExteriorDetailMask
        * (0.5 - architectureExteriorAggregate)
        * ${glslFloat(weatherDetailRoughness)}
      + architectureExteriorRunoff * ${glslFloat(weatherDetailRoughness * 0.45)}
      + architectureExteriorCornerWeather * ${glslFloat(weatherDetailRoughness * 0.70)}`
    : '';
  const hardscapeMottleStrength = hardscapeWear?.mottleStrength ?? 0;
  const hardscapeFrequency = hardscapeWear?.frequency ?? 0.28;
  const hardscapeDrainageStrength = hardscapeWear?.drainageStrength ?? 0;
  const hardscapeDrainageRoughness = hardscapeWear?.drainageRoughness ?? 0;
  const hardscapeTrackStrength = hardscapeWear?.trackStrength ?? 0;
  const hardscapeTrackRoughness = hardscapeWear?.trackRoughness ?? 0;
  const hardscapeTrackWidth = hardscapeWear?.trackWidth ?? 0.32;
  const hardscapeTrackCenters = Array.isArray(hardscapeWear?.trackCenters)
    ? hardscapeWear.trackCenters
    : [];
  const hardscapeEnabled = hardscapeMottleStrength > 0
    || hardscapeDrainageStrength > 0
    || hardscapeTrackStrength > 0;
  const hardscapeTrackDistance = hardscapeTrackCenters.length > 0
    ? hardscapeTrackCenters.slice(1).reduce(
        (expression, center) => `min(${expression}, abs(architectureHardscapePoint.x - ${glslFloat(center)}))`,
        `abs(architectureHardscapePoint.x - ${glslFloat(hardscapeTrackCenters[0])})`,
      )
    : '9999.0';
  const hardscapeFragment = hardscapeEnabled
    ? `
  float architectureUpwardFace = smoothstep(
    0.72,
    0.96,
    abs(normalize(vArchitectureNormal)).y
  );
  vec2 architectureHardscapePoint = vArchitecturePosition.xz;
  float architectureHardscapeWaveA = sin(
    architectureHardscapePoint.x * ${glslFloat(hardscapeFrequency)}
      + 1.45 * sin(
        architectureHardscapePoint.y * ${glslFloat(hardscapeFrequency * 0.37)} + 0.8
      )
  );
  float architectureHardscapeWaveB = sin(
    dot(architectureHardscapePoint, vec2(-0.38, 0.93))
      * ${glslFloat(hardscapeFrequency * 0.71)}
      + 1.1 * sin(
        dot(architectureHardscapePoint, vec2(0.82, 0.57))
          * ${glslFloat(hardscapeFrequency * 0.29)} - 1.2
      )
  );
  float architectureHardscapeMottle = clamp(
    0.5 + architectureHardscapeWaveA * 0.24 + architectureHardscapeWaveB * 0.22,
    0.0,
    1.0
  );
  float architectureDrainageField = 0.5
    + architectureHardscapeWaveA * 0.28
    - architectureHardscapeWaveB * 0.16;
  float architectureDrainagePatch = architectureUpwardFace
    * smoothstep(0.64, 0.88, architectureDrainageField);
  float architectureTrackDistance = ${hardscapeTrackDistance};
  float architectureTrackBreakup = 0.72 + 0.28 * (
    0.5 + 0.5 * sin(
      architectureHardscapePoint.y * ${glslFloat(hardscapeFrequency * 2.1)}
        + 0.8 * sin(
          architectureHardscapePoint.x * ${glslFloat(hardscapeFrequency * 0.83)}
        )
    )
  );
  float architectureWheelCompaction = architectureUpwardFace
    * (1.0 - smoothstep(
      ${glslFloat(hardscapeTrackWidth * 0.28)},
      ${glslFloat(hardscapeTrackWidth)},
      architectureTrackDistance
    ))
    * architectureTrackBreakup;
  diffuseColor.rgb *= 1.0 + (
    architectureHardscapeMottle - 0.5
  ) * ${glslFloat(hardscapeMottleStrength)} * architectureUpwardFace;
  diffuseColor.rgb *= 1.0
    - architectureDrainagePatch * ${glslFloat(hardscapeDrainageStrength)};
  diffuseColor.rgb *= 1.0
    - architectureWheelCompaction * ${glslFloat(hardscapeTrackStrength)};
  float architectureHardscapeRoughnessShift =
    - architectureDrainagePatch * ${glslFloat(hardscapeDrainageRoughness)}
    - architectureWheelCompaction * ${glslFloat(hardscapeTrackRoughness)};`
    : '';
  const hardscapeRoughnessFragment = hardscapeEnabled
    ? `
      + architectureHardscapeRoughnessShift`
    : '';
  // A continuous low-frequency tint field breaks the single flat wall or
  // paving colour the way the terrain's snapped-block vertex tint breaks the
  // ground. It reads position, not instance id, so adjacent wall pieces never
  // show a tint seam.
  const macroStrength = macroVariation?.strength ?? 0;
  const macroFrequency = macroVariation?.frequency ?? 0.14;
  const macroWarmth = macroVariation?.warmth ?? 0.7;
  const macroEnabled = macroStrength > 0;
  const macroFragment = macroEnabled
    ? `
  float architectureMacroWave = 0.5 + 0.5 * sin(
    dot(vArchitecturePosition.xz, vec2(
      ${glslFloat(macroFrequency)},
      ${glslFloat(macroFrequency * 0.62)}
    ))
      + 1.9 * sin(
        vArchitecturePosition.x * ${glslFloat(macroFrequency * 0.31)}
          - vArchitecturePosition.z * ${glslFloat(macroFrequency * 0.47)}
      )
      + vArchitecturePosition.y * ${glslFloat(macroFrequency * 0.18)}
  );
  vec3 architectureMacroAxis = vec3(
    1.0,
    ${glslFloat(1 - 0.3 * macroWarmth)},
    ${glslFloat(1 - 0.6 * macroWarmth)}
  );
  diffuseColor.rgb *= vec3(1.0)
    + architectureMacroAxis
      * (architectureMacroWave - 0.5)
      * ${glslFloat(macroStrength * 2)};`
    : '';
  // Vertical faces darken softly toward the terrain line: the compound's
  // stand-in for the baked contact occlusion every natural clump receives
  // from its in-shader root shading.
  const contactBaseY = groundContact?.baseY ?? 0;
  const contactHeight = groundContact?.height ?? 0.42;
  const contactStrength = groundContact?.strength ?? 0;
  const contactEnabled = contactStrength > 0;
  const contactFragment = contactEnabled
    ? `
  float architectureContactVertical = 1.0 - smoothstep(
    0.3,
    0.75,
    abs(normalize(vArchitectureNormal).y)
  );
  float architectureGroundContact = (1.0 - smoothstep(
    ${glslFloat(contactBaseY - 0.55)},
    ${glslFloat(contactBaseY + contactHeight)},
    vArchitecturePosition.y
  )) * architectureContactVertical;
  diffuseColor.rgb *= 1.0
    - architectureGroundContact * ${glslFloat(contactStrength)};`
    : '';
  const contactRoughnessFragment = contactEnabled
    ? `
      + architectureGroundContact * ${glslFloat(contactStrength * 0.4)}`
    : '';
  const shaderKey = [
    'compound-projected-surface-v6',
    scaleX,
    scaleY,
    colorStrength,
    roughnessVariation,
    roughnessFloor,
    bumpStrength,
    blendSharpness,
    weatherBaseY,
    weatherHeight,
    weatherStrength,
    weatherRoughness,
    weatherFrequency,
    weatherAggregateStrength,
    weatherRunoffStrength,
    weatherCornerStrength,
    weatherDetailRoughness,
    ...weatherRegions.flatMap((region) => [
      region.xMin,
      region.xMax,
      region.zMin,
      region.zMax,
      region.weatherStrength,
      region.detailStrength,
      ...region.tint,
    ]),
    ...interiorFinishTint,
    interiorFinishRoughness,
    interiorFinishVariation,
    interiorFinishFrequency,
    interiorFinishFeather,
    interiorFinishFace,
    interiorFinishExcludeExterior,
    ...interiorFinishRegions.flatMap((region) => [
      region.xMin,
      region.xMax,
      region.zMin,
      region.zMax,
    ]),
    floorBoardWidth,
    floorBoardLength,
    floorBoardSeamStrength,
    floorBoardSeamRoughness,
    floorBoardToneStrength,
    floorBoardAxis,
    hardscapeMottleStrength,
    hardscapeFrequency,
    hardscapeDrainageStrength,
    hardscapeDrainageRoughness,
    hardscapeTrackStrength,
    hardscapeTrackRoughness,
    hardscapeTrackWidth,
    ...hardscapeTrackCenters,
    macroStrength,
    macroFrequency,
    macroWarmth,
    contactBaseY,
    contactHeight,
    contactStrength,
  ].join(':');

  material.map = map;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vArchitecturePosition;\nvarying vec3 vArchitectureNormal;',
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vec4 architecturePosition = vec4(transformed, 1.0);
vec3 architectureNormal = objectNormal;
#ifdef USE_INSTANCING
  architecturePosition = instanceMatrix * architecturePosition;
  mat3 architectureInstanceMatrix = mat3(instanceMatrix);
  architectureNormal /= vec3(
    dot(architectureInstanceMatrix[0], architectureInstanceMatrix[0]),
    dot(architectureInstanceMatrix[1], architectureInstanceMatrix[1]),
    dot(architectureInstanceMatrix[2], architectureInstanceMatrix[2])
  );
  architectureNormal = architectureInstanceMatrix * architectureNormal;
#endif
vArchitecturePosition = architecturePosition.xyz;
vArchitectureNormal = normalize(architectureNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vArchitecturePosition;
varying vec3 vArchitectureNormal;

vec3 perturbArchitectureNormal(
  vec3 surfacePosition,
  vec3 surfaceNormal,
  float height,
  float strength,
  float direction
) {
  vec3 sigmaX = normalize(dFdx(surfacePosition));
  vec3 sigmaY = normalize(dFdy(surfacePosition));
  vec3 r1 = cross(sigmaY, surfaceNormal);
  vec3 r2 = cross(surfaceNormal, sigmaX);
  float determinant = dot(sigmaX, r1) * direction;
  vec2 heightDerivative = vec2(dFdx(height), dFdy(height)) * strength;
  vec3 gradient = sign(determinant)
    * (heightDerivative.x * r1 + heightDerivative.y * r2);
  return normalize(abs(determinant) * surfaceNormal - gradient);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec3 architectureWeights = pow(
    abs(normalize(vArchitectureNormal)),
    vec3(${glslFloat(blendSharpness)})
  );
  architectureWeights /= max(
    architectureWeights.x + architectureWeights.y + architectureWeights.z,
    0.0001
  );
  vec2 architectureScale = vec2(${glslFloat(scaleX)}, ${glslFloat(scaleY)});
  vec4 architectureX = texture2D(
    map,
    vec2(vArchitecturePosition.z, vArchitecturePosition.y) * architectureScale
  );
  vec4 architectureY = texture2D(
    map,
    vec2(vArchitecturePosition.x, vArchitecturePosition.z) * architectureScale
  );
  vec4 architectureZ = texture2D(
    map,
    vec2(vArchitecturePosition.x, vArchitecturePosition.y) * architectureScale
  );
  vec4 architectureTexel = architectureX * architectureWeights.x
    + architectureY * architectureWeights.y
    + architectureZ * architectureWeights.z;
  diffuseColor.rgb *= mix(
    vec3(1.0),
    architectureTexel.rgb,
    ${glslFloat(colorStrength)}
  );
  diffuseColor.a *= architectureTexel.a;
  float architectureHeight = dot(
    architectureTexel.rgb,
    vec3(0.2126, 0.7152, 0.0722)
  );${weatherFragment}${interiorFinishFragment}${floorBoardsFragment}${hardscapeFragment}${macroFragment}${contactFragment}
#endif`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
#ifdef USE_MAP
  roughnessFactor = clamp(
    roughnessFactor
      + (0.5 - architectureHeight) * ${glslFloat(roughnessVariation)}${weatherRoughnessFragment}${interiorFinishRoughnessFragment}${floorBoardsRoughnessFragment}${hardscapeRoughnessFragment}${contactRoughnessFragment},
    ${glslFloat(roughnessFloor)},
    1.0
  );
#endif`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
#ifdef USE_MAP
  normal = perturbArchitectureNormal(
    -vViewPosition,
    normal,
    architectureHeight,
    ${glslFloat(bumpStrength)},
    faceDirection
  );
#endif`,
      );
  };
  material.customProgramCacheKey = () => shaderKey;
  material.userData.projectedSurface = Object.freeze({
    texture: map.name,
    metresPerTile: [1 / scaleX, 1 / scaleY],
    weathering: weatherEnabled
      ? Object.freeze({
          baseY: weatherBaseY,
          height: weatherHeight,
          strength: weatherStrength,
          roughness: weatherRoughness,
          frequency: weatherFrequency,
          exteriorOnly: exteriorMaskEnabled,
          aggregateStrength: weatherAggregateStrength,
          runoffStrength: weatherRunoffStrength,
          cornerStrength: weatherCornerStrength,
          detailRoughness: weatherDetailRoughness,
          regions: Object.freeze(weatherRegions.map((region) => Object.freeze({
            ...region,
            tint: Object.freeze([...region.tint]),
          }))),
        })
      : null,
    hardscapeWear: hardscapeEnabled
      ? Object.freeze({
          mottleStrength: hardscapeMottleStrength,
          frequency: hardscapeFrequency,
          drainageStrength: hardscapeDrainageStrength,
          drainageRoughness: hardscapeDrainageRoughness,
          trackStrength: hardscapeTrackStrength,
          trackRoughness: hardscapeTrackRoughness,
          trackWidth: hardscapeTrackWidth,
          trackCenters: Object.freeze([...hardscapeTrackCenters]),
        })
      : null,
    macroVariation: macroEnabled
      ? Object.freeze({
          strength: macroStrength,
          frequency: macroFrequency,
          warmth: macroWarmth,
        })
      : null,
    groundContact: contactEnabled
      ? Object.freeze({
          baseY: contactBaseY,
          height: contactHeight,
          strength: contactStrength,
        })
      : null,
    interiorFinish: interiorFinishEnabled
      ? Object.freeze({
          tint: Object.freeze([...interiorFinishTint]),
          roughnessShift: interiorFinishRoughness,
          variationStrength: interiorFinishVariation,
          frequency: interiorFinishFrequency,
          feather: interiorFinishFeather,
          face: interiorFinishFace,
          excludeExterior: interiorFinishExcludeExterior,
          regions: Object.freeze(interiorFinishRegions.map((region) => Object.freeze({ ...region }))),
        })
      : null,
    floorBoards: floorBoardsEnabled
      ? Object.freeze({
          width: floorBoardWidth,
          length: floorBoardLength,
          seamStrength: floorBoardSeamStrength,
          seamRoughness: floorBoardSeamRoughness,
          toneStrength: floorBoardToneStrength,
          axis: floorBoardAxis,
        })
      : null,
  });
  material.needsUpdate = true;
  return material;
}

/**
 * Gives a shared material a different response inside a few plan rectangles.
 * This is intentionally map-free: private-room metal can become a little
 * tighter and warmer without creating another material batch or changing the
 * same instanced frames beside the pool, garage, and public rooms.
 */
function applyPlanZoneResponse(material, {
  regions = [],
  tint = [0, 0, 0],
  roughnessShift = 0,
  metalnessShift = 0,
  emissiveTint = [0, 0, 0],
  emissiveStrength = 0,
  feather = 0.035,
} = {}) {
  const normalizedRegions = regions.map((region) => ({
    xMin: Math.min(region.xMin, region.xMax),
    xMax: Math.max(region.xMin, region.xMax),
    zMin: Math.min(region.zMin, region.zMax),
    zMax: Math.max(region.zMin, region.zMax),
    label: region.label ?? 'private interior',
  }));
  if (!normalizedRegions.length) return material;
  const safeFeather = Math.max(0.001, feather);
  const [tintRed = 0, tintGreen = 0, tintBlue = 0] = tint;
  const [emissiveRed = 0, emissiveGreen = 0, emissiveBlue = 0] = emissiveTint;
  const regionFragment = normalizedRegions.map((region, index) => `
  float architecturePlanResponseRegion${index} =
    smoothstep(
      ${glslFloat(region.xMin)},
      ${glslFloat(region.xMin + safeFeather)},
      vArchitectureResponsePosition.x
    )
    * (1.0 - smoothstep(
      ${glslFloat(region.xMax - safeFeather)},
      ${glslFloat(region.xMax)},
      vArchitectureResponsePosition.x
    ))
    * smoothstep(
      ${glslFloat(region.zMin)},
      ${glslFloat(region.zMin + safeFeather)},
      vArchitectureResponsePosition.z
    )
    * (1.0 - smoothstep(
      ${glslFloat(region.zMax - safeFeather)},
      ${glslFloat(region.zMax)},
      vArchitectureResponsePosition.z
    ));`).join('');
  const regionMask = normalizedRegions.slice(1).reduce(
    (expression, _region, index) => `max(${expression}, architecturePlanResponseRegion${index + 1})`,
    'architecturePlanResponseRegion0',
  );
  const shaderKey = [
    'compound-plan-zone-response-v1',
    ...tint,
    roughnessShift,
    metalnessShift,
    ...emissiveTint,
    emissiveStrength,
    safeFeather,
    ...normalizedRegions.flatMap((region) => [
      region.xMin,
      region.xMax,
      region.zMin,
      region.zMax,
    ]),
  ].join(':');

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vArchitectureResponsePosition;',
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vec4 architectureResponsePosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  architectureResponsePosition = instanceMatrix * architectureResponsePosition;
#endif
vArchitectureResponsePosition = architectureResponsePosition.xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vArchitectureResponsePosition;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
${regionFragment}
float architecturePlanResponseMask = clamp(${regionMask}, 0.0, 1.0);
diffuseColor.rgb *= vec3(1.0) + vec3(
  ${glslFloat(tintRed)},
  ${glslFloat(tintGreen)},
  ${glslFloat(tintBlue)}
) * architecturePlanResponseMask;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = clamp(
  roughnessFactor
    + architecturePlanResponseMask * ${glslFloat(roughnessShift)},
  0.04,
  1.0
);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
metalnessFactor = clamp(
  metalnessFactor
    + architecturePlanResponseMask * ${glslFloat(metalnessShift)},
  0.0,
  1.0
);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(
  ${glslFloat(emissiveRed)},
  ${glslFloat(emissiveGreen)},
  ${glslFloat(emissiveBlue)}
) * architecturePlanResponseMask * ${glslFloat(emissiveStrength)};`,
      );
  };
  material.customProgramCacheKey = () => shaderKey;
  material.userData.planZoneResponse = Object.freeze({
    tint: Object.freeze([...tint]),
    roughnessShift,
    metalnessShift,
    emissiveTint: Object.freeze([...emissiveTint]),
    emissiveStrength,
    feather: safeFeather,
    regions: Object.freeze(normalizedRegions.map((region) => Object.freeze({ ...region }))),
  });
  material.needsUpdate = true;
  return material;
}

function applyGlassResponse(material, palette = {}) {
  // Analytic sunset reflection: the panes mirror the same warm horizon,
  // cool zenith, and low sun the sky dome paints, so glazing stops reading
  // as a flat dark sheet against the amber basin.
  const glassHorizon = paletteColor(palette, 'skyHorizon', 0xb85838)
    .lerp(paletteColor(palette, 'sun', 0xffc86f), 0.22)
    .multiplyScalar(0.34);
  const glassSky = paletteColor(palette, 'skyTop', 0x343847)
    .lerp(paletteColor(palette, 'shadowTeal', 0x0b1b1d), 0.3)
    .multiplyScalar(0.5);
  const glassSun = paletteColor(palette, 'sun', 0xffc86f).multiplyScalar(0.6);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGlassHorizonColor = { value: glassHorizon };
    shader.uniforms.uGlassSkyColor = { value: glassSky };
    shader.uniforms.uGlassSunColor = { value: glassSun };
    shader.uniforms.uGlassSunDirection = { value: BIOME_SUN_DIRECTION.clone() };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vArchitectureGlassPosition;
varying vec3 vArchitectureGlassUnitPosition;
varying vec3 vArchitectureGlassUnitNormal;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vec4 architectureGlassPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  architectureGlassPosition = instanceMatrix * architectureGlassPosition;
#endif
vArchitectureGlassPosition = architectureGlassPosition.xyz;
vArchitectureGlassUnitPosition = position;
vArchitectureGlassUnitNormal = normal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vArchitectureGlassPosition;
varying vec3 vArchitectureGlassUnitPosition;
varying vec3 vArchitectureGlassUnitNormal;
uniform vec3 uGlassHorizonColor;
uniform vec3 uGlassSkyColor;
uniform vec3 uGlassSunColor;
uniform vec3 uGlassSunDirection;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `float architectureGlassFacing = clamp(abs(dot(
  normalize(normal),
  normalize(vViewPosition)
)), 0.0, 1.0);
float architectureGlassFresnel = pow(1.0 - architectureGlassFacing, 2.6);

vec3 architectureGlassFaceAxes = 1.0 - abs(normalize(
  vArchitectureGlassUnitNormal
));
float architectureGlassEdgeCoordinate = max(
  abs(vArchitectureGlassUnitPosition.x) * architectureGlassFaceAxes.x,
  max(
    abs(vArchitectureGlassUnitPosition.y) * architectureGlassFaceAxes.y,
    abs(vArchitectureGlassUnitPosition.z) * architectureGlassFaceAxes.z
  )
);
float architectureGlassEdgeSeal = smoothstep(
  0.482,
  0.499,
  architectureGlassEdgeCoordinate
);
float architectureGlassUpperSheen = smoothstep(
  -0.08,
  0.48,
  vArchitectureGlassUnitPosition.y
);
float architectureGlassWaveA = sin(
  dot(vArchitectureGlassPosition.xz, vec2(0.78, 1.13)) * 1.2
    + vArchitectureGlassPosition.y * 5.3
);
float architectureGlassWaveB = sin(
  dot(vArchitectureGlassPosition.xz, vec2(-1.41, 0.63)) * 2.1
    - vArchitectureGlassPosition.y * 10.7
);
float architectureGlassImperfection = clamp(
  0.5 + architectureGlassWaveA * 0.23 + architectureGlassWaveB * 0.17,
  0.0,
  1.0
);
float architectureGlassReflection = (
  0.045
  + architectureGlassFresnel * 0.34
  + architectureGlassEdgeSeal * 0.075
  + architectureGlassUpperSheen * (0.012 + architectureGlassFresnel * 0.022)
) * mix(0.95, 1.05, architectureGlassImperfection);
vec3 architectureGlassWorldNormal = inverseTransformDirection(normal, viewMatrix);
vec3 architectureGlassReflect = reflect(
  -normalize(inverseTransformDirection(normalize(vViewPosition), viewMatrix)),
  architectureGlassWorldNormal
);
float architectureGlassSkyBand = smoothstep(
  -0.03,
  0.48,
  clamp(architectureGlassReflect.y, -0.1, 0.8)
);
vec3 architectureGlassReflectionTint = mix(
  uGlassHorizonColor,
  uGlassSkyColor,
  architectureGlassSkyBand
);
float architectureGlassSunGlint = pow(
  max(dot(architectureGlassReflect, uGlassSunDirection), 0.0),
  26.0
);
architectureGlassReflectionTint += uGlassSunColor
  * architectureGlassSunGlint
  * (0.55 + architectureGlassImperfection * 0.3);
outgoingLight = mix(
  outgoingLight,
  architectureGlassReflectionTint,
  clamp(architectureGlassReflection, 0.0, 0.5)
);
outgoingLight += uGlassSunColor * architectureGlassSunGlint
  * architectureGlassFresnel * 0.5;
diffuseColor.a = clamp(
  diffuseColor.a
    + architectureGlassFresnel * 0.135
    + architectureGlassEdgeSeal * 0.095
    + (architectureGlassImperfection - 0.5) * 0.012,
  0.0,
  0.66
);
#include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'compound-glass-sunset-v3';
  material.userData.glassResponse = Object.freeze({
    response: 'Fresnel, pane-edge seal, analytic sunset-sky reflection with sun glint, and local micro-waviness',
    maximumOpacity: 0.66,
  });
  material.needsUpdate = true;
  return material;
}

function addPlanBox(batch, planX, planZ, y, width, height, depth, rotationY = 0) {
  const local = planToLocal(planX, planZ);
  batch.add(local.x, y, local.z, width, height, depth, rotationY);
}

function addLinearBox(batch, axis, at, from, to, bottom, height, thickness) {
  const centerAlong = (from + to) * 0.5;
  const planX = axis === 'x' ? centerAlong : at;
  const planZ = axis === 'x' ? at : centerAlong;
  const length = Math.max(0.001, to - from) * FEET_TO_METERS;
  addPlanBox(
    batch,
    planX,
    planZ,
    bottom + height * 0.5,
    axis === 'x' ? length : thickness,
    height,
    axis === 'x' ? thickness : length,
  );
}

function addCollider(colliders, id, axis, at, from, to, base, height, thickness, kind = 'wall') {
  const centerAlong = (from + to) * 0.5;
  const planX = axis === 'x' ? centerAlong : at;
  const planZ = axis === 'x' ? at : centerAlong;
  const world = planToWorld(planX, planZ);
  const length = Math.max(0.001, to - from) * FEET_TO_METERS;
  const halfExtents = new THREE.Vector3(
    (axis === 'x' ? length : thickness) * 0.5,
    height * 0.5,
    (axis === 'x' ? thickness : length) * 0.5,
  );
  const center = new THREE.Vector3(world.x, base + height * 0.5, world.z);
  colliders.push({
    shape: 'box',
    type: 'box',
    kind,
    id,
    name: id,
    center,
    position: center,
    halfExtents,
    size: halfExtents.clone().multiplyScalar(2),
    yaw: COMPOUND_SITE.yaw,
    enabled: true,
  });
}

function addPerimeter(batch, rectangle, y, height, thickness, outset = 0) {
  const z = rectangleZ(rectangle);
  const x0 = rectangle.x - outset / FEET_TO_METERS;
  const x1 = rectangle.x + rectangle.width + outset / FEET_TO_METERS;
  const z0 = z - outset / FEET_TO_METERS;
  const z1 = z + rectangle.depth + outset / FEET_TO_METERS;
  addLinearBox(batch, 'x', z0, x0, x1, y - height * 0.5, height, thickness);
  addLinearBox(batch, 'x', z1, x0, x1, y - height * 0.5, height, thickness);
  addLinearBox(batch, 'z', x0, z0, z1, y - height * 0.5, height, thickness);
  addLinearBox(batch, 'z', x1, z0, z1, y - height * 0.5, height, thickness);
}

function makeLanceLeafGeometry() {
  // A lightly folded, pointed leaf that grows diagonally from its base. Yawing
  // instances around a shared crown creates convincing bird-of-paradise and
  // ginger silhouettes with a very small vertex budget.
  const positions = new Float32Array([
    0.00, -0.50, 0.00,  -0.17, -0.04, 0.00,   0.34, 0.50, 0.00,
    0.00, -0.50, 0.00,   0.34, 0.50, 0.00,    0.19, 0.02, 0.00,
    0.00, -0.50, 0.00,   0.04, 0.02, 0.055,  -0.17, -0.04, 0.00,
    -0.17, -0.04, 0.00,  0.04, 0.02, 0.055,   0.34, 0.50, 0.00,
    0.34, 0.50, 0.00,    0.04, 0.02, 0.055,   0.19, 0.02, 0.00,
    0.19, 0.02, 0.00,    0.04, 0.02, 0.055,   0.00, -0.50, 0.00,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.name = 'Low-poly folded tropical lance leaf';
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeSoftContactTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 4, 32, 32, 31);
  gradient.addColorStop(0, 'rgb(255,255,255)');
  gradient.addColorStop(0.58, 'rgb(210,210,210)');
  gradient.addColorStop(1, 'rgb(0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'Soft compound contact falloff';
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function makeLinenTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = '#d4c5af';
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Alternating warp and weft values produce a quiet woven normal cue once
  // the projected-surface shader derives height from luminance. The pattern is
  // deliberately finer than the rug so upholstery never reads as another rug.
  for (let index = 0; index < canvas.width; index += 2) {
    context.fillStyle = index % 4
      ? 'rgba(105,88,70,.16)'
      : 'rgba(247,235,214,.22)';
    context.fillRect(index, 0, 1, canvas.height);
    context.fillStyle = index % 4
      ? 'rgba(245,232,210,.18)'
      : 'rgba(112,92,73,.13)';
    context.fillRect(0, index, canvas.width, 1);
  }

  let state = 0x71c4_2ea9;
  for (let index = 0; index < 420; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const x = state & 127;
    const y = (state >>> 9) & 127;
    context.fillStyle = state & 0x10000
      ? 'rgba(255,244,224,.10)'
      : 'rgba(75,61,50,.08)';
    context.fillRect(x, y, 1, 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'Procedural fine linen upholstery weave';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.MirroredRepeatWrapping;
  texture.wrapT = THREE.MirroredRepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  return texture;
}

function makePoolWater(width, depth, palette) {
  const geometry = new THREE.PlaneGeometry(width, depth, 1, 1);
  const deep = paletteColor(palette, 'shadowTeal', 0x123f43).lerp(new THREE.Color(0x24686b), 0.36);
  const light = new THREE.Color(0x6eaaa1).lerp(paletteColor(palette, 'sun', 0xffc86f), 0.045);
  const sky = paletteColor(palette, 'mist', 0xc8b28f)
    .lerp(paletteColor(palette, 'sun', 0xffc86f), 0.12)
    .lerp(deep, 0.38);
  const sun = paletteColor(palette, 'sun', 0xffc86f);
  const horizon = paletteColor(palette, 'mist', 0xc8b28f)
    .lerp(sun, 0.28)
    .lerp(new THREE.Color(0xa5b4aa), 0.14)
    .lerp(deep, 0.18);
  const structure = paletteColor(palette, 'shadowTeal', 0x172d2f)
    .lerp(new THREE.Color(0x5c4b3c), 0.18);
  const material = new THREE.ShaderMaterial({
    name: 'Depth-absorbing reflected courtyard pool water',
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: { value: 0 },
      uDeep: { value: deep },
      uLight: { value: light },
      uSky: { value: sky },
      uSun: { value: sun },
      uHorizon: { value: horizon },
      uStructure: { value: structure },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uLight;
      uniform vec3 uSky;
      uniform vec3 uSun;
      uniform vec3 uHorizon;
      uniform vec3 uStructure;
      varying vec2 vUv;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      void main() {
        float phaseA = vWorld.x * 2.8 + vWorld.z * .35 + uTime * .63;
        float phaseB = vWorld.z * 4.1 - vWorld.x * .22 - uTime * .48;
        float phaseC = (vWorld.x + vWorld.z) * 7.3 + uTime * .31;
        float a = sin(phaseA);
        float b = sin(phaseB);
        float c = sin(phaseC);
        float ripple = .5 + .5 * (a * .46 + b * .36 + c * .18);
        vec2 slope = vec2(
          cos(phaseA) * .075 + cos(phaseC) * .035,
          cos(phaseB) * .082 + cos(phaseC) * .035
        );
        vec3 waterNormal = normalize(vec3(-slope.x, 1.0, -slope.y));
        vec3 viewDirection = normalize(cameraPosition - vWorld);
        float facing = clamp(dot(waterNormal, viewDirection), 0.0, 1.0);
        float fresnel = .045 + .52 * pow(1.0 - facing, 4.0);

        // Centre-weighted absorption gives the water a real basin volume;
        // near-edge light remains shallow enough to reveal steps and coping.
        float edgeDistance = min(min(vUv.x, 1.0-vUv.x), min(vUv.y, 1.0-vUv.y));
        float depthAbsorption = smoothstep(.035, .25, edgeDistance);
        vec3 refracted = mix(
          uLight,
          uDeep * .78,
          .38 + depthAbsorption * .47 - ripple * .055
        );

        // A low-cost reflected environment approximation follows the actual
        // ripple normal: warm horizon above, darker façade/pergola bands at
        // grazing angles, and a faint broken post rhythm near the waterline.
        vec3 reflectionDirection = reflect(-viewDirection, waterNormal);
        float reflectedHeight = clamp(reflectionDirection.y, -.08, .72);
        float skyHeight = smoothstep(-.025, .46, reflectedHeight);
        vec3 reflectedSky = mix(uHorizon, uSky, skyHeight);
        float structureBand = 1.0 - smoothstep(.045, .255, reflectedHeight);
        float structureRhythm = .5 + .5 * sin(
          vWorld.x * 1.24 + vWorld.z * .39 + ripple * 1.8
        );
        structureRhythm = smoothstep(.58, .90, structureRhythm);
        vec3 reflected = mix(
          reflectedSky,
          uStructure,
          structureBand * (.24 + structureRhythm * .16)
        );
        vec3 color = mix(refracted, reflected, clamp(.07 + fresnel * 1.05, 0.0, .66));

        // Crossed, softly thresholded ripple bands suggest moving caustics on
        // the pale basin without turning the pool surface into glitter.
        float causticPhaseA = vUv.x * 79.0 + vUv.y * 31.0 + uTime * .72;
        float causticPhaseB = vUv.y * 67.0 - vUv.x * 23.0 - uTime * .59;
        float causticField = .5
          + .22 * sin(causticPhaseA + sin(causticPhaseB) * .82)
          + .18 * sin(causticPhaseB + sin(causticPhaseA) * .67)
          + .10 * sin((vUv.x - vUv.y) * 113.0 + uTime * .31);
        float caustics = smoothstep(.82, .965, causticField);
        color += uSun * caustics * (1.0 - fresnel) * (.010 + (1.0 - depthAbsorption) * .012);

        // The glint matches the river's copper stream: the same low biome sun
        // and a moving broken track, so both waters read as one world.
        vec3 sunDirection = normalize(vec3(-.48, .105, -.87));
        vec3 sunHalf = normalize(viewDirection + sunDirection);
        float glint = pow(max(dot(waterNormal, sunHalf), 0.0), 88.0);
        float glintTrack = .5 + .5 * sin(
          vWorld.x * 1.05 + vWorld.z * .45 + uTime * 1.4 + ripple * 1.6
        );
        glint *= .35 + .65 * smoothstep(.42, .9, glintTrack);
        color += uSun * glint * (.6 + ripple * .35);

        float shallowBand = 1.0 - smoothstep(.012, .07, edgeDistance);
        color = mix(color, uLight, shallowBand * .095);
        float alpha = .79 + depthAbsorption * .05 + fresnel * .13 + shallowBand * .02;
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: true,
    fog: true,
  });
  material.userData.waterResponse = Object.freeze({
    response: 'depth absorption, analytic sky/facade reflection, shallow caustics',
    additionalDrawCalls: 0,
  });
  return { geometry, material };
}

/**
 * Turns the exact A-103 plan wall pieces into a finished, single-storey
 * compound. All child geometry uses compound-root-local X/Z coordinates and
 * absolute terrain Y values; the returned root supplies COMPOUND_SITE's world
 * translation and yaw. Collider centers, by contrast, are already in world
 * coordinates so a controller can consume them without traversing the root.
 */
export function createCompoundArchitecture({
  heightAt,
  palette = {},
  windUniforms = null,
  wallPieces = [],
  doorOpenings = [],
  windowOpenings = [],
} = {}) {
  const root = new THREE.Group();
  root.name = 'Realized courtyard compound';
  root.position.set(COMPOUND_SITE.centerX, 0, COMPOUND_SITE.centerZ);
  root.rotation.y = COMPOUND_SITE.yaw;
  root.userData.coordinateSystem = 'plan-aligned local metres; absolute world elevation';
  root.userData.planScale = '1 plan foot = 0.3048 world metres';

  const normalizedDoors = doorOpenings.map(normalizeOpening);
  const normalizedWindows = windowOpenings.map(normalizeOpening);
  const segments = uniqueSegments(wallPieces);
  const colliders = [];
  const resources = { geometries: new Set(), materials: new Set(), textures: new Set() };

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const softUnitBox = new RoundedBoxGeometry(1, 1, 1, 2, 0.045);
  const unitCylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1, false);
  const leafGeometry = makeLanceLeafGeometry();
  const contactGeometry = new THREE.PlaneGeometry(1, 1);
  contactGeometry.rotateX(-Math.PI * 0.5);
  const wallWashGeometry = new THREE.PlaneGeometry(1, 1);
  resources.geometries
    .add(unitBox)
    .add(softUnitBox)
    .add(unitCylinder)
    .add(leafGeometry)
    .add(contactGeometry)
    .add(wallWashGeometry);
  // If a scan fails to load, drop back to the authored base colours instead
  // of letting an empty sampler pull every projected surface toward black.
  const architectureTextures = loadArchitectureTextures((failedTexture) => {
    resources.materials.forEach((material) => {
      if (material.map === failedTexture) {
        material.map = null;
        material.needsUpdate = true;
      }
    });
  });
  architectureTextures.linen = makeLinenTexture();
  Object.values(architectureTextures).forEach((texture) => resources.textures.add(texture));
  const contactTexture = makeSoftContactTexture();
  resources.textures.add(contactTexture);
  const compoundPadY = safeHeight(
    heightAt,
    COMPOUND_SITE.centerX,
    COMPOUND_SITE.centerZ,
  );
  const drivewayTrackCenter = planToLocal(
    COMPOUND_PLAN.driveway.x + COMPOUND_PLAN.driveway.width * 0.5,
    rectangleZ(COMPOUND_PLAN.driveway),
  ).x;
  const serviceTrackCenter = planToLocal(
    COMPOUND_PLAN.serviceDrive.x + COMPOUND_PLAN.serviceDrive.width * 0.5,
    rectangleZ(COMPOUND_PLAN.serviceDrive),
  ).x;
  const driveTrackCenters = Object.freeze([
    drivewayTrackCenter - 0.82,
    drivewayTrackCenter + 0.82,
    serviceTrackCenter - 0.66,
    serviceTrackCenter + 0.66,
  ]);
  const exteriorShellStyle = {
    'main-house': { detailStrength: 0, tint: [0, 0, 0] },
    garage: { detailStrength: 1, tint: [-0.024, -0.018, -0.010] },
    'fab-lab': { detailStrength: 0.9, tint: [-0.014, -0.010, -0.004] },
    'guest-house': { detailStrength: 0.78, tint: [0.010, 0.006, 0] },
  };
  const exteriorWeatherRegions = Object.freeze(COMPOUND_PLAN.buildingList.map((rectangle) => {
    const minimum = planToLocal(rectangle.x, rectangleZ(rectangle));
    const maximum = planToLocal(
      rectangle.x + rectangle.width,
      rectangleZ(rectangle) + rectangle.depth,
    );
    const style = exteriorShellStyle[rectangle.id] ?? exteriorShellStyle['main-house'];
    return Object.freeze({
      xMin: minimum.x,
      xMax: maximum.x,
      zMin: minimum.z,
      zMax: maximum.z,
      weatherStrength: 1,
      detailStrength: style.detailStrength,
      tint: Object.freeze([...style.tint]),
    });
  }));
  const makePrivateFinishRegion = (label, xMin, zMin, xMax, zMax) => {
    const minimum = planToLocal(xMin, zMin);
    const maximum = planToLocal(xMax, zMax);
    return Object.freeze({
      label,
      xMin: Math.min(minimum.x, maximum.x),
      xMax: Math.max(minimum.x, maximum.x),
      zMin: Math.min(minimum.z, maximum.z),
      zMax: Math.max(minimum.z, maximum.z),
    });
  };
  // The small offsets split the two faces of each thin partition: the room
  // side receives the warmer finish while the hall/public face remains on the
  // cooler compound palette. Exterior shell faces are rejected by normal and
  // shell position in the stucco shader below.
  const privateInteriorFinishRegions = Object.freeze([
    makePrivateFinishRegion('Bedroom, bath, and closet wing', 37.16, 16.16, 97.84, 25.84),
    makePrivateFinishRegion('Primary sleeping suite', 86.16, 26.16, 97.84, 41.84),
    makePrivateFinishRegion('Guest house interior', 108.16, 76.16, 133.84, 97.84),
  ]);

  const stuccoColor = new THREE.Color(0xeff1ed)
    .lerp(paletteColor(palette, 'shadowTeal', 0x173333), 0.025);
  const materials = {
    stucco: standardMaterial('Cool-white mineral stucco', stuccoColor, {
      roughness: 0.94,
      emissive: 0x26302f,
      emissiveIntensity: 0.025,
      projectedSurface: {
        map: architectureTextures.stucco,
        scale: 0.72,
        colorStrength: 0.72,
        roughnessVariation: 0.06,
        roughnessFloor: 0.86,
        bumpStrength: 0.42,
        weatherBaseY: compoundPadY,
        weatherHeight: 0.58,
        weatherStrength: 0.13,
        weatherRoughness: 0.03,
        weatherFrequency: 0.55,
        exteriorWeathering: {
          regions: exteriorWeatherRegions,
          aggregateStrength: 0.085,
          runoffStrength: 0.055,
          cornerStrength: 0.065,
          detailRoughness: 0.04,
        },
        interiorFinish: {
          regions: privateInteriorFinishRegions,
          tint: [0.026, 0.014, -0.012],
          roughnessShift: -0.05,
          variationStrength: 0.016,
          frequency: 0.43,
          feather: 0.032,
          face: 'vertical',
          excludeExterior: true,
        },
        macroVariation: { strength: 0.07, frequency: 0.42, warmth: 0.7 },
        groundContact: { baseY: compoundPadY, height: 0.44, strength: 0.2 },
      },
    }),
    roof: standardMaterial('Cool-white flat roof', new THREE.Color(0xe8ebe7), {
      roughness: 0.9,
      projectedSurface: {
        map: architectureTextures.stucco,
        scale: 0.46,
        colorStrength: 0.72,
        roughnessVariation: 0.05,
        roughnessFloor: 0.84,
        bumpStrength: 0.26,
        macroVariation: { strength: 0.075, frequency: 0.3, warmth: 0.6 },
      },
    }),
    stone: standardMaterial('Pale honed limestone', new THREE.Color(0xe5e2d9), {
      roughness: 0.82,
      projectedSurface: {
        map: architectureTextures.paleStone,
        scale: 0.34,
        colorStrength: 0.82,
        roughnessVariation: 0.1,
        roughnessFloor: 0.72,
        bumpStrength: 0.3,
        macroVariation: { strength: 0.08, frequency: 0.38, warmth: 0.8 },
        hardscapeWear: {
          mottleStrength: 0.16,
          frequency: 0.34,
          drainageStrength: 0.07,
          drainageRoughness: 0.055,
        },
      },
    }),
    stoneEdge: standardMaterial('Pale cut-limestone edge', new THREE.Color(0xcacbc4), {
      roughness: 0.88,
      projectedSurface: {
        map: architectureTextures.paleStone,
        scale: 0.4,
        colorStrength: 0.7,
        roughnessVariation: 0.08,
        roughnessFloor: 0.8,
        bumpStrength: 0.26,
        macroVariation: { strength: 0.04, frequency: 0.17, warmth: 0.7 },
        groundContact: { baseY: compoundPadY, height: 0.4, strength: 0.2 },
      },
    }),
    interiorFloor: standardMaterial('Warm honed interior concrete', new THREE.Color(0xa3a096), {
      roughness: 0.7,
      emissive: 0x5c574c,
      emissiveIntensity: 0.34,
      projectedSurface: {
        map: architectureTextures.paleStone,
        scale: 0.55,
        colorStrength: 0.52,
        roughnessVariation: 0.06,
        roughnessFloor: 0.6,
        bumpStrength: 0.14,
        blendSharpness: 18,
      },
    }),
    privateFloor: standardMaterial('Warm white-oak private-room floor', new THREE.Color(0xbca78d), {
      roughness: 0.67,
      emissive: 0x31251b,
      emissiveIntensity: 0.055,
      projectedSurface: {
        map: architectureTextures.cedar,
        scale: [0.72, 0.22],
        colorStrength: 0.36,
        roughnessVariation: 0.07,
        roughnessFloor: 0.58,
        bumpStrength: 0.11,
        blendSharpness: 20,
        floorBoards: {
          width: 0.19,
          length: 1.82,
          seamStrength: 0.075,
          seamRoughness: 0.055,
          toneStrength: 0.035,
          axis: 'z',
        },
      },
    }),
    joint: standardMaterial('Subtle paving joint', new THREE.Color(0xb8b9b1), { roughness: 0.96 }),
    drive: standardMaterial('Cool-gray permeable motor court', new THREE.Color(0xb2b5ae), {
      roughness: 0.96,
      projectedSurface: {
        map: architectureTextures.aggregate,
        scale: 1.2,
        colorStrength: 0.78,
        roughnessVariation: 0.08,
        roughnessFloor: 0.86,
        bumpStrength: 0.72,
        blendSharpness: 18,
        hardscapeWear: {
          mottleStrength: 0.19,
          frequency: 0.28,
          drainageStrength: 0.085,
          drainageRoughness: 0.060,
          trackStrength: 0.090,
          trackRoughness: 0.050,
          trackWidth: 0.34,
          trackCenters: driveTrackCenters,
        },
        macroVariation: { strength: 0.08, frequency: 0.32, warmth: 0.55 },
      },
    }),
    tanStone: standardMaterial('Warm vein-cut feature stone', new THREE.Color(0xd2bda1), {
      roughness: 0.9,
      projectedSurface: {
        map: architectureTextures.featureStone,
        scale: [0.34, 0.28],
        colorStrength: 0.8,
        roughnessVariation: 0.1,
        roughnessFloor: 0.78,
        bumpStrength: 0.34,
        macroVariation: { strength: 0.045, frequency: 0.19, warmth: 0.85 },
        groundContact: { baseY: compoundPadY, height: 0.38, strength: 0.14 },
      },
    }),
    stoneJoint: standardMaterial('Recessed feature-stone joint', new THREE.Color(0x62584b), {
      roughness: 0.96,
    }),
    charcoal: standardMaterial('Matte black frame and fascia', new THREE.Color(0x11191a), {
      roughness: 0.48,
      metalness: 0.18,
    }),
    cedar: standardMaterial('Oiled cedar', new THREE.Color(0xb98f6c), {
      roughness: 0.72,
      emissive: 0x351509,
      emissiveIntensity: 0.045,
      projectedSurface: {
        map: architectureTextures.cedar,
        scale: [0.5, 0.2],
        colorStrength: 0.56,
        roughnessVariation: 0.12,
        roughnessFloor: 0.58,
        bumpStrength: 0.25,
        blendSharpness: 18,
      },
    }),
    cedarDark: standardMaterial('Cedar shadow', new THREE.Color(0x76543e), {
      roughness: 0.78,
      projectedSurface: {
        map: architectureTextures.cedar,
        scale: [0.54, 0.2],
        colorStrength: 0.42,
        roughnessVariation: 0.1,
        roughnessFloor: 0.64,
        bumpStrength: 0.2,
        blendSharpness: 18,
        groundContact: { baseY: compoundPadY, height: 0.3, strength: 0.12 },
      },
    }),
    glass: applyGlassResponse(standardMaterial('Lightly reflective architectural glass', new THREE.Color(0x18363a), {
      roughness: 0.075,
      metalness: 0.08,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
      side: THREE.DoubleSide,
      emissive: 0x081415,
      emissiveIntensity: 0.08,
    }), palette),
    glow: standardMaterial('Warm interior glow', new THREE.Color(0xffc27a), {
      roughness: 1,
      transparent: true,
      opacity: 0.09,
      depthWrite: false,
      side: THREE.DoubleSide,
      emissive: 0xff9f4f,
      emissiveIntensity: 1.85,
    }),
    furnitureWood: standardMaterial('Modern furniture oak', new THREE.Color(0xa87c55), {
      roughness: 0.72,
      projectedSurface: {
        map: architectureTextures.cedar,
        scale: [2.4, 0.9],
        colorStrength: 0.32,
        roughnessVariation: 0.06,
        roughnessFloor: 0.60,
        bumpStrength: 0.10,
        blendSharpness: 18,
        interiorFinish: {
          regions: privateInteriorFinishRegions,
          tint: [0.032, 0.014, -0.018],
          roughnessShift: -0.035,
          variationStrength: 0.012,
          frequency: 0.56,
          feather: 0.032,
        },
      },
    }),
    workSurface: standardMaterial('Oiled birch utility work surface', new THREE.Color(0xb99a73), {
      roughness: 0.62,
      emissive: 0x2d1d10,
      emissiveIntensity: 0.08,
      projectedSurface: {
        map: architectureTextures.cedar,
        scale: [0.44, 0.16],
        colorStrength: 0.46,
        roughnessVariation: 0.07,
        roughnessFloor: 0.54,
        bumpStrength: 0.14,
        blendSharpness: 18,
      },
    }),
    furnitureDark: applyPlanZoneResponse(standardMaterial('Modern furniture dark metal', new THREE.Color(0x303638), {
      roughness: 0.50,
      metalness: 0.18,
      emissive: 0x111819,
      emissiveIntensity: 0.10,
    }), {
      regions: privateInteriorFinishRegions,
      tint: [0.018, 0.006, -0.012],
      roughnessShift: -0.055,
      metalnessShift: 0.10,
      emissiveTint: [0.05, 0.025, 0.012],
      emissiveStrength: 0.018,
      feather: 0.032,
    }),
    upholstery: standardMaterial('Sand linen upholstery', new THREE.Color(0xc5b59f), {
      roughness: 0.96,
      emissive: 0x2f2922,
      emissiveIntensity: 0.07,
      projectedSurface: {
        map: architectureTextures.linen,
        scale: 5.5,
        colorStrength: 0.19,
        roughnessVariation: 0.045,
        roughnessFloor: 0.88,
        bumpStrength: 0.13,
        blendSharpness: 16,
        interiorFinish: {
          regions: privateInteriorFinishRegions,
          tint: [0.040, 0.024, 0.008],
          roughnessShift: -0.025,
          variationStrength: 0.014,
          frequency: 0.74,
          feather: 0.032,
        },
      },
    }),
    waterBasin: standardMaterial('Pool basin', new THREE.Color(0x3c6b6d), { roughness: 0.52 }),
    soil: standardMaterial('Planter soil', paletteColor(palette, 'soil', 0x38291f), { roughness: 1 }),
    foliage: standardMaterial('Courtyard foliage', new THREE.Color(0x356845).lerp(paletteColor(palette, 'bamboo', 0x234f39), 0.16), {
      roughness: 0.92,
      side: THREE.DoubleSide,
      emissive: 0x0d2115,
      emissiveIntensity: 0.08,
    }),
    foliageLight: standardMaterial('Courtyard foliage tips', new THREE.Color(0x71894f).lerp(paletteColor(palette, 'grassLit', 0x75884c), 0.18), {
      roughness: 0.94,
      side: THREE.DoubleSide,
      emissive: 0x18220d,
      emissiveIntensity: 0.07,
    }),
    sconce: standardMaterial('Warm exterior sconce lens', new THREE.Color(0xffc078), {
      roughness: 0.55,
      emissive: 0xff8f3f,
      emissiveIntensity: 3.1,
    }),
  };
  // Managed courtyard foliage bends with the exact gust field that drives the
  // wild meadow: still air inside the compound was the loudest tell that the
  // architecture lived in a different renderer than its surroundings.
  if (windUniforms) {
    const leafBendOptions = {
      bendScale: 0.085,
      flutterScale: 0.016,
      weightExpression: 'clamp(position.y + 0.5, 0.0, 1.0)',
    };
    applyInstancedFoliageWind(materials.foliage, windUniforms, {
      ...leafBendOptions,
      key: 'compound-leaf',
    });
    applyInstancedFoliageWind(materials.foliageLight, windUniforms, {
      ...leafBendOptions,
      key: 'compound-leaf-tip',
    });
  }
  // Exterior shells, hardscape, and planting share the biome's warm
  // height-graded fog and a restrained sun-facing rim so built surfaces take
  // the sunset palette the way every natural silhouette already does.
  for (const [materialKey, rimStrength] of [
    ['stucco', 0.075],
    ['roof', 0.05],
    ['stone', 0.05],
    ['stoneEdge', 0.045],
    ['drive', 0.045],
    ['tanStone', 0.06],
    ['charcoal', 0.055],
    ['cedar', 0.06],
    ['cedarDark', 0.05],
    ['foliage', 0.1],
    ['foliageLight', 0.1],
    ['waterBasin', 0],
    ['soil', 0],
    ['joint', 0],
  ]) {
    applyBiomeAtmosphere(materials[materialKey], {
      palette,
      rimStrength,
      key: materialKey,
    });
  }
  Object.values(materials).forEach((material) => resources.materials.add(material));
  const contactMaterial = new THREE.MeshBasicMaterial({
    name: 'Soft multiply-blended compound contact shadow',
    color: 0x071111,
    alphaMap: contactTexture,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
    blending: THREE.MultiplyBlending,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  resources.materials.add(contactMaterial);
  const wallWashMaterial = new THREE.MeshBasicMaterial({
    name: 'Soft additive exterior sconce wash',
    color: 0xffa45c,
    alphaMap: contactTexture,
    transparent: true,
    opacity: 0.105,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  resources.materials.add(wallWashMaterial);

  const batch = {};
  const boxBatch = (key, name, material, options) => {
    const value = new InstanceBatch(name, unitBox, material, options);
    batch[key] = value;
    return value;
  };
  boxBatch('stucco', 'Plan-faithful stucco wall solids', materials.stucco);
  boxBatch('roof', 'Flat roof planes and white parapets', materials.roof);
  boxBatch('stone', 'Pale stone slabs and coping', materials.stone);
  boxBatch('stoneEdge', 'Stone slab edges and foundations', materials.stoneEdge);
  boxBatch('interiorFloor', 'Honed floors in principal work and living interiors', materials.interiorFloor);
  boxBatch('privateFloor', 'White-oak floors in private sleeping and dressing rooms', materials.privateFloor, { castShadow: false });
  boxBatch('joint', 'Quiet flush paving joints', materials.joint, { castShadow: false });
  boxBatch('drive', 'Motor-court and service-drive paving', materials.drive, { castShadow: false });
  boxBatch('tanStone', 'Warm stone-clad feature planes', materials.tanStone);
  boxBatch('stoneJoint', 'Feature-stone control joints and edge returns', materials.stoneJoint, { castShadow: false });
  boxBatch('charcoal', 'Black window frames and fascias', materials.charcoal);
  boxBatch('cedar', 'Cedar soffits, screens and pergola slats', materials.cedar);
  boxBatch('cedarDark', 'Cedar posts and deep trim', materials.cedarDark);
  boxBatch('glass', 'Floor-to-ceiling courtyard glazing', materials.glass, { castShadow: false, receiveShadow: false });
  boxBatch('glow', 'Warm luminous interior planes', materials.glow, { castShadow: false, receiveShadow: false });
  boxBatch('furnitureWood', 'Oak furniture forms', materials.furnitureWood);
  boxBatch('workSurface', 'Birch utility worktops and shelves', materials.workSurface);
  boxBatch('furnitureDark', 'Dark modern furniture frames', materials.furnitureDark);
  batch.upholstery = new InstanceBatch('Soft sand-colored furniture', softUnitBox, materials.upholstery);
  boxBatch('waterBasin', 'Pool basin shell', materials.waterBasin, { castShadow: false });
  boxBatch('soil', 'Raised-bed soil', materials.soil, { castShadow: false });
  boxBatch('sconce', 'Warm exterior sconces', materials.sconce, { castShadow: false });
  batch.sconceWash = new InstanceBatch(
    'Soft exterior sconce light pools',
    wallWashGeometry,
    wallWashMaterial,
    { castShadow: false, receiveShadow: false },
  );

  const planterGeometry = new THREE.CylinderGeometry(0.38, 0.5, 1, 10, 1, false);
  resources.geometries.add(planterGeometry);
  const potBatch = new InstanceBatch('Tapered pale-stone planters', planterGeometry, materials.stoneEdge);
  const trunkBatch = new InstanceBatch('Courtyard plant trunks', unitCylinder, materials.cedarDark);
  const leafBatch = new InstanceBatch('Restrained lush courtyard foliage', leafGeometry, materials.foliage, {
    tintJitter: { amount: 0.16, warmth: 0.6 },
  });
  const leafTipBatch = new InstanceBatch('Sunlit courtyard foliage tips', leafGeometry, materials.foliageLight, {
    tintJitter: { amount: 0.14, warmth: 0.75 },
  });
  const contactBatch = new InstanceBatch(
    'Soft compound-scale contact grounding',
    contactGeometry,
    contactMaterial,
    { castShadow: false, receiveShadow: false },
  );

  const addSoftContact = (planX, planZ, y, width, depth, rotationY = 0) => {
    addPlanBox(contactBatch, planX, planZ, y, width, 1, depth, rotationY);
  };

  const baseByBuilding = new Map();
  for (const rectangle of COMPOUND_PLAN.buildingList) {
    const base = sampleTerraceHeight(heightAt, rectangle);
    baseByBuilding.set(rectangle.id, base);
    const z = rectangleZ(rectangle);
    const centerX = rectangle.x + rectangle.width * 0.5;
    const centerZ = z + rectangle.depth * 0.5;
    const width = rectangle.width * FEET_TO_METERS;
    const depth = rectangle.depth * FEET_TO_METERS;
    const style = BUILDING_STYLE[rectangle.id] ?? BUILDING_STYLE['main-house'];

    // A deep shadow-jointed plinth levels each volume on the natural shelf.
    addPlanBox(batch.stoneEdge, centerX, centerZ, base - FOUNDATION_DEPTH * 0.5, width, FOUNDATION_DEPTH, depth);
    const usesInteriorFloor = rectangle.id !== 'guest-house';
    const interiorFloorBatch = usesInteriorFloor ? batch.interiorFloor : batch.stone;
    addPlanBox(
      interiorFloorBatch,
      centerX,
      centerZ,
      base + FINISHED_SURFACE_LIFT - 0.055,
      width - 0.12,
      0.11,
      depth - 0.12,
    );
    // The dark plinth grounds occupied volumes by itself. A building-wide
    // multiply card would sit over these visible floors, so retain that soft
    // card only beneath the guest volume whose slab is not part of this pass.
    if (!usesInteriorFloor) {
      addSoftContact(centerX, centerZ, base + 0.014, width + 0.72, depth + 0.72);
    }
    addPerimeter(batch.charcoal, rectangle, base + 0.025, 0.035, 0.032, 0.025);

    // Thin, planar roof plates with black perimeter fascias and a pale parapet.
    addPlanBox(batch.roof, centerX, centerZ, base + style.roofHeight, width + ROOF_OVERHANG * 2, 0.16, depth + ROOF_OVERHANG * 2);
    addPerimeter(batch.charcoal, rectangle, base + style.roofHeight + 0.035, 0.20, 0.075, ROOF_OVERHANG);
    addPerimeter(batch.roof, rectangle, base + style.roofHeight + 0.28, 0.38, 0.14, 0.05);
    addPerimeter(batch.stoneEdge, rectangle, base + style.roofHeight + 0.485, 0.035, 0.19, 0.08);
  }

  // Full-height solids come directly from the existing cut wall-piece list.
  // Window spans retain their low sill and gain a separate header; door spans
  // never occur in wallPieces, which preserves every authored doorway gap.
  wallPieces.forEach((piece, index) => {
    const segment = piece?.segment;
    if (!segment || !(piece.to > piece.from)) return;
    const centerAlong = (piece.from + piece.to) * 0.5;
    const planX = segment.axis === 'x' ? centerAlong : segment.at;
    const planZ = segment.axis === 'x' ? segment.at : centerAlong;
    const building = buildingAt(planX, planZ);
    const base = baseByBuilding.get(building?.id) ?? 0;
    const style = BUILDING_STYLE[building?.id] ?? BUILDING_STYLE['main-house'];
    const thickness = segment.thick * FEET_TO_METERS;
    const sill = isWindowSillPiece(piece, normalizedWindows);
    if (sill) {
      addLinearBox(batch.stucco, segment.axis, segment.at, piece.from, piece.to, base - 0.04, WINDOW_SILL + 0.04, thickness);
      const headerBottom = Math.min(WINDOW_HEAD, style.wallHeight - 0.24);
      addLinearBox(batch.stucco, segment.axis, segment.at, piece.from, piece.to, base + headerBottom, style.wallHeight - headerBottom, thickness);
    } else {
      addLinearBox(batch.stucco, segment.axis, segment.at, piece.from, piece.to, base - 0.04, style.wallHeight + 0.04, thickness);
    }
    addCollider(
      colliders,
      `compound-wall-${index}`,
      segment.axis,
      segment.at,
      piece.from,
      piece.to,
      base,
      style.wallHeight,
      thickness,
    );
  });

  function addFramedOpening(opening, kind, index) {
    const segment = matchingSegment(opening, segments);
    if (!segment) return;
    const span = openingSpan(opening);
    const axis = segment.axis;
    const centerAlong = (span.from + span.to) * 0.5;
    const planX = axis === 'x' ? centerAlong : segment.at;
    const planZ = axis === 'x' ? segment.at : centerAlong;
    const building = buildingAt(planX, planZ);
    const base = baseByBuilding.get(building?.id) ?? 0;
    const style = BUILDING_STYLE[building?.id] ?? BUILDING_STYLE['main-house'];
    const spanMeters = (span.to - span.from) * FEET_TO_METERS;
    const isWindow = kind === 'window';
    const sill = isWindow ? WINDOW_SILL : 0.035;
    const head = Math.min(isWindow ? WINDOW_HEAD : DOOR_HEAD, style.wallHeight - 0.18);
    const openingHeight = head - sill;
    const frameThickness = INCHES_2;
    const frameDepth = Math.max(INCHES_3, segment.thick * FEET_TO_METERS * 0.42);
    const insetFeet = frameThickness / FEET_TO_METERS;

    // Authored door gaps have no wall piece at all, so restore their lintels.
    // Window pieces already create both sill and header in the wall pass.
    if (!isWindow) {
      addLinearBox(batch.stucco, axis, segment.at, span.from, span.to, base + head, style.wallHeight - head, segment.thick * FEET_TO_METERS);
    }
    // Interior openings receive a shallow white casing so they read as built
    // assemblies rather than boolean holes. The black frame/glass language is
    // reserved for the exterior shell.
    if (segment.thick < 0.7) {
      const casingThickness = 0.034;
      const casingFeet = casingThickness / FEET_TO_METERS;
      addLinearBox(batch.stucco, axis, segment.at, span.from, span.to, base + head - casingThickness, casingThickness, frameDepth);
      addLinearBox(batch.stucco, axis, segment.at, span.from, span.from + casingFeet, base + sill, openingHeight, frameDepth);
      addLinearBox(batch.stucco, axis, segment.at, span.to - casingFeet, span.to, base + sill, openingHeight, frameDepth);
      return;
    }
    addLinearBox(batch.charcoal, axis, segment.at, span.from, span.to, base + head - frameThickness, frameThickness, frameDepth);
    addLinearBox(batch.charcoal, axis, segment.at, span.from, span.from + insetFeet, base + sill, openingHeight, frameDepth);
    addLinearBox(batch.charcoal, axis, segment.at, span.to - insetFeet, span.to, base + sill, openingHeight, frameDepth);
    if (isWindow) {
      addLinearBox(batch.charcoal, axis, segment.at, span.from, span.to, base + sill, frameThickness, frameDepth);
    } else {
      addLinearBox(batch.charcoal, axis, segment.at, span.from, span.to, base + 0.012, 0.032, frameDepth + 0.035);
    }

    // Garage overhead bays remain visually open, with the door tucked above.
    const isGarageBay = building?.id === 'garage' && spanMeters > 2.1;
    if (isGarageBay) {
      const panelHeight = 0.115;
      for (let panel = 0; panel < 5; panel += 1) {
        const panelTop = base + head - 0.06 - panel * (panelHeight + 0.022);
        addLinearBox(
          batch.charcoal,
          axis,
          segment.at,
          span.from + 0.08 / FEET_TO_METERS,
          span.to - 0.08 / FEET_TO_METERS,
          panelTop - panelHeight,
          panelHeight,
          Math.max(0.045, frameDepth * 0.62),
        );
      }
      return;
    }

    const paneInset = 0.045;
    const paneInsetFeet = paneInset / FEET_TO_METERS;
    // All glazing shares one cool reflective material; interior warmth comes
    // from the real lights and emissive ceiling plates only.
    if (isWindow) {
      addLinearBox(
        batch.glass,
        axis,
        segment.at,
        span.from + paneInsetFeet,
        span.to - paneInsetFeet,
        base + sill + frameThickness,
        openingHeight - frameThickness * 2,
        0.024,
      );
    } else if (spanMeters > 1.35) {
      // Wide sliders are shown open, with their glass leaves stacked at one
      // jamb. The authored circulation gap therefore reads the way it behaves.
      const stackedPanelFeet = Math.min((span.to - span.from) * 0.28, 3);
      const stackEnd = span.from + stackedPanelFeet;
      addLinearBox(
        batch.glass,
        axis,
        segment.at,
        span.from + paneInsetFeet,
        stackEnd,
        base + sill + frameThickness,
        openingHeight - frameThickness * 2,
        0.028,
      );
      addLinearBox(
        batch.charcoal,
        axis,
        segment.at,
        stackEnd - insetFeet * 0.5,
        stackEnd + insetFeet * 0.5,
        base + sill,
        openingHeight,
        frameDepth,
      );
      addLinearBox(
        batch.glass,
        axis,
        segment.at + 0.035 / FEET_TO_METERS,
        span.from + paneInsetFeet,
        stackEnd,
        base + sill + frameThickness,
        openingHeight - frameThickness * 2,
        0.024,
      );
    } else {
      // A narrow exterior opening gets a solid cedar leaf held partly open.
      // Keeping the visual leaf uncollided preserves the authored walkability.
      const doorWidth = Math.max(0.62, spanMeters - 0.1);
      const doorHeight = Math.max(1.8, openingHeight - 0.1);
      const angle = index % 2 ? 0.48 : -0.48;
      const hingeAlong = span.from + 0.05 / FEET_TO_METERS;
      const hingePlanX = axis === 'x' ? hingeAlong : segment.at;
      const hingePlanZ = axis === 'x' ? segment.at : hingeAlong;
      const hinge = planToLocal(hingePlanX, hingePlanZ);
      const center = axis === 'x'
        ? {
            x: hinge.x + Math.cos(angle) * doorWidth * 0.5,
            z: hinge.z - Math.sin(angle) * doorWidth * 0.5,
          }
        : {
            x: hinge.x + Math.sin(angle) * doorWidth * 0.5,
            z: hinge.z + Math.cos(angle) * doorWidth * 0.5,
          };
      batch.cedar.add(
        center.x,
        base + sill + 0.05 + doorHeight * 0.5,
        center.z,
        axis === 'x' ? doorWidth : 0.052,
        doorHeight,
        axis === 'x' ? 0.052 : doorWidth,
        angle,
      );
      const handleDistance = doorWidth * 0.83;
      const handle = axis === 'x'
        ? {
            x: hinge.x + Math.cos(angle) * handleDistance,
            z: hinge.z - Math.sin(angle) * handleDistance,
          }
        : {
            x: hinge.x + Math.sin(angle) * handleDistance,
            z: hinge.z + Math.cos(angle) * handleDistance,
          };
      batch.charcoal.add(handle.x, base + sill + 1.02, handle.z, 0.045, 0.15, 0.045, angle);
    }

    if (isWindow) {
      const mullionCount = Math.max(0, Math.floor(spanMeters / 1.25));
      for (let mullion = 1; mullion <= mullionCount; mullion += 1) {
        const along = span.from + (span.to - span.from) * mullion / (mullionCount + 1);
        addLinearBox(batch.charcoal, axis, segment.at, along - insetFeet * 0.5, along + insetFeet * 0.5, base + sill, openingHeight, frameDepth);
      }
    }

    root.userData[`${kind}Frame${index}`] = true;
  }

  normalizedWindows.forEach((opening, index) => addFramedOpening(opening, 'window', index));
  normalizedDoors.forEach((opening, index) => addFramedOpening(opening, 'door', index));

  const mainBase = baseByBuilding.get('main-house') ?? 0;
  const garageBase = baseByBuilding.get('garage') ?? mainBase;
  const guestBase = baseByBuilding.get('guest-house') ?? mainBase;
  const fabBase = baseByBuilding.get('fab-lab') ?? mainBase;

  // A three-millimetre finish layer preserves the authored slab/collider
  // datum while separating private oak from public concrete. Bathrooms reuse
  // the existing limestone batch, so the entire zoning pass costs only the
  // single white-oak draw below. Bounds stop at the room side of shell walls;
  // internal partitions simply conceal the small continuous closet run.
  let privateFloorFinishInstances = 0;
  const addPrivateFloorFinish = (target, xMin, zMin, xMax, zMax, base) => {
    const previousCount = target.matrices.length;
    addPlanBox(
      target,
      (xMin + xMax) * 0.5,
      (zMin + zMax) * 0.5,
      base + FINISHED_SURFACE_LIFT + 0.0015,
      (xMax - xMin) * FEET_TO_METERS,
      0.003,
      (zMax - zMin) * FEET_TO_METERS,
    );
    privateFloorFinishInstances += target.matrices.length - previousCount;
  };
  for (const [xMin, zMin, xMax, zMax] of [
    [37.28, 16.28, 48.72, 25.72],
    [56.28, 16.28, 67.72, 25.72],
    [68.28, 16.28, 85.72, 25.72],
    [86.28, 26.28, 97.72, 41.72],
  ]) {
    addPrivateFloorFinish(batch.privateFloor, xMin, zMin, xMax, zMax, mainBase);
  }
  addPrivateFloorFinish(batch.privateFloor, 108.43, 76.43, 121.72, 97.57, guestBase);
  addPrivateFloorFinish(batch.privateFloor, 122.28, 76.43, 133.57, 88.72, guestBase);
  addPrivateFloorFinish(batch.stone, 49.28, 16.28, 55.72, 25.72, mainBase);
  addPrivateFloorFinish(batch.stone, 86.28, 16.28, 97.72, 25.72, mainBase);

  // Courtyard deck, paths and pool are held to the main-house datum, making
  // the lanai/pool court one continuous accessible outdoor room.
  const deck = COMPOUND_PLAN.poolDeck;
  const deckZ = rectangleZ(deck);
  const pool = COMPOUND_PLAN.pool;
  const poolZ = rectangleZ(pool);
  const poolCenterX = pool.x + pool.width * 0.5;
  const poolCenterZ = poolZ + pool.depth * 0.5;
  const poolWidth = pool.width * FEET_TO_METERS;
  const poolDepth = pool.depth * FEET_TO_METERS;
  const addDeckRectangle = (x, z, widthFeet, depthFeet) => addPlanBox(
    batch.stone,
    x + widthFeet * 0.5,
    z + depthFeet * 0.5,
    mainBase + FINISHED_SURFACE_LIFT - 0.065,
    widthFeet * FEET_TO_METERS,
    0.13,
    depthFeet * FEET_TO_METERS,
  );
  // Four pieces leave a true opening in the slab for the water rather than a
  // coplanar blue decal laid over continuous paving.
  addDeckRectangle(deck.x, deckZ, deck.width, poolZ - deckZ);
  addDeckRectangle(deck.x, poolZ + pool.depth, deck.width, deckZ + deck.depth - poolZ - pool.depth);
  addDeckRectangle(deck.x, poolZ, pool.x - deck.x, pool.depth);
  addDeckRectangle(pool.x + pool.width, poolZ, deck.x + deck.width - pool.x - pool.width, pool.depth);
  // Quiet saw-cut joints give the broad pale slab human scale.
  for (let x = deck.x + 4; x < deck.x + deck.width; x += 4) {
    if (x > pool.x && x < pool.x + pool.width) {
      addPlanBox(batch.joint, x, (deckZ + poolZ) * 0.5, mainBase + FINISHED_SURFACE_LIFT - 0.0015, 0.012, 0.003, (poolZ - deckZ) * FEET_TO_METERS - 0.12);
      addPlanBox(batch.joint, x, (poolZ + pool.depth + deckZ + deck.depth) * 0.5, mainBase + FINISHED_SURFACE_LIFT - 0.0015, 0.012, 0.003, (deckZ + deck.depth - poolZ - pool.depth) * FEET_TO_METERS - 0.12);
    } else {
      addPlanBox(batch.joint, x, deckZ + deck.depth * 0.5, mainBase + FINISHED_SURFACE_LIFT - 0.0015, 0.012, 0.003, deck.depth * FEET_TO_METERS - 0.16);
    }
  }
  for (let z = deckZ + 4; z < deckZ + deck.depth; z += 4) {
    if (z > poolZ && z < poolZ + pool.depth) {
      addPlanBox(batch.joint, (deck.x + pool.x) * 0.5, z, mainBase + FINISHED_SURFACE_LIFT - 0.0015, (pool.x - deck.x) * FEET_TO_METERS - 0.12, 0.003, 0.012);
      addPlanBox(batch.joint, (pool.x + pool.width + deck.x + deck.width) * 0.5, z, mainBase + FINISHED_SURFACE_LIFT - 0.0015, (deck.x + deck.width - pool.x - pool.width) * FEET_TO_METERS - 0.12, 0.003, 0.012);
    } else {
      addPlanBox(batch.joint, deck.x + deck.width * 0.5, z, mainBase + FINISHED_SURFACE_LIFT - 0.0015, deck.width * FEET_TO_METERS - 0.16, 0.003, 0.012);
    }
  }

  const pathRects = [COMPOUND_PLAN.entryWalk, COMPOUND_PLAN.guestWalk];
  for (const path of pathRects) {
    const z = rectangleZ(path);
    const base = sampleTerraceHeight(heightAt, path);
    addPlanBox(
      batch.stone,
      path.x + path.width * 0.5,
      z + path.depth * 0.5,
      base + FINISHED_SURFACE_LIFT - 0.045,
      path.width * FEET_TO_METERS,
      0.09,
      path.depth * FEET_TO_METERS,
    );
  }

  function addTerrainFollowingSurface(rectangle, moduleFeet = 6) {
    const z0 = rectangleZ(rectangle);
    for (let z = z0; z < z0 + rectangle.depth - 0.01; z += moduleFeet) {
      for (let x = rectangle.x; x < rectangle.x + rectangle.width - 0.01; x += moduleFeet) {
        const widthFeet = Math.min(moduleFeet, rectangle.x + rectangle.width - x);
        const depthFeet = Math.min(moduleFeet, z0 + rectangle.depth - z);
        const centerX = x + widthFeet * 0.5;
        const centerZ = z + depthFeet * 0.5;
        const world = planToWorld(centerX, centerZ);
        const surface = safeHeight(heightAt, world.x, world.z)
          + FINISHED_SURFACE_LIFT - 0.0325;
        addPlanBox(
          batch.drive,
          centerX,
          centerZ,
          surface,
          Math.max(0.08, widthFeet * FEET_TO_METERS),
          0.065,
          Math.max(0.08, depthFeet * FEET_TO_METERS),
        );
      }
    }
  }

  addTerrainFollowingSurface(COMPOUND_PLAN.driveway, 6);
  addTerrainFollowingSurface(COMPOUND_PLAN.serviceDrive, 6);

  // A fully open sliding-gate threshold completes the street edge without
  // reducing either the 38' motor-court throat or the 12' service opening.
  // Both leaves are parked behind the boundary wings; piers, returns, screens,
  // and gate hardware reuse the existing architectural batches.
  let arrivalThresholdInstances = 0;
  const addArrivalBox = (
    target,
    planX,
    planZ,
    y,
    width,
    height,
    depth,
    rotationY = 0,
  ) => {
    const previousCount = target.matrices.length;
    addPlanBox(target, planX, planZ, y, width, height, depth, rotationY);
    arrivalThresholdInstances += target.matrices.length - previousCount;
  };
  const addArrivalLinear = (target, axis, at, from, to, bottom, height, thickness) => {
    const previousCount = target.matrices.length;
    addLinearBox(target, axis, at, from, to, bottom, height, thickness);
    arrivalThresholdInstances += target.matrices.length - previousCount;
  };
  const addArrivalContact = (...args) => {
    const previousCount = contactBatch.matrices.length;
    addSoftContact(...args);
    arrivalThresholdInstances += contactBatch.matrices.length - previousCount;
  };

  const gateBase = sampleTerraceHeight(heightAt, COMPOUND_PLAN.driveway);
  const gateZ = 129;
  const gateThickness = 0.10;
  const addGatePier = (id, x0, x1, height = 1.95) => {
    const centerX = (x0 + x1) * 0.5;
    const width = (x1 - x0) * FEET_TO_METERS;
    const depthFeet = 1.5;
    const depth = depthFeet * FEET_TO_METERS;
    addArrivalBox(batch.tanStone, centerX, gateZ, gateBase + height * 0.5, width, height, depth);
    addArrivalBox(batch.stone, centerX, gateZ, gateBase + height + 0.045, width + 0.11, 0.09, depth + 0.11);
    addArrivalContact(centerX, gateZ, gateBase + 0.012, width + 0.22, depth + 0.22);
    addCollider(
      colliders,
      id,
      'x',
      gateZ,
      x0,
      x1,
      gateBase,
      height,
      depth,
      'gate-boundary',
    );
  };

  addGatePier('main-gate-west-pier', 38.5, 40);
  addGatePier('main-gate-east-pier', 78, 79.5);
  addGatePier('service-gate-west-pier', 132.5, 134, 1.65);
  addGatePier('service-gate-east-pier', 146, 147.5, 1.65);

  const addParkedGateLeaf = (id, x0, x1) => {
    const centerX = (x0 + x1) * 0.5;
    const length = (x1 - x0) * FEET_TO_METERS;
    const height = 1.65;
    for (const level of [0.08, height - 0.08]) {
      addArrivalBox(batch.charcoal, centerX, gateZ, gateBase + level, length, 0.08, gateThickness);
    }
    for (const x of [x0, x1]) {
      addArrivalBox(batch.charcoal, x, gateZ, gateBase + height * 0.5, 0.075, height, gateThickness);
    }
    for (let level = 0.24; level < height - 0.12; level += 0.235) {
      addArrivalBox(
        batch.cedar,
        centerX,
        gateZ,
        gateBase + level,
        length - 0.14,
        0.115,
        0.060,
      );
    }
    addArrivalBox(batch.charcoal, centerX, gateZ, gateBase + 0.025, length + 0.22, 0.035, 0.055);
    addArrivalContact(centerX, gateZ, gateBase + 0.012, length + 0.20, 0.48);
    addCollider(
      colliders,
      id,
      'x',
      gateZ,
      x0,
      x1,
      gateBase,
      height,
      gateThickness,
      'parked-gate-leaf',
    );
  };
  addParkedGateLeaf('parked-main-gate-west-leaf', 19.25, 38.25);
  addParkedGateLeaf('parked-main-gate-east-leaf', 79.75, 98.75);

  // Short returns tie the gate to the garage and screen the motor court from
  // the east while leaving a deliberate 2.5' cross-circulation break north of
  // the screen at the guest walk.
  addArrivalLinear(batch.stucco, 'z', 39.25, 124, 128.25, gateBase, 1.35, 1.5 * FEET_TO_METERS);
  addArrivalLinear(batch.stucco, 'z', 78.75, 90.5, 104, gateBase, 0.78, 1.5 * FEET_TO_METERS);
  addArrivalLinear(batch.stucco, 'z', 78.75, 104, 128.25, gateBase, 0.48, 1.5 * FEET_TO_METERS);
  addCollider(colliders, 'garage-gate-return', 'z', 39.25, 124, 128.25, gateBase, 1.35, 1.5 * FEET_TO_METERS, 'gate-boundary');
  addCollider(colliders, 'east-gate-low-screen', 'z', 78.75, 90.5, 104, gateBase, 0.78, 1.5 * FEET_TO_METERS, 'gate-boundary');
  addCollider(colliders, 'east-gate-privacy-plinth', 'z', 78.75, 104, 128.25, gateBase, 0.48, 1.5 * FEET_TO_METERS, 'gate-boundary');
  addArrivalContact(39.25, 126.125, gateBase + 0.012, 0.72, 4.25 * FEET_TO_METERS);
  addArrivalContact(78.75, 97.25, gateBase + 0.012, 0.72, 13.5 * FEET_TO_METERS);
  for (const z of [104, 112, 120, 128]) {
    addArrivalBox(batch.charcoal, 78.75, z, gateBase + 1.065, 0.10, 1.17, 0.10);
  }
  for (const level of [0.68, 0.87, 1.06, 1.25, 1.44]) {
    addArrivalLinear(batch.cedar, 'z', 78.75, 104.2, 128.05, gateBase + level - 0.045, 0.09, 0.16);
  }
  addArrivalContact(78.75, 109.8, gateBase + 0.012, 0.72, 12.0 * FEET_TO_METERS);
  addArrivalContact(78.75, 121.9, gateBase + 0.012, 0.72, 12.0 * FEET_TO_METERS);

  const addBoundaryWing = (id, x0, x1, height = 0.54) => {
    const centerX = (x0 + x1) * 0.5;
    const length = (x1 - x0) * FEET_TO_METERS;
    addArrivalLinear(batch.stucco, 'x', gateZ, x0, x1, gateBase, height, 0.30);
    addArrivalBox(batch.stone, centerX, gateZ, gateBase + height + 0.035, length + 0.08, 0.07, 0.36);
    for (let x = x0 + 1.0; x < x1 - 0.6; x += 6.0) {
      addArrivalBox(batch.charcoal, x, gateZ, gateBase + 1.03, 0.065, 0.92, 0.065);
    }
    for (const level of [0.69, 0.88, 1.07, 1.26, 1.43]) {
      addArrivalBox(batch.cedarDark, centerX, gateZ, gateBase + level, length - 0.14, 0.09, 0.075);
    }
    addArrivalContact(centerX, gateZ, gateBase + 0.012, length + 0.18, 0.52);
    addCollider(colliders, id, 'x', gateZ, x0, x1, gateBase, 1.48, 0.30, 'privacy-boundary');
  };
  addBoundaryWing('west-street-privacy-wing', 0.75, 18.75);
  addBoundaryWing('east-street-privacy-wing', 99.25, 132.5);
  addBoundaryWing('far-east-street-return', 147.5, 149.25, 0.48);

  // The street-edge fence language continues around the west, north, and
  // east lot boundaries so the whole compound reads as one enclosed place.
  // Panels step with the terrain every ten feet — plinth, cap, rails, and
  // colliders re-sample the meadow so the run hugs the grade instead of
  // floating over it. The only openings remain the two street gates.
  let perimeterFencePanels = 0;
  const addPerimeterFenceRun = (id, axis, at, from, to) => {
    const panelFeet = 10;
    const railLevels = [0.69, 0.88, 1.07, 1.26, 1.43];
    let panelIndex = 0;
    for (let start = from; start < to - 0.05; start += panelFeet) {
      const end = Math.min(start + panelFeet, to);
      const centerAlong = (start + end) * 0.5;
      const planX = axis === 'x' ? centerAlong : at;
      const planZ = axis === 'x' ? at : centerAlong;
      const world = planToWorld(planX, planZ);
      const base = safeHeight(heightAt, world.x, world.z);
      addArrivalLinear(batch.stucco, axis, at, start, end, base - 0.26, 0.80, 0.24);
      addArrivalLinear(batch.stone, axis, at, start, end, base + 0.54, 0.07, 0.30);
      const postAlong = start + 0.35;
      addArrivalBox(
        batch.charcoal,
        axis === 'x' ? postAlong : at,
        axis === 'x' ? at : postAlong,
        base + 1.03,
        0.065,
        0.92,
        0.065,
      );
      for (const level of railLevels) {
        addArrivalLinear(batch.cedarDark, axis, at, start + 0.25, end - 0.25, base + level - 0.045, 0.09, 0.075);
      }
      const panelLength = (end - start) * FEET_TO_METERS + 0.18;
      addArrivalContact(
        planX,
        planZ,
        base + 0.012,
        axis === 'x' ? panelLength : 0.52,
        axis === 'x' ? 0.52 : panelLength,
      );
      addCollider(
        colliders,
        `${id}-panel-${panelIndex}`,
        axis,
        at,
        start,
        end,
        base,
        1.48,
        0.30,
        'perimeter-boundary',
      );
      panelIndex += 1;
      perimeterFencePanels += 1;
    }
  };
  const addFencePier = (id, planX, planZ, height = 1.72) => {
    const world = planToWorld(planX, planZ);
    const base = safeHeight(heightAt, world.x, world.z);
    addArrivalBox(batch.tanStone, planX, planZ, base + height * 0.5, 0.5, height, 0.5);
    addArrivalBox(batch.stone, planX, planZ, base + height + 0.045, 0.61, 0.09, 0.61);
    addArrivalContact(planX, planZ, base + 0.012, 0.74, 0.74);
    addCollider(colliders, id, 'x', planZ, planX - 0.8, planX + 0.8, base, height, 0.5, 'perimeter-boundary');
  };
  addFencePier('perimeter-nw-pier', 0.75, 0.75);
  addFencePier('perimeter-ne-pier', 149.25, 0.75);
  addPerimeterFenceRun('perimeter-west-fence', 'z', 0.75, 1.6, 128.6);
  addPerimeterFenceRun('perimeter-north-fence', 'x', 0.75, 1.6, 148.4);
  addPerimeterFenceRun('perimeter-east-fence', 'z', 149.25, 1.6, 128.6);

  // Small down-facing gate lanterns and an intercom create human scale at the
  // threshold without adding point lights or a new material program.
  for (const x of [39.25, 78.75]) {
    addArrivalBox(batch.charcoal, x, gateZ - 0.78, gateBase + 1.38, 0.26, 0.38, 0.08);
    addArrivalBox(batch.sconce, x, gateZ - 0.92, gateBase + 1.35, 0.14, 0.21, 0.06);
  }
  addArrivalBox(batch.charcoal, 79.05, gateZ - 0.82, gateBase + 1.00, 0.09, 0.24, 0.055);

  // Broad floating-look stones carry the arrival axis across the short lawn
  // gap between the paved motor court and the pool deck; the court and drive
  // are already paved, so the stones stop at their edges.
  for (let planZ = 88.9; planZ >= 85.2; planZ -= 3.65) {
    const world = planToWorld(58.5, planZ);
    const surface = safeHeight(heightAt, world.x, world.z);
    addPlanBox(batch.stone, 58.5, planZ, surface + 0.005, 4.7 * FEET_TO_METERS, 0.08, 1.85 * FEET_TO_METERS);
  }

  const basinFloorBottom = mainBase - 0.78;
  const basinFloorTop = mainBase - 0.61;
  addPlanBox(
    batch.waterBasin,
    poolCenterX,
    poolCenterZ,
    (basinFloorBottom + basinFloorTop) * 0.5,
    poolWidth - 0.32,
    basinFloorTop - basinFloorBottom,
    poolDepth - 0.32,
  );
  const copingWidth = 0.34;
  addPlanBox(batch.stone, poolCenterX, poolZ, mainBase + 0.095, poolWidth + copingWidth * 2, 0.16, copingWidth);
  addPlanBox(batch.stone, poolCenterX, poolZ + pool.depth, mainBase + 0.095, poolWidth + copingWidth * 2, 0.16, copingWidth);
  addPlanBox(batch.stone, pool.x, poolCenterZ, mainBase + 0.095, copingWidth, 0.16, poolDepth);
  addPlanBox(batch.stone, pool.x + pool.width, poolCenterZ, mainBase + 0.095, copingWidth, 0.16, poolDepth);

  // A real basin section is visible through the water at grazing angles:
  // four vertical liner walls meet the floor and a compact three-step entry
  // occupies the north-west corner instead of leaving a bottomless cyan plane.
  const basinWallThickness = 0.12;
  const basinWallHeight = mainBase + 0.018 - basinFloorTop;
  const basinWallCenterY = basinFloorTop + basinWallHeight * 0.5;
  const basinWallInsetFeet = (0.19 + basinWallThickness * 0.5) / FEET_TO_METERS;
  addPlanBox(batch.waterBasin, poolCenterX, poolZ + basinWallInsetFeet, basinWallCenterY, poolWidth - 0.38, basinWallHeight, basinWallThickness);
  addPlanBox(batch.waterBasin, poolCenterX, poolZ + pool.depth - basinWallInsetFeet, basinWallCenterY, poolWidth - 0.38, basinWallHeight, basinWallThickness);
  addPlanBox(batch.waterBasin, pool.x + basinWallInsetFeet, poolCenterZ, basinWallCenterY, basinWallThickness, basinWallHeight, poolDepth - 0.38);
  addPlanBox(batch.waterBasin, pool.x + pool.width - basinWallInsetFeet, poolCenterZ, basinWallCenterY, basinWallThickness, basinWallHeight, poolDepth - 0.38);

  const stepDepth = 4.8 * FEET_TO_METERS;
  const stepZ = poolZ + 3.25;
  [
    { x: pool.x + 1.05, top: mainBase - 0.11 },
    { x: pool.x + 2.55, top: mainBase - 0.27 },
    { x: pool.x + 4.05, top: mainBase - 0.43 },
  ].forEach((step) => {
    const height = step.top - basinFloorBottom;
    addPlanBox(
      batch.stone,
      step.x,
      stepZ,
      basinFloorBottom + height * 0.5,
      1.65 * FEET_TO_METERS,
      height,
      stepDepth,
    );
  });
  addCollider(colliders, 'pool-north-edge', 'x', poolZ, pool.x, pool.x + pool.width, mainBase, 0.65, copingWidth, 'pool-boundary');
  addCollider(colliders, 'pool-south-edge', 'x', poolZ + pool.depth, pool.x, pool.x + pool.width, mainBase, 0.65, copingWidth, 'pool-boundary');
  addCollider(colliders, 'pool-west-edge', 'z', pool.x, poolZ, poolZ + pool.depth, mainBase, 0.65, copingWidth, 'pool-boundary');
  addCollider(colliders, 'pool-east-edge', 'z', pool.x + pool.width, poolZ, poolZ + pool.depth, mainBase, 0.65, copingWidth, 'pool-boundary');

  const waterAsset = makePoolWater(poolWidth - 0.38, poolDepth - 0.38, palette);
  resources.geometries.add(waterAsset.geometry);
  resources.materials.add(waterAsset.material);
  const water = new THREE.Mesh(waterAsset.geometry, waterAsset.material);
  const waterLocal = planToLocal(poolCenterX, poolCenterZ);
  water.name = 'Level courtyard pool water';
  water.position.set(waterLocal.x, mainBase + 0.035, waterLocal.z);
  water.rotation.x = -Math.PI * 0.5;
  water.renderOrder = 4;
  water.receiveShadow = true;
  root.add(water);

  // Three stone-clad solids introduce a slower facade rhythm between the
  // broad glazed bays. They sit only on already-solid wall spans, so none of
  // the authored openings is narrowed or moved. The shell walls are 0.85'
  // thick, so cladding centred 0.60' off the wall line sits proud of the
  // 0.425' face instead of vanishing inside the stucco.
  const addFeatureStonePanel = (axis, at, from, to, base, height, outwardSign) => {
    addLinearBox(batch.tanStone, axis, at, from, to, base + 0.04, height, 0.105);
    const jointAt = at + outwardSign * 0.008 / FEET_TO_METERS;
    for (let level = 0.66; level < height - 0.2; level += 0.68) {
      addLinearBox(batch.stoneJoint, axis, jointAt, from, to, base + level, 0.016, 0.114);
    }
    const edgeWidthFeet = 0.018 / FEET_TO_METERS;
    addLinearBox(batch.stoneJoint, axis, jointAt, from, from + edgeWidthFeet, base + 0.04, height, 0.114);
    addLinearBox(batch.stoneJoint, axis, jointAt, to - edgeWidthFeet, to, base + 0.04, height, 0.114);
  };
  addFeatureStonePanel('x', 42.60, 35.2, 40.7, mainBase, 2.82, 1);
  addFeatureStonePanel('x', 42.60, 62.0, 65.2, mainBase, 2.82, 1);
  addFeatureStonePanel('x', 42.60, 83.2, 87.1, mainBase, 2.82, 1);
  addFeatureStonePanel('z', 107.40, 83.0, 87.4, guestBase, 2.78, -1);

  // The primary lanai is a cedar-lined outdoor room: deep dark fascia, a
  // regular slatted soffit and sparse posts preserve the uninterrupted view.
  const lanai = COMPOUND_PLAN.canopies.find((item) => item.id === 'lanai');
  if (lanai) {
    const z = rectangleZ(lanai);
    const top = mainBase + 2.76;
    // A wood deck floor, flush with the pool-deck stone, so the compound's
    // primary outdoor room is not bare ground. It starts just south of the
    // house wall face (0.45') to avoid z-fighting the interior slab.
    addPlanBox(
      batch.cedarDark,
      lanai.x + lanai.width * 0.5,
      z + 0.45 + (lanai.depth - 0.45) * 0.5,
      mainBase + FINISHED_SURFACE_LIFT - 0.065,
      lanai.width * FEET_TO_METERS,
      0.13,
      (lanai.depth - 0.45) * FEET_TO_METERS,
    );
    addPlanBox(batch.charcoal, lanai.x + lanai.width * 0.5, z + lanai.depth, top + 0.06, lanai.width * FEET_TO_METERS, 0.18, 0.12);
    addPlanBox(batch.cedar, lanai.x + lanai.width * 0.5, z + lanai.depth * 0.5, top, lanai.width * FEET_TO_METERS, 0.065, lanai.depth * FEET_TO_METERS);
    addLinearBox(batch.cedar, 'x', z + lanai.depth - 0.12, lanai.x + 0.3, lanai.x + lanai.width - 0.3, top - 0.20, 0.13, 0.075);
    for (let x = lanai.x + 0.7; x < lanai.x + lanai.width; x += 1.15) {
      addPlanBox(batch.cedarDark, x, z + lanai.depth * 0.5, top - 0.055, 0.055, 0.06, lanai.depth * FEET_TO_METERS);
    }
    // Small recessed apertures break up the soffit at a believable fixture
    // scale without adding real-time lights or another material batch.
    for (let x = lanai.x + 4.2; x < lanai.x + lanai.width - 2; x += 9.2) {
      addPlanBox(batch.charcoal, x, z + lanai.depth * 0.58, top - 0.043, 0.13, 0.022, 0.13);
      addPlanBox(batch.sconce, x, z + lanai.depth * 0.58, top - 0.057, 0.052, 0.008, 0.052);
    }
    for (let x = lanai.x; x <= lanai.x + lanai.width + 0.1; x += 12.4) {
      addPlanBox(batch.charcoal, x, z + lanai.depth - 0.2, mainBase + 1.38, 0.09, 2.76, 0.09);
      addSoftContact(x, z + lanai.depth - 0.2, mainBase + 0.012, 0.42, 0.42);
    }
  }

  // Lighter slatted roofs mark the secondary links without turning them into
  // bulky enclosed corridors. Slats span the short axis and repeat along the
  // long one, matching the lanai soffit rhythm.
  const insideAnyBuilding = (planX, planZ, padFeet = 0.5) => COMPOUND_PLAN.buildingList.some((building) => (
    planX >= building.x - padFeet
    && planX <= building.x + building.width + padFeet
    && planZ >= rectangleZ(building) - padFeet
    && planZ <= rectangleZ(building) + building.depth + padFeet
  ));
  for (const canopy of COMPOUND_PLAN.canopies.filter((item) => item.id !== 'lanai')) {
    const z = rectangleZ(canopy);
    const nearby = canopy.id.includes('guest') ? guestBase : canopy.id.includes('fab') ? fabBase : (mainBase + garageBase) * 0.5;
    const top = nearby + 2.62;
    const longX = canopy.width >= canopy.depth;
    const count = Math.max(2, Math.floor((longX ? canopy.width : canopy.depth) / 1.25));
    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      const planX = longX ? canopy.x + canopy.width * t : canopy.x + canopy.width * 0.5;
      const planZ = longX ? z + canopy.depth * 0.5 : z + canopy.depth * t;
      addPlanBox(
        batch.cedar,
        planX,
        planZ,
        top,
        longX ? 0.06 : canopy.width * FEET_TO_METERS,
        0.07,
        longX ? canopy.depth * FEET_TO_METERS : 0.06,
      );
    }
    // Corners that land on a building are carried by that wall; a post there
    // would stand buried inside the stucco.
    const corners = [[canopy.x, z], [canopy.x + canopy.width, z], [canopy.x, z + canopy.depth], [canopy.x + canopy.width, z + canopy.depth]];
    for (const [x, planZ] of corners) {
      if (insideAnyBuilding(x, planZ)) continue;
      addPlanBox(batch.charcoal, x, planZ, nearby + 1.31, 0.075, 2.62, 0.075);
    }
  }

  // A shallow entry lantern and one raised fab clerestory are the only taller
  // notes in an otherwise unequivocally single-storey silhouette.
  addLinearBox(batch.stucco, 'x', 42, 42.4, 46.8, mainBase + 3.02, 0.68, 0.18);
  addLinearBox(batch.stucco, 'z', 42.4, 38.5, 42, mainBase + 3.02, 0.68, 0.18);
  addLinearBox(batch.stucco, 'z', 46.8, 38.5, 42, mainBase + 3.02, 0.68, 0.18);
  addPlanBox(batch.roof, 44.6, 40.25, mainBase + 3.72, 4.8 * FEET_TO_METERS, 0.13, 3.5 * FEET_TO_METERS);

  const guestFeature = { x: 108, z: 76, width: 14, depth: 13 };
  addLinearBox(batch.stucco, 'x', guestFeature.z, guestFeature.x, guestFeature.x + guestFeature.width, guestBase + 3.00, 0.48, 0.16);
  addLinearBox(batch.stucco, 'x', guestFeature.z + guestFeature.depth, guestFeature.x, guestFeature.x + guestFeature.width, guestBase + 3.00, 0.48, 0.16);
  addLinearBox(batch.stucco, 'z', guestFeature.x, guestFeature.z, guestFeature.z + guestFeature.depth, guestBase + 3.00, 0.48, 0.16);
  addLinearBox(batch.stucco, 'z', guestFeature.x + guestFeature.width, guestFeature.z, guestFeature.z + guestFeature.depth, guestBase + 3.00, 0.48, 0.16);
  addPlanBox(batch.roof, 115, 82.5, guestBase + 3.54, 14.3 * FEET_TO_METERS, 0.13, 13.3 * FEET_TO_METERS);
  addPerimeter(batch.charcoal, guestFeature, guestBase + 3.53, 0.12, 0.06, 0.03);

  addPlanBox(batch.roof, 136, 18, fabBase + 4.08, 16 * FEET_TO_METERS, 0.14, 12 * FEET_TO_METERS);
  addLinearBox(batch.stucco, 'x', 12, 128, 144, fabBase + 3.34, 0.68, 0.18);
  addLinearBox(batch.stucco, 'z', 144, 12, 24, fabBase + 3.34, 0.68, 0.18);
  addLinearBox(batch.stucco, 'x', 24, 128, 144, fabBase + 3.34, 0.68, 0.18);
  addLinearBox(batch.glass, 'z', 128.02, 13, 23, fabBase + 3.43, 0.46, 0.024);
  addLinearBox(batch.charcoal, 'z', 128, 12.8, 13.05, fabBase + 3.39, 0.56, 0.06);
  addLinearBox(batch.charcoal, 'z', 128, 22.95, 23.2, fabBase + 3.39, 0.56, 0.06);

  function addTable(planX, planZ, base, widthFt, depthFt, seats = 0) {
    const width = widthFt * FEET_TO_METERS;
    const depth = depthFt * FEET_TO_METERS;
    addPlanBox(batch.furnitureWood, planX, planZ, base + 0.75, width, 0.075, depth);
    addSoftContact(planX, planZ, base + 0.012, width * 0.92, depth * 1.22);
    for (const [dx, dz] of [[-width * .42, -depth * .35], [width * .42, -depth * .35], [-width * .42, depth * .35], [width * .42, depth * .35]]) {
      const local = planToLocal(planX, planZ);
      batch.furnitureDark.add(local.x + dx, base + 0.38, local.z + dz, 0.045, 0.72, 0.045);
    }
    for (let index = 0; index < seats; index += 1) {
      const side = index % 2 ? 1 : -1;
      const along = (Math.floor(index / 2) - (Math.ceil(seats / 2) - 1) * 0.5) * Math.min(0.74, width / 3);
      const local = planToLocal(planX, planZ);
      const chairZ = local.z + side * (depth * 0.5 + 0.28);
      batch.upholstery.add(local.x + along, base + 0.48, chairZ, 0.48, 0.12, 0.48);
      batch.upholstery.add(local.x + along, base + 0.72, chairZ + side * 0.225, 0.44, 0.47, 0.11);
      for (const [dx, dz] of [[-0.17, -0.16], [0.17, -0.16], [-0.17, 0.16], [0.17, 0.16]]) {
        batch.furnitureDark.add(local.x + along + dx, base + 0.25, chairZ + dz, 0.035, 0.44, 0.035);
      }
    }
  }

  function addSofa(planX, planZ, base, widthFt, rotation = 0) {
    // Cushions are separated by real shadow gaps and sit above a recessed
    // plinth. This preserves instancing while avoiding the raw-box silhouette
    // that was especially conspicuous through the courtyard glazing.
    const width = widthFt * FEET_TO_METERS;
    const local = planToLocal(planX, planZ);
    const offset = (along, across) => ({
      x: local.x + Math.cos(rotation) * along + Math.sin(rotation) * across,
      z: local.z - Math.sin(rotation) * along + Math.cos(rotation) * across,
    });
    const cushionCount = width > 2.35 ? 3 : 2;
    const armWidth = 0.18;
    const gap = 0.035;
    const cushionWidth = (width - armWidth * 2 - gap * (cushionCount - 1)) / cushionCount;
    for (let index = 0; index < cushionCount; index += 1) {
      const along = -width * 0.5 + armWidth + cushionWidth * 0.5 + index * (cushionWidth + gap);
      const seat = offset(along, 0.07);
      const back = offset(along, -0.31);
      batch.upholstery.add(seat.x, base + 0.39, seat.z, cushionWidth, 0.28, 0.70, rotation);
      batch.upholstery.add(back.x, base + 0.72, back.z, cushionWidth, 0.54, 0.17, rotation);
    }
    for (const along of [-width * 0.5 + armWidth * 0.5, width * 0.5 - armWidth * 0.5]) {
      const arm = offset(along, 0.02);
      batch.upholstery.add(arm.x, base + 0.48, arm.z, armWidth, 0.58, 0.82, rotation);
    }
    batch.furnitureDark.add(local.x, base + 0.13, local.z, width - 0.08, 0.10, 0.70, rotation);
    addSoftContact(planX, planZ, base + 0.012, width + 0.12, 0.96, rotation);
  }

  // Utility rooms need only a few deliberate silhouettes to read as working
  // spaces. Every part below reuses an existing instanced material batch, so
  // the denser close-range kit does not add a draw call. These pieces remain
  // visual-only and hug walls or ceilings, preserving authored circulation and
  // the collision contract supplied by the plan walls.
  let utilityDetailInstances = 0;
  const addUtilityBox = (
    target,
    planX,
    planZ,
    y,
    width,
    height,
    depth,
    rotationY = 0,
  ) => {
    const previousCount = target.matrices.length;
    addPlanBox(target, planX, planZ, y, width, height, depth, rotationY);
    utilityDetailInstances += target.matrices.length - previousCount;
  };
  const addUtilityContact = (...args) => {
    const previousCount = contactBatch.matrices.length;
    addSoftContact(...args);
    utilityDetailInstances += contactBatch.matrices.length - previousCount;
  };

  function addGarageInteriorKit() {
    const baySpans = [[90.5, 99.5], [101.5, 110.5], [112.5, 121.5]];
    const railX0 = 31.7;
    const railX1 = 39.45;
    const railCenterX = (railX0 + railX1) * 0.5;

    for (const [from, to] of baySpans) {
      const centerZ = (from + to) * 0.5;
      // Twin jamb/ceiling tracks, a torsion bar, and a compact opener give the
      // dark folded panels above each opening a believable support mechanism.
      for (const railZ of [from + 0.34, to - 0.34]) {
        addUtilityBox(batch.charcoal, 39.48, railZ, garageBase + 1.27, 0.048, 2.40, 0.052);
        addUtilityBox(
          batch.charcoal,
          railCenterX,
          railZ,
          garageBase + 2.73,
          (railX1 - railX0) * FEET_TO_METERS,
          0.045,
          0.052,
        );
        addUtilityBox(batch.furnitureDark, railX0 + 0.18, railZ, garageBase + 2.68, 0.18, 0.18, 0.16);
      }
      addUtilityBox(
        batch.charcoal,
        39.28,
        centerZ,
        garageBase + 2.61,
        0.052,
        0.065,
        (to - from - 0.26) * FEET_TO_METERS,
      );
      addUtilityBox(batch.furnitureDark, 31.9, centerZ, garageBase + 2.69, 0.46, 0.19, 0.34);
      addUtilityBox(
        batch.charcoal,
        (31.9 + 39.25) * 0.5,
        centerZ,
        garageBase + 2.73,
        (39.25 - 31.9) * FEET_TO_METERS,
        0.035,
        0.040,
      );

      // A long recessed task strip per bay is visible from the motor court but
      // relies on the existing emissive batches rather than another point light.
      addUtilityBox(batch.charcoal, 27.5, centerZ, garageBase + 3.125, 1.46, 0.022, 0.18);
      addUtilityBox(batch.glow, 27.5, centerZ, garageBase + 3.108, 1.22, 0.010, 0.072);
    }

    // Tall birch-faced cabinets terminate the first bay without projecting
    // into its lane. Narrow gaps between modules keep the run from reading as
    // one undifferentiated box.
    for (const cabinetZ of [92.2, 94.7, 97.2]) {
      addUtilityBox(
        batch.furnitureDark,
        17.48,
        cabinetZ,
        garageBase + 1.10,
        1.78 * FEET_TO_METERS,
        2.20,
        2.16 * FEET_TO_METERS,
      );
      addUtilityBox(
        batch.furnitureWood,
        18.39,
        cabinetZ,
        garageBase + 1.11,
        0.026,
        2.02,
        1.96 * FEET_TO_METERS,
      );
      addUtilityBox(batch.charcoal, 18.46, cabinetZ + 0.64, garageBase + 1.12, 0.035, 0.32, 0.035);
    }

    // The centre bay carries the main work run: cabinet carcass, divided drawer
    // fronts, a thick timber top, pegboard tools, and two cantilevered shelves.
    addUtilityBox(
      batch.furnitureDark,
      17.48,
      106,
      garageBase + 0.42,
      1.78 * FEET_TO_METERS,
      0.78,
      12.0 * FEET_TO_METERS,
    );
    addUtilityBox(
      batch.workSurface,
      17.58,
      106,
      garageBase + 0.845,
      2.18 * FEET_TO_METERS,
      0.075,
      12.35 * FEET_TO_METERS,
    );
    addUtilityBox(
      batch.cedarDark,
      16.50,
      106,
      garageBase + 1.48,
      0.030,
      1.08,
      11.55 * FEET_TO_METERS,
    );
    for (const drawerZ of [101.2, 103.1, 105.0, 106.9, 108.8, 110.7]) {
      addUtilityBox(
        batch.furnitureWood,
        18.40,
        drawerZ,
        garageBase + 0.48,
        0.026,
        0.43,
        1.58 * FEET_TO_METERS,
      );
      addUtilityBox(batch.charcoal, 18.47, drawerZ, garageBase + 0.55, 0.035, 0.032, 0.24);
    }
    for (const shelfY of [1.34, 1.98]) {
      addUtilityBox(
        batch.workSurface,
        17.18,
        106,
        garageBase + shelfY,
        1.42 * FEET_TO_METERS,
        0.060,
        11.30 * FEET_TO_METERS,
      );
    }
    for (const toolZ of [102.0, 104.2, 107.1, 109.5]) {
      addUtilityBox(batch.charcoal, 16.58, toolZ, garageBase + 1.52, 0.035, 0.54, 0.055);
      addUtilityBox(batch.charcoal, 16.61, toolZ + 0.36, garageBase + 1.70, 0.055, 0.055, 0.32);
    }
    addUtilityBox(batch.furnitureDark, 18.32, 103.5, garageBase + 1.02, 0.34, 0.28, 0.42);
    addUtilityBox(batch.charcoal, 18.55, 103.5, garageBase + 0.99, 0.21, 0.055, 0.055);
    addUtilityContact(17.55, 106, garageBase + 0.012, 0.96, 4.25);

    // Open shelving and a few staggered storage bins finish the third bay while
    // preserving a clear read through to the rear wall.
    for (const shelfY of [0.42, 0.91, 1.40, 1.89]) {
      addUtilityBox(
        batch.workSurface,
        17.48,
        117.6,
        garageBase + shelfY,
        1.88 * FEET_TO_METERS,
        0.055,
        6.10 * FEET_TO_METERS,
      );
    }
    for (const postZ of [114.7, 120.5]) {
      for (const postX of [16.65, 18.30]) {
        addUtilityBox(batch.furnitureDark, postX, postZ, garageBase + 1.08, 0.055, 2.16, 0.055);
      }
    }
    for (const [binZ, binY, binWidth] of [
      [116.0, 0.66, 1.65],
      [119.0, 0.66, 1.95],
      [117.4, 1.15, 2.35],
      [119.2, 1.64, 1.55],
    ]) {
      addUtilityBox(
        batch.furnitureDark,
        17.60,
        binZ,
        garageBase + binY,
        1.36 * FEET_TO_METERS,
        0.31,
        binWidth * FEET_TO_METERS,
      );
    }
    addUtilityContact(17.55, 117.6, garageBase + 0.012, 0.88, 2.12);
  }

  function addFabLabInteriorKit() {
    // The principal ten-foot bench is open below, keeping the room navigable
    // and giving the fixed interior view a much lighter, believable silhouette.
    addUtilityBox(
      batch.workSurface,
      120,
      27,
      fabBase + 0.91,
      10.0 * FEET_TO_METERS,
      0.085,
      3.20 * FEET_TO_METERS,
    );
    addUtilityBox(
      batch.workSurface,
      120,
      27,
      fabBase + 0.28,
      9.10 * FEET_TO_METERS,
      0.055,
      2.35 * FEET_TO_METERS,
    );
    for (const x of [115.75, 124.25]) {
      for (const z of [25.85, 28.15]) {
        addUtilityBox(batch.furnitureDark, x, z, fabBase + 0.45, 0.070, 0.82, 0.070);
      }
    }
    addUtilityBox(batch.furnitureDark, 120, 25.67, fabBase + 0.58, 8.6 * FEET_TO_METERS, 0.075, 0.065);
    addUtilityBox(batch.furnitureDark, 124.10, 25.80, fabBase + 1.07, 0.34, 0.28, 0.42);
    addUtilityBox(batch.charcoal, 124.42, 25.80, fabBase + 1.03, 0.28, 0.055, 0.055);
    addUtilityContact(120, 27, fabBase + 0.012, 3.28, 1.16);

    // A low flat-file cabinet sits beneath the north windows without masking
    // their low sill. Alternating fronts and pulls establish useful scale.
    addUtilityBox(
      batch.furnitureDark,
      120,
      13.16,
      fabBase + 0.31,
      9.40 * FEET_TO_METERS,
      0.60,
      1.60 * FEET_TO_METERS,
    );
    addUtilityBox(
      batch.workSurface,
      120,
      13.18,
      fabBase + 0.645,
      9.65 * FEET_TO_METERS,
      0.070,
      1.78 * FEET_TO_METERS,
    );
    for (const x of [116.6, 118.85, 121.15, 123.4]) {
      addUtilityBox(
        batch.furnitureWood,
        x,
        14.0,
        fabBase + 0.34,
        1.90 * FEET_TO_METERS,
        0.47,
        0.026,
      );
      addUtilityBox(batch.charcoal, x, 14.08, fabBase + 0.40, 0.24, 0.035, 0.035);
    }

    // A compact laser/CNC enclosure supplies the lab's primary equipment
    // silhouette. Its transparent front, bed, gantry, and status light all use
    // batches already present elsewhere in the compound.
    const machineX = 123.1;
    const machineZ = 18.4;
    addUtilityBox(
      batch.furnitureDark,
      machineX,
      machineZ,
      fabBase + 0.39,
      6.0 * FEET_TO_METERS,
      0.72,
      3.8 * FEET_TO_METERS,
    );
    addUtilityBox(
      batch.stone,
      machineX,
      machineZ,
      fabBase + 0.79,
      5.55 * FEET_TO_METERS,
      0.065,
      3.30 * FEET_TO_METERS,
    );
    for (const x of [120.55, 125.65]) {
      for (const z of [16.82, 19.98]) {
        addUtilityBox(batch.charcoal, x, z, fabBase + 1.18, 0.055, 0.76, 0.055);
      }
    }
    addUtilityBox(
      batch.charcoal,
      machineX,
      16.82,
      fabBase + 1.54,
      5.25 * FEET_TO_METERS,
      0.060,
      0.060,
    );
    addUtilityBox(
      batch.charcoal,
      machineX,
      19.98,
      fabBase + 1.54,
      5.25 * FEET_TO_METERS,
      0.060,
      0.060,
    );
    addUtilityBox(
      batch.glass,
      machineX,
      20.0,
      fabBase + 1.18,
      5.10 * FEET_TO_METERS,
      0.64,
      0.024,
    );
    addUtilityBox(
      batch.charcoal,
      machineX,
      machineZ,
      fabBase + 1.08,
      4.75 * FEET_TO_METERS,
      0.11,
      0.090,
    );
    addUtilityBox(batch.sconce, 125.72, 20.03, fabBase + 1.38, 0.080, 0.11, 0.035);
    addUtilityContact(machineX, machineZ, fabBase + 0.012, 2.04, 1.36);

    // Wall-mounted tool board on the solid portion of the west partition. It
    // stops well before the authored door span at z=28..31.
    addUtilityBox(
      batch.cedarDark,
      114.27,
      24.1,
      fabBase + 1.50,
      0.030,
      1.18,
      5.20 * FEET_TO_METERS,
    );
    for (const toolZ of [22.15, 23.25, 24.55, 25.75]) {
      addUtilityBox(batch.charcoal, 114.34, toolZ, fabBase + 1.50, 0.035, 0.54, 0.050);
      addUtilityBox(batch.charcoal, 114.37, toolZ + 0.31, fabBase + 1.68, 0.050, 0.050, 0.28);
    }
    addUtilityBox(batch.workSurface, 114.46, 24.1, fabBase + 0.91, 0.28, 0.060, 5.05 * FEET_TO_METERS);

    // Three recessed strips give the work zones a visible task-light source,
    // with no extra dynamic lights or material programs.
    for (const [x, z] of [[117.7, 27], [122.3, 27], [123.1, 18.4]]) {
      addUtilityBox(batch.charcoal, x, z, fabBase + 3.305, 1.24, 0.022, 0.18);
      addUtilityBox(batch.glow, x, z, fabBase + 3.288, 1.02, 0.010, 0.072);
    }
  }

  // A small set of legible, modern room arrangements communicates actual use
  // without cluttering the plan or inflating draw calls.
  let interiorDetailInstances = 0;
  const addInteriorBox = (
    target,
    planX,
    planZ,
    y,
    width,
    height,
    depth,
    rotationY = 0,
  ) => {
    const previousCount = target.matrices.length;
    addPlanBox(target, planX, planZ, y, width, height, depth, rotationY);
    interiorDetailInstances += target.matrices.length - previousCount;
  };
  addTable(56, 36.4, mainBase, 8, 3.2, 6);
  addTable(62, 48.2, mainBase, 7, 3.1, 6);
  addPlanBox(batch.furnitureWood, 34.7, 36.6, mainBase + 0.48, 8.2 * FEET_TO_METERS, 0.92, 2.9 * FEET_TO_METERS);
  addPlanBox(batch.stone, 34.7, 36.6, mainBase + 0.955, 8.35 * FEET_TO_METERS, 0.065, 3.05 * FEET_TO_METERS);
  // Cabinet divisions, inset cooktop, and a slim faucet make the kitchen
  // island legible as millwork rather than another generic furniture block.
  for (const x of [31.95, 33.75, 35.55, 37.35]) {
    addPlanBox(batch.furnitureDark, x, 38.03, mainBase + 0.47, 0.022, 0.76, 0.018);
  }
  addPlanBox(batch.furnitureDark, 33.2, 36.35, mainBase + 0.993, 1.45 * FEET_TO_METERS, 0.018, 1.5 * FEET_TO_METERS);
  addPlanBox(batch.furnitureDark, 36.2, 36.55, mainBase + 1.13, 0.035, 0.29, 0.035);
  addPlanBox(batch.furnitureDark, 36.2, 36.40, mainBase + 1.27, 0.035, 0.035, 0.30);
  addSofa(72.5, 35.3, mainBase, 9.5);
  addSofa(79.8, 37.4, mainBase, 6.2, -Math.PI * 0.5);
  addPlanBox(batch.furnitureWood, 71.4, 38.3, mainBase + 0.27, 4.4 * FEET_TO_METERS, 0.34, 2.2 * FEET_TO_METERS);

  // A large textile, media console, triptych, and floor lamp occupy the great
  // room at architectural scale. They give the long interior proof view a
  // composed focal wall instead of an uninterrupted blank stucco plane.
  addInteriorBox(
    batch.upholstery,
    75.0,
    36.25,
    mainBase + 0.032,
    15.5 * FEET_TO_METERS,
    0.034,
    8.5 * FEET_TO_METERS,
  );
  addInteriorBox(batch.furnitureDark, 74.0, 30.92, mainBase + 0.28, 9.4 * FEET_TO_METERS, 0.48, 0.42);
  for (const x of [70.8, 74.0, 77.2]) {
    addInteriorBox(batch.furnitureWood, x, 31.66, mainBase + 0.31, 2.7 * FEET_TO_METERS, 0.34, 0.035);
    addInteriorBox(batch.charcoal, x, 31.72, mainBase + 0.34, 0.24, 0.032, 0.032);
  }
  addInteriorBox(batch.charcoal, 74.0, 30.30, mainBase + 1.58, 9.7 * FEET_TO_METERS, 1.20, 0.045);
  for (const [x, target] of [[70.8, batch.cedar], [74.0, batch.tanStone], [77.2, batch.cedarDark]]) {
    addInteriorBox(target, x, 30.43, mainBase + 1.58, 2.72 * FEET_TO_METERS, 0.98, 0.032);
  }
  addInteriorBox(batch.charcoal, 83.0, 32.2, mainBase + 0.72, 0.055, 1.42, 0.055);
  addInteriorBox(batch.charcoal, 83.0, 32.2, mainBase + 1.43, 0.42, 0.055, 0.42);
  addInteriorBox(batch.sconce, 83.0, 32.2, mainBase + 1.39, 0.24, 0.035, 0.24);
  addInteriorBox(batch.furnitureWood, 81.8, 34.1, mainBase + 0.31, 0.52, 0.055, 0.52);
  addInteriorBox(batch.furnitureDark, 81.8, 34.1, mainBase + 0.16, 0.055, 0.29, 0.055);

  // One slim dining pendant anchors the table without adding a dynamic light.
  addInteriorBox(batch.charcoal, 56.0, 36.4, mainBase + 2.52, 1.55, 0.055, 0.12);
  for (const x of [54.2, 56.0, 57.8]) {
    addInteriorBox(batch.sconce, x, 36.4, mainBase + 2.47, 0.18, 0.035, 0.08);
  }
  addSofa(114.8, 86, guestBase, 6.3);
  addTable(114.5, 93.5, guestBase, 4.2, 2.4, 2);
  addGarageInteriorKit();
  addFabLabInteriorKit();

  // Pool loungers and a low outdoor conversation group, held clear of the
  // planting beds along the deck's north edge.
  for (const [x, z] of [[45, 59.9], [49, 59.9], [93, 61]]) {
    addPlanBox(batch.upholstery, x, z, mainBase + 0.32, 0.72, 0.14, 1.78, -0.08);
    addPlanBox(batch.furnitureDark, x, z, mainBase + 0.19, 0.68, 0.10, 1.70, -0.08);
    addSoftContact(x, z, mainBase + 0.012, 0.86, 1.92, -0.08);
  }

  function addPlant(planX, planZ, base, scale = 1) {
    const local = planToLocal(planX, planZ);
    potBatch.add(local.x, base + 0.20 * scale, local.z, 0.68 * scale, 0.40 * scale, 0.68 * scale);
    addSoftContact(planX, planZ, base + 0.012, 0.92 * scale, 0.92 * scale);
    // Long folded blades spring from the planter rather than gathering into a
    // spherical crown. Two interleaved height rings make a layered tropical
    // silhouette while retaining two foliage draw calls for the whole court.
    for (let index = 0; index < 13; index += 1) {
      const ring = index % 3;
      const yaw = index * 2.39996 + ring * 0.23;
      const leafHeight = (1.00 + (index % 5) * 0.105 - ring * 0.07) * scale;
      const leafWidth = (0.78 + ring * 0.11) * scale;
      const radius = ring * 0.035 * scale;
      const target = index % 4 === 0 ? leafTipBatch : leafBatch;
      target.add(
        local.x + Math.cos(yaw) * radius,
        base + 0.43 * scale + leafHeight * 0.49,
        local.z + Math.sin(yaw) * radius,
        leafWidth,
        leafHeight,
        0.72 * scale,
        yaw,
      );
    }
  }

  [[53, 55.8, .92], [96.5, 55.8, .94], [100.5, 80.4, .88], [38, 43.5, .76]].forEach(([x, z, scale]) => addPlant(x, z, mainBase, scale));

  function addLayeredBed(planX, planZ, widthFeet, depthFeet, base) {
    const width = widthFeet * FEET_TO_METERS;
    const depth = depthFeet * FEET_TO_METERS;
    addPlanBox(batch.stoneEdge, planX, planZ, base + 0.13, width, 0.26, depth);
    addPlanBox(batch.soil, planX, planZ, base + 0.275, width - 0.12, 0.055, depth - 0.12);
    addSoftContact(planX, planZ, base + 0.012, width + 0.24, depth + 0.24);
    const columns = Math.max(3, Math.floor(widthFeet / 1.15));
    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < 2; row += 1) {
        const alongFeet = (column / Math.max(1, columns - 1) - 0.5) * (widthFeet - 0.9);
        const acrossFeet = (row - 0.5) * Math.max(0.35, depthFeet - 0.9);
        const local = planToLocal(planX + alongFeet, planZ + acrossFeet);
        const height = 0.34 + ((column + row) % 3) * 0.075;
        const yaw = column * 1.71 + row * 2.3;
        (column % 4 === 0 ? leafTipBatch : leafBatch).add(
          local.x,
          base + 0.31 + height * 0.48,
          local.z,
          0.34,
          height,
          0.28,
          yaw,
        );
      }
    }
  }

  addLayeredBed(45.5, 55.4, 10.5, 1.75, mainBase);
  addLayeredBed(98.0, 55.4, 10.0, 1.75, mainBase);
  addLayeredBed(99.8, 80.9, 7.0, 1.65, mainBase);

  // Raised kitchen beds remain exactly on their authored rectangles. Low herb
  // clumps are deterministic and share only two instanced foliage draws.
  let herbSeed = 0x51f15e;
  const random = () => {
    herbSeed = (Math.imul(herbSeed, 1664525) + 1013904223) >>> 0;
    return herbSeed / 0x100000000;
  };
  for (const bed of COMPOUND_PLAN.gardenBeds) {
    const z = rectangleZ(bed);
    const base = sampleTerraceHeight(heightAt, bed);
    addPlanBox(batch.cedarDark, bed.x + bed.width * 0.5, z + bed.depth * 0.5, base + 0.16, bed.width * FEET_TO_METERS, 0.32, bed.depth * FEET_TO_METERS);
    addPlanBox(batch.soil, bed.x + bed.width * 0.5, z + bed.depth * 0.5, base + 0.33, bed.width * FEET_TO_METERS - 0.16, 0.07, bed.depth * FEET_TO_METERS - 0.16);
    addSoftContact(
      bed.x + bed.width * 0.5,
      z + bed.depth * 0.5,
      base + 0.012,
      bed.width * FEET_TO_METERS + 0.24,
      bed.depth * FEET_TO_METERS + 0.24,
    );
    for (let index = 0; index < 7; index += 1) {
      const planX = bed.x + 0.7 + random() * (bed.width - 1.4);
      const planZ = z + 0.55 + random() * (bed.depth - 1.1);
      const local = planToLocal(planX, planZ);
      const scale = 0.20 + random() * 0.14;
      (index % 3 ? leafBatch : leafTipBatch).add(local.x, base + 0.48, local.z, scale, scale * 1.45, scale);
    }
  }

  // `face` is the plan coordinate of the surface the fixture mounts on and
  // `outSign` points away from the building, so the lens always projects into
  // the open air instead of being buried inside the wall.
  function addSconce(axis, face, along, base, outSign) {
    addLinearBox(batch.charcoal, axis, face + outSign * 0.1, along - 0.22, along + 0.22, base + 1.54, 0.38, 0.065);
    addLinearBox(batch.sconce, axis, face + outSign * 0.28, along - 0.14, along + 0.14, base + 1.61, 0.22, 0.075);
    const washOffsetFeet = 0.003 / FEET_TO_METERS;
    const washPlanX = axis === 'x' ? along : face + outSign * washOffsetFeet;
    const washPlanZ = axis === 'x' ? face + outSign * washOffsetFeet : along;
    const local = planToLocal(washPlanX, washPlanZ);
    batch.sconceWash.add(
      local.x,
      base + 1.37,
      local.z,
      1.28,
      1.86,
      1,
      axis === 'x' ? 0 : Math.PI * 0.5,
    );
  }

  // Main-house and guest sconces mount on the tan stone cladding faces; the
  // garage pair mounts on the bare stucco piers between the overhead doors.
  addSconce('x', 42.77, 38.0, mainBase, 1);
  addSconce('x', 42.77, 63.6, mainBase, 1);
  addSconce('x', 42.77, 85.1, mainBase, 1);
  addSconce('z', 107.23, 85.2, guestBase, -1);
  addSconce('z', 40.425, 100.5, garageBase, 1);
  addSconce('z', 40.425, 111.5, garageBase, 1);

  // Warm pools of light sit just inside the large glazed fronts. Compact
  // recessed apertures carry the visible source if real-time lights are
  // culled, avoiding the earlier oversized luminous ceiling rectangles.
  const lights = [];
  for (const [name, role, planX, planZ, base, intensity, distance, color, flickerAmplitude] of [
    ['Dining recessed ambient', 'public ambient', 57, 36, mainBase, 5.2, 7.8, 0xffb260, 0.012],
    ['Great-room recessed ambient', 'public ambient', 76, 35, mainBase, 6.2, 8.6, 0xffae61, 0.012],
    ['Primary-suite recessed ambient', 'restrained private ambient', 92, 34, mainBase, 3.5, 5.8, 0xffc18a, 0.004],
    ['Guest-house recessed ambient', 'restrained private ambient', 115, 86, guestBase, 4.0, 5.8, 0xffbd7c, 0.004],
  ]) {
    const local = planToLocal(planX, planZ);
    const light = new THREE.PointLight(color, intensity, distance, 2);
    light.name = name;
    light.position.set(local.x, base + 2.30, local.z);
    light.castShadow = false;
    light.userData.baseIntensity = intensity;
    light.userData.role = role;
    light.userData.flickerAmplitude = flickerAmplitude;
    root.add(light);
    lights.push(light);
    for (const offsetX of [-0.64, 0, 0.64]) {
      batch.charcoal.add(local.x + offsetX, base + 2.674, local.z, 0.22, 0.022, 0.22);
      batch.glow.add(local.x + offsetX, base + 2.66, local.z, 0.105, 0.012, 0.105);
    }
  }

  // The garage and fab strips already provide visible sources; two tightly
  // ranged, shadowless fills now let those sources affect the nearby floor and
  // worktops without flattening the sunset exposure outside either building.
  const taskLights = [];
  for (const [name, planX, planZ, base, height, intensity, distance, color] of [
    ['Garage work-bay fill', 27.5, 106, garageBase, 2.42, 3.4, 7.8, 0xffd4a8],
    // Lower and move this fill toward the CNC front so the powder-coated
    // gantry separates from the garden seen through the north glazing.
    ['Fab-lab task fill', 123.0, 21.0, fabBase, 1.82, 3.8, 5.0, 0xffddb8],
  ]) {
    const local = planToLocal(planX, planZ);
    const light = new THREE.PointLight(color, intensity, distance, 2);
    light.name = name;
    light.position.set(local.x, base + height, local.z);
    light.castShadow = false;
    light.userData.role = 'bounded interior task fill';
    root.add(light);
    taskLights.push(light);
  }

  // Build all accumulated instance batches after authoring is complete.
  const builtMeshes = [];
  Object.values(batch).forEach((entry) => {
    const mesh = entry.build(root);
    if (mesh) builtMeshes.push(mesh);
  });
  for (const entry of [potBatch, trunkBatch, leafBatch, leafTipBatch, contactBatch]) {
    const mesh = entry.build(root);
    if (mesh) builtMeshes.push(mesh);
  }

  const instanceCount = [...Object.values(batch), potBatch, trunkBatch, leafBatch, leafTipBatch, contactBatch]
    .reduce((sum, entry) => sum + entry.matrices.length, 0);
  const wallPieceCount = wallPieces.filter((piece) => piece?.segment && piece.to > piece.from).length;
  const stats = Object.freeze({
    realized: true,
    scale: '1:1',
    structures: COMPOUND_PLAN.buildingList.length,
    wallPieces: wallPieceCount,
    doorOpenings: normalizedDoors.length,
    windowOpenings: normalizedWindows.length,
    colliders: colliders.length,
    instanceCount,
    drawCalls: builtMeshes.length + 1,
    pointLights: lights.length + taskLights.length,
    primaryPointLights: lights.length,
    taskFillLights: taskLights.length,
    privateAmbientLights: lights.filter((light) => light.userData.role === 'restrained private ambient').length,
    addedPrivatePointLights: 0,
    privateInteriorFinishRegions: privateInteriorFinishRegions.length,
    privateFloorFinishInstances,
    privateFloorDrawCalls: batch.privateFloor.matrices.length > 0 ? 1 : 0,
    spatialPrivateResponseMaterials: Object.values(materials)
      .filter((material) => (
        material.userData.projectedSurface?.interiorFinish
        || material.userData.planZoneResponse
      )).length,
    utilityDetailInstances,
    garageDoorMechanisms: 3,
    fabLabEquipmentStations: 2,
    interiorDetailInstances,
    arrivalThresholdInstances,
    arrivalGateOpen: true,
    mainGateClearWidthFeet: 38,
    serviceGateClearWidthFeet: 12,
    perimeterFenceEnclosed: true,
    perimeterFencePanels,
    poolWater: true,
    projectedTextureMaterials: Object.values(materials)
      .filter((material) => material.userData.projectedSurface).length,
    architecturalMaterials: Object.values(materials).length,
    architecturalTextureMaps: Object.keys(architectureTextures).length,
  });
  root.userData.stats = stats;

  return {
    root,
    colliders,
    stats,
    update(elapsedSeconds = 0) {
      const elapsed = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
      waterAsset.material.uniforms.uTime.value = elapsed;
      lights.forEach((light, index) => {
        const amplitude = light.userData.flickerAmplitude ?? 0;
        light.intensity = light.userData.baseIntensity * (
          1 - amplitude + Math.sin(elapsed * 1.31 + index * 2.17) * amplitude
        );
      });
    },
    dispose() {
      root.removeFromParent();
      builtMeshes.forEach((mesh) => mesh.dispose());
      resources.geometries.forEach((geometry) => geometry.dispose());
      resources.materials.forEach((material) => material.dispose());
      resources.textures.forEach((texture) => texture.dispose());
    },
  };
}
