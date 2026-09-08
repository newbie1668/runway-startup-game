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
  PARKS,
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
  CHUNK_COLS,
  CHUNK_COUNT,
  CHUNK_ROWS,
  chunkTierMeshes,
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
import {
  aabbHitsKeep,
  buildJobsThisFrame,
  CITYSTREET_AT,
  inKeepDisk,
  meshBudget,
  type BuildJobKind,
  type KeepDisk,
} from './lookClip';
import { instantiateNoticed, loadNoticedPrefabs, type NoticedEntry } from './noticedPrefabs';
import { isUniqueNoticedId } from './uniqueNoticed';
import { DISTRICT_LABEL, SKY, STYLE_LABEL, USE_LABEL } from './palette';
import { createGlowSpriteTexture } from './textures';
import { createGeometryTracker } from './diagnostics';
import { createMapDiagnostics, type MapDiagnosticsReporter } from '../mapDiagnostics';
import { createResourcePool } from './sceneResources';
import { retainSceneResources } from './sceneResourceTree';
import {
  excludedBuildingIndices,
  mapReplacementAnchors,
  selectActiveReplacementIds,
} from './stockReplacements';

const CITY_BIN_URL = '/map/london-city.bin';
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
  citystreet: { at: CITYSTREET_AT, viewH: HERO_VIEW_HEIGHT, azimuth: 0.22 },
};

/** Warm afternoon sun from the south-west. Lights faces, does not cast a shadow map. */
const SUN_DIR = new THREE.Vector3(-0.84, 0.5, 0.78).normalize();

