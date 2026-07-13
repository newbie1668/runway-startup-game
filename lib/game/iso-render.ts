/**
 * RUNWAY — isometric London map renderer.
 * Canvas 2D sprite compositing with daytime illustrated diorama style.
 */

import { HUBS } from './content';
import { LANDMARKS, project } from './geo';
import { drawSky, drawParks, drawThames, drawRoads, drawHubSign } from './iso-scenery';
import {
  TILE_H,
  TILE_W,
  hubIsoPoint,
  isoToScreen,
  screenToIso,
  worldToScreen,
  type IsoCamera,
  type IsoPoint,
  type ScreenPoint,
} from './iso';
import {
  type HitTarget,
  type Scene,
} from './map-scene';
import type { MapRendererApi } from './map-renderer';
import {
  HUB_CLUSTERS,
  ISO_PALETTE,
  MIN_HIT_PX,
  sectorBuildingColors,
  type ClusterBuildingDef,
} from './sprites';
import type { HubId } from './types';
import {
  drawHubPlaza,
  drawIllustratedBuilding,
  drawIllustratedTent,
  HUB_THEMES,
  truncateLabel,
} from './iso-draw';
import { getCachedSprite, HUB_SPRITE_META, preloadHubSprites } from './sprite-loader';

const EVENT_TENTS: Record<HubId, { wx: number; wy: number }> = {
  shoreditch: { wx: 0.9, wy: 1.35 },
  kingscross: { wx: -0.8, wy: 1.1 },
  soho: { wx: 0.7, wy: 1.0 },
  farringdon: { wx: -0.75, wy: 1.05 },
  canarywharf: { wx: 1.1, wy: 1.4 },
  londonbridge: { wx: -0.85, wy: 1.15 },
  camden: { wx: 0.65, wy: 0.95 },
  battersea: { wx: -0.7, wy: 1.0 },
};

interface HitRegion {
  target: HitTarget;
  poly: ScreenPoint[];
}

function pointInPoly(px: number, py: number, poly: ScreenPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function expandPoly(poly: ScreenPoint[], minSize: number): ScreenPoint[] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (w >= minSize && h >= minSize) return poly;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const half = Math.max(minSize / 2, w / 2, h / 2) + 4;
  return [
    { x: cx - half, y: cy - half },
    { x: cx + half, y: cy - half },
    { x: cx + half, y: cy + half },
    { x: cx - half, y: cy + half },
  ];
}

type CanvasLike = HTMLCanvasElement | { width: number; height: number };

export class IsoMapRenderer implements MapRendererApi {
  private canvas: CanvasLike;
  private ctx: CanvasRenderingContext2D | null;
  private cam: IsoCamera = { panX: 0, panY: 0, zoom: 1 };
  private minZoom = 0.4;
  private maxZoom = 3.2;
  cssW = 0;
  cssH = 0;
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
  private mobileFocused = false;

  constructor(canvas: CanvasLike) {
    this.canvas = canvas;
    if ('getContext' in canvas) {
      this.ctx = canvas.getContext('2d');
      preloadHubSprites();
    } else {
      this.ctx = null;
    }
  }

  /** Offline test entry — no DOM canvas required. */
  static forTest(w: number, h: number): IsoMapRenderer {
    const r = new IsoMapRenderer({ width: w, height: h });
    r.cssW = w;
    r.cssH = h;
    r.fitAll();
    return r;
  }

  resize() {
    if (!('getBoundingClientRect' in this.canvas)) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    if (rect.width <= 0 || rect.height <= 0) return;
    this.cssW = rect.width;
    this.cssH = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fit = this.computeFitZoom();
    this.minZoom = fit * 0.55;
    if (this.cam.zoom < this.minZoom) this.cam.zoom = fit;
    this.applyMobileFocus();
  }

  fitAll() {
    this.cam.zoom = this.computeFitZoom();
    this.cam.panX = 0;
    this.cam.panY = 0;
    this.mobileFocused = false;
    this.applyMobileFocus();
  }

  private computeFitZoom(): number {
    const pts = HUBS.map((h) => hubIsoPoint(h.id));
    let minIx = Infinity;
    let maxIx = -Infinity;
    let minIy = Infinity;
    let maxIy = -Infinity;
    for (const p of pts) {
      minIx = Math.min(minIx, p.ix);
      maxIx = Math.max(maxIx, p.ix);
      minIy = Math.min(minIy, p.iy);
      maxIy = Math.max(maxIy, p.iy);
    }
    const spanX = (maxIx - minIx + 6) * TILE_W * 0.5;
    const spanY = (maxIy - minIy + 6) * TILE_H * 0.5;
    const fit = Math.min(this.cssW / spanX, this.cssH / spanY) * 0.92;
    return Math.max(0.35, fit || 0.8);
  }

