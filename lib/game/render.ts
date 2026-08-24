/**
 * RUNWAY map renderer — Three.js London diorama.
 *
 * Look: yU+co Silicon Valley titles (daylight miniature city).
 * Interaction: Atlas-style orbit, fly-to, and pickable pins.
 * Contract: React still feeds a Scene; clicks still return HitTarget.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HUBS } from './content';
import { LAND_Y, buildLondonBoard, hubPosition, type LondonBoard } from './board';
import { stageBandFromName } from './stageBand';
import type { HubId, SectorId } from './types';

export const SECTOR_COLORS: Record<SectorId, string> = {
  ai: '#a78bfa',
  fintech: '#34d399',
  climate: '#a3e635',
  healthtech: '#fb7185',
  devtools: '#fbbf24',
  consumer: '#f472b6',
};

const PLAYER_COLOR = '#f8c33a';
const EVENT_COLOR = '#7dd3fc';

export interface SceneRival {
  id: string;
  name: string;
  hubId: HubId;
  sectorId: SectorId;
  stageName: string;
  alive: boolean;
}

export interface SceneEvent {
  id: string;
  name: string;
  hubId: HubId;
  attended: boolean;
}

export interface Scene {
  mode: 'setup' | 'play';
  playerHubId: HubId | null;
  playerSectorId: SectorId | null;
  companyName: string;
  stageName: string;
  rivals: SceneRival[];
  events: SceneEvent[];
}

export type HitTarget =
  | { type: 'hub'; hubId: HubId }
  | { type: 'event'; eventId: string }
  | { type: 'rival'; rivalId: string };

interface Particle {
  mesh: THREE.Object3D;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  ttl: number;
  kind: 'confetti' | 'float' | 'smoke' | 'spark';
}

interface Flight {
  fromPos: THREE.Vector3;
  midPos: THREE.Vector3 | null;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  t: number;
  dur: number;
}

const HUB_POS = Object.fromEntries(HUBS.map((h) => [h.id, hubPosition(h.id)])) as Record<
  HubId,
  THREE.Vector3
>;

export type PinLabel = {
  hit: HitTarget;
  title: string;
  tag: string;
  color: string;
  x: number;
  y: number;
  z: number;
};

function makeBadge(title: string, tag: string, accent: string): THREE.Group {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.055, 2.35, 8),
    new THREE.MeshStandardMaterial({ color: 0xdbe7f0, roughness: 0.38, metalness: 0.08 }),
  );
  stem.position.y = 1.18;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 14, 12),
    new THREE.MeshStandardMaterial({ color: accent, roughness: 0.32, metalness: 0.12 }),
  );
  head.position.y = 2.42;
  const hit = new THREE.Mesh(
    new THREE.SphereGeometry(0.95, 8, 8),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
  );
  hit.position.y = 2.2;
  g.add(stem, head, hit);
  g.userData.label = { title, tag, color: accent };
  return g;
}

function makeLabel(text: string, fill = '#1d2430'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 64);
  ctx.font = '700 22px ui-sans-serif, system-ui';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.beginPath();
  ctx.roundRect(18, 14, 220, 36, 10);
  ctx.fill();
  ctx.fillStyle = fill;
  ctx.fillText(text, 128, 40);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(6.4, 1.6, 1);
  sprite.position.y = 1.8;
  return sprite;
}

export class MapRenderer {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private threeScene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private ndc = new THREE.Vector3();
  private board: LondonBoard;
  private pinRoot = new THREE.Group();
  private pickables: THREE.Object3D[] = [];
  private beam: THREE.Group;
  private selected: HitTarget | null = null;
  private particles: Particle[] = [];
  private flight: Flight | null = null;
  private reduced: boolean;
  private pinKey = '';
  private cssW = 1;
  private cssH = 1;
  scene: Scene = {
    mode: 'setup',
    playerHubId: null,
    playerSectorId: null,
    companyName: '',
    stageName: '',
    rivals: [],
    events: [],
  };
  hover: HitTarget | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.reduced = window.matchMedia('(max-width: 54rem)').matches;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.reduced, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.reduced ? 1.25 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = !this.reduced;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.threeScene = new THREE.Scene();
    this.board = buildLondonBoard(this.reduced);
    this.threeScene.background = this.board.sky;
    this.threeScene.fog = new THREE.FogExp2(0xcfe6f2, 0.0048);
    this.threeScene.add(this.board.group);
    this.threeScene.add(this.pinRoot);
    this.beam = this.makeBeam();
    this.threeScene.add(this.beam);

    const hemi = new THREE.HemisphereLight(0xdbefff, 0x4a4335, 2.4);
    this.threeScene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffedc9, 3.1);
    sun.position.set(-48, 52, 36);
    sun.castShadow = !this.reduced;
    sun.shadow.mapSize.set(this.reduced ? 512 : 1024, this.reduced ? 512 : 1024);
    sun.shadow.camera.near = 4;
    sun.shadow.camera.far = 220;
    sun.shadow.camera.left = -80;
    sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -80;
    this.threeScene.add(sun);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
    this.camera.position.set(-48, 68, 58);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 16;
    this.controls.maxDistance = 150;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minPolarAngle = Math.PI * 0.28;
    this.controls.screenSpacePanning = false;
    this.controls.target.set(2, 0, -5);
    this.controls.update();
    this.fitAll();
  }

  dispose() {
    this.board.dispose();
    this.controls.dispose();
    this.renderer.dispose();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.camera.aspect = this.cssW / this.cssH;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.cssW, this.cssH, false);
  }

  fitAll() {
    this.startFlight(new THREE.Vector3(-48, 68, 58), new THREE.Vector3(2, 0, -5), 1.15);
  }

  focusHub(hubId: HubId) {
    const p = HUB_POS[hubId].clone();
    const target = new THREE.Vector3(p.x, LAND_Y + 0.5, p.z);
    const pos = new THREE.Vector3(p.x - 14, LAND_Y + 16, p.z + 16);
    this.startFlight(pos, target, 1.55, true);
    this.select({ type: 'hub', hubId });
  }

  select(hit: HitTarget | null) {
    this.selected = hit;
    this.placeBeam();
  }

  getSelection(): HitTarget | null {
    return this.selected;
  }

  pinLabels(): PinLabel[] {
    const out: PinLabel[] = [];
    for (const child of this.pinRoot.children) {
      const hit = child.userData.hit as HitTarget | undefined;
      const label = child.userData.label as { title: string; tag: string; color: string } | undefined;
      if (!hit || !label) continue;
      out.push({
        hit,
        title: label.title,
        tag: label.tag,
        color: label.color,
        x: child.position.x,
        y: child.position.y + 2.55,
        z: child.position.z,
      });
    }
    return out;
  }

  projectWorld(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    this.ndc.set(x, y, z).project(this.camera);
    return {
      x: (this.ndc.x * 0.5 + 0.5) * this.cssW,
      y: (-this.ndc.y * 0.5 + 0.5) * this.cssH,
      visible: this.ndc.z > -1 && this.ndc.z < 1,
    };
  }

  pan(dxPx: number, dyPx: number) {
    const pan = new THREE.Vector3(-dxPx, 0, -dyPx).multiplyScalar(0.08);
    this.camera.position.add(pan);
    this.controls.target.add(pan);
  }

  zoomAt(_sx: number, _sy: number, factor: number) {
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    dir.multiplyScalar(factor > 1 ? 0.92 : 1.08);
    this.camera.position.copy(this.controls.target).add(dir);
  }

  hitTest(sx: number, sy: number): HitTarget | null {
    this.pointer.x = (sx / this.cssW) * 2 - 1;
    this.pointer.y = -(sy / this.cssH) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, true);
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj) {
        const target = obj.userData.hit as HitTarget | undefined;
        if (target) return target;
        obj = obj.parent;
      }
    }
    return null;
  }

  burstConfetti(hubId: HubId | null) {
    const at = this.anchor(hubId);
    const colors = [PLAYER_COLOR, EVENT_COLOR, '#f472b6', '#a3e635', '#a78bfa', '#ffffff'];
    for (let i = 0; i < 40; i++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.04, 0.18),
        new THREE.MeshBasicMaterial({ color: colors[i % colors.length] }),
      );
      mesh.position.copy(at).add(new THREE.Vector3(0, 1.2, 0));
      this.threeScene.add(mesh);
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 8;
      this.particles.push({
        mesh,
        vx: Math.cos(a) * sp,
        vy: 6 + Math.random() * 8,
        vz: Math.sin(a) * sp,
        age: 0,
        ttl: 1.4 + Math.random(),
        kind: 'confetti',
      });
    }
  }

  floatText(hubId: HubId | null, text: string, color = '#4ade80') {
    const sprite = makeLabel(text, color);
    sprite.position.copy(this.anchor(hubId)).add(new THREE.Vector3(0, 2.2, 0));
    this.threeScene.add(sprite);
    this.particles.push({
      mesh: sprite,
      vx: 0,
      vy: 1.8,
      vz: 0,
      age: 0,
      ttl: 2.1,
      kind: 'float',
    });
  }

  puffSmoke(hubId: HubId | null) {
    const at = this.anchor(hubId);
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.35 }),
      );
      mesh.position
        .copy(at)
        .add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 1, (Math.random() - 0.5) * 0.4));
      this.threeScene.add(mesh);
      this.particles.push({
        mesh,
        vx: (Math.random() - 0.5) * 0.8,
        vy: 1.2 + Math.random(),
        vz: (Math.random() - 0.5) * 0.8,
        age: 0,
        ttl: 1.6,
        kind: 'smoke',
      });
    }
  }

  sparkle(hubId: HubId | null) {
    const at = this.anchor(hubId);
    for (let i = 0; i < 16; i++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xfde68a }),
      );
      mesh.position.copy(at).add(new THREE.Vector3(0, 1.1, 0));
      this.threeScene.add(mesh);
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 4;
      this.particles.push({
        mesh,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        vz: (Math.random() - 0.5) * sp,
        age: 0,
        ttl: 0.8,
        kind: 'spark',
      });
    }
  }

  frame(t: number, dt: number) {
    this.syncPins();
    this.board.update(t);
    this.stepFlight(dt);
    this.stepParticles(dt);
    this.controls.enabled = !this.flight;
    this.controls.update();
    if (this.beam.visible) {
      this.beam.rotation.y = t * 0.0004;
      const pulse = 0.42 + Math.sin(t * 0.0021) * 0.1;
      this.beam.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        const mat = mesh.material as THREE.MeshBasicMaterial | undefined;
        if (mat?.transparent) mat.opacity = pulse;
      });
    }
    for (const child of this.pinRoot.children) {
      if (!child.userData.pulse) continue;
      const pulse = 1 + Math.sin(t * 0.003 + child.position.x) * 0.05;
      child.scale.setScalar(pulse);
    }
    this.renderer.render(this.threeScene, this.camera);
  }

  private anchor(hubId: HubId | null): THREE.Vector3 {
    if (hubId) return HUB_POS[hubId].clone();
    return this.controls.target.clone();
  }

  private startFlight(toPos: THREE.Vector3, toTarget: THREE.Vector3, dur: number, cinematic = false) {
    const fromPos = this.camera.position.clone();
    const mid = fromPos.clone().lerp(toPos, 0.45);
    mid.y += cinematic ? 18 : 0;
    this.flight = {
      fromPos,
      midPos: cinematic ? mid : null,
      toPos,
      fromTarget: this.controls.target.clone(),
      toTarget,
      t: 0,
      dur,
    };
  }

  private stepFlight(dt: number) {
    if (!this.flight) return;
    this.flight.t += dt;
    const k = Math.min(1, this.flight.t / this.flight.dur);
    const e = 1 - (1 - k) ** 3;
    if (this.flight.midPos) {
      const a = this.flight.fromPos.clone().lerp(this.flight.midPos, e);
      this.camera.position.copy(a.lerp(this.flight.toPos, e));
    } else {
      this.camera.position.lerpVectors(this.flight.fromPos, this.flight.toPos, e);
    }
    this.controls.target.lerpVectors(this.flight.fromTarget, this.flight.toTarget, e);
    if (k >= 1) this.flight = null;
  }

  private makeBeam(): THREE.Group {
    const g = new THREE.Group();
    g.visible = false;
    const mat = new THREE.MeshBasicMaterial({
      color: 0x3b6bff,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.18, 9, 18, 1, true), mat);
    shaft.position.y = 4.6;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.78, 28), mat.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    g.add(shaft, ring);
    return g;
  }

  private placeBeam() {
    if (!this.selected) {
      this.beam.visible = false;
      return;
    }
    let pos: THREE.Vector3 | null = null;
    if (this.selected.type === 'hub') pos = HUB_POS[this.selected.hubId].clone();
    else {
      const pin = this.pinRoot.children.find((c) => {
        const hit = c.userData.hit as HitTarget | undefined;
        if (!hit || hit.type !== this.selected?.type) return false;
        if (hit.type === 'rival' && this.selected.type === 'rival') return hit.rivalId === this.selected.rivalId;
        if (hit.type === 'event' && this.selected.type === 'event') return hit.eventId === this.selected.eventId;
        return false;
      });
      if (pin) pos = pin.position.clone();
    }
    if (!pos) {
      this.beam.visible = false;
      return;
    }
    this.beam.position.copy(pos);
    this.beam.visible = true;
  }

  private stepParticles(dt: number) {
    this.particles = this.particles.filter((p) => {
      p.age += dt;
      if (p.kind === 'confetti') p.vy -= 18 * dt;
      if (p.kind === 'smoke') {
        p.mesh.scale.multiplyScalar(1 + dt * 0.8);
        const mat = (p.mesh as THREE.Mesh).material as THREE.MeshBasicMaterial;
        mat.opacity = Math.max(0, 0.35 * (1 - p.age / p.ttl));
      }
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      if (p.age >= p.ttl) {
        this.threeScene.remove(p.mesh);
        return false;
      }
      return true;
    });
  }

  private syncPins() {
    const key = JSON.stringify(this.scene);
    if (key === this.pinKey) return;
    this.pinKey = key;
    this.pinRoot.clear();
    this.pickables = [];

    const counts: Partial<Record<HubId, number>> = {};
    const slot = (hubId: HubId) => {
      const n = counts[hubId] ?? 0;
      counts[hubId] = n + 1;
      return n;
    };

    if (this.scene.playerHubId) slot(this.scene.playerHubId);

    for (const hub of HUBS) {
      const p = HUB_POS[hub.id];
      const isHq = this.scene.playerHubId === hub.id;
      const band =
        isHq && this.scene.stageName
          ? stageBandFromName(this.scene.stageName)
          : { label: isHq ? 'HQ' : 'Hub', color: EVENT_COLOR };
      const g = makeBadge(
        isHq && this.scene.companyName ? this.scene.companyName : hub.name,
        band.label,
        isHq ? band.color : EVENT_COLOR,
      );
      g.position.copy(p);
      g.userData.hit = { type: 'hub', hubId: hub.id } satisfies HitTarget;
      g.userData.pulse = this.scene.mode === 'setup';
      this.pinRoot.add(g);
      this.pickables.push(g);
    }

    for (const rival of this.scene.rivals) {
      if (!rival.alive) continue;
      const i = slot(rival.hubId);
      const band = stageBandFromName(rival.stageName);
      const g = makeBadge(rival.name, band.label, band.color);
      const base = HUB_POS[rival.hubId];
      const ang = -Math.PI / 2 + i * 2.1;
      const dist = i === 0 ? 0 : 1.8;
      g.position.set(base.x + Math.cos(ang) * dist, LAND_Y, base.z + Math.sin(ang) * dist);
      g.userData.hit = { type: 'rival', rivalId: rival.id } satisfies HitTarget;
      this.pinRoot.add(g);
      this.pickables.push(g);
    }

    for (const ev of this.scene.events) {
      const i = slot(ev.hubId);
      const g = makeBadge(ev.name.replace(/^★ /, ''), ev.attended ? 'Done' : 'Event', ev.attended ? '#64748b' : EVENT_COLOR);
      const base = HUB_POS[ev.hubId];
      const ang = Math.PI / 2 + i * 1.9;
      const dist = i === 0 ? 0 : 2;
      g.position.set(base.x + Math.cos(ang) * dist, LAND_Y, base.z + Math.sin(ang) * dist);
      g.userData.hit = { type: 'event', eventId: ev.id } satisfies HitTarget;
      g.userData.pulse = !ev.attended;
      this.pinRoot.add(g);
      this.pickables.push(g);
    }
    this.placeBeam();
  }
}
