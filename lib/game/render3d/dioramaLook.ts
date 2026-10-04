/**
 * Opt-in "miniature diorama" look for the 3D city (`?style=diorama`).
 * Warm tone-mapped light, soft sun shadows that follow the camera,
 * ground-contact ambient occlusion and a tilt-shift focus band with vignette.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { CameraState } from '../scene';

export function dioramaRequested(look?: 'flat' | 'diorama'): boolean {
  if (typeof window === 'undefined') return false;
  const style = new URLSearchParams(window.location.search).get('style');
  if (style === 'flat') return false;
  return style === 'diorama' || look === 'diorama';
}

function dioramaParam(name: string, fallback: number): number {
  const raw = new URLSearchParams(window.location.search).get(name);
  const value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const TiltShiftShader = {
  name: 'RunwayTiltShift',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    dir: { value: new THREE.Vector2(1, 0) },
    texel: { value: new THREE.Vector2(1 / 1024, 1 / 768) },
    focus: { value: 0.5 },
    band: { value: 0.16 },
    strength: { value: 3.0 },
    vignette: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 dir;
    uniform vec2 texel;
    uniform float focus;
    uniform float band;
    uniform float strength;
    uniform float vignette;
    varying vec2 vUv;
    void main() {
      float d = abs(vUv.y - focus);
      float amount = smoothstep(band, band + 0.32, d) * strength;
      vec2 step = dir * texel * amount;
      vec4 sum = texture2D(tDiffuse, vUv) * 0.1633;
      sum += texture2D(tDiffuse, vUv - 1.0 * step) * 0.1531;
      sum += texture2D(tDiffuse, vUv + 1.0 * step) * 0.1531;
      sum += texture2D(tDiffuse, vUv - 2.0 * step) * 0.12245;
      sum += texture2D(tDiffuse, vUv + 2.0 * step) * 0.12245;
      sum += texture2D(tDiffuse, vUv - 3.0 * step) * 0.0918;
      sum += texture2D(tDiffuse, vUv + 3.0 * step) * 0.0918;
      sum += texture2D(tDiffuse, vUv - 4.0 * step) * 0.051;
      sum += texture2D(tDiffuse, vUv + 4.0 * step) * 0.051;
      if (vignette > 0.0) {
        vec2 c = vUv - 0.5;
        sum.rgb *= 1.0 - vignette * smoothstep(0.25, 0.75, dot(c, c) * 2.0);
      }
      gl_FragColor = sum;
    }`,
};

export interface DioramaLook {
  setSize(width: number, height: number): void;
  render(cam: CameraState, cssW: number, cssH: number): void;
  dispose(): void;
}

export function createDioramaLook(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  sun: THREE.DirectionalLight,
  sunTarget: THREE.Object3D,
  hemi: THREE.HemisphereLight,
  sunDir: THREE.Vector3,
): DioramaLook {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = dioramaParam('exposure', 1.3);
  renderer.shadowMap.enabled = dioramaParam('shadows', 1) > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  sun.color.setHex(0xffd9a8);
  sun.intensity = dioramaParam('sun', 2.8);
  sun.castShadow = renderer.shadowMap.enabled;
  const shadowSize = dioramaParam('shadowmap', 2048);
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  hemi.color.setHex(0xbcd2ff);
  hemi.groundColor.setHex(0x8c7356);
  hemi.intensity = dioramaParam('sky', 0.75);
  scene.background = new THREE.Color(0xc9d6e3);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  let ao: GTAOPass | null = null;
  if (dioramaParam('ao', 1) > 0) {
    ao = new GTAOPass(scene, camera, 1024, 768);
    ao.updateGtaoMaterial({ radius: dioramaParam('aoradius', 0.25), distanceExponent: 1, thickness: 1, scale: 1 });
    ao.blendIntensity = dioramaParam('aostrength', 0.8);
    composer.addPass(ao);
  }
  const tiltH = new ShaderPass(TiltShiftShader);
  const tiltV = new ShaderPass(TiltShiftShader);
  tiltV.uniforms.dir!.value = new THREE.Vector2(0, 1);
  for (const pass of [tiltH, tiltV]) {
    pass.uniforms.focus!.value = dioramaParam('focus', 0.55);
    pass.uniforms.band!.value = dioramaParam('band', 0.14);
    pass.uniforms.strength!.value = dioramaParam('blur', 2.6);
  }
  tiltV.uniforms.vignette!.value = dioramaParam('vignette', 0.35);
  composer.addPass(tiltH);
  composer.addPass(tiltV);
  composer.addPass(new OutputPass());

  const shadowCam = sun.shadow.camera as THREE.OrthographicCamera;
  const offset = new THREE.Vector3();

  return {
    setSize(width, height) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
      const pr = renderer.getPixelRatio();
      for (const pass of [tiltH, tiltV])
        (pass.uniforms.texel!.value as THREE.Vector2).set(1 / (width * pr), 1 / (height * pr));
    },
    render(cam, cssW, cssH) {
      if (sun.castShadow) {
        const zoom = Math.max(1e-6, cam.zoom);
        const half = Math.max(cssW, cssH) / (2 * zoom) * 1.25;
        const dist = Math.max(40, half * 4);
        sunTarget.position.set(cam.x, 0, cam.y);
        offset.copy(sunDir).multiplyScalar(dist);
        sun.position.copy(sunTarget.position).add(offset);
        sunTarget.updateMatrixWorld();
        shadowCam.left = -half;
        shadowCam.right = half;
        shadowCam.top = half;
        shadowCam.bottom = -half;
        shadowCam.near = 0.1;
        shadowCam.far = dist * 2;
        shadowCam.updateProjectionMatrix();
      }
      composer.render();
    },
    dispose() {
      ao?.dispose();
      composer.dispose();
    },
  };
}
