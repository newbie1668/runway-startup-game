/**
 * RUNWAY — 3D city renderer.
 *
 * Implements IMapRenderer on top of a three.js WebGL scene: the city itself
 * (ground, water, parks, roads, tube ribbons, buildings, hub glows, fog) is
 * pure WebGL with no text/pins/particles; all game-facing chrome is drawn by
 * the shared, camera-agnostic MapOverlay onto the 2D overlay canvas via
 * `rig.worldToScreen` as the projector. Streams the city in over multiple
 * frames once `public/map/london-city.bin` has loaded and decoded.
 */

import * as THREE from 'three';
import { LANDMARKS, WORLD, project } from '../geo';
import { HUB_POS, MapOverlay } from '../overlay';
import type { CameraState, HitTarget, IMapRenderer, Scene } from '../scene';
import type { HubId } from '../types';
import { CameraRig, FIT_PITCH_SIN } from './cameraRig';
import {
  buildChunkTier,
  buildGround,
  buildHubGlows,
  buildParks,
  buildRoads,
  buildTubeLines,
  buildWater,
  CHUNK_COUNT,
  createBuildingMaterial,
  HUB_GLOW_PLAYER_COLOR,
} from './cityBuilder';
import { decodeCity, type CityData } from './format';
import { build as buildLandmark, EYE_WHEEL_NAME } from './landmarks';
import { createGlowSpriteTexture, createWindowsTexture } from './textures';

const CITY_BIN_URL = '/map/london-city.bin';
const BUILD_JOBS_PER_FRAME = 2;
const HUB_GLOW_DEFAULT_COLOR = 0x7dd3fc;

type BuildJob = () => void;

export class CityRenderer3D implements IMapRenderer {
  private readonly cityCanvas: HTMLCanvasElement;
  private readonly overlayCanvas: HTMLCanvasElement;
  private readonly overlayCtx: CanvasRenderingContext2D;
  private readonly onFatal: () => void;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene3d = new THREE.Scene();
  private readonly fog: THREE.Fog;
  private readonly rig = new CameraRig();
  private readonly overlay: MapOverlay;
  private readonly isCoarsePointer: boolean;

  private cam: CameraState = { x: WORLD.width / 2, y: WORLD.height / 2, zoom: 4 };
  private minZoom = 2;
  private maxZoom = 26;
  private cssW = 0;
  private cssH = 0;

  private readonly cityGroup = new THREE.Group();
  private readonly buildingMaterial: THREE.MeshLambertMaterial;
  private readonly glowTexture: THREE.Texture;
  private buildQueue: BuildJob[] = [];
  private hubGlowSprites: Map<HubId, THREE.Sprite> = new Map();
  private lastPlayerHubId: HubId | null = null;
  eyeWheel: THREE.Object3D | null = null;
  /** LOD: minor buildings hide below a zoom threshold (coarser on touch); tier-2 roads hide below 4.5. */
  private readonly minorMeshes: THREE.Mesh[] = [];
  private tier2RoadMesh: THREE.Mesh | null = null;
  private lastMinorVisible: boolean | null = null;
  private lastTier2Visible: boolean | null = null;

  private disposed = false;
  private contextLostTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    cityCanvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
    opts: { onFatal: () => void },
  ) {
    this.cityCanvas = cityCanvas;
    this.overlayCanvas = overlayCanvas;
    this.overlayCtx = overlayCanvas.getContext('2d')!;
    this.onFatal = opts.onFatal;
    this.isCoarsePointer = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

    this.overlay = new MapOverlay(
      (p) => this.rig.worldToScreen(p),
      () => ({ w: this.cssW, h: this.cssH }),
    );

    this.renderer = new THREE.WebGLRenderer({
      canvas: cityCanvas,
      alpha: true,
      antialias: !this.isCoarsePointer,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.isCoarsePointer ? 1.5 : 2));

    this.fog = new THREE.Fog(0x0d142b, 200, 900);
    this.scene3d.fog = this.fog;

    const hemi = new THREE.HemisphereLight(0x16204a, 0x05070f, 0.9);
    const dir = new THREE.DirectionalLight(0x8fa8ff, 0.35);
    dir.position.set(-1, 1.5, -1); // NW, high
    this.scene3d.add(hemi, dir);

    this.scene3d.add(buildGround());
    this.scene3d.add(buildTubeLines());

    this.glowTexture = createGlowSpriteTexture();
    const { group: hubGlowGroup, sprites } = buildHubGlows(this.glowTexture);
    this.hubGlowSprites = sprites;
    this.scene3d.add(hubGlowGroup);

    this.scene3d.add(this.cityGroup);

    const windowsTexture = createWindowsTexture();
    this.buildingMaterial = createBuildingMaterial(windowsTexture);

    this.cityCanvas.addEventListener('webglcontextlost', this.handleContextLost);

    fetch(CITY_BIN_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => this.onCityData(decodeCity(buf)))
      .catch(() => this.onFatal());

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
    const landmarkAnchors = LANDMARKS.map((l) => project(l.at));
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
      const roadGroup = buildRoads(data);
      if (roadGroup) {
        this.cityGroup.add(roadGroup);
        for (const child of roadGroup.children) {
          if (child instanceof THREE.Mesh && child.userData.roadTier === 2) this.tier2RoadMesh = child;
        }
      }
    });
    jobs.push(() => {
      const mesh = buildParks(data);
      if (mesh) this.cityGroup.add(mesh);
    });
    jobs.push(() => {
      const mesh = buildWater(data);
      if (mesh) this.cityGroup.add(mesh);
    });
    for (let i = 0; i < LANDMARKS.length; i++) {
      jobs.push(() => {
        const landmark = LANDMARKS[i];
        const anchor = landmarkAnchors[i];
        const group = buildLandmark(landmark.kind);
        group.position.set(anchor.x, 0, anchor.y);
        this.cityGroup.add(group);
        if (landmark.kind === 'eye') {
          this.eyeWheel = group.getObjectByName(EYE_WHEEL_NAME) ?? null;
        }
      });
    }
    this.buildQueue = jobs;
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
    this.rig.update(this.cam, this.minZoom);
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
    this.cam = { x: WORLD.width / 2, y: WORLD.height / 2, zoom: this.computeFit() };
    this.syncRig();
  }

  focusHub(hubId: HubId, zoom = 9): void {
    const p = HUB_POS[hubId];
    this.cam.x = p.x;
    this.cam.y = p.y;
    this.cam.zoom = Math.max(this.cam.zoom, zoom);
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
    if (this.disposed || this.cssW === 0 || this.cssH === 0) return;
    this.syncRig();

    for (let i = 0; i < BUILD_JOBS_PER_FRAME && this.buildQueue.length > 0; i++) {
      this.buildQueue.shift()!();
    }

    const dist = this.rig.getDistance();
    this.fog.near = dist * 0.8;
    this.fog.far = dist * 3.5;
    this.buildingMaterial.emissiveIntensity = Math.min(1.1, Math.max(0.55, 0.55 + this.cam.zoom * 0.02));

    if (this.eyeWheel) this.eyeWheel.rotation.y = t * ((Math.PI * 2) / 60000);

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
    this.buildingMaterial.emissiveMap?.dispose();
    this.buildingMaterial.dispose();
    this.glowTexture.dispose();
    this.renderer.dispose();
  }
}
