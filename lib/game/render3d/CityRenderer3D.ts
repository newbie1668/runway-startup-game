/**
 * RUNWAY — 3D city renderer.
 *
 * Implements IMapRenderer on top of a three.js WebGL scene: the city itself
 * (ground, water, parks, roads, buildings, hub glows, fog) is pure WebGL
 * with no text/pins/particles; all game-facing chrome is drawn by the shared
 * camera-agnostic MapOverlay onto the 2D overlay canvas via `rig.worldToScreen`.
 * Streams the city in over multiple frames once london-city.bin has decoded.
 *
 * Look: daytime SFSIM — matte Lambert, one warm sun with a camera-following
 * shadow frustum, solid-colour façades, geometric window insets.
 */

import * as THREE from 'three';
import { LANDMARKS, METERS_TO_WORLD, WORLD, project, type LandmarkKind } from '../geo';
import { HUB_POS, MapOverlay } from '../overlay';
import type { CameraState, HitTarget, IMapRenderer, Scene } from '../scene';
import type { HubId } from '../types';
import { CameraRig, FIT_PITCH_SIN } from './cameraRig';
import {
  buildChunkTier,
  buildGround,
  buildHubGlows,
  buildParkTrees,
  buildParks,
  buildRoads,
  buildRooftopMesh,
  buildStreetLamps,
  buildTubeLines,
  buildWater,
  buildWindowMesh,
  CHUNK_COUNT,
  createBuildingMaterial,
  createScratch,
  HUB_GLOW_PLAYER_COLOR,
  nearestPick,
  type BuildingPick,
  type CityScratch,
} from './cityBuilder';
import { decodeCity, type CityData } from './format';
import { instantiateLandmark, loadLandmarkPrefabs } from './landmarkPrefabs';
import { instantiateNoticed, loadNoticedPrefabs, type NoticedEntry } from './noticedPrefabs';
import { DISTRICT_LABEL, SKY, STYLE_LABEL } from './palette';
import { createGlowSpriteTexture } from './textures';

const CITY_BIN_URL = '/map/london-city.bin';
const BUILD_JOBS_PER_FRAME = 2;
/** Drain faster while the loading overlay is up — the player isn't watching a half-built city. */
const BUILD_JOBS_WHILE_LOADING = 10;
const HUB_GLOW_DEFAULT_COLOR = 0xb8d4e8;

/** Fitzrovia / Charlotte St — cream and brick terraces. */
const HERO_AT = [-0.1358, 51.5196] as const;
const HERO_VIEW_HEIGHT = 0.95;

/** Warm afternoon sun from the south-west, ~38° elevation. */
const SUN_DIR = new THREE.Vector3(-0.72, 0.62, 0.82).normalize();

function heroLook(): { at: readonly [number, number]; viewH: number; azimuth: number } {
  const look = new URLSearchParams(window.location.search).get('look');
  const hit = LANDMARKS.find((l) => l.kind === look);
  if (!hit) return { at: HERO_AT, viewH: HERO_VIEW_HEIGHT, azimuth: 0 };
  if (hit.kind === 'towerbridge') {
    return { at: hit.at, viewH: 1.08, azimuth: Math.PI / 2 - 0.38 };
  }
  if (hit.kind === 'eye') {
    return { at: hit.at, viewH: 3.6, azimuth: -Math.PI / 2 };
  }
  if (hit.kind === 'buckingham') {
    return { at: hit.at, viewH: 2.4, azimuth: Math.PI / 2 };
  }
  if (hit.kind === 'canadasq') {
    return { at: hit.at, viewH: 7.2, azimuth: Math.PI / 2 - 0.35 };
  }
  if (hit.kind === 'westminsterbr' || hit.kind === 'lambethbr' || hit.kind === 'albertbr') {
    return { at: hit.at, viewH: 1.35, azimuth: 0 };
  }
  const wide =
    hit.kind.endsWith('br') ||
    hit.kind === 'millennium' ||
    hit.kind === 'hungerford' ||
    hit.kind === 'bigben' ||
    hit.kind === 'abbey' ||
    hit.kind === 'towerlondon' ||
    hit.kind === 'battersea' ||
    hit.kind === 'o2';
  return { at: hit.at, viewH: wide ? 2.8 : 1.55, azimuth: 0 };
}

function viewParam(): string | null {
  return new URLSearchParams(window.location.search).get('view');
}

