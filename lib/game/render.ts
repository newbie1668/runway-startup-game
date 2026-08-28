/**
 * RUNWAY — canvas renderer (2D fallback).
 *
 * Draws the night-time London map every frame: Thames with animated shimmer,
 * tube lines in TfL colours, parks, twinkling "city light" dots, and
 * landmark doodles. Game-facing chrome (hub markers, shield pins, tooltips,
 * particles, vignette) is delegated to a camera-agnostic MapOverlay so this
 * renderer and the 3D city renderer draw pixel-identical chrome.
 *
 * The renderer owns the camera (pan/zoom); React feeds it a Scene each state
 * change and drives one requestAnimationFrame loop. This is also the
 * automatic fallback when WebGL is unavailable or the 3D context is lost.
 */

import { LANDMARKS, PARKS, THAMES, TUBE_LINES, WORLD, project, type WorldPoint } from './geo';
import { HUB_POS, MapOverlay } from './overlay';
import type { CameraState, HitTarget, IMapRenderer, Scene } from './scene';
import type { HubId } from './types';

// Re-exported so existing `from '@/lib/game/render'` imports don't churn.
export type { CameraState, HitTarget, IMapRenderer, Scene, SceneEvent, SceneRival } from './scene';
export { EVENT_COLOR, PLAYER_COLOR, SECTOR_COLORS } from './scene';

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

const THAMES_PTS = THAMES.map(project);
const PARK_POLYS = PARKS.map((p) => ({
  ...p,
  pts: p.points.map(project),
}));
const TUBE_PATHS = TUBE_LINES.map((l) => ({ ...l, pts: l.points.map(project) }));
const LANDMARK_PTS = LANDMARKS.map((l) => ({ ...l, at: project(l.at) }));

