/**
 * RUNWAY — 3D city renderer.
 *
 * Implements IMapRenderer on top of a three.js WebGL scene: the city itself
 * (ground, water, parks, roads, buildings, hub glows, fog) is pure WebGL
 * with no text/pins/particles; all game-facing chrome is drawn by the shared
 * camera-agnostic MapOverlay onto the 2D overlay canvas via `rig.worldToScreen`.
 * Streams the city in over multiple frames once london-city.bin has decoded.
 *
 * Look: daytime SFSIM — matte Lambert, one warm sun, no projected
 * shadows, solid-colour façades, locked isometric orthographic camera.
 */

import * as THREE from 'three';
import {
  LANDMARKS,
  METERS_TO_WORLD,
  THAMES_CROSSINGS,
  WORLD,
  isDeckLandmark,
  project,
  thamesCrossingLookKey,
  type LandmarkKind,
} from '../geo';
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
  buildFacadeSigns,
  buildStreetLamps,
  buildTubeLines,
  buildWater,
  buildWindowMesh,
  CHUNK_COUNT,
  createBuildingMaterial,
  createScratch,
  crossingYawAt,
  HUB_GLOW_PLAYER_COLOR,
  nearestPick,
  riverCrossingSpans,
  type BuildingPick,
  type CityScratch,
} from './cityBuilder';
import { decodeCity, type CityData } from './format';
import { instantiateLandmark, loadLandmarkPrefabs } from './landmarkPrefabs';
import { instantiateNoticed, loadNoticedPrefabs, type NoticedEntry } from './noticedPrefabs';
import { isUniqueNoticedId } from './uniqueNoticed';
import { DISTRICT_LABEL, SKY, STYLE_LABEL, USE_LABEL } from './palette';
import { createGlowSpriteTexture } from './textures';

const CITY_BIN_URL = '/map/london-city.bin';
const BUILD_JOBS_PER_FRAME = 2;
/** Drain faster while the loading overlay is up — the player isn't watching a half-built city. */
const BUILD_JOBS_WHILE_LOADING = 16;
const HUB_GLOW_DEFAULT_COLOR = 0xb8d4e8;

/** Fitzrovia / Charlotte St — cream and brick terraces, toy isometric height. */
const HERO_AT = [-0.1358, 51.5196] as const;
const HERO_VIEW_HEIGHT = 1.92;

/** Close cameras on bake-time noticed towers (lng/lat from OSM rings). */
const NOTICED_LOOK: Record<
  string,
  { at: readonly [number, number]; viewH: number; azimuth: number }
> = {
  parkdrive: { at: [-0.01503, 51.50227], viewH: 2.55, azimuth: 0.95 },
  newfoundland: { at: [-0.0251, 51.5043], viewH: 2.35, azimuth: 1.15 },
  wardian: { at: [-0.0224, 51.5017], viewH: 2.45, azimuth: 0.85 },
  charrington: { at: [-0.00546, 51.50692], viewH: 1.85, azimuth: 0.18 },
  hsbc: { at: [-0.01744, 51.50543], viewH: 2.35, azimuth: 0.55 },
  canadastreet: { at: [-0.0184, 51.50495], viewH: 4.25, azimuth: 0.62 },
};

/** Warm afternoon sun from the south-west. Lights faces, does not cast a shadow map. */
const SUN_DIR = new THREE.Vector3(-0.84, 0.5, 0.78).normalize();

