/**
 * RUNWAY — canvas renderer.
 *
 * Draws the night-time London map every frame: Thames with animated shimmer,
 * tube lines in TfL colours, parks, twinkling "city light" dots, landmark
 * doodles, shield-shaped pins (a nod to the real London Startup Map pins),
 * event pulses and a particle system for confetti / cash / smoke.
 *
 * The renderer owns the camera (pan/zoom) and particles; React feeds it a
 * Scene each state change and drives one requestAnimationFrame loop.
 */

import {
  AREA_LABELS,
  LANDMARKS,
  PARKS,
  THAMES,
  TUBE_LINES,
  WORLD,
  project,
  type WorldPoint,
} from './geo';
import { HUBS } from './content';
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
  kind: 'confetti' | 'float' | 'smoke' | 'spark';
  x: number; // screen-space
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  age: number;
  ttl: number;
  size: number;
  color: string;
  text?: string;
}

interface Camera {
  x: number; // world centre
  y: number;
  zoom: number; // px per world unit
}

interface Twinkle {
  x: number;
  y: number;
  phase: number;
  size: number;
}

const HUB_POS: Record<HubId, WorldPoint> = Object.fromEntries(
  HUBS.map((h) => [h.id, project([h.lng, h.lat])]),
) as Record<HubId, WorldPoint>;

const THAMES_PTS = THAMES.map(project);
const PARK_POLYS = PARKS.map((p) => ({
  ...p,
  pts: p.points.map(project),
}));
const TUBE_PATHS = TUBE_LINES.map((l) => ({ ...l, pts: l.points.map(project) }));
const LABEL_PTS = AREA_LABELS.map((l) => ({ ...l, at: project(l.at) }));
const LANDMARK_PTS = LANDMARKS.map((l) => ({ ...l, at: project(l.at) }));

