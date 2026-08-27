/**
 * RUNWAY — 3D city renderer.
 *
 * Implements IMapRenderer on top of a three.js WebGL scene: the city itself
 * (ground, water, parks, roads, tube ribbons, buildings, hub glows, fog) is
 * pure WebGL with no text/pins/particles; all game-facing chrome is drawn by
 * the shared, camera-agnostic MapOverlay onto the 2D overlay canvas via
 * `rig.worldToScreen` as the projector. Streams the city in over multiple
 * frames once `public/map/london-city.bin` has loaded and decoded. Landmark
 * silhouettes come from baked GLBs in `/map/landmarks/` with a procedural
 * fallback if a file is missing. Named towers the camera actually looks at
 * come from `/map/noticed/` (Wikimedia + Blender at bake time).
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
  buildStreetLamps,
  buildTubeLines,
  buildWater,
  CHUNK_COUNT,
  createBuildingMaterial,
  HUB_GLOW_PLAYER_COLOR,
} from './cityBuilder';
import { decodeCity, type CityData } from './format';
import { instantiateLandmark, loadLandmarkPrefabs } from './landmarkPrefabs';
import { instantiateNoticed, loadNoticedPrefabs, type NoticedEntry } from './noticedPrefabs';
import { createFacadeAtlases, createGlowSpriteTexture, createRoadTexture } from './textures';

const CITY_BIN_URL = '/map/london-city.bin';
const BUILD_JOBS_PER_FRAME = 2;
/** Drain faster while the loading overlay is up — the player isn't watching a half-built city. */
const BUILD_JOBS_WHILE_LOADING = 10;
const HUB_GLOW_DEFAULT_COLOR = 0x7dd3fc;

/** Fitzrovia / Charlotte St — cream and brick terraces, the X-post street-clip analogue. */
const HERO_AT = [-0.1358, 51.5196] as const;
/**
 * World-units of ground to fill the viewport height (~95 m). The X-post
 * street clip is a corner of a few buildings, not a whole neighbourhood.
 */
const HERO_VIEW_HEIGHT = 0.95;
const DAY_SKY = 0x8ec5f0;