function heroLook(): { at: readonly [number, number]; viewH: number; azimuth: number } {
  const look = new URLSearchParams(window.location.search).get('look');
  if (look && NOTICED_LOOK[look]) return NOTICED_LOOK[look]!;
  const crossing = THAMES_CROSSINGS.find((c) => thamesCrossingLookKey(c.name) === look);
  if (crossing) return { at: crossing.at, viewH: 1.35, azimuth: 0 };
  const hit = LANDMARKS.find((l) => l.kind === look);
  if (!hit) return { at: HERO_AT, viewH: HERO_VIEW_HEIGHT, azimuth: 0 };
  if (isDeckLandmark(hit.kind) && hit.kind !== 'oldstreet') {
    if (hit.kind === 'towerbridge') {
      return { at: hit.at, viewH: 2.15, azimuth: Math.PI / 2 - 0.32 };
    }
    const azimuth = hit.kind === 'hungerford' ? -Math.PI / 2 : 0;
    return { at: hit.at, viewH: 1.35, azimuth };
  }
  if (hit.kind === 'eye') {
    return { at: hit.at, viewH: 3.15, azimuth: -Math.PI / 2 };
  }
  if (hit.kind === 'buckingham') {
    return { at: hit.at, viewH: 2.4, azimuth: Math.PI / 2 };
  }
  if (hit.kind === 'stpauls' || hit.kind === 'britishmuseum') {
    return { at: hit.at, viewH: 2.35, azimuth: 0.72 };
  }
  if (hit.kind === 'tatemodern' || hit.kind === 'nationaltheatre' || hit.kind === 'stpancras') {
    return { at: hit.at, viewH: 2.6, azimuth: 0.35 };
  }
  if (hit.kind === 'alberthall' || hit.kind === 'allsouls') {
    return { at: hit.at, viewH: 2.4, azimuth: 0.2 };
  }
  if (hit.kind === 'towerlondon') {
    return { at: hit.at, viewH: 1.55, azimuth: 0.35 };
  }
  if (hit.kind === 'canadasq') {
    return { at: hit.at, viewH: 4.4, azimuth: Math.PI / 2 - 0.35 };
  }
  if (
    hit.kind === 'gherkin' ||
    hit.kind === 'walkie' ||
    hit.kind === 'grater' ||
    hit.kind === 'bishop' ||
    hit.kind === 'heron' ||
    hit.kind === 'tower42'
  ) {
    return { at: hit.at, viewH: 3.35, azimuth: 0.55 };
  }
  if (hit.kind === 'shard') {
    return { at: hit.at, viewH: 2.65, azimuth: 0.42 };
  }
  const wide =
    hit.kind.endsWith('br') ||
    hit.kind === 'millennium' ||
    hit.kind === 'bigben' ||
    hit.kind === 'abbey' ||
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
  private readonly rig = new CameraRig();
  private readonly overlay: MapOverlay;
  private readonly isCoarsePointer: boolean;

  private cam: CameraState = (() => {
    const p = project(heroLook().at);
    return { x: p.x, y: p.y, zoom: 80 };
  })();
  private minZoom = 2;
  private maxZoom = 2200;
  private cssW = 0;
  private cssH = 0;
  private heroAzimuth = heroLook().azimuth;
  private lastSearch = typeof window === 'undefined' ? '' : window.location.search;
  private laidOut = false;

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
  private markMesh: THREE.Object3D | null = null;
  private lampGroup: THREE.Object3D | null = null;
  private lastMinorVisible: boolean | null = null;
  private lastTier2Visible: boolean | null = null;
  private lastMarksVisible: boolean | null = null;
  private lastLampsVisible: boolean | null = null;
  private treeGroup: THREE.Object3D | null = null;
  private lastGrovesVisible: boolean | null = null;
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
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.setClearColor(SKY, 1);
    this.renderer.shadowMap.enabled = false;

    this.scene3d.fog = null;
    this.scene3d.background = new THREE.Color(SKY);

    this.hemi = new THREE.HemisphereLight(0xd4deea, 0x6a6054, 0.55);
    const amb = new THREE.AmbientLight(0xe8e0d4, 0.18);
    this.sun = new THREE.DirectionalLight(0xfff3dc, 1.35);
    this.sun.castShadow = false;
    const originX = WORLD.width / 2;
    const originZ = WORLD.height / 2;
    this.sunTarget.position.set(originX, 0, originZ);
    this.sun.position.set(originX + SUN_DIR.x * 120, SUN_DIR.y * 120, originZ + SUN_DIR.z * 120);
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
      color: 0xffe566,
      transparent: true,
      opacity: 0.42,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.12, 1, 20, 1, true), beamMat);
    beam.position.y = 0.5;
    beam.name = 'shaft';
    beam.renderOrder = 12;
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xfff6b0,
      transparent: true,
      opacity: 0.55,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.3, 1, 12, 1, true), coreMat);
    core.position.y = 0.5;
    core.name = 'core';
    core.renderOrder = 13;
    this.beamGroup.add(beam, core);
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
    const look = new URLSearchParams(window.location.search).get('look');
    const lookNoticedId =
      look === 'charrington'
        ? 'charrington-tower'
        : look === 'parkdrive'
          ? 'one-park-drive'
          : look === 'newfoundland'
            ? 'newfoundland-quay'
            : look === 'hsbc' || look === 'canadastreet'
              ? 'hsbc-uk'
              : undefined;
    const jobs: BuildJob[] = [];
    const crossings = riverCrossingSpans(data);
    const pushNoticed = (entry: NoticedEntry): void => {
      jobs.push(() => {
        const prefab = this.noticedPrefabs.get(entry.id) ?? null;
        if (!prefab && !isUniqueNoticedId(entry.id)) return;
        const group = instantiateNoticed(entry, prefab);
        group.position.set(entry.x, 0, entry.z);
        this.cityGroup.add(group);
      });
    };
    const pushLandmark = (landmark: (typeof LANDMARKS)[number]): void => {
      jobs.push(() => {
        const p = project(landmark.at);
        const group = instantiateLandmark(landmark.kind, this.landmarkPrefabs);
        group.position.set(p.x, 0, p.y);
        const riverDeck = isDeckLandmark(landmark.kind) && landmark.kind !== 'oldstreet';
        if (riverDeck && landmark.kind !== 'towerbridge') {
          const yaw = crossingYawAt(p.x, p.y, crossings) ?? landmark.yaw ?? 0;
          group.rotation.y += yaw;
        } else if (landmark.yaw) {
          group.rotation.y += landmark.yaw;
        }
        this.cityGroup.add(group);
      });
    };
    for (const entry of this.noticedEntries) {
      if (lookNoticedId && entry.id === lookNoticedId) pushNoticed(entry);
    }
    for (const entry of this.noticedEntries) {
      if (isUniqueNoticedId(entry.id) && entry.id !== lookNoticedId) pushNoticed(entry);
    }
    for (const landmark of LANDMARKS) {
      if (look && landmark.kind === look) pushLandmark(landmark);
    }
    jobs.push(() => {
      const mesh = buildWater(data);
      if (mesh) this.cityGroup.add(mesh);
    });
    jobs.push(() => {
      const mesh = buildParks(data);
      if (mesh) this.cityGroup.add(mesh);
    });
    jobs.push(() => {
      const trees = buildParkTrees(data);
      if (trees) {
        trees.visible = true;
        this.treeGroup = trees;
        this.cityGroup.add(trees);
      }
    });
    jobs.push(() => {
      const roadGroup = buildRoads(data);
      if (roadGroup) {
        this.cityGroup.add(roadGroup);
        for (const child of roadGroup.children) {
          if (child.userData.roadTier === 2) this.tier2RoadMesh = child;
          if (child.userData.roadMarks) this.markMesh = child;
        }
      }
    });
    for (const landmark of LANDMARKS) {
      if (!(look && landmark.kind === look)) pushLandmark(landmark);
    }
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
      const signs = buildFacadeSigns(this.scratch);
      if (signs) this.cityGroup.add(signs);
    });
    jobs.push(() => {
      const lamps = buildStreetLamps(data);
      if (lamps) {
        lamps.visible = false;
        this.lampGroup = lamps;
        this.cityGroup.add(lamps);
      }
    });
    for (const entry of this.noticedEntries) {
      if (isUniqueNoticedId(entry.id) || entry.id === lookNoticedId) continue;
      pushNoticed(entry);
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

  private placeBeam(pick: BuildingPick | null): void {
    this.selected = pick;
    if (!pick) {
      this.beamGroup.visible = false;
      return;
    }
    const r = Math.max(0.045, Math.sqrt(pick.areaM2) * METERS_TO_WORLD * 0.38);
    const h = Math.max(pick.heightWorld * 1.45 + 1.8, 3.6);
    this.beamGroup.position.set(pick.x, 0, pick.z);
    const shaft = this.beamGroup.getObjectByName('shaft') as THREE.Mesh | undefined;
    const core = this.beamGroup.getObjectByName('core') as THREE.Mesh | undefined;
    if (shaft) {
      shaft.scale.set(r, h, r);
      shaft.position.y = h / 2;
    }
    if (core) {
      core.scale.set(r, h * 1.06, r);
      core.position.y = (h * 1.06) / 2;
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

  private nearbyLabels(pick: BuildingPick): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const p of this.scratch.picks) {
      if (p === pick) continue;
      const d = Math.hypot(p.x - pick.x, p.z - pick.z);
      if (d > 0.48 || d < 0.015) continue;
      const label = USE_LABEL[p.style] ?? 'Building';
      if (seen.has(label)) continue;
      seen.add(label);
      out.push(label);
      if (out.length >= 3) break;
    }
    return out;
  }

  private drawBuildingCard(ctx: CanvasRenderingContext2D, pick: BuildingPick): void {
    const name = pick.label || USE_LABEL[pick.style] || STYLE_LABEL[pick.style] || 'Building';
    const area = `${Math.round(pick.areaM2).toLocaleString('en-GB')} m²`;
    const nearby = this.nearbyLabels(pick);
    const lines = [
      name,
      pick.address,
      `${Math.round(pick.heightM)} m · ${area} · ${DISTRICT_LABEL[pick.district]}`,
      'OpenStreetMap',
    ];
    ctx.save();
    ctx.font = '700 13px ui-sans-serif, system-ui';
    const w0 = Math.max(
      ctx.measureText(lines[0]!).width,
      ctx.measureText(lines[1]!).width,
      ctx.measureText(lines[2]!).width,
      ctx.measureText(lines[3]!).width,
    );
    const pillW = nearby.reduce((w, s) => w + ctx.measureText(s).width + 18, 0);
    const bw = Math.max(w0, pillW) + 24;
    const bh = 88 + (nearby.length ? 22 : 0);
    const bx = 14;
    const by = this.cssH - bh - 48;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.58)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1e293b';
    ctx.textAlign = 'left';
    ctx.fillText(lines[0]!, bx + 12, by + 18);
    ctx.font = '500 11px ui-sans-serif, system-ui';
    ctx.fillStyle = '#334155';
    ctx.fillText(lines[1]!, bx + 12, by + 36);
    ctx.fillText(lines[2]!, bx + 12, by + 52);
    ctx.fillStyle = '#64748b';
    ctx.fillText(lines[3]!, bx + 12, by + 68);
    if (nearby.length) {
      let px = bx + 12;
      const py = by + 78;
      ctx.font = '600 10px ui-sans-serif, system-ui';
      for (const pill of nearby) {
        const pw = ctx.measureText(pill).width + 14;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.12)';
        ctx.beginPath();
        ctx.roundRect(px, py, pw, 16, 8);
        ctx.fill();
        ctx.fillStyle = '#334155';
        ctx.fillText(pill, px + 7, py + 12);
        px += pw + 6;
      }
    }
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
    this.rig.update(this.cam, this.heroAzimuth);
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
    if (!this.laidOut) {
      this.laidOut = true;
      this.fitAll();
      return;
    }
    if (this.cam.zoom < this.minZoom) this.cam.zoom = fit * 1.02;
    this.syncRig();
  }

  fitAll(): void {
    const look = heroLook();
    this.heroAzimuth = look.azimuth;
    const view = viewParam();
    if (view === 'wide') {
      this.fitOverview();
      return;
    }
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

  /** Scale the orthographic frustum around the cursor. Pitch stays locked. */
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

  lookAt(x: number, y: number, viewH?: number): void {
    this.cam.x = x;
    this.cam.y = y;
    if (viewH && viewH > 0 && this.cssH > 0) {
      this.cam.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.cssH / viewH));
    }
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
    if (window.location.search !== this.lastSearch) {
      this.lastSearch = window.location.search;
      this.fitAll();
    }
    this.syncRig();

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
    const marksVisible = this.cam.zoom >= 14;
    if (marksVisible !== this.lastMarksVisible) {
      if (this.markMesh) this.markMesh.visible = marksVisible;
      this.lastMarksVisible = marksVisible;
    }
    const lampsVisible = this.cam.zoom >= 28;
    if (lampsVisible !== this.lastLampsVisible) {
      if (this.lampGroup) this.lampGroup.visible = lampsVisible;
      this.lastLampsVisible = lampsVisible;
    }
    const grovesVisible = this.cam.zoom < 18;
    if (grovesVisible !== this.lastGrovesVisible) {
      if (this.treeGroup) {
        this.treeGroup.traverse((obj) => {
          if (obj.userData.grove) obj.visible = grovesVisible;
        });
      }
      this.lastGrovesVisible = grovesVisible;
    }
    const windowsVisible = this.cam.zoom >= 7;
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
      const pulse = 0.38 + 0.14 * Math.sin(t * 0.004);
      const shaft = this.beamGroup.getObjectByName('shaft') as THREE.Mesh | undefined;
      const core = this.beamGroup.getObjectByName('core') as THREE.Mesh | undefined;
      if (shaft && shaft.material instanceof THREE.MeshBasicMaterial)
        shaft.material.opacity = pulse;
      if (core && core.material instanceof THREE.MeshBasicMaterial)
        core.material.opacity = 0.45 + 0.2 * Math.sin(t * 0.006);
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