type BuildJob = () => void;

export class CityRenderer3D implements IMapRenderer {
  private readonly cityCanvas: HTMLCanvasElement;
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly overlayCtx: CanvasRenderingContext2D;
  private readonly onFatal: () => void;
  private readonly onReady: () => void;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene3d = new THREE.Scene();
  private readonly fog: THREE.Fog;
  private readonly rig = new CameraRig();
  private readonly overlay: MapOverlay;
  private readonly isCoarsePointer: boolean;

  private cam: CameraState = (() => {
    const p = project(heroLook().at);
    return { x: p.x, y: p.y, zoom: 80 };
  })();
  private minZoom = 2;
  private maxZoom = 880;
  private cssW = 0;
  private cssH = 0;
  private readonly heroAzimuth = heroLook().azimuth;

  private readonly cityGroup = new THREE.Group();
  private readonly buildingMaterial: THREE.MeshLambertMaterial;
  private readonly glowTexture: THREE.Texture;
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly sunTarget = new THREE.Object3D();
  private buildQueue: BuildJob[] = [];
  private hubGlowSprites: Map<HubId, THREE.Sprite> = new Map();
  private lastPlayerHubId: HubId | null = null;
  private readonly minorMeshes: THREE.Mesh[] = [];
  private tier2RoadMesh: THREE.Object3D | null = null;
  private lampGroup: THREE.Object3D | null = null;
  private lastMinorVisible: boolean | null = null;
  private lastTier2Visible: boolean | null = null;
  private lastLampsVisible: boolean | null = null;
  private treeGroup: THREE.Object3D | null = null;
  private lastTreesVisible: boolean | null = null;
  private windowMesh: THREE.InstancedMesh | null = null;
  private lastWindowsVisible: boolean | null = null;
  private landmarkPrefabs = new Map<LandmarkKind, THREE.Object3D>();
  private noticedEntries: NoticedEntry[] = [];
  private noticedPrefabs = new Map<string, THREE.Object3D>();
  private cityStreamed = false;
  private readyNotified = false;
  private scratch: CityScratch = createScratch();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private selected: BuildingPick | null = null;
  private readonly beamGroup = new THREE.Group();
  private readonly buildingMeshes: THREE.Object3D[] = [];