  private applyMobileFocus() {
    if (this.mobileFocused) return;
    if (this.cssW > 768) return;
    const hubId = this.scene.playerHubId;
    if (!hubId) return;
    this.focusHub(hubId);
    this.mobileFocused = true;
  }

  focusHub(hubId: HubId) {
    const hub = hubIsoPoint(hubId);
    const center = isoToScreen(hub, this.cam, this.cssW, this.cssH);
    this.cam.panX += this.cssW / 2 - center.x;
    this.cam.panY += this.cssH / 2 - center.y;
    this.cam.zoom = Math.max(this.cam.zoom, this.computeFitZoom() * 1.35);
  }

  pan(dx: number, dy: number) {
    this.cam.panX += dx;
    this.cam.panY += dy;
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const before = screenToIso(sx, sy, this.cam, this.cssW, this.cssH);
    this.cam.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.cam.zoom * factor));
    const after = screenToIso(sx, sy, this.cam, this.cssW, this.cssH);
    const b = isoToScreen(before, this.cam, this.cssW, this.cssH);
    const a = isoToScreen(after, this.cam, this.cssW, this.cssH);
    this.cam.panX += b.x - a.x;
    this.cam.panY += b.y - a.y;
  }

  private hubOrigin(hubId: HubId): IsoPoint {
    return hubIsoPoint(hubId);
  }

  private buildingIso(hubId: HubId, b: ClusterBuildingDef): IsoPoint {
    const o = this.hubOrigin(hubId);
    return { ix: o.ix + b.wx, iy: o.iy + b.wy };
  }

  private buildingFootprint(hubId: HubId, b: ClusterBuildingDef): ScreenPoint[] {
    const iso = this.buildingIso(hubId, b);
    const base = isoToScreen(iso, this.cam, this.cssW, this.cssH);
    const hw = b.w * TILE_W * 0.5 * this.cam.zoom;
    const hd = b.d * TILE_H * 0.5 * this.cam.zoom;
    return expandPoly(
      [
        { x: base.x, y: base.y - hd },
        { x: base.x + hw, y: base.y },
        { x: base.x, y: base.y + hd },
        { x: base.x - hw, y: base.y },
      ],
      MIN_HIT_PX,
    );
  }

  private hubGroundPoly(hubId: HubId): ScreenPoint[] {
    const cluster = HUB_CLUSTERS[hubId];
    const o = this.hubOrigin(hubId);
    const pad = isoToScreen(o, this.cam, this.cssW, this.cssH);
    const z = this.cam.zoom;
    return [
      { x: pad.x, y: pad.y - cluster.groundRy * TILE_H * 0.5 * z },
      { x: pad.x + cluster.groundRx * TILE_W * 0.5 * z, y: pad.y },
      { x: pad.x, y: pad.y + cluster.groundRy * TILE_H * 0.5 * z },
      { x: pad.x - cluster.groundRx * TILE_W * 0.5 * z, y: pad.y },
    ];
  }

  private collectHitRegions(): HitRegion[] {
    const out: HitRegion[] = [];
    const scene = this.scene;

    for (const hub of HUBS) {
      const cluster = HUB_CLUSTERS[hub.id];
      const rivals = scene.rivals.filter((r) => r.alive && r.hubId === hub.id);
      const events = scene.events.filter((e) => !e.attended && e.hubId === hub.id);
      const rivalSlots = cluster.buildings.filter((b) => b.role === 'rival');
      const playerBuilding = cluster.buildings.find((b) => b.role === 'player')!;

      if (scene.playerHubId === hub.id && scene.mode === 'play') {
        out.push({
          target: { type: 'player' },
          poly: this.buildingFootprint(hub.id, playerBuilding),
        });
      }

      rivals.forEach((rival, i) => {
        const slot = rivalSlots[i % rivalSlots.length];
        if (!slot) return;
        out.push({
          target: { type: 'rival', rivalId: rival.id },
          poly: this.buildingFootprint(hub.id, slot),
        });
      });

      for (const ev of events) {
        const tent = EVENT_TENTS[hub.id];
        const iso = { ix: this.hubOrigin(hub.id).ix + tent.wx, iy: this.hubOrigin(hub.id).iy + tent.wy };
        const base = isoToScreen(iso, this.cam, this.cssW, this.cssH);
        const hw = 0.55 * TILE_W * 0.5 * this.cam.zoom;
        const hd = 0.5 * TILE_H * 0.5 * this.cam.zoom;
        out.push({
          target: { type: 'event', eventId: ev.id },
          poly: expandPoly(
            [
              { x: base.x, y: base.y - hd },
              { x: base.x + hw, y: base.y },
              { x: base.x, y: base.y + hd },
              { x: base.x - hw, y: base.y },
            ],
            MIN_HIT_PX,
          ),
        });
      }

      out.push({
        target: { type: 'hub', hubId: hub.id },
        poly: this.hubGroundPoly(hub.id),
      });
    }

    return out;
  }

  /** Screen centre of a hub cluster — used by tests and tooling. */
  hubScreenCenter(hubId: HubId): ScreenPoint {
    return isoToScreen(this.hubOrigin(hubId), this.cam, this.cssW, this.cssH);
  }

  hitTest(sx: number, sy: number): HitTarget | null {
    const regions = this.collectHitRegions();
    const entities = regions.filter((r) => r.target.type !== 'hub');
    const sortedEntities = [...entities].sort((a, b) => {
      const depth = (t: HitTarget) => (t.type === 'event' ? 2 : 3);
      return depth(a.target) - depth(b.target);
    });
    for (let i = sortedEntities.length - 1; i >= 0; i--) {
      if (pointInPoly(sx, sy, sortedEntities[i].poly)) return sortedEntities[i].target;
    }

    let bestHub: HitTarget | null = null;
    let bestDist = Infinity;
    for (const r of regions) {
      if (r.target.type !== 'hub') continue;
      if (!pointInPoly(sx, sy, r.poly)) continue;
      const c = this.hubScreenCenter(r.target.hubId);
      const d = (c.x - sx) ** 2 + (c.y - sy) ** 2;
      if (d < bestDist) {
        bestDist = d;
        bestHub = r.target;
      }
    }
    return bestHub;
  }

  /** Exposed for offline tests — minimum hit dimension at a screen point. */
  hitRegionSizeAt(sx: number, sy: number): { w: number; h: number } | null {
    const regions = this.collectHitRegions();
    for (let i = regions.length - 1; i >= 0; i--) {
      if (!pointInPoly(sx, sy, regions[i].poly)) continue;
      const poly = regions[i].poly;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of poly) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      return { w: maxX - minX, h: maxY - minY };
    }
    return null;
  }

  burstConfetti(hubId: HubId | null) {
    void hubId;
  }
  floatText(hubId: HubId | null, text: string, color?: string) {
    void hubId;
    void text;
    void color;
  }
  puffSmoke(hubId: HubId | null) {
    void hubId;
  }
  sparkle(hubId: HubId | null) {
    void hubId;
  }

  frame(_t: number, _dt: number) {
    void _t;
    void _dt;
    this.draw();
  }

  private draw() {
    const ctx = this.ctx;
    if (!ctx || this.cssW === 0 || this.cssH === 0) return;
    const w = this.cssW;
    const h = this.cssH;

    drawSky(ctx, w, h);
    drawParks(ctx, this.cam, w, h);
    drawThames(ctx, this.cam, w, h);
    drawRoads(ctx, this.cam, w, h);

    // Hub clusters back-to-front
    const hubOrder = [...HUBS].sort((a, b) => {
      const pa = this.hubOrigin(a.id);
      const pb = this.hubOrigin(b.id);
      return pa.ix + pa.iy - (pb.ix + pb.iy);
    });

    for (const hub of hubOrder) {
      this.drawHubCluster(ctx, hub.id, w, h);
    }

    // Landmarks on top
    this.drawLandmarks(ctx, w, h);
  }

  private drawHubCluster(ctx: CanvasRenderingContext2D, hubId: HubId, w: number, h: number) {
    const cluster = HUB_CLUSTERS[hubId];
    const theme = HUB_THEMES[hubId];
    const origin = isoToScreen(this.hubOrigin(hubId), this.cam, w, h);
    const z = this.cam.zoom;
    const padScale = z < 0.55 ? 0.78 : 1;
    const rx = cluster.groundRx * TILE_W * 0.5 * z * padScale;
    const ry = cluster.groundRy * TILE_H * 0.5 * z * padScale;

    const sprite = getCachedSprite(HUB_SPRITE_META[hubId].assetPath);
    if (sprite) {
      const meta = HUB_SPRITE_META[hubId];
      const sw = meta.drawW * TILE_W * z;
      const sh = meta.drawH * TILE_H * z;
      ctx.drawImage(sprite, origin.x - sw * meta.anchorX, origin.y - sh * meta.anchorY, sw, sh);
    } else {
      drawHubPlaza(ctx, origin.x, origin.y, rx, ry, theme, z);
      drawHubSign(ctx, hubId, origin.x, origin.y - ry - 8, z);
    }

    const rivals = this.scene.rivals.filter((r) => r.alive && r.hubId === hubId);
    const events = this.scene.events.filter((e) => !e.attended && e.hubId === hubId);
    const rivalSlots = cluster.buildings.filter((b) => b.role === 'rival');
    const sortedBuildings = [...cluster.buildings].sort((a, b) => a.wx + a.wy - (b.wx + b.wy));

    for (const b of sortedBuildings) {
      let colors = { roof: b.roof, left: b.left, right: b.right, accent: cluster.accent };
      let label: string | null = null;
      let kind: 'player' | 'rival' | 'neutral' = 'neutral';
      let companyName: string | undefined;

      if (b.role === 'player' && this.scene.playerHubId === hubId) {
        kind = 'player';
        if (this.scene.playerSectorId) {
          colors = { ...sectorBuildingColors(this.scene.playerSectorId), accent: cluster.accent };
        }
        companyName = this.scene.companyName;
        label = this.scene.companyName || 'YOU';
      } else if (b.role === 'rival') {
        const idx = rivalSlots.indexOf(b);
        const rival = rivals[idx];
        if (rival) {
          kind = 'rival';
          colors = { ...sectorBuildingColors(rival.sectorId), accent: cluster.accent };
          label = rival.name;
        }
      }

      const rivalHoverId = this.hover?.type === 'rival' ? this.hover.rivalId : null;
      const hovered =
        (kind === 'player' && this.hover?.type === 'player') ||
        (kind === 'rival' &&
          rivalHoverId !== null &&
          rivals.some((r, i) => rivalSlots[i % rivalSlots.length] === b && r.id === rivalHoverId));

      if (sprite && kind === 'neutral') continue;

      const base = isoToScreen(this.buildingIso(hubId, b), this.cam, w, h);
      const hw = b.w * TILE_W * 0.5 * this.cam.zoom;
      const hd = b.d * TILE_H * 0.5 * this.cam.zoom;
      const rise = b.h * TILE_H * this.cam.zoom;

      drawIllustratedBuilding(ctx, base, hw, hd, rise, colors, theme.buildingStyle, {
        kind,
        gag: kind === 'neutral' ? theme.gag : undefined,
        companyName,
        hover: hovered,
      });

      if (label && kind === 'rival') {
        ctx.font = `bold ${Math.max(9, 10 * z)}px system-ui`;
        ctx.fillStyle = 'rgba(15,23,42,0.8)';
        ctx.textAlign = 'center';
        ctx.fillText(truncateLabel(label, 16), base.x, base.y - b.h * TILE_H * z - 18);
      }
    }

    for (const ev of events) {
      const tent = EVENT_TENTS[hubId];
      const iso = { ix: this.hubOrigin(hubId).ix + tent.wx, iy: this.hubOrigin(hubId).iy + tent.wy };
      const base = isoToScreen(iso, this.cam, w, h);
      const hw = 0.55 * TILE_W * 0.5 * this.cam.zoom;
      const hd = 0.5 * TILE_H * 0.5 * this.cam.zoom;
      const rise = 0.7 * TILE_H * this.cam.zoom;
      drawIllustratedTent(
        ctx,
        base,
        hw,
        hd,
        rise,
        ev.name,
        this.hover?.type === 'event' && this.hover.eventId === ev.id,
      );
    }
  }

  private drawLandmarks(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const s = Math.min(1.35, this.cam.zoom * 1.1);
    for (const lm of LANDMARKS) {
      const p = worldToScreen(project(lm.at), this.cam, w, h);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(s, s);
      ctx.lineWidth = 1.1;
      switch (lm.kind) {
        case 'shard':
          ctx.fillStyle = 'rgba(180, 200, 220, 0.85)';
          ctx.strokeStyle = '#6a7a8a';
          ctx.beginPath();
          ctx.moveTo(-6, 2);
          ctx.lineTo(0, -22);
          ctx.lineTo(6, 2);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          break;
        case 'eye':
          ctx.strokeStyle = '#5a6a7a';
          ctx.fillStyle = 'rgba(220, 230, 240, 0.7)';
          ctx.beginPath();
          ctx.arc(0, -11, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(-8, -11);
          ctx.lineTo(8, -11);
          ctx.stroke();
          break;
        case 'bigben':
          ctx.fillStyle = '#c4a86a';
          ctx.strokeStyle = '#6a5a3a';
          ctx.fillRect(-3, -16, 6, 16);
          ctx.beginPath();
          ctx.moveTo(-3, -16);
          ctx.lineTo(0, -21);
          ctx.lineTo(3, -16);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#2a2a2a';
          ctx.fillRect(-1.5, -12, 3, 3);
          break;
        case 'stpauls':
          ctx.fillStyle = '#d8d0c0';
          ctx.strokeStyle = '#8a8070';
          ctx.fillRect(-5, -4, 10, 6);
          ctx.beginPath();
          ctx.arc(0, -6, 6, Math.PI, 0);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, -12);
          ctx.lineTo(0, -16);
          ctx.stroke();
          break;
        default:
          ctx.fillStyle = ISO_PALETTE.landmark;
          ctx.fillRect(-2, -10, 4, 10);
      }
      ctx.restore();
    }
  }
}
