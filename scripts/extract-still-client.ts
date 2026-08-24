/**
 * Browser client for extract stills. Fetches the clay-board GeoJSON only.
 * Never loads /sim or public/sim/london.bin.
 */
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { buildCity } from '../lib/sim/build-city';
import { hubTarget, overviewPose, type CameraPose } from '../lib/sim/camera';
import { SIM_HUBS, type SimHubId } from '../lib/sim/constants';
import { projectLngLat } from '../lib/sim/projection';
import { createBuildingMaterial, setupScene } from '../lib/sim/scene-setup';
import type {
  BuildingProperties,
  LandcoverProperties,
  LngLat,
  RoadProperties,
  SimFeature,
  SimFeatureCollection,
  SimProperties,
} from '../lib/sim/types';

const EXTRACT_URL = '/extract.geojson';

interface ExtractWindow extends Window {
  __extractReady?: boolean;
  __extractError?: string;
  __extractStats?: { buildings: number; roads: number; source: string };
  setExtractView?: (id: string) => void;
}

type MixedFC = SimFeatureCollection<SimProperties>;

function splitExtract(fc: MixedFC) {
  const buildings: SimFeature<BuildingProperties>[] = [];
  const roads: SimFeature<RoadProperties>[] = [];
  const landcover: SimFeature<LandcoverProperties>[] = [];
  for (const feature of fc.features) {
    if (feature.properties.layer === 'building') {
      buildings.push(feature as SimFeature<BuildingProperties>);
    } else if (feature.properties.layer === 'road') {
      roads.push(feature as SimFeature<RoadProperties>);
    } else {
      landcover.push(feature as SimFeature<LandcoverProperties>);
    }
  }
  const wrap = <P extends SimProperties>(
    name: string,
    features: SimFeature<P>[],
  ): SimFeatureCollection<P> => ({
    type: 'FeatureCollection',
    name,
    attribution: fc.attribution,
    bbox: fc.bbox,
    generated: fc.generated,
    meta: fc.meta,
    features,
  });
  return {
    buildings: wrap('buildings', buildings),
    roads: wrap('roads', roads),
    landcover: wrap('landcover', landcover),
  };
}

function lookDown(target: { x: number; z: number }, height: number, back: number): CameraPose {
  return {
    target: { x: target.x, y: 0, z: target.z },
    position: { x: target.x - back * 0.22, y: height, z: target.z - back },
  };
}

function hubLookDown(id: SimHubId, height: number, back: number): CameraPose {
  const hub = SIM_HUBS.find((item) => item.id === id)!;
  return lookDown(hubTarget(hub), height, back);
}

function framePickables(
  items: { name: string; x: number; z: number }[],
  match: RegExp,
  fallback: CameraPose,
  back: number,
  height: number,
): CameraPose {
  const hits = items.filter((item) => match.test(item.name));
  if (!hits.length) return fallback;
  let x = 0;
  let z = 0;
  for (const hit of hits) {
    x += hit.x;
    z += hit.z;
  }
  x /= hits.length;
  z /= hits.length;
  return lookDown({ x, z }, height, back);
}

function applyPose(camera: THREE.PerspectiveCamera, pose: CameraPose) {
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
}

function eachRoadLine(feature: SimFeature<RoadProperties>, visit: (line: LngLat[]) => void) {
  const geometry = feature.geometry;
  if (geometry.type === 'LineString') {
    visit(geometry.coordinates as LngLat[]);
    return;
  }
  if (geometry.type === 'MultiLineString') {
    for (const line of geometry.coordinates as LngLat[][]) visit(line);
  }
}

function addStreetLines(
  group: THREE.Group,
  roads: SimFeature<RoadProperties>[],
  resolution: THREE.Vector2,
) {
  const material = new LineMaterial({
    color: 0xf4f6f8,
    linewidth: 9,
    worldUnits: true,
    vertexColors: false,
  });
  material.resolution.copy(resolution);
  for (const feature of roads) {
    eachRoadLine(feature, (line) => {
      if (line.length < 2) return;
      const positions: number[] = [];
      for (const [lng, lat] of line) {
        const point = projectLngLat(lng, lat);
        positions.push(point.x, 1.8, point.z);
      }
      const geometry = new LineGeometry();
      geometry.setPositions(positions);
      const mesh = new Line2(geometry, material);
      mesh.computeLineDistances();
      group.add(mesh);
    });
  }
}

