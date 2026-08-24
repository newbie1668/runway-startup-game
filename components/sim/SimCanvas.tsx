'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BUILDING_DATA_FILE,
  LANDCOVER_DATA_FILE,
  ROADS_DATA_FILE,
  SIM_HUBS,
  type SimHubId,
} from '@/lib/sim/constants';
import { hubPose, lerpVec, overviewPose, pointPose, type CameraPose } from '@/lib/sim/camera';
import type { CityMesh, Pickable } from '@/lib/sim/build-city';
import type { BuildingProperties, LandcoverProperties, RoadProperties, SimFeatureCollection } from '@/lib/sim/types';

export interface SimHudState {
  loading: boolean;
  phase: string;
  ratio: number;
  error: string | null;
  stats: CityMesh['stats'] | null;
  pickables: Pickable[];
  selected: Pickable | null;
  activeHub: SimHubId | 'overview' | null;
}

export type FlyRequest =
  | { kind: 'overview' }
  | { kind: 'hub'; id: SimHubId }
  | { kind: 'point'; x: number; z: number; height: number };

interface SimCanvasProps {
  flyTo: FlyRequest;
  flyGeneration: number;
  onHud: (state: SimHudState) => void;
  onInspect: (item: Pickable | null) => void;
}

export function SimCanvas({ flyTo, flyGeneration, onHud, onInspect }: SimCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const threeRef = useRef<{
    renderer: import('three').WebGLRenderer;
    camera: import('three').PerspectiveCamera;
    controls: { target: { set: (x: number, y: number, z: number) => void; x: number; y: number; z: number }; enabled: boolean; update: () => void };
    city: import('three').Group;
    pickables: Pickable[];
  } | null>(null);
  const [meshReady, setMeshReady] = useState(false);
  const hudRef = useRef(onHud);
  const inspectRef = useRef(onInspect);
  useEffect(() => {
    hudRef.current = onHud;
    inspectRef.current = onInspect;
  }, [onHud, onInspect]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let frame = 0;
    let clickHandler: ((event: MouseEvent) => void) | null = null;
    let resizeHandler: (() => void) | null = null;
    let renderer: import('three').WebGLRenderer | undefined;

    const run = async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      const { setupScene, createBuildingMaterial } = await import('@/lib/sim/scene-setup');
      const { buildCity } = await import('@/lib/sim/build-city');

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      renderer.setSize(host.clientWidth, host.clientHeight);
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(52, host.clientWidth / Math.max(1, host.clientHeight), 2, 28000);
      setupScene(renderer, scene, camera);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.06;
      controls.zoomToCursor = true;
      controls.minDistance = 40;
      controls.maxDistance = 14000;
      controls.maxPolarAngle = Math.PI / 2 - 0.04;
      controls.minPolarAngle = 0.08;
      controls.screenSpacePanning = true;

      const start = overviewPose();
      camera.position.set(start.position.x, start.position.y, start.position.z);
      controls.target.set(start.target.x, start.target.y, start.target.z);
      controls.update();

      const city = new THREE.Group();
      city.name = 'city';
      scene.add(city);

      threeRef.current = { renderer, camera, controls, city, pickables: [] };

      resizeHandler = () => {
        if (!renderer) return;
        camera.aspect = host.clientWidth / Math.max(1, host.clientHeight);
        camera.updateProjectionMatrix();
        renderer.setSize(host.clientWidth, host.clientHeight);
      };
      window.addEventListener('resize', resizeHandler);

      const loop = () => {
        frame = requestAnimationFrame(loop);
        controls.update();
        renderer!.render(scene, camera);
      };
      loop();

      try {
        hudRef.current({
          loading: true,
          phase: 'Downloading OpenStreetMap extract',
          ratio: 0.05,
          error: null,
          stats: null,
          pickables: [],
          selected: null,
          activeHub: 'overview',
        });
        const [buildings, roads, landcover] = await Promise.all([
          fetchJson<SimFeatureCollection<BuildingProperties>>(`/data/${BUILDING_DATA_FILE}`),
          fetchJson<SimFeatureCollection<RoadProperties>>(`/data/${ROADS_DATA_FILE}`),
          fetchJson<SimFeatureCollection<LandcoverProperties>>(`/data/${LANDCOVER_DATA_FILE}`),
        ]);
        if (disposed) return;

        const mesh = await buildCity({
          buildings,
          roads,
          landcover,
          onProgress: (phase, ratio) => {
            if (disposed) return;
            hudRef.current({
              loading: true,
              phase:
                phase === 'buildings'
                  ? 'Extruding footprints'
                  : phase === 'roads'
                    ? 'Laying streets'
                    : 'Meshing London',
              ratio: 0.15 + ratio * 0.75,
              error: null,
              stats: null,
              pickables: [],
              selected: null,
              activeHub: 'overview',
            });
          },
        });
        if (disposed) return;

        const buildingMat = createBuildingMaterial();
        const roadMat = new THREE.MeshLambertMaterial({ vertexColors: true });
        const parkMat = new THREE.MeshLambertMaterial({ vertexColors: true });
        const waterMat = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.32,
          metalness: 0.18,
        });

        for (const chunk of mesh.chunks) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(chunk.positions, 3));
          geometry.setAttribute('normal', new THREE.BufferAttribute(chunk.normals, 3));
          geometry.setAttribute('color', new THREE.BufferAttribute(chunk.colors, 3));
          geometry.setIndex(new THREE.BufferAttribute(chunk.indices, 1));
          const material =
            chunk.kind === 'building'
              ? buildingMat
              : chunk.kind === 'road'
                ? roadMat
                : chunk.kind === 'water'
                  ? waterMat
                  : parkMat;
          const object = new THREE.Mesh(geometry, material);
          object.name = chunk.key;
          object.userData.kind = chunk.kind;
          city.add(object);
        }

        threeRef.current.pickables = mesh.pickables;
        setMeshReady(true);
        hudRef.current({
          loading: false,
          phase: 'ready',
          ratio: 1,
          error: null,
          stats: mesh.stats,
          pickables: mesh.pickables,
          selected: null,
          activeHub: 'overview',
        });

        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();
        clickHandler = (event: MouseEvent) => {
          if (!renderer) return;
          const rect = renderer.domElement.getBoundingClientRect();
          pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(pointer, camera);
          const hits = raycaster.intersectObjects(city.children, false);
          const hit = hits.find((h) => h.object.userData.kind === 'building') ?? hits[0];
          if (!hit) {
            inspectRef.current(null);
            return;
          }
          inspectRef.current(nearestPickable(mesh.pickables, hit.point.x, hit.point.z, 90));
        };
        renderer.domElement.addEventListener('click', clickHandler);
      } catch (error) {
        hudRef.current({
          loading: false,
          phase: 'error',
          ratio: 0,
          error: error instanceof Error ? error.message : 'Failed to build London mesh',
          stats: null,
          pickables: [],
          selected: null,
          activeHub: null,
        });
      }
    };

    void run();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      if (resizeHandler) window.removeEventListener('resize', resizeHandler);
      if (clickHandler && renderer) renderer.domElement.removeEventListener('click', clickHandler);
      const ctx = threeRef.current;
      if (ctx) {
        ctx.city.traverse((obj) => {
          const mesh = obj as { geometry?: { dispose: () => void } };
          mesh.geometry?.dispose();
        });
        ctx.renderer.dispose();
        ctx.renderer.domElement.remove();
      }
      threeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const ctx = threeRef.current;
    if (!ctx || !meshReady) return;
    const dest: CameraPose =
      flyTo.kind === 'overview'
        ? overviewPose()
        : flyTo.kind === 'hub'
          ? hubPose(SIM_HUBS.find((h) => h.id === flyTo.id)!)
          : pointPose(flyTo.x, flyTo.z, flyTo.height);
    const fromPos = { x: ctx.camera.position.x, y: ctx.camera.position.y, z: ctx.camera.position.z };
    const fromTarget = { x: ctx.controls.target.x, y: ctx.controls.target.y, z: ctx.controls.target.z };
    const started = performance.now();
    const duration = 1400;
    ctx.controls.enabled = false;
    let raf = 0;
    const tick = () => {
      const t = (performance.now() - started) / duration;
      const pos = lerpVec(fromPos, dest.position, t);
      const target = lerpVec(fromTarget, dest.target, t);
      ctx.camera.position.set(pos.x, pos.y, pos.z);
      ctx.controls.target.set(target.x, target.y, target.z);
      if (t < 1) raf = requestAnimationFrame(tick);
      else ctx.controls.enabled = true;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flyTo, flyGeneration, meshReady]);

  return <div ref={hostRef} className="absolute inset-0 h-full w-full" />;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Missing ${url} — run pnpm osm:fetch`);
  }
  return (await response.json()) as T;
}

function nearestPickable(items: Pickable[], x: number, z: number, maxDist: number): Pickable | null {
  let best: Pickable | null = null;
  let bestD = maxDist;
  for (const item of items) {
    const d = Math.hypot(item.x - x, item.z - z);
    if (d < bestD) {
      best = item;
      bestD = d;
    }
  }
  return best;
}