function heroLook(): { at: readonly [number, number]; viewH: number; azimuth: number } {
  const look = new URLSearchParams(window.location.search).get('look');
  if (look && NOTICED_LOOK[look]) return NOTICED_LOOK[look]!;
  const crossing = THAMES_CROSSINGS.find((c) => thamesCrossingLookKey(c.name) === look);
  if (crossing) return { at: crossing.at, viewH: 1.35, azimuth: 0 };
  const hit = LANDMARKS.find((l) => l.kind === look);
  if (!hit) {
    const park = PARKS.find((p) => {
      const key = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
      return look !== null && (key === look || key.startsWith(look));
    });
    if (park) {
      const at = park.label ?? park.points[0]!;
      return { at, viewH: 6.5, azimuth: 0 };
    }
    return { at: HERO_AT, viewH: HERO_VIEW_HEIGHT, azimuth: 0 };
  }
  if (isDeckLandmark(hit.kind) && hit.kind !== 'oldstreet') {
    if (hit.kind === 'towerbridge') {
      return { at: hit.at, viewH: 2.05, azimuth: Math.PI / 4 };
    }
    const azimuth = hit.kind === 'hungerford' ? -Math.PI / 2 : 0;
    return { at: hit.at, viewH: 1.35, azimuth };
  }
  if (hit.kind === 'eye') {
    return { at: hit.at, viewH: 2.55, azimuth: -Math.PI / 2 };
  }
  if (hit.kind === 'buckingham') {
    // From the Mall: Victoria Memorial in front of the 21-bay east front.
    // Slightly north of due east keeps Green Park in frame.
    return { at: hit.at, viewH: 3.55, azimuth: Math.PI / 2 + 0.22 };
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
    return { at: hit.at, viewH: 1.4, azimuth: 0.48 };
  }
  if (hit.kind === 'lcy') {
    return { at: hit.at, viewH: 10.2, azimuth: 0.18 };
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

type BuildJob = { id: string; kind: BuildJobKind; essential: boolean; run: () => void };

function hasVisibleGeometry(root: THREE.Object3D): boolean {
  let visible = false;
  root.traverse((object) => {
    if (visible || !(object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh)) return;
    const position = object.geometry.getAttribute('position');
    const index = object.geometry.getIndex();
    if (position && position.count > 0 && (!index || index.count > 0)) visible = true;
  });
  return visible;
}

export class CityRenderer3D implements IMapRenderer {
  private readonly cityCanvas: HTMLCanvasElement;
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly overlayCtx: CanvasRenderingContext2D;
  private readonly onFatal: (reason?: string) => void;
  private readonly onReady: () => void;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly diagnostics: MapDiagnosticsReporter;
  private readonly ownsDiagnostics: boolean;
  private readonly geometryTracker = createGeometryTracker();
  private readonly resources = createResourcePool();
  private readonly loadController = new AbortController();
  private generation = 0;
  private groundRelease: (() => void) | null = null;
  private stockBuildings = 0;
  private stockDrawnThisFrame = false;
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
  private groundMesh: THREE.Mesh;
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
  private debugContextLoss: (() => void) | null = null;

  constructor(
    cityCanvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
    opts: {
      onFatal: (reason?: string) => void;
      onReady?: () => void;
      diagnostics?: MapDiagnosticsReporter;
    },
  ) {
    this.cityCanvas = cityCanvas;
    this.overlayCanvas = overlayCanvas;
    this.overlayCtx = overlayCanvas.getContext('2d')!;
    this.onFatal = opts.onFatal;
    this.ownsDiagnostics = opts.diagnostics === undefined;
    this.diagnostics = opts.diagnostics ?? createMapDiagnostics(0, () => performance.now());
    this.onReady = opts.onReady ?? (() => undefined);
    this.isCoarsePointer =
      typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

    this.overlay = new MapOverlay(
      (p) => this.rig.worldToScreen(p),
      () => ({ w: this.cssW, h: this.cssH }),
    );

    const budget = meshBudget();
    this.renderer = new THREE.WebGLRenderer({
      canvas: cityCanvas,
      alpha: false,
      antialias: !this.isCoarsePointer && !budget.skipAntialias,
      powerPreference: 'high-performance',
    });
    try {
      this.diagnostics.selectMode('3d');
      this.renderer.setPixelRatio(
        Math.min(
          window.devicePixelRatio || 1,
          budget.pixelRatioCap,
          this.isCoarsePointer ? Math.min(1.5, budget.pixelRatioCap) : budget.pixelRatioCap,
        ),
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

      this.groundMesh = buildGround();
      this.scene3d.add(this.groundMesh);
      this.groundRelease = retainSceneResources(this.resources, this.groundMesh);
      const tubeLines = buildTubeLines();
      this.scene3d.add(tubeLines);
      retainSceneResources(this.resources, tubeLines);

      this.glowTexture = createGlowSpriteTexture();
      const { group: hubGlowGroup, sprites } = buildHubGlows(this.glowTexture);
      this.hubGlowSprites = sprites;
      this.scene3d.add(hubGlowGroup);
      retainSceneResources(this.resources, hubGlowGroup);

      this.scene3d.add(this.cityGroup);
      this.buildingMaterial = createBuildingMaterial();
      this.resources.retain(this.buildingMaterial);
      this.resources.retain(this.glowTexture);

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
      retainSceneResources(this.resources, this.beamGroup);
      this.geometryTracker.trackTree(this.scene3d);

      this.cityCanvas.addEventListener('webglcontextlost', this.handleContextLost);

      const generation = this.generation;
      const isCurrent = () => this.isCurrent(generation);
      const onAssetError = (id: string, error: unknown) => {
        if (isCurrent()) this.diagnostics.recordError(id, false, error);
      };
      const trackLoad = <T>(id: string, essential: boolean, load: () => Promise<T>): Promise<T> => {
        this.diagnostics.registerJob(id, essential);
        this.diagnostics.startJob(id);
        return load().then(
          (value) => {
            if (isCurrent()) this.diagnostics.completeJob(id);
            return value;
          },
          (error) => {
            if (isCurrent()) this.diagnostics.failJob(id, error);
            throw error;
          },
        );
      };
      const cityPromise = trackLoad('load:city', true, () =>
        fetch(CITY_BIN_URL, { signal: this.loadController.signal })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.arrayBuffer();
          })
          .then((buf) => {
            if (!isCurrent()) throw new DOMException('Obsolete city load', 'AbortError');
            return decodeCity(buf);
          }),
      );
      const prefabOptions = {
        resources: this.resources,
        signal: this.loadController.signal,
        isCurrent,
        onError: onAssetError,
      };
      const landmarksPromise = trackLoad('load:landmarks', false, () =>
        loadLandmarkPrefabs(prefabOptions),
      );
      const noticedPromise = trackLoad('load:noticed', false, () =>
        loadNoticedPrefabs(prefabOptions),
      );

      void Promise.all([cityPromise, landmarksPromise, noticedPromise])
        .then(([data, prefabs, noticed]) => {
          if (!isCurrent()) return;
          this.diagnostics.registerJob('plan:city', true);
          this.diagnostics.startJob('plan:city');
          this.landmarkPrefabs = prefabs;
          this.noticedEntries = noticed.entries;
          this.noticedPrefabs = noticed.prefabs;
          try {
            for (const prefab of prefabs.values()) this.geometryTracker.trackTree(prefab);
            for (const prefab of noticed.prefabs.values()) this.geometryTracker.trackTree(prefab);
            this.onCityData(data);
            this.diagnostics.completeJob('plan:city');
          } catch (error) {
            this.diagnostics.failJob('plan:city', error);
            if (isCurrent()) this.onFatal('City layout failed');
          }
        })
        .catch(() => {
          if (isCurrent()) this.onFatal('City data failed');
        });

      if (new URLSearchParams(window.location.search).get('map') === 'debug') {
        this.debugContextLoss = () => {
          this.renderer.getContext().getExtension('WEBGL_lose_context')?.loseContext();
        };
        (window as unknown as { __runwayForceContextLoss?: () => void }).__runwayForceContextLoss =
          this.debugContextLoss;
      }
    } catch (error) {
      this.rollbackConstruction();
      throw error;
    }
  }

  /** Release resources acquired after WebGL allocation when construction cannot reach the factory. */
  private rollbackConstruction(): void {
    this.disposed = true;
    this.generation += 1;
    this.loadController.abort();
    const cleanup: Array<() => void> = [
      () => {
        if (this.contextLostTimer) clearTimeout(this.contextLostTimer);
        this.contextLostTimer = null;
      },
      () => this.cityCanvas.removeEventListener('webglcontextlost', this.handleContextLost),
      () => {
        const target = window as unknown as { __runwayForceContextLoss?: () => void };
        if (this.debugContextLoss && target.__runwayForceContextLoss === this.debugContextLoss)
          delete target.__runwayForceContextLoss;
      },
      () => this.scene3d.clear(),
      () => this.resources.dispose(),
      () => this.renderer.dispose(),
      () => this.geometryTracker.clear(),
      () => {
        if (this.ownsDiagnostics) this.diagnostics.dispose();
      },
    ];
    for (const action of cleanup) {
      try {
        action();
      } catch {
        /* preserve the construction error for factory fallback */
      }
    }
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && !this.loadController.signal.aborted && this.generation === generation;
  }

  private handleContextLost = (e: Event): void => {
    e.preventDefault();
    if (this.disposed) return;
    this.diagnostics.recordError('contextlost', true, new Error('WebGL context lost'));
    if (this.contextLostTimer) clearTimeout(this.contextLostTimer);
    this.contextLostTimer = setTimeout(() => {
      if (this.disposed) return;
      try {
        sessionStorage.setItem('runway-force-2d', '1');
      } catch {
        // Storage unavailable (private mode etc.) — the in-memory fallback still fires.
      }
      this.onFatal('WebGL context lost');
    }, 2000);
  };

  private onCityData(data: CityData): void {
    if (this.disposed) return;
    this.scratch = createScratch();
    const replacementMapping = mapReplacementAnchors(data, [
      ...LANDMARKS.map((l, sourceIndex) => {
        const p = project(l.at);
        return { id: `landmark:${sourceIndex}:${l.kind}`, x: p.x, z: p.y };
      }),
      ...this.noticedEntries.map((e) => ({
        id: `noticed:${e.id}`,
        x: e.x,
        z: e.z,
      })),
    ]);
    const enabledReplacementIds = new Set<string>();
    const availableReplacementIds = new Set<string>();
    let stockExclusions: ReadonlySet<number> | null = null;
    const finalizeStockExclusions = (): ReadonlySet<number> => {
      if (stockExclusions) return stockExclusions;
      const activeIds = selectActiveReplacementIds(
        [...enabledReplacementIds].map((id) => ({
          id,
          enabled: true,
          available: availableReplacementIds.has(id),
        })),
      );
      stockExclusions = excludedBuildingIndices(activeIds, replacementMapping);
      return stockExclusions;
    };
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
    const lookLandmarkKinds = new Set<string>(
      look === 'citystreet'
        ? ['gherkin', 'grater', 'walkie', 'tower42']
        : look === 'canadastreet'
          ? ['canadasq']
          : look === 'eye'
            ? ['eye', 'hungerford', 'westminsterbr', 'nationaltheatre', 'bigben']
            : look
              ? [look]
              : [],
    );
    const budget = meshBudget();
    const lookAt = heroLook();
    const lookPt = project(lookAt.at);
    const view = viewParam();
    const keep: KeepDisk | null =
      budget.chunkKeepM != null
        ? {
            x: view === 'wide' ? WORLD.width / 2 : lookPt.x,
            z: view === 'wide' ? WORLD.height / 2 : lookPt.y,
            r: budget.chunkKeepM * METERS_TO_WORLD,
          }
        : null;
    if (keep) {
      const oldGround = this.groundMesh;
      const oldRelease = this.groundRelease;
      const nextGround = buildGround(keep);
      const nextRelease = retainSceneResources(this.resources, nextGround);
      this.scene3d.remove(oldGround);
      this.groundMesh = nextGround;
      this.groundRelease = nextRelease;
      this.scene3d.add(this.groundMesh);
      oldRelease?.();
      this.geometryTracker.trackTree(this.groundMesh);
    }
    const inKeep = (x: number, z: number) => inKeepDisk(x, z, keep);
    const heroJobs: BuildJob[] = [];
    const coverJobs: BuildJob[] = [];
    const replacementJobs: BuildJob[] = [];
    const chunkJobs: BuildJob[] = [];
    const restJobs: BuildJob[] = [];
    const crossings = riverCrossingSpans(data);
    const enqueue = (
      into: BuildJob[],
      id: string,
      kind: BuildJobKind,
      essential: boolean,
      run: () => void,
    ): void => {
      this.diagnostics.registerJob(id, essential);
      into.push({ id, kind, essential, run });
    };
    const pushNoticed = (
      entry: NoticedEntry,
      into: BuildJob[],
      kind: BuildJobKind,
      sourceIndex: number,
    ): void => {
      enqueue(into, `noticed:${kind}:${entry.id}:${sourceIndex}`, kind, false, () => {
        const replacementId = `noticed:${entry.id}`;
        enabledReplacementIds.add(replacementId);
        const prefab = this.noticedPrefabs.get(entry.id) ?? null;
        if (!prefab && !isUniqueNoticedId(entry.id)) return;
        const group = instantiateNoticed(entry, prefab);
        group.position.set(entry.x, 0, entry.z);
        this.cityGroup.add(group);
        if (hasVisibleGeometry(group)) availableReplacementIds.add(replacementId);
      });
    };
    const pushLandmark = (
      landmark: (typeof LANDMARKS)[number],
      into: BuildJob[],
      kind: BuildJobKind,
      sourceIndex: number,
    ): void => {
      enqueue(into, `landmark:${kind}:${landmark.kind}:${sourceIndex}`, kind, false, () => {
        const replacementId = `landmark:${sourceIndex}:${landmark.kind}`;
        enabledReplacementIds.add(replacementId);
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
        if (hasVisibleGeometry(group)) availableReplacementIds.add(replacementId);
      });
    };
    const allowLandmark = (landmark: (typeof LANDMARKS)[number]): boolean => {
      if (lookLandmarkKinds.has(landmark.kind)) return true;
      if (look === 'eye') return false;
      const p = project(landmark.at);
      return inKeep(p.x, p.y);
    };
    for (let sourceIndex = 0; sourceIndex < this.noticedEntries.length; sourceIndex++) {
      const entry = this.noticedEntries[sourceIndex]!;
      if (lookNoticedId && entry.id === lookNoticedId)
        pushNoticed(entry, heroJobs, 'hero', sourceIndex);
    }
    for (let sourceIndex = 0; sourceIndex < LANDMARKS.length; sourceIndex++) {
      const landmark = LANDMARKS[sourceIndex]!;
      if (lookLandmarkKinds.has(landmark.kind))
        pushLandmark(landmark, heroJobs, 'hero', sourceIndex);
    }
    enqueue(coverJobs, 'cover:water', 'cover', true, () => {
      const mesh = buildWater(data, keep);
      if (mesh) this.cityGroup.add(mesh);
    });
    enqueue(coverJobs, 'cover:parks', 'cover', true, () => {
      const mesh = buildParks(data, keep);
      if (mesh) this.cityGroup.add(mesh);
    });
    if (!budget.skipTrees) {
      enqueue(coverJobs, 'cover:trees', 'cover', false, () => {
        const trees = buildParkTrees(data, keep);
        if (trees) {
          trees.visible = true;
          this.cityGroup.add(trees);
        }
      });
    }
    enqueue(coverJobs, 'cover:roads', 'cover', true, () => {
      const roadGroup = buildRoads(data, keep, !budget.skipRoadMarks);
      if (roadGroup) {
        this.cityGroup.add(roadGroup);
        for (const child of roadGroup.children) {
          if (child.userData.roadTier === 2) this.tier2RoadMesh = child;
          if (child.userData.roadMarks) this.markMesh = child;
        }
      }
    });
    for (let sourceIndex = 0; sourceIndex < LANDMARKS.length; sourceIndex++) {
      const landmark = LANDMARKS[sourceIndex]!;
      if (lookLandmarkKinds.has(landmark.kind)) continue;
      if (allowLandmark(landmark)) pushLandmark(landmark, replacementJobs, 'rest', sourceIndex);
    }
    if (!budget.skipNoticedStock) {
      for (let sourceIndex = 0; sourceIndex < this.noticedEntries.length; sourceIndex++) {
        const entry = this.noticedEntries[sourceIndex]!;
        if (isUniqueNoticedId(entry.id) && entry.id !== lookNoticedId) {
          pushNoticed(entry, replacementJobs, 'rest', sourceIndex);
        }
      }
      for (let sourceIndex = 0; sourceIndex < this.noticedEntries.length; sourceIndex++) {
        const entry = this.noticedEntries[sourceIndex]!;
        if (isUniqueNoticedId(entry.id) || entry.id === lookNoticedId) continue;
        if (!inKeep(entry.x, entry.z)) continue;
        pushNoticed(entry, replacementJobs, 'rest', sourceIndex);
      }
    }
    const chunkWork: { chunkId: number; major: boolean; dist: number }[] = [];
    for (let chunkId = 0; chunkId < CHUNK_COUNT; chunkId++) {
      const col = chunkId % CHUNK_COLS;
      const row = Math.floor(chunkId / CHUNK_COLS);
      const x0 = (col / CHUNK_COLS) * WORLD.width;
      const x1 = ((col + 1) / CHUNK_COLS) * WORLD.width;
      const z0 = (row / CHUNK_ROWS) * WORLD.height;
      const z1 = ((row + 1) / CHUNK_ROWS) * WORLD.height;
      if (!aabbHitsKeep(x0, z0, x1, z1, keep)) continue;
      const dx = (x0 + x1) / 2 - lookPt.x;
      const dz = (z0 + z1) / 2 - lookPt.y;
      const dist = dx * dx + dz * dz;
      for (const major of [true, false]) {
        if (budget.skipMinorChunks && !major) continue;
        chunkWork.push({ chunkId, major, dist });
      }
    }
    chunkWork.sort((a, b) => a.dist - b.dist || Number(b.major) - Number(a.major));
    for (const job of chunkWork) {
      enqueue(
        chunkJobs,
        `chunk:${job.chunkId}:${job.major ? 'major' : 'minor'}`,
        'chunk',
        true,
        () => {
          const picksBefore = this.scratch.picks.length;
          const built = buildChunkTier(
            data,
            job.chunkId,
            job.major,
            finalizeStockExclusions(),
            this.scratch,
            keep,
          );
          if (built) {
            const replacedMaterials = new Set<THREE.Material>();
            for (const mesh of chunkTierMeshes(built)) {
              const previousMaterial = mesh.material;
              mesh.material = this.buildingMaterial;
              for (const material of Array.isArray(previousMaterial)
                ? previousMaterial
                : [previousMaterial]) {
                replacedMaterials.add(material);
              }
              this.buildingMeshes.push(mesh);
              if (!job.major) this.minorMeshes.push(mesh);
              const previous = mesh.onAfterRender;
              mesh.onAfterRender = (...args) => {
                previous?.call(mesh, ...args);
                this.stockDrawnThisFrame = true;
              };
            }
            for (const material of replacedMaterials) {
              const release = this.resources.retain(material);
              release();
            }
            this.cityGroup.add(built);
            this.stockBuildings += Math.max(0, this.scratch.picks.length - picksBefore);
          }
        },
      );
    }
    if (!budget.skipWindows) {
      enqueue(restJobs, 'decor:windows-roofs-signs', 'rest', false, () => {
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
    }
    if (!budget.skipLamps) {
      enqueue(restJobs, 'decor:lamps', 'rest', false, () => {
        const lamps = buildStreetLamps(data);
        if (lamps) {
          lamps.visible = false;
          this.lampGroup = lamps;
          this.cityGroup.add(lamps);
        }
      });
    }
    // Wide cameras must paint nearby chunks before the cover jobs, or chrome=0
    // sits on brown ground until water/parks/roads finish (and used to OOM first).
    this.buildQueue = keep
      ? [...heroJobs, ...replacementJobs, ...chunkJobs, ...coverJobs, ...restJobs]
      : [...heroJobs, ...coverJobs, ...replacementJobs, ...chunkJobs, ...restJobs];
    this.cityStreamed = true;
  }

  private drainBuildQueue(): void {
    const keepLoad = meshBudget().chunkKeepM != null;
    const head = this.buildQueue[0];
    if (!head) return;
    const view = viewParam();
    const n = buildJobsThisFrame({
      ready: this.readyNotified,
      keepDisk: keepLoad,
      kind: head.kind,
      wideFrust: view === 'mid' || view === 'default',
    });
    let i = 0;
    while (i < n && this.buildQueue.length > 0 && this.buildQueue[0]!.kind === head.kind) {
      const job = this.buildQueue.shift()!;
      if (this.disposed) return;
      this.diagnostics.startJob(job.id);
      const childCount = this.cityGroup.children.length;
      let fatalReason: string | undefined;
      try {
        job.run();
        this.diagnostics.completeJob(job.id);
      } catch (error) {
        this.diagnostics.failJob(job.id, error);
        if (job.essential) {
          fatalReason = job.id;
        }
      } finally {
        for (const child of this.cityGroup.children.slice(childCount)) {
          retainSceneResources(this.resources, child);
          this.geometryTracker.trackTree(child);
        }
      }
      if (fatalReason) {
        this.onFatal(fatalReason);
        return;
      }
      i += 1;
    }
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
    const startedAt = performance.now();
    this.drainBuildQueue();
    if (this.disposed) return;
    if (this.cityStreamed && this.buildQueue.length === 0 && this.stockBuildings === 0) {
      const error = new Error('No ordinary stock buildings emitted');
      this.diagnostics.recordError('coverage:stock', true, error);
      this.onFatal('coverage:stock');
      return;
    }
    if (this.cssW === 0 || this.cssH === 0) return;
    if (window.location.search !== this.lastSearch) {
      this.lastSearch = window.location.search;
      this.fitAll();
    }
    this.syncRig();

    const minorVisible = true;
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
    const windowsVisible = true;
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

    this.stockDrawnThisFrame = false;
    this.renderer.render(this.scene3d, this.rig.camera);

    this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    this.overlay.drawAreaLabels(this.overlayCtx, this.cam.zoom);
    this.overlay.draw(this.overlayCtx, t, dt, this.cam.zoom);
    if (this.selected) this.drawBuildingCard(this.overlayCtx, this.selected);
    this.diagnostics.setCamera(this.cam);
    this.diagnostics.recordFrame({
      mode: '3d',
      durationMs: performance.now() - startedAt,
      stockDrawn: this.stockDrawnThisFrame,
      stockBuildings: this.stockBuildings,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometryBytes: this.geometryTracker.bytes(),
      textures: this.renderer.info.memory.textures,
    });
    const state = this.diagnostics.getState();
    if (state === 'ready' || state === 'degraded') this.markReady();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.loadController.abort();
    const cleanup: Array<() => void> = [
      () => {
        if (this.contextLostTimer) clearTimeout(this.contextLostTimer);
        this.contextLostTimer = null;
      },
      () => this.cityCanvas.removeEventListener('webglcontextlost', this.handleContextLost),
      () => {
        const target = window as unknown as { __runwayForceContextLoss?: () => void };
        if (this.debugContextLoss && target.__runwayForceContextLoss === this.debugContextLoss)
          delete target.__runwayForceContextLoss;
      },
      () => {
        this.buildQueue = [];
        this.scratch = createScratch();
        this.buildingMeshes.length = 0;
        this.minorMeshes.length = 0;
      },
      () => {
        this.landmarkPrefabs.clear();
        this.noticedPrefabs.clear();
        this.noticedEntries = [];
        this.hubGlowSprites.clear();
        this.selected = null;
        this.lastPlayerHubId = null;
        this.tier2RoadMesh = this.markMesh = this.lampGroup = null;
        this.windowMesh = null;
      },
      () => {
        this.scene3d.clear();
      },
      () => this.resources.dispose(),
      () => this.renderer.dispose(),
      () => this.geometryTracker.clear(),
      () => {
        if (this.ownsDiagnostics) this.diagnostics.dispose();
      },
    ];
    for (const action of cleanup) {
      try {
        action();
      } catch {
        /* teardown continues; disposed diagnostics cannot safely report */
      }
    }
  }
}