function heroLook(): { at: readonly [number, number]; viewH: number; azimuth: number } {
  const look = new URLSearchParams(window.location.search).get('look');
  const hit = LANDMARKS.find((l) => l.kind === look);
  if (!hit) return { at: HERO_AT, viewH: HERO_VIEW_HEIGHT, azimuth: 0 };
  if (hit.kind === 'towerbridge') {
    // From ESE, looking WNW: both towers left/right, walkways and lanterns readable.
    return { at: hit.at, viewH: 1.08, azimuth: Math.PI / 2 - 0.38 };
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
    hit.kind === 'buckingham' ||
    hit.kind === 'towerlondon' ||
    hit.kind === 'battersea' ||
    hit.kind === 'o2';
  return { at: hit.at, viewH: wide ? 2.8 : 1.55, azimuth: 0 };
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
  /**
   * 2D kept maxZoom=26 (px per world-unit) because that map is a schematic doodle.
   * Street-scale in 3D is ~880: about 90 m of ground in a tall viewport —
   * a corner you can read the way the X-post street clip does.
   */
  private maxZoom = 880;
  private cssW = 0;
  private cssH = 0;
  private readonly heroAzimuth = heroLook().azimuth;

  private readonly cityGroup = new THREE.Group();
  private readonly buildingMaterial: THREE.MeshLambertMaterial;
  private readonly glowTexture: THREE.Texture;
  private readonly roadTexture: THREE.Texture;
  private readonly hemi: THREE.HemisphereLight;
  private readonly streetFill: THREE.PointLight;
  private buildQueue: BuildJob[] = [];
  private hubGlowSprites: Map<HubId, THREE.Sprite> = new Map();
  private lastPlayerHubId: HubId | null = null;
  /** LOD: minor buildings hide below a zoom threshold (coarser on touch); tier-2 roads hide below 4.5. */
  private readonly minorMeshes: THREE.Mesh[] = [];
  private tier2RoadMesh: THREE.Object3D | null = null;
  private lampGroup: THREE.Object3D | null = null;
  private lastMinorVisible: boolean | null = null;
  private lastTier2Visible: boolean | null = null;
  private lastLampsVisible: boolean | null = null;
  private treeGroup: THREE.Object3D | null = null;
  private lastTreesVisible: boolean | null = null;
  private landmarkPrefabs = new Map<LandmarkKind, THREE.Object3D>();
  private noticedEntries: NoticedEntry[] = [];
  private noticedPrefabs = new Map<string, THREE.Object3D>();
  /** True once london-city.bin is decoded and jobs are queued (queue starts empty). */
  private cityStreamed = false;
  private readyNotified = false;

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
    this.isCoarsePointer = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.isCoarsePointer ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(DAY_SKY, 1);

    this.fog = new THREE.Fog(DAY_SKY, 12, 80);
    this.scene3d.fog = this.fog;
    this.scene3d.background = new THREE.Color(DAY_SKY);

    this.hemi = new THREE.HemisphereLight(0xd6ebff, 0xc8b79a, 0.78);
    const amb = new THREE.AmbientLight(0xfff8ee, 0.42);
    const dir = new THREE.DirectionalLight(0xfff6e0, 1.15);
    dir.position.set(0.22, 4.2, 0.18);
    this.streetFill = new THREE.PointLight(0xffe0b0, 0, 2.8, 1.6);
    this.scene3d.add(this.hemi, amb, dir, this.streetFill);
    this.overlay.atmosphere = 'day';

    this.scene3d.add(buildGround());
    this.scene3d.add(buildTubeLines());

    this.glowTexture = createGlowSpriteTexture();
    const { group: hubGlowGroup, sprites } = buildHubGlows(this.glowTexture);
    this.hubGlowSprites = sprites;
    this.scene3d.add(hubGlowGroup);

    this.scene3d.add(this.cityGroup);

    const facades = createFacadeAtlases();
    facades.albedo.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    facades.emissive.anisotropy = facades.albedo.anisotropy;
    this.buildingMaterial = createBuildingMaterial(facades.albedo, facades.emissive);
    this.roadTexture = createRoadTexture();
    this.roadTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

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
      (window as unknown as { __runwayForceContextLoss?: () => void }).__runwayForceContextLoss = () => {
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

  private onCityData(data: CityData): void {
    if (this.disposed) return;
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
          const mesh = buildChunkTier(data, chunkId, major, landmarkAnchors);
          if (mesh) {
            mesh.material = this.buildingMaterial;
            this.cityGroup.add(mesh);
            if (!major) this.minorMeshes.push(mesh);
          }
        });
      }
    }
    jobs.push(() => {
      const roadGroup = buildRoads(data, this.roadTexture);
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
        this.cityGroup.add(group);
      });
    }
    for (const entry of this.noticedEntries) {
      jobs.push(() => {
        const prefab = this.noticedPrefabs.get(entry.id);
        if (!prefab) return;
        const group = instantiateNoticed(prefab);
        group.position.set(entry.x, 0, entry.z);
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

  // ---------------------------------------------------------------------
  // IMapRenderer surface
  // ---------------------------------------------------------------------

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
    const look = heroLook();
    const hero = project(look.at);
    const zoom = this.cssH > 0 ? this.cssH / look.viewH : 80;
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

    const dist = this.rig.getDistance();
    this.fog.near = dist * 8;
    this.fog.far = dist * 28;
    const close = Math.max(0, Math.min(1, (this.cam.zoom - 24) / 220));
    this.streetFill.position.set(this.cam.x, 16 * METERS_TO_WORLD, this.cam.y);
    this.streetFill.intensity = 0;
    this.streetFill.distance = 1.4 + close * 1.6;
    this.hemi.intensity = 0.74 + close * 0.08;
    this.buildingMaterial.emissiveIntensity = 0;

    const minorThreshold = this.isCoarsePointer ? 5.5 : 4.8;
    const minorVisible = this.cam.zoom >= minorThreshold;
    if (minorVisible !== this.lastMinorVisible) {
      for (let i = 0; i < this.minorMeshes.length; i++) this.minorMeshes[i].visible = minorVisible;
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
    const treesVisible = this.cam.zoom >= 10;
    if (treesVisible !== this.lastTreesVisible) {
      if (this.treeGroup) this.treeGroup.visible = treesVisible;
      this.lastTreesVisible = treesVisible;
    }

    const playerHubId = this.overlay.scene.playerHubId;
    if (playerHubId !== this.lastPlayerHubId) {
      if (this.lastPlayerHubId) {
        this.hubGlowSprites.get(this.lastPlayerHubId)?.material.color.setHex(HUB_GLOW_DEFAULT_COLOR);
      }
      if (playerHubId) {
        this.hubGlowSprites.get(playerHubId)?.material.color.setHex(HUB_GLOW_PLAYER_COLOR);
      }
      this.lastPlayerHubId = playerHubId;
    }

    this.renderer.render(this.scene3d, this.rig.camera);

    this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    this.overlay.drawAreaLabels(this.overlayCtx, this.cam.zoom);
    this.overlay.draw(this.overlayCtx, t, dt, this.cam.zoom);
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
    this.buildingMaterial.map?.dispose();
    this.buildingMaterial.emissiveMap?.dispose();
    this.buildingMaterial.dispose();
    this.glowTexture.dispose();
    this.roadTexture.dispose();
    this.renderer.dispose();
  }
}
