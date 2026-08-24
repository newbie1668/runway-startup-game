import * as THREE from 'three';
import { OSM_BBOX } from './constants';
import { projectLngLat } from './projection';

export function createBuildingMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.72,
    metalness: 0.08,
    envMapIntensity: 0.4,
  });

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vSimWorld;
varying vec3 vSimNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vSimWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vSimNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vSimWorld;
varying vec3 vSimNormal;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float wall = 1.0 - smoothstep(0.35, 0.72, abs(vSimNormal.y));
float wx = fract(vSimWorld.x * 0.62);
float wy = fract(vSimWorld.y * 0.48);
float wz = fract(vSimWorld.z * 0.62);
float along = max(wx, wz);
float windowPane = step(0.42, along) * step(0.34, wy);
float mullion = 1.0 - windowPane;
float storeyLine = 1.0 - smoothstep(0.02, 0.08, abs(wy - 0.08));
vec3 glass = vec3(0.12, 0.16, 0.2);
float glassAmt = clamp((diffuseColor.b - diffuseColor.r) * 2.4 + 0.25, 0.0, 0.9);
diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb * 0.72, glass, glassAmt), windowPane * wall);
diffuseColor.rgb *= mix(1.0, 0.88, storeyLine * wall * mullion);
float roof = 1.0 - wall;
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.08, roof * 0.35);`,
      );
  };

  material.customProgramCacheKey = () => 'sim-building-windows-v1';
  return material;
}

export function createLambert(color: number, extra?: THREE.MeshLambertMaterialParameters) {
  return new THREE.MeshLambertMaterial({ color, ...extra });
}

export function setupScene(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
  renderer.setClearColor(0xb4bcc4, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = false;
  scene.background = new THREE.Color(0xb4bcc4);
  scene.fog = new THREE.FogExp2(0xb8c0c8, 0.000055);

  const hemi = new THREE.HemisphereLight(0xd8dee6, 0x3e3a36, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xf2efe8, 1.15);
  sun.position.set(-4200, 5200, 1800);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xc5d0dc, 0.35);
  fill.position.set(2400, 1800, -2200);
  scene.add(fill);

  const extent = projectLngLat(OSM_BBOX.east, OSM_BBOX.north);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.abs(extent.x) * 2.4, Math.abs(extent.z) * 2.4),
    new THREE.MeshLambertMaterial({ color: 0x1c1d20 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.name = 'ground';
  scene.add(ground);

  camera.near = 2;
  camera.far = 28000;
  camera.updateProjectionMatrix();
}