export class MapRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cam: Camera = { x: WORLD.width / 2, y: WORLD.height / 2, zoom: 4 };
  private minZoom = 2;
  private maxZoom = 26;
  private particles: Particle[] = [];
  private twinkles: Twinkle[] = [];
  private cssW = 0;
  private cssH = 0;
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
    this.ctx = canvas.getContext('2d')!;
    // Deterministic pseudo-random city lights (no RNG dependency needed).
    let h = 12345;
    const rnd = () => {
      h = (h * 1103515245 + 12345) & 0x7fffffff;
      return h / 0x7fffffff;
    };
    for (let i = 0; i < 420; i++) {
      this.twinkles.push({
        x: rnd() * WORLD.width,
        y: rnd() * WORLD.height,
        phase: rnd() * Math.PI * 2,
        size: 0.6 + rnd() * 1.1,
      });
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cssW = rect.width;
    this.cssH = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fit = Math.min(rect.width / WORLD.width, rect.height / WORLD.height);
    this.minZoom = fit * 0.85;
    if (this.cam.zoom < this.minZoom) this.cam.zoom = fit * 1.02;
  }

  fitAll() {
    const fit = Math.min(this.cssW / WORLD.width, this.cssH / WORLD.height);
    this.cam = { x: WORLD.width / 2, y: WORLD.height / 2, zoom: fit * 1.02 };
  }

  focusHub(hubId: HubId, zoom = 9) {
    const p = HUB_POS[hubId];
    this.cam.x = p.x;
    this.cam.y = p.y;
    this.cam.zoom = Math.max(this.cam.zoom, zoom);
    this.clampCamera();
  }

  pan(dxPx: number, dyPx: number) {
    this.cam.x -= dxPx / this.cam.zoom;
    this.cam.y -= dyPx / this.cam.zoom;
    this.clampCamera();
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const before = this.screenToWorld(sx, sy);
    this.cam.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.cam.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
    this.clampCamera();
  }

  private clampCamera() {
    const mx = WORLD.width * 0.25;
    const my = WORLD.height * 0.25;
    this.cam.x = Math.min(WORLD.width + mx, Math.max(-mx, this.cam.x));
    this.cam.y = Math.min(WORLD.height + my, Math.max(-my, this.cam.y));
  }

  worldToScreen(p: WorldPoint): { x: number; y: number } {
    return {
      x: (p.x - this.cam.x) * this.cam.zoom + this.cssW / 2,
      y: (p.y - this.cam.y) * this.cam.zoom + this.cssH / 2,
    };
  }

  screenToWorld(sx: number, sy: number): WorldPoint {
    return {
      x: (sx - this.cssW / 2) / this.cam.zoom + this.cam.x,
      y: (sy - this.cssH / 2) / this.cam.zoom + this.cam.y,
    };
  }

  // -------------------------------------------------------------------------
  // Pin layout: several pins can share a hub, so fan them out around it.
  // Used by both drawing and hit-testing so clicks always match pixels.
  // -------------------------------------------------------------------------

  private pinLayout(): { target: HitTarget; x: number; y: number; r: number }[] {
    const out: { target: HitTarget; x: number; y: number; r: number }[] = [];
    const countAt: Partial<Record<HubId, number>> = {};
    const slot = (hubId: HubId) => {
      const n = countAt[hubId] ?? 0;
      countAt[hubId] = n + 1;
      return n;
    };
    // Player pin sits exactly on the hub.
    if (this.scene.playerHubId) slot(this.scene.playerHubId);

    for (const rival of this.scene.rivals) {
      if (!rival.alive) continue;
      const base = this.worldToScreen(HUB_POS[rival.hubId]);
      const i = slot(rival.hubId);
      const angle = -Math.PI / 2 + i * 2.1;
      const dist = i === 0 ? 0 : 26;
      out.push({
        target: { type: 'rival', rivalId: rival.id },
        x: base.x + Math.cos(angle) * dist,
        y: base.y + Math.sin(angle) * dist,
        r: 13,
      });
    }
    for (const ev of this.scene.events) {
      const base = this.worldToScreen(HUB_POS[ev.hubId]);
      const i = slot(ev.hubId);
      const angle = Math.PI / 2 + i * 1.9;
      const dist = i === 0 ? 0 : 30;
      out.push({
        target: { type: 'event', eventId: ev.id },
        x: base.x + Math.cos(angle) * dist,
        y: base.y + Math.sin(angle) * dist - 4,
        r: 14,
      });
    }
    return out;
  }

  hitTest(sx: number, sy: number): HitTarget | null {
    // Pins first (drawn on top), then hub circles.
    const pins = this.pinLayout();
    for (let i = pins.length - 1; i >= 0; i--) {
      const p = pins[i];
      const dx = sx - p.x;
      const dy = sy - p.y;
      if (dx * dx + dy * dy <= (p.r + 6) * (p.r + 6)) return p.target;
    }
    for (const hub of HUBS) {
      const p = this.worldToScreen(HUB_POS[hub.id]);
      const dx = sx - p.x;
      const dy = sy - p.y;
      const r = this.scene.mode === 'setup' ? 26 : 15;
      if (dx * dx + dy * dy <= r * r) return { type: 'hub', hubId: hub.id };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Particles
  // -------------------------------------------------------------------------

  private particleOrigin(hubId: HubId | null) {
    return hubId ? this.worldToScreen(HUB_POS[hubId]) : { x: this.cssW / 2, y: this.cssH / 2 };
  }

  burstConfetti(hubId: HubId | null) {
    const at = this.particleOrigin(hubId);
    const colors = ['#f8c33a', '#7dd3fc', '#f472b6', '#a3e635', '#a78bfa', '#ffffff'];
    for (let i = 0; i < 110; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 90 + Math.random() * 300;
      this.particles.push({
        kind: 'confetti',
        x: at.x,
        y: at.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 140,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 12,
        age: 0,
        ttl: 1.6 + Math.random() * 1.3,
        size: 4 + Math.random() * 5,
        color: colors[i % colors.length],
      });
    }
  }

  floatText(hubId: HubId | null, text: string, color = '#4ade80') {
    const at = this.particleOrigin(hubId);
    this.particles.push({
      kind: 'float',
      x: at.x + (Math.random() - 0.5) * 30,
      y: at.y - 20,
      vx: 0,
      vy: -34,
      rot: 0,
      vr: 0,
      age: 0,
      ttl: 2.2,
      size: 17,
      color,
      text,
    });
  }

  puffSmoke(hubId: HubId | null) {
    const at = this.particleOrigin(hubId);
    for (let i = 0; i < 14; i++) {
      this.particles.push({
        kind: 'smoke',
        x: at.x + (Math.random() - 0.5) * 18,
        y: at.y - Math.random() * 10,
        vx: (Math.random() - 0.5) * 26,
        vy: -22 - Math.random() * 26,
        rot: 0,
        vr: 0,
        age: 0,
        ttl: 1.8 + Math.random(),
        size: 7 + Math.random() * 12,
        color: '#94a3b8',
      });
    }
  }

  sparkle(hubId: HubId | null) {
    const at = this.particleOrigin(hubId);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 120;
      this.particles.push({
        kind: 'spark',
        x: at.x,
        y: at.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        rot: 0,
        vr: 0,
        age: 0,
        ttl: 0.9,
        size: 2 + Math.random() * 2,
        color: '#fde68a',
      });
    }
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  frame(t: number, dt: number) {
    const ctx = this.ctx;
    const w = this.cssW;
    const h = this.cssH;
    if (w === 0 || h === 0) return;

    // --- Sky/background
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#070c1a');
    bg.addColorStop(0.55, '#0a1124');
    bg.addColorStop(1, '#0d142b');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const z = this.cam.zoom;

    // --- City-light twinkles
    for (const tw of this.twinkles) {
      const p = this.worldToScreen(tw);
      if (p.x < -10 || p.x > w + 10 || p.y < -10 || p.y > h + 10) continue;
      const a = 0.1 + 0.1 * (0.5 + 0.5 * Math.sin(t * 0.0011 + tw.phase));
      ctx.fillStyle = `rgba(226,232,240,${a.toFixed(3)})`;
      const s = tw.size * Math.min(1.6, z / 5);
      ctx.fillRect(p.x, p.y, s, s);
    }

    // --- Parks
    for (const park of PARK_POLYS) {
      ctx.beginPath();
      park.pts.forEach((pt, i) => {
        const p = this.worldToScreen(pt);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(34,80,58,0.42)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(74,140,100,0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // --- Thames: dark ribbon + animated shimmer
    const river = (width: number, style: string) => {
      ctx.beginPath();
      THAMES_PTS.forEach((pt, i) => {
        const p = this.worldToScreen(pt);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    };
    river(Math.max(7, z * 2.6), 'rgba(23,44,84,0.95)');
    river(Math.max(4.5, z * 1.9), 'rgba(37,70,124,0.85)');
    ctx.save();
    ctx.setLineDash([14, 26]);
    ctx.lineDashOffset = -(t * 0.02) % 40;
    river(1.4, 'rgba(148,190,255,0.35)');
    ctx.restore();

    // --- Tube lines
    for (const line of TUBE_PATHS) {
      ctx.beginPath();
      line.pts.forEach((pt, i) => {
        const p = this.worldToScreen(pt);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.strokeStyle = line.color;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = Math.max(1.4, z * 0.32);
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // --- Area labels
    if (z > 3.2) {
      ctx.font = `600 ${Math.min(12, 8 + z * 0.3)}px ui-sans-serif, system-ui`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(148,163,184,0.34)';
      for (const label of LABEL_PTS) {
        const p = this.worldToScreen(label.at);
        ctx.save();
        ctx.letterSpacing = '3px';
        ctx.fillText(label.text, p.x, p.y);
        ctx.restore();
      }
    }

    // --- Landmarks
    if (z > 4) this.drawLandmarks(t);

    // --- Hubs
    for (const hub of HUBS) {
      const p = this.worldToScreen(HUB_POS[hub.id]);
      const isPlayerHub = this.scene.playerHubId === hub.id;
      const hovered = this.hover?.type === 'hub' && this.hover.hubId === hub.id;
      const setup = this.scene.mode === 'setup';

      if (setup) {
        // Big inviting target rings while choosing an HQ.
        const pulse = 0.5 + 0.5 * Math.sin(t * 0.003 + p.x * 0.05);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 20 + pulse * 5, 0, Math.PI * 2);
        ctx.strokeStyle = hovered ? 'rgba(248,195,58,0.95)' : 'rgba(125,211,252,0.5)';
        ctx.lineWidth = hovered ? 2.5 : 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = hovered ? '#f8c33a' : '#7dd3fc';
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, isPlayerHub ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = isPlayerHub ? 'rgba(248,195,58,0.9)' : 'rgba(125,211,252,0.55)';
        ctx.fill();
      }

      const labelAlpha = setup || hovered ? 0.95 : 0.6;
      ctx.font = `700 ${setup ? 13 : 11.5}px ui-sans-serif, system-ui`;
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(226,232,240,${labelAlpha})`;
      ctx.fillText(hub.name, p.x, p.y + (setup ? 40 : 20));
      if (setup && hovered) {
        ctx.font = '500 11px ui-sans-serif, system-ui';
        ctx.fillStyle = 'rgba(148,163,184,0.9)';
        ctx.fillText(`£${hub.rent.toLocaleString()}/wk rent`, p.x, p.y + 55);
      }
    }

    // --- Pins (rivals + events), fanned around their hubs
    const pins = this.pinLayout();
    for (const pin of pins) {
      if (pin.target.type === 'rival') {
        const rival = this.scene.rivals.find(
          (r) => r.id === (pin.target as { rivalId: string }).rivalId,
        )!;
        const hovered = this.hover?.type === 'rival' && this.hover.rivalId === rival.id;
        this.drawShieldPin(pin.x, pin.y, 11, SECTOR_COLORS[rival.sectorId], false, hovered);
        if (hovered) {
          this.tooltip(pin.x, pin.y - 26, `${rival.name} · ${rival.stageName}`);
        }
      } else if (pin.target.type === 'event') {
        const ev = this.scene.events.find(
          (e) => e.id === (pin.target as { eventId: string }).eventId,
        )!;
        const hovered = this.hover?.type === 'event' && this.hover.eventId === ev.id;
        const pulse = 0.5 + 0.5 * Math.sin(t * 0.004 + pin.x);
        if (!ev.attended) {
          ctx.beginPath();
          ctx.arc(pin.x, pin.y, 12 + pulse * 8, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(125,211,252,${(0.5 - pulse * 0.3).toFixed(2)})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(pin.x, pin.y, 9, 0, Math.PI * 2);
        ctx.fillStyle = ev.attended ? 'rgba(71,85,105,0.9)' : EVENT_COLOR;
        ctx.fill();
        ctx.strokeStyle = 'rgba(8,15,33,0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // calendar glyph
        ctx.fillStyle = '#0a1124';
        ctx.font = '700 9px ui-sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(ev.attended ? '✓' : '★', pin.x, pin.y + 3);
        if (hovered) this.tooltip(pin.x, pin.y - 24, ev.name);
      }
    }

    // --- Player HQ pin, drawn last so it sits on top
    if (this.scene.playerHubId && this.scene.mode === 'play') {
      const p = this.worldToScreen(HUB_POS[this.scene.playerHubId]);
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.0035);
      ctx.beginPath();
      ctx.arc(p.x, p.y - 14, 17 + pulse * 4, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(248,195,58,${(0.45 - pulse * 0.25).toFixed(2)})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      this.drawShieldPin(p.x, p.y, 15, PLAYER_COLOR, true, false);
      ctx.font = '800 12px ui-sans-serif, system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f8c33a';
      ctx.strokeStyle = 'rgba(7,12,26,0.85)';
      ctx.lineWidth = 3;
      const label = this.scene.companyName.toUpperCase();
      ctx.strokeText(label, p.x, p.y - 34);
      ctx.fillText(label, p.x, p.y - 34);
    }

    // --- Particles
    this.stepParticles(dt);

    // --- Vignette
    const vg = ctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.42,
      w / 2,
      h / 2,
      Math.max(w, h) * 0.75,
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(2,4,12,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }

  /** Shield-shaped map pin — the signature pin shape of the real site. */
  private drawShieldPin(
    x: number,
    y: number,
    size: number,
    color: string,
    isPlayer: boolean,
    hovered: boolean,
  ) {
    const ctx = this.ctx;
    const wHalf = size * 0.78;
    const top = y - size * 1.9;
    ctx.save();
    if (isPlayer || hovered) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
    }
    ctx.beginPath();
    ctx.moveTo(x, y); // bottom point
    ctx.quadraticCurveTo(x - wHalf, y - size * 0.85, x - wHalf, y - size * 1.35);
    ctx.quadraticCurveTo(x - wHalf, top, x, top);
    ctx.quadraticCurveTo(x + wHalf, top, x + wHalf, y - size * 1.35);
    ctx.quadraticCurveTo(x + wHalf, y - size * 0.85, x, y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(7,12,26,0.9)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // inner mark
    ctx.beginPath();
    ctx.arc(x, y - size * 1.15, size * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(7,12,26,0.85)';
    ctx.fill();
    ctx.restore();
  }

  private tooltip(x: number, y: number, text: string) {
    const ctx = this.ctx;
    ctx.font = '600 11.5px ui-sans-serif, system-ui';
    const wText = ctx.measureText(text).width;
    const pad = 7;
    const bw = wText + pad * 2;
    const bx = Math.min(Math.max(x - bw / 2, 6), this.cssW - bw - 6);
    ctx.fillStyle = 'rgba(10,17,36,0.92)';
    ctx.strokeStyle = 'rgba(125,211,252,0.4)';
    ctx.beginPath();
    ctx.roundRect(bx, y - 18, bw, 22, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'left';
    ctx.fillText(text, bx + pad, y - 3);
    ctx.textAlign = 'center';
  }

  private drawLandmarks(t: number) {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(160,178,205,0.55)';
    ctx.fillStyle = 'rgba(160,178,205,0.55)';
    ctx.lineWidth = 1.2;
    for (const lm of LANDMARK_PTS) {
      const p = this.worldToScreen(lm.at);
      const s = Math.min(1.4, this.cam.zoom / 9);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(s, s);
      switch (lm.kind) {
        case 'eye': {
          ctx.beginPath();
          ctx.arc(0, -12, 9, 0, Math.PI * 2);
          ctx.stroke();
          const spin = t * 0.0004;
          for (let i = 0; i < 6; i++) {
            const a = spin + (i * Math.PI) / 3;
            ctx.beginPath();
            ctx.moveTo(0, -12);
            ctx.lineTo(Math.cos(a) * 9, -12 + Math.sin(a) * 9);
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.moveTo(-5, 0);
          ctx.lineTo(0, -6);
          ctx.lineTo(5, 0);
          ctx.stroke();
          break;
        }
        case 'shard':
          ctx.beginPath();
          ctx.moveTo(-6, 0);
          ctx.lineTo(0, -22);
          ctx.lineTo(6, 0);
          ctx.moveTo(0, -22);
          ctx.lineTo(-2, 0);
          ctx.moveTo(0, -22);
          ctx.lineTo(2, 0);
          ctx.stroke();
          break;
        case 'bigben':
          ctx.strokeRect(-3, -18, 6, 18);
          ctx.beginPath();
          ctx.moveTo(-3, -18);
          ctx.lineTo(0, -23);
          ctx.lineTo(3, -18);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, -14, 2, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'bttower':
          ctx.beginPath();
          ctx.moveTo(-2, 0);
          ctx.lineTo(-2, -20);
          ctx.moveTo(2, 0);
          ctx.lineTo(2, -20);
          ctx.moveTo(-4, -20);
          ctx.lineTo(4, -20);
          ctx.stroke();
          ctx.strokeRect(-4, -14, 8, 3);
          break;
        case 'stpauls':
          ctx.beginPath();
          ctx.arc(0, -8, 7, Math.PI, 0);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(-8, -8);
          ctx.lineTo(8, -8);
          ctx.moveTo(0, -15);
          ctx.lineTo(0, -19);
          ctx.stroke();
          break;
        case 'o2': {
          ctx.beginPath();
          ctx.arc(0, 0, 8, Math.PI, 0);
          ctx.stroke();
          for (let i = -2; i <= 2; i++) {
            ctx.beginPath();
            ctx.moveTo(i * 3, -Math.sqrt(Math.max(0, 64 - i * i * 9)));
            ctx.lineTo(i * 4, -13);
            ctx.stroke();
          }
          break;
        }
      }
      ctx.restore();
    }
  }

  private stepParticles(dt: number) {
    const ctx = this.ctx;
    this.particles = this.particles.filter((p) => p.age < p.ttl);
    for (const p of this.particles) {
      p.age += dt;
      const k = p.age / p.ttl;
      if (p.kind === 'confetti') {
        p.vy += 380 * dt;
        p.vx *= 1 - 1.4 * dt;
      } else if (p.kind === 'smoke') {
        p.vy -= 8 * dt;
        p.size += 9 * dt;
      } else if (p.kind === 'spark') {
        p.vx *= 1 - 3 * dt;
        p.vy *= 1 - 3 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const alpha = p.kind === 'float' ? Math.min(1, 3 - 3 * k) : 1 - k;

      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      if (p.kind === 'float' && p.text) {
        ctx.font = `800 ${p.size}px ui-sans-serif, system-ui`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(7,12,26,0.9)';
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
      } else if (p.kind === 'smoke') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, alpha * 0.25);
        ctx.fill();
      } else if (p.kind === 'spark') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      } else {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      ctx.restore();
    }
  }
}