export class MapRenderer implements IMapRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cam: Camera = { x: WORLD.width / 2, y: WORLD.height / 2, zoom: 4 };
  private minZoom = 2;
  private maxZoom = 26;
  private twinkles: Twinkle[] = [];
  private cssW = 0;
  private cssH = 0;
  private overlay = new MapOverlay(
    (p) => this.worldToScreen(p),
    () => ({ w: this.cssW, h: this.cssH }),
  );

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

  fitOverview() {
    this.fitAll();
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

  getCamera(): CameraState {
    return { ...this.cam };
  }

  setCamera(c: CameraState) {
    this.cam = { ...c };
    this.clampCamera();
  }

  lookAt(x: number, y: number, viewH?: number) {
    this.cam.x = x;
    this.cam.y = y;
    if (viewH && viewH > 0 && this.cssH > 0) {
      this.cam.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.cssH / viewH));
    }
    this.clampCamera();
  }

  dispose() {
    // Plain 2D canvas owns no GPU/native resources to release.
  }

  private clampCamera() {
    const mx = WORLD.width * 0.25;
    const my = WORLD.height * 0.25;
    this.cam.x = Math.min(WORLD.width + mx, Math.max(-mx, this.cam.x));
    this.cam.y = Math.min(WORLD.height + my, Math.max(-my, this.cam.y));
  }

  private worldToScreen(p: WorldPoint): { x: number; y: number } {
    return {
      x: (p.x - this.cam.x) * this.cam.zoom + this.cssW / 2,
      y: (p.y - this.cam.y) * this.cam.zoom + this.cssH / 2,
    };
  }

  private screenToWorld(sx: number, sy: number): WorldPoint {
    return {
      x: (sx - this.cssW / 2) / this.cam.zoom + this.cam.x,
      y: (sy - this.cssH / 2) / this.cam.zoom + this.cam.y,
    };
  }

  hitTest(sx: number, sy: number): HitTarget | null {
    return this.overlay.hitTest(sx, sy);
  }

  burstConfetti(hubId: HubId | null) {
    this.overlay.burstConfetti(hubId);
  }

  floatText(hubId: HubId | null, text: string, color?: string) {
    this.overlay.floatText(hubId, text, color);
  }

  puffSmoke(hubId: HubId | null) {
    this.overlay.puffSmoke(hubId);
  }

  sparkle(hubId: HubId | null) {
    this.overlay.sparkle(hubId);
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
    this.overlay.drawAreaLabels(ctx, z);

    // --- Landmarks
    if (z > 4) this.drawLandmarks();

    // --- Game chrome: hubs, pins, player HQ, particles, vignette
    this.overlay.draw(ctx, t, dt, z);
  }

  private drawLandmarks() {
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
          for (let i = 0; i < 6; i++) {
            const a = (i * Math.PI) / 3;
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
        case 'gherkin':
          ctx.beginPath();
          ctx.ellipse(0, -11, 5, 11, 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'towerbridge':
          ctx.strokeRect(-8, -16, 4, 16);
          ctx.strokeRect(4, -16, 4, 16);
          ctx.beginPath();
          ctx.moveTo(-8, -10);
          ctx.lineTo(8, -10);
          ctx.moveTo(-10, 0);
          ctx.lineTo(10, 0);
          ctx.stroke();
          break;
        case 'walkie':
          ctx.beginPath();
          ctx.moveTo(-3, 0);
          ctx.lineTo(-3, -12);
          ctx.lineTo(-7, -18);
          ctx.lineTo(7, -18);
          ctx.lineTo(3, -12);
          ctx.lineTo(3, 0);
          ctx.stroke();
          break;
        case 'grater':
          ctx.beginPath();
          ctx.moveTo(-6, 0);
          ctx.lineTo(-6, -20);
          ctx.lineTo(6, 0);
          ctx.closePath();
          ctx.stroke();
          break;
        case 'canadasq':
          ctx.strokeRect(-5, -16, 10, 16);
          ctx.beginPath();
          ctx.moveTo(-5, -16);
          ctx.lineTo(0, -22);
          ctx.lineTo(5, -16);
          ctx.stroke();
          break;
        case 'battersea':
          ctx.strokeRect(-10, -8, 20, 8);
          for (const x of [-7, -2, 2, 7]) {
            ctx.strokeRect(x - 1, -16, 2, 8);
          }
          break;
        case 'bishop':
          ctx.beginPath();
          ctx.moveTo(-4, 0);
          ctx.lineTo(-3, -22);
          ctx.lineTo(3, -22);
          ctx.lineTo(4, 0);
          ctx.stroke();
          break;
        case 'heron':
          ctx.strokeRect(-3, -20, 6, 20);
          ctx.strokeRect(-4, -20, 8, 2);
          ctx.beginPath();
          ctx.moveTo(0, -20);
          ctx.lineTo(0, -24);
          ctx.stroke();
          break;
        case 'tower42':
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const a = (i * Math.PI) / 4 + Math.PI / 8;
            const cmd = i === 0 ? ctx.moveTo.bind(ctx) : ctx.lineTo.bind(ctx);
            cmd(Math.cos(a) * 5, -10 + Math.sin(a) * 5);
          }
          ctx.closePath();
          ctx.stroke();
          ctx.strokeRect(-2, -20, 4, 8);
          break;
        case 'abbey':
          ctx.strokeRect(-10, -8, 20, 8);
          ctx.strokeRect(-10, -16, 4, 8);
          ctx.strokeRect(-4, -16, 4, 8);
          break;
        case 'oldstreet':
          ctx.beginPath();
          ctx.arc(0, -2, 8, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, -2, 3, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'westminsterbr':
        case 'lambethbr':
        case 'waterloobr':
        case 'blackfriarsbr':
        case 'londonbr':
        case 'hungerford':
          ctx.beginPath();
          ctx.moveTo(-12, 0);
          ctx.lineTo(12, 0);
          ctx.moveTo(-8, 0);
          ctx.lineTo(-8, -4);
          ctx.moveTo(0, 0);
          ctx.lineTo(0, -4);
          ctx.moveTo(8, 0);
          ctx.lineTo(8, -4);
          ctx.stroke();
          break;
        case 'millennium':
          ctx.beginPath();
          ctx.moveTo(-12, -2);
          ctx.quadraticCurveTo(0, -8, 12, -2);
          ctx.stroke();
          break;
        case 'albertbr':
          ctx.strokeRect(-6, -10, 3, 10);
          ctx.strokeRect(3, -10, 3, 10);
          ctx.beginPath();
          ctx.moveTo(-12, 0);
          ctx.lineTo(12, 0);
          ctx.stroke();
          break;
        case 'towerlondon':
          ctx.strokeRect(-6, -10, 12, 10);
          ctx.strokeRect(-7, -14, 3, 4);
          ctx.strokeRect(4, -14, 3, 4);
          break;
        case 'buckingham':
          ctx.strokeRect(-12, -8, 24, 8);
          ctx.beginPath();
          ctx.moveTo(-4, -8);
          ctx.lineTo(0, -12);
          ctx.lineTo(4, -8);
          ctx.stroke();
          break;
        case 'monument':
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(0, -18);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, -20, 2, 0, Math.PI * 2);
          ctx.stroke();
          break;
      }
      ctx.restore();
    }
  }
}
