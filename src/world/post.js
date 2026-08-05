import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uPhotoMode: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uPhotoMode;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 uv = vUv;
      vec3 color = texture2D(tDiffuse, uv).rgb;
      float luma = dot(color, vec3(.2126, .7152, .0722));

      // Warm highlights and very restrained teal-black shadow separation.
      float shadow = 1.0 - smoothstep(.045, .48, luma);
      float highlight = smoothstep(.42, 1.42, luma);
      color += vec3(-.006, .014, .018) * shadow;
      color += vec3(.040, .010, -.020) * highlight;
      color = mix(vec3(dot(color, vec3(.299, .587, .114))), color, 1.075);

      float vignette = 1.0 - dot((uv - .5) * vec2(1.0, .78), (uv - .5) * vec2(1.0, .78));
      vignette = smoothstep(.18, .98, vignette);
      color *= mix(.83, 1.0, vignette);

      float grain = hash(gl_FragCoord.xy + fract(uTime) * vec2(73.1, 19.7)) - .5;
      color += grain * mix(.007, .003, uPhotoMode);
      gl_FragColor = vec4(max(color, 0.0), 1.0);
    }
  `,
};

export function createPostPipeline(renderer, scene, camera, { quality = 'high' } = {}) {
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    quality === 'low' ? .12 : .24,
    .62,
    .72,
  );
  bloom.threshold = .86;
  bloom.radius = .55;

  const grade = new ShaderPass(GradeShader);
  const output = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(grade);
  composer.addPass(output);

  return {
    render(delta, elapsed, photoMode = false) {
      grade.uniforms.uTime.value = elapsed;
      grade.uniforms.uPhotoMode.value = photoMode ? 1 : 0;
      composer.render(delta);
    },
    resize(width, height) {
      composer.setSize(width, height);
      grade.uniforms.uResolution.value.set(width, height);
    },
    composer,
    bloom,
  };
}