async function main() {
  const w = window as ExtractWindow;
  const host = document.getElementById('view');
  if (!host) throw new Error('#view missing');

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    52,
    host.clientWidth / Math.max(1, host.clientHeight),
    2,
    28000,
  );
  setupScene(renderer, scene, camera);
  renderer.setClearColor(0x7d868f, 1);
  scene.background = new THREE.Color(0x7d868f);
  scene.fog = null;
  const ground = scene.getObjectByName('ground') as THREE.Mesh | undefined;
  const groundMat = ground?.material;
  if (groundMat && groundMat instanceof THREE.MeshLambertMaterial) {
    groundMat.color.setHex(0x3a3e45);
  }

  applyPose(camera, overviewPose());

  const city = new THREE.Group();
  scene.add(city);

  const response = await fetch(EXTRACT_URL);
  if (!response.ok) throw new Error(`failed to load ${EXTRACT_URL}`);
  const fc = (await response.json()) as MixedFC;
  if (!Array.isArray(fc.features)) throw new Error('extract is not a FeatureCollection');

  const parts = splitExtract(fc);
  const mesh = await buildCity({
    buildings: parts.buildings,
    roads: { ...parts.roads, features: [] },
    landcover: parts.landcover,
    preview: {
      waterColor: [0.55, 0.78, 0.92],
      parkColor: [0.42, 0.58, 0.36],
      waterY: 0.4,
      parkY: 0.5,
    },
  });
  mesh.stats.roads = parts.roads.features.length;

  const buildingMat = createBuildingMaterial();
  const parkMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const waterMat = new THREE.MeshBasicMaterial({ vertexColors: true });

  for (const chunk of mesh.chunks) {
    if (chunk.kind === 'road') continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(chunk.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(chunk.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(chunk.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(chunk.indices, 1));
    const material =
      chunk.kind === 'building' ? buildingMat : chunk.kind === 'water' ? waterMat : parkMat;
    city.add(new THREE.Mesh(geometry, material));
  }

  addStreetLines(
    city,
    parts.roads.features,
    new THREE.Vector2(host.clientWidth, host.clientHeight),
  );

  const views: Record<string, () => CameraPose> = {
    overview: () => {
      const pose = overviewPose();
      return {
        target: pose.target,
        position: { x: pose.position.x, y: Math.max(pose.position.y, 5200), z: pose.position.z },
      };
    },
    streets: () => hubLookDown('city', 1480, 220),
    canary: () => hubLookDown('canarywharf', 860, 580),
    westminster: () =>
      framePickables(
        mesh.pickables,
        /palace of westminster|london eye/i,
        hubLookDown('westminster', 780, 620),
        620,
        780,
      ),
    farringdon: () => hubLookDown('farringdon', 780, 520),
  };

  w.setExtractView = (id: string) => {
    applyPose(camera, views[id]?.() ?? overviewPose());
    const kicker = document.getElementById('kicker');
    if (kicker) kicker.textContent = `EXTRACT · CLAY BOARD · ${id.toUpperCase()}`;
  };
  w.setExtractView('overview');

  const hudCounts = document.getElementById('counts');
  const hudSource = document.getElementById('source');
  if (hudCounts) {
    hudCounts.textContent = `${mesh.stats.buildings.toLocaleString('en-GB')} buildings · ${mesh.stats.roads.toLocaleString('en-GB')} streets`;
  }
  if (hudSource) {
    hudSource.textContent =
      'data/osm-central-london-simplified.geojson · NOT /sim · NOT london.bin';
  }

  const loop = () => {
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  loop();

  w.__extractStats = {
    buildings: mesh.stats.buildings,
    roads: mesh.stats.roads,
    source: 'osm-central-london-simplified.geojson',
  };
  w.__extractReady = true;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  (window as ExtractWindow).__extractError = message;
});
