import * as THREE from 'three';

/**
 * Systems shared by every module that wants to read as part of the same
 * basin: the world-space gust field, the biome sun vector, the warm
 * height-graded fog response, and material hooks that let ordinary
 * MeshStandardMaterials participate without becoming bespoke shaders.
 */

/** Matches the atmosphere key light and the river's glint direction. */
export const BIOME_SUN_DIRECTION = Object.freeze(
  new THREE.Vector3(-0.48, 0.105, -0.87).normalize(),
);

// This field is deliberately shared verbatim by grass, flowers, bamboo,
// trees, airborne debris, and the compound's managed planting. Large gust
// fronts are anchored in world space; per-instance phase is reserved for
// small flutter, so a wave reads as one event travelling through the whole
// biome instead of independent swaying.
export const WIND_FIELD_GLSL = /* glsl */`
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

function glslFloat(value) {
  return Number(value).toFixed(4);
}

/**
 * Chains an extra program hook onto a material that may already carry an
 * onBeforeCompile pass. The composite cache key must uniquely describe both
 * passes, so callers provide an explicit suffix that encodes their options.
 */
function chainProgramHook(material, hook, keySuffix) {
  const previousHook = material.onBeforeCompile;
  const previousKeySource = material.customProgramCacheKey;
  const hadExplicitKey = typeof previousKeySource === 'function'
    && previousKeySource !== THREE.Material.prototype.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    if (typeof previousHook === 'function') previousHook.call(material, shader, renderer);
    hook(shader, renderer);
  };
  material.customProgramCacheKey = () => {
    const base = hadExplicitKey ? previousKeySource.call(material) : material.name;
    return `${base}|${keySuffix}`;
  };
  material.needsUpdate = true;
  return material;
}

/**
 * Bends an instanced foliage material with the shared biome gust field.
 * The bend happens in world space after instancing, so a leaf yawed by its
 * instance matrix still lies down along the same gust front as the meadow
 * around it. `weightExpression` maps the unit geometry to a 0..1 bend
 * weight (0 at the rooted base, 1 at the free tip).
 */
export function applyInstancedFoliageWind(material, windUniforms, {
  bendScale = 0.075,
  flutterScale = 0.014,
  weightExpression = 'clamp(position.y + 0.5, 0.0, 1.0)',
  key = 'foliage',
} = {}) {
  if (!windUniforms?.uTime) return material;
  return chainProgramHook(material, (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWindStrength = windUniforms.uWindStrength;
    shader.uniforms.uWindDirection = windUniforms.uWindDirection;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform float uWindStrength;
uniform vec2 uWindDirection;
${WIND_FIELD_GLSL}`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 biomeWindWorld = vec4(transformed, 1.0);
float biomeWindSpan = 1.0;
#ifdef USE_INSTANCING
  biomeWindWorld = instanceMatrix * biomeWindWorld;
  biomeWindSpan = length(vec3(
    instanceMatrix[1].x,
    instanceMatrix[1].y,
    instanceMatrix[1].z
  ));
#endif
biomeWindWorld = modelMatrix * biomeWindWorld;
vec2 biomeWindOrigin = vec2(modelMatrix[3].x, modelMatrix[3].z);
#ifdef USE_INSTANCING
  biomeWindOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
#endif
float biomeWindPhase = fract(
  sin(dot(biomeWindOrigin, vec2(12.9898, 78.233))) * 43758.5453
);
float biomeBendWeight = ${weightExpression};
biomeBendWeight *= biomeBendWeight;
vec3 biomeWind = sampleBiomeWind(biomeWindOrigin, biomeWindPhase);
biomeWindWorld.xz += biomeWind.xy * uWindStrength * biomeBendWeight
  * biomeWindSpan * ${glslFloat(bendScale)};
biomeWindWorld.y -= biomeWind.z * uWindStrength * biomeBendWeight
  * biomeWindSpan * ${glslFloat(bendScale * 0.22)};
biomeWindWorld.xz += vec2(
  sin(uTime * 3.1 + biomeWindPhase * 6.2831853),
  cos(uTime * 2.7 + biomeWindPhase * 4.71)
) * biomeBendWeight * biomeWindSpan * ${glslFloat(flutterScale)}
  * (0.4 + 0.6 * biomeWind.z);
vec4 mvPosition = viewMatrix * biomeWindWorld;
gl_Position = projectionMatrix * mvPosition;`,
      );
  }, `biome-foliage-wind-v1:${key}:${bendScale}:${flutterScale}:${weightExpression}`);
}

/**
 * Gives a MeshStandardMaterial the same atmosphere response the custom
 * vegetation shaders implement by hand: fog that warms slightly with height
 * (so built surfaces sink into the same amber layers as the meadow) and a
 * restrained warm rim toward the low sun (the architecture's version of the
 * foliage warm-edge scatter). Composes with any existing program hook.
 */
export function applyBiomeAtmosphere(material, {
  palette = {},
  rimStrength = 0,
  key = 'surface',
} = {}) {
  const rimColor = new THREE.Color(palette.sun ?? 0xffc86f);
  const sunDirection = BIOME_SUN_DIRECTION.clone();
  const rimEnabled = rimStrength > 0;
  return chainProgramHook(material, (shader) => {
    shader.uniforms.uBiomeRimColor = { value: rimColor };
    shader.uniforms.uBiomeSunDirection = { value: sunDirection };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vBiomeAtmosphereWorld;',
      )
      .replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>
vec4 biomeAtmosphereWorld = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  biomeAtmosphereWorld = instanceMatrix * biomeAtmosphereWorld;
#endif
vBiomeAtmosphereWorld = (modelMatrix * biomeAtmosphereWorld).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vBiomeAtmosphereWorld;
uniform vec3 uBiomeRimColor;
uniform vec3 uBiomeSunDirection;`,
      )
      .replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float biomeFogAmount = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float biomeFogAmount = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  vec3 biomeWarmFog = fogColor * mix(
    0.94,
    1.075,
    smoothstep(-2.0, 16.0, vBiomeAtmosphereWorld.y)
  );
  gl_FragColor.rgb = mix(gl_FragColor.rgb, biomeWarmFog, min(biomeFogAmount, 0.96));
#endif`,
      );

    if (rimEnabled) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `vec3 biomeWorldNormal = inverseTransformDirection(normal, viewMatrix);
vec3 biomeViewDirection = normalize(cameraPosition - vBiomeAtmosphereWorld);
float biomeRim = pow(
  1.0 - clamp(abs(dot(biomeWorldNormal, biomeViewDirection)), 0.0, 1.0),
  3.0
);
float biomeRimSunFacing = 0.35 + 0.65 * smoothstep(
  -0.25,
  0.6,
  dot(biomeWorldNormal, uBiomeSunDirection)
);
outgoingLight += uBiomeRimColor * biomeRim * biomeRimSunFacing
  * ${glslFloat(rimStrength)};
#include <opaque_fragment>`,
      );
    }
  }, `biome-atmosphere-v1:${key}:${rimStrength}`);
}