  private disposed = false;
  private contextLostTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    cityCanvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
    opts: { onFatal: () => void; onReady?: () => void },
  ) {
    this.cityCanvas = cityCanvas;
    this.overlayCanvas = overlayCanvas;
    this.overlayCtx = overlayCanvas.getContext('2d')!;
    this.onFatal = opts.onFatal;
    this.onReady = opts.onReady ?? (() => undefined);
    this.isCoarsePointer =
      typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

    this.overlay = new MapOverlay(
      (p) => this.rig.worldToScreen(p),
      () => ({ w: this.cssW, h: this.cssH }),
    );

    this.renderer = new THREE.WebGLRenderer({
      canvas: cityCanvas,
      alpha: false,
      antialias: !this.isCoarsePointer,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, this.isCoarsePointer ? 1.5 : 2),
    );
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setClearColor(SKY, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.fog = new THREE.Fog(SKY, 18, 90);
    this.scene3d.fog = this.fog;
    this.scene3d.background = new THREE.Color(SKY);

    this.hemi = new THREE.HemisphereLight(0xd4e4f2, 0xc2b6a4, 0.62);
    const amb = new THREE.AmbientLight(0xf0ebe3, 0.28);
    this.sun = new THREE.DirectionalLight(0xfff1d4, 1.55);
    this.sun.castShadow = true;
    const mapSize = this.isCoarsePointer ? 1024 : 2048;
    this.sun.shadow.mapSize.set(mapSize, mapSize);
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.camera.near = 2;
    this.sun.shadow.camera.far = 140;
    this.sunTarget.position.set(WORLD.width / 2, 0, WORLD.height / 2);
    this.sun.target = this.sunTarget;
    this.scene3d.add(this.hemi, amb, this.sun, this.sunTarget);
    this.overlay.atmosphere = 'day';

    const ground = buildGround();
    this.scene3d.add(ground);
    this.scene3d.add(buildTubeLines());

    this.glowTexture = createGlowSpriteTexture();
    const { group: hubGlowGroup, sprites } = buildHubGlows(this.glowTexture);
    this.hubGlowSprites = sprites;
    this.scene3d.add(hubGlowGroup);

    this.scene3d.add(this.cityGroup);
    this.buildingMaterial = createBuildingMaterial();

    this.beamGroup.visible = false;
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x7ec8ff,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 1, 16, 1, true), beamMat);
    beam.position.y = 0.5;
    beam.name = 'shaft';
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xb8e0ff,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.32, 24), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.name = 'ring';
    this.beamGroup.add(beam, ring);
    this.scene3d.add(this.beamGroup);

    this.cityCanvas.addEventListener('webglcontextlost', this.handleContextLost);

    const cityPromise = fetch(CITY_BIN_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => decodeCity(buf));

    void Promise.all([cityPromise, loadLandmarkPrefabs(), loadNoticedPrefabs()])
      .then(([data, prefabs, noticed]) => {
        this.landmarkPrefabs = prefabs;
        this.noticedEntries = noticed.entries;
        this.noticedPrefabs = noticed.prefabs;
        this.onCityData(data);
      })
      .catch(() => {
        if (!this.disposed) this.onFatal();
      });

    if (new URLSearchParams(window.location.search).get('map') === 'debug') {
      (window as unknown as { __runwayForceContextLoss?: () => void }).__runwayForceContextLoss =
        () => {
          this.renderer.getContext().getExtension('WEBGL_lose_context')?.loseContext();
        };
    }
  }

  private handleContextLost = (e: Event): void => {
    e.preventDefault();
    this.contextLostTimer = setTimeout(() => {
      if (this.disposed) return;
      try {
        sessionStorage.setItem('runway-force-2d', '1');
      } catch {
        // Storage unavailable (private mode etc.) — the in-memory fallback still fires.
      }
      this.onFatal();
    }, 2000);
  };

  private enableShadows(root: THREE.Object3D, cast: boolean, receive: boolean): void {
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = cast;
        obj.receiveShadow = receive;
      }
    });
  }

  private onCityData(data: CityData): void {
    if (this.disposed) return;
    this.scratch = createScratch();
    const landmarkAnchors = [
      ...LANDMARKS.map((l) => {
        const p = project(l.at);
        return { x: p.x, y: p.y, r: (l.exclusionM ?? 80) * METERS_TO_WORLD };
      }),
      ...this.noticedEntries.map((e) => ({
        x: e.x,
        y: e.z,
        r: e.exclusionM * METERS_TO_WORLD,
      })),
    ];
    const jobs: BuildJob[] = [];
    for (let chunkId = 0; chunkId < CHUNK_COUNT; chunkId++) {
      for (const major of [true, false]) {
        jobs.push(() => {
          const mesh = buildChunkTier(data, chunkId, major, landmarkAnchors, this.scratch);
          if (mesh) {
            mesh.material = this.buildingMaterial;
            this.cityGroup.add(mesh);
            this.buildingMeshes.push(mesh);
            if (!major) this.minorMeshes.push(mesh);
          }
        });
      }
    }
    jobs.push(() => {
      const windows = buildWindowMesh(this.scratch);
      if (windows) {
        windows.visible = false;
        this.windowMesh = windows;
        this.cityGroup.add(windows);
      }
      const roofs = buildRooftopMesh(this.scratch);
      if (roofs) this.cityGroup.add(roofs);
    });
    jobs.push(() => {
      const roadGroup = buildRoads(data);
      if (roadGroup) {
        this.cityGroup.add(roadGroup);
        for (const child of roadGroup.children) {
          if (child.userData.roadTier === 2) this.tier2RoadMesh = child;
        }
      }
    });
    jobs.push(() => {
      const lamps = buildStreetLamps(data);
      if (lamps) {
        lamps.visible = false;
        this.lampGroup = lamps;
        this.cityGroup.add(lamps);
      }
    });
    jobs.push(() => {
      const mesh = buildParks(data);
      if (mesh) this.cityGroup.add(mesh);
    });
    jobs.push(() => {
      const trees = buildParkTrees(data);
      if (trees) {
        trees.visible = false;
        this.treeGroup = trees;
        this.cityGroup.add(trees);
      }
    });
    jobs.push(() => {
      const mesh = buildWater(data);
      if (mesh) this.cityGroup.add(mesh);
    });
    for (let i = 0; i < LANDMARKS.length; i++) {
      jobs.push(() => {
        const landmark = LANDMARKS[i];
        const p = project(landmark.at);
        const group = instantiateLandmark(landmark.kind, this.landmarkPrefabs);
        group.position.set(p.x, 0, p.y);
        if (landmark.yaw) group.rotation.y += landmark.yaw;
        this.enableShadows(group, true, true);
        this.cityGroup.add(group);
      });
    }
    for (const entry of this.noticedEntries) {
      jobs.push(() => {
        const prefab = this.noticedPrefabs.get(entry.id);
        if (!prefab) return;
        const group = instantiateNoticed(prefab);
        group.position.set(entry.x, 0, entry.z);
        this.enableShadows(group, true, true);
        this.cityGroup.add(group);
      });
    }
    this.buildQueue = jobs;
    this.cityStreamed = true;
  }

  private drainBuildQueue(): void {
    const budget = this.readyNotified ? BUILD_JOBS_PER_FRAME : BUILD_JOBS_WHILE_LOADING;
    for (let i = 0; i < budget && this.buildQueue.length > 0; i++) {
      this.buildQueue.shift()!();
    }
    if (this.cityStreamed && this.buildQueue.length === 0) this.markReady();
  }

  private markReady(): void {
    if (this.readyNotified || this.disposed) return;
    this.readyNotified = true;
    this.onReady();
  }

  private updateSunShadow(): void {
    const dist = this.rig.getDistance();
    const extent = Math.max(6, Math.min(42, dist * 1.05));
    this.sunTarget.position.set(this.cam.x, 0, this.cam.y);
    this.sun.position.set(this.cam.x + SUN_DIR.x * 70, SUN_DIR.y * 70, this.cam.y + SUN_DIR.z * 70);
    const cam = this.sun.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 4;
    cam.far = 130;
    cam.updateProjectionMatrix();
    this.sunTarget.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  private placeBeam(pick: BuildingPick | null): void {
    this.selected = pick;
    if (!pick) {
      this.beamGroup.visible = false;
      return;
    }
    const r = Math.max(0.22, Math.sqrt(pick.areaM2) * METERS_TO_WORLD * 0.22);
    const h = Math.max(2.4, pick.heightWorld * 2.4 + 1.6);
    this.beamGroup.position.set(pick.x, 0, pick.z);
    const shaft = this.beamGroup.getObjectByName('shaft') as THREE.Mesh | undefined;
    const ring = this.beamGroup.getObjectByName('ring') as THREE.Mesh | undefined;
    if (shaft) {
      shaft.scale.set(r, h, r);
      shaft.position.y = h / 2;
    }
    if (ring) {
      ring.scale.set(r, r, 1);
      ring.position.y = 0.04;
    }
    this.beamGroup.visible = true;
  }

  private pickBuilding(sx: number, sy: number): BuildingPick | null {
    if (this.cssW <= 0 || this.cssH <= 0 || this.buildingMeshes.length === 0) return null;
    this.ndc.set((sx / this.cssW) * 2 - 1, -(sy / this.cssH) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.rig.camera);
    const hits = this.raycaster.intersectObjects(this.buildingMeshes, false);
    if (hits.length === 0) return null;
    const pt = hits[0]!.point;
    return nearestPick(this.scratch.picks, pt.x, pt.z, 0.85);
  }

  private drawBuildingCard(ctx: CanvasRenderingContext2D, pick: BuildingPick): void {
    const screen = this.rig.worldToScreen({ x: pick.x, y: pick.z });
    if (!screen) return;
    const name = STYLE_LABEL[pick.style] ?? 'Building';
    const lines = [
      name,
      `${Math.round(pick.heightM)} m · ${DISTRICT_LABEL[pick.district]}`,
      'OpenStreetMap',
    ];
    ctx.save();
    ctx.font = '700 12px ui-sans-serif, system-ui';
    const w0 = Math.max(
      ctx.measureText(lines[0]!).width,
      ctx.measureText(lines[1]!).width,
      ctx.measureText(lines[2]!).width,
    );
    const bw = w0 + 20;
    const bh = 58;
    const bx = Math.min(Math.max(screen.x - bw / 2, 8), this.cssW - bw - 8);
    const by = Math.max(8, screen.y - pick.heightWorld * 0.15 - bh - 18);
    ctx.fillStyle = 'rgba(18, 24, 36, 0.9)';
    ctx.strokeStyle = 'rgba(126, 200, 255, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e8eef6';
    ctx.textAlign = 'left';
    ctx.fillText(lines[0]!, bx + 10, by + 18);
    ctx.font = '500 11px ui-sans-serif, system-ui';
    ctx.fillStyle = '#c5d0dc';
    ctx.fillText(lines[1]!, bx + 10, by + 36);
    ctx.fillStyle = '#8aa0b4';
    ctx.fillText(lines[2]!, bx + 10, by + 50);
    ctx.restore();
  }

  notifyPointer(sx: number, sy: number, kind: 'hover' | 'click'): void {
    if (kind !== 'click') return;
    if (this.overlay.hitTest(sx, sy)) return;
    const pick = this.pickBuilding(sx, sy);
    if (
      pick &&
      this.selected &&
      Math.hypot(pick.x - this.selected.x, pick.z - this.selected.z) < 0.05
    ) {
      this.placeBeam(null);
      return;
    }
    this.placeBeam(pick);
  }

  get scene(): Scene {
    return this.overlay.scene;
  }
  set scene(s: Scene) {
    this.overlay.scene = s;
  }
  get hover(): HitTarget | null {
    return this.overlay.hover;
  }
  set hover(h: HitTarget | null) {
    this.overlay.hover = h;
  }

  private computeFit(): number {
    if (this.cssW === 0 || this.cssH === 0) return this.minZoom || 2;
    return Math.min(this.cssW / WORLD.width, (this.cssH / WORLD.height) * FIT_PITCH_SIN) * 1.02;
  }

  private syncRig(): void {
    this.rig.update(this.cam, this.minZoom, this.heroAzimuth);
  }

  private clampCamera(): void {
    const mx = WORLD.width * 0.25;
    const my = WORLD.height * 0.25;
    this.cam.x = Math.min(WORLD.width + mx, Math.max(-mx, this.cam.x));
    this.cam.y = Math.min(WORLD.height + my, Math.max(-my, this.cam.y));
  }

  resize(): void {
    const rect = this.cityCanvas.getBoundingClientRect();
    this.cssW = rect.width;
    this.cssH = rect.height;
    if (this.cssW === 0 || this.cssH === 0) return;
    this.renderer.setSize(this.cssW, this.cssH, false);
    const overlayDpr = Math.min(2, window.devicePixelRatio || 1);
    this.overlayCanvas.width = Math.round(this.cssW * overlayDpr);
    this.overlayCanvas.height = Math.round(this.cssH * overlayDpr);
    this.overlayCtx.setTransform(overlayDpr, 0, 0, overlayDpr, 0, 0);
    this.rig.setViewport(this.cssW, this.cssH);
    const fit = this.computeFit();
    this.minZoom = fit * 0.85;
    if (this.cam.zoom < this.minZoom) this.cam.zoom = fit * 1.02;
    this.syncRig();
  }

  fitAll(): void {
    const view = viewParam();
    if (view === 'wide') {
      this.fitOverview();
      return;
    }
    const look = heroLook();
    const hero = project(look.at);
    let viewH = look.viewH;
    if (view === 'mid' || view === 'default') viewH = 8.5;
    const zoom = this.cssH > 0 ? this.cssH / viewH : 80;
    this.cam = {
      x: hero.x,
      y: hero.y,
      zoom: Math.min(this.maxZoom, Math.max(this.minZoom, zoom)),
    };
    this.clampCamera();
    this.syncRig();
  }

  fitOverview(): void {
    this.cam = { x: WORLD.width / 2, y: WORLD.height / 2, zoom: this.computeFit() };
    this.syncRig();
  }

  focusHub(hubId: HubId, zoom = 80): void {
    const p = HUB_POS[hubId];
    this.cam.x = p.x;
    this.cam.y = p.y;
    this.cam.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, Math.max(this.cam.zoom, zoom)));
    this.clampCamera();
    this.syncRig();
  }

  pan(dxPx: number, dyPx: number): void {
    this.syncRig();
    const cx = this.cssW / 2;
    const cy = this.cssH / 2;
    const before = this.rig.groundUnproject(cx, cy);
    const after = this.rig.groundUnproject(cx + dxPx, cy + dyPx);
    this.cam.x -= after.x - before.x;
    this.cam.y -= after.y - before.y;
    this.clampCamera();
    this.syncRig();
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    this.syncRig();
    const before = this.rig.groundUnproject(sx, sy);
    this.cam.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.cam.zoom * factor));
    this.syncRig();
    const after = this.rig.groundUnproject(sx, sy);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
    this.clampCamera();
    this.syncRig();
  }

  getCamera(): CameraState {
    return { ...this.cam };
  }

  setCamera(c: CameraState): void {
    this.cam = { ...c };
    this.clampCamera();
    this.syncRig();
  }

  hitTest(sx: number, sy: number): HitTarget | null {
    return this.overlay.hitTest(sx, sy);
  }
  burstConfetti(hubId: HubId | null): void {
    this.overlay.burstConfetti(hubId);
  }
  floatText(hubId: HubId | null, text: string, color?: string): void {
    this.overlay.floatText(hubId, text, color);
  }
  puffSmoke(hubId: HubId | null): void {
    this.overlay.puffSmoke(hubId);
  }
  sparkle(hubId: HubId | null): void {
    this.overlay.sparkle(hubId);
  }

  frame(t: number, dt: number): void {
    if (this.disposed) return;
    this.drainBuildQueue();
    if (this.cssW === 0 || this.cssH === 0) return;
    this.syncRig();
    this.updateSunShadow();

    const dist = this.rig.getDistance();
    this.fog.near = dist * 7;
    this.fog.far = dist * 24;

    const minorThreshold = this.isCoarsePointer ? 5.5 : 4.8;
    const minorVisible = this.cam.zoom >= minorThreshold;
    if (minorVisible !== this.lastMinorVisible) {
      for (let i = 0; i < this.minorMeshes.length; i++) this.minorMeshes[i]!.visible = minorVisible;
      this.lastMinorVisible = minorVisible;
    }
    const tier2Visible = this.cam.zoom >= 4.5;
    if (tier2Visible !== this.lastTier2Visible) {
      if (this.tier2RoadMesh) this.tier2RoadMesh.visible = tier2Visible;
      this.lastTier2Visible = tier2Visible;
    }
    const lampsVisible = this.cam.zoom >= 28;
    if (lampsVisible !== this.lastLampsVisible) {
      if (this.lampGroup) this.lampGroup.visible = lampsVisible;
      this.lastLampsVisible = lampsVisible;
    }
    const treesVisible = this.cam.zoom >= 8;
    if (treesVisible !== this.lastTreesVisible) {
      if (this.treeGroup) this.treeGroup.visible = treesVisible;
      this.lastTreesVisible = treesVisible;
    }
    const windowsVisible = this.cam.zoom >= 10;
    if (windowsVisible !== this.lastWindowsVisible) {
      if (this.windowMesh) this.windowMesh.visible = windowsVisible;
      this.lastWindowsVisible = windowsVisible;
    }

    const playerHubId = this.overlay.scene.playerHubId;
    if (playerHubId !== this.lastPlayerHubId) {
      if (this.lastPlayerHubId) {
        this.hubGlowSprites
          .get(this.lastPlayerHubId)
          ?.material.color.setHex(HUB_GLOW_DEFAULT_COLOR);
      }
      if (playerHubId) {
        this.hubGlowSprites.get(playerHubId)?.material.color.setHex(HUB_GLOW_PLAYER_COLOR);
      }
      this.lastPlayerHubId = playerHubId;
    }

    if (this.beamGroup.visible) {
      const pulse = 0.22 + 0.08 * Math.sin(t * 0.004);
      const shaft = this.beamGroup.getObjectByName('shaft') as THREE.Mesh | undefined;
      if (shaft && shaft.material instanceof THREE.MeshBasicMaterial)
        shaft.material.opacity = pulse;
    }

    this.renderer.render(this.scene3d, this.rig.camera);

    this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    this.overlay.drawAreaLabels(this.overlayCtx, this.cam.zoom);
    this.overlay.draw(this.overlayCtx, t, dt, this.cam.zoom);
    if (this.selected) this.drawBuildingCard(this.overlayCtx, this.selected);
  }

  dispose(): void {
    this.disposed = true;
    if (this.contextLostTimer) clearTimeout(this.contextLostTimer);
    this.cityCanvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.scene3d.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.geometry.dispose();
      const material = (obj as Partial<THREE.Mesh>).material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    this.buildingMaterial.dispose();
    this.glowTexture.dispose();
    this.renderer.dispose();
  }
}
