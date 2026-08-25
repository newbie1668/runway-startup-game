/**
 * RUNWAY — camera-agnostic map chrome.
 *
 * All game-facing 2D drawing (hub markers, rival/event pins, the player's HQ
 * pin + label, tooltips, area labels, particles, vignette) lives here as a
 * plain 2D-canvas painter driven by a `Projector`. The 2D renderer projects
 * world points with its own affine camera; the 3D renderer projects world
 * ground points through a perspective camera. Either way hitTest/pin layout
 * stay screen-space circle checks — no raycasting, pixel-identical in both
 * modes.
 */

import { AREA_LABELS, project, type WorldPoint } from './geo';
import { HUBS } from './content';
import {
  EVENT_COLOR,
  PLAYER_COLOR,
  SECTOR_COLORS,
  type HitTarget,
  type Scene,
} from './scene';
import type { HubId } from './types';

export type Projector = (p: WorldPoint) => { x: number; y: number } | null;

export const HUB_POS: Record<HubId, WorldPoint> = Object.fromEntries(
  HUBS.map((h) => [h.id, project([h.lng, h.lat])]),
) as Record<HubId, WorldPoint>;

const LABEL_PTS = AREA_LABELS.map((l) => ({ ...l, at: project(l.at) }));

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

export class MapOverlay {
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

  private particles: Particle[] = [];

  constructor(
    private projector: Projector,
    private size: () => { w: number; h: number },
  ) {}

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
      const base = this.projector(HUB_POS[rival.hubId]);
      if (!base) continue;
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
      const base = this.projector(HUB_POS[ev.hubId]);
      if (!base) continue;
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
      const p = this.projector(HUB_POS[hub.id]);
      if (!p) continue;
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
    const { w, h } = this.size();
    if (!hubId) return { x: w / 2, y: h / 2 };
    return this.projector(HUB_POS[hubId]) ?? { x: w / 2, y: h / 2 };
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

  private stepParticles(ctx: CanvasRenderingContext2D, dt: number) {
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

  /** Shield-shaped map pin — the signature pin shape of the real site. */
  private drawShieldPin(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    color: string,
    isPlayer: boolean,
    hovered: boolean,
  ) {
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

  private tooltip(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
    const { w } = this.size();
    ctx.font = '600 11.5px ui-sans-serif, system-ui';
    const wText = ctx.measureText(text).width;
    const pad = 7;
    const bw = wText + pad * 2;
    const bx = Math.min(Math.max(x - bw / 2, 6), w - bw - 6);
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

  /** Area labels — only legible once zoomed in past street level. */
  drawAreaLabels(ctx: CanvasRenderingContext2D, zoom: number) {
    if (zoom <= 3.2) return;
    ctx.font = `600 ${Math.min(12, 8 + zoom * 0.3)}px ui-sans-serif, system-ui`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(148,163,184,0.34)';
    for (const label of LABEL_PTS) {
      const p = this.projector(label.at);
      if (!p) continue;
      ctx.save();
      ctx.letterSpacing = '3px';
      ctx.fillText(label.text, p.x, p.y);
      ctx.restore();
    }
  }

  /**
   * All game-facing 2D chrome: hub markers, rival/event pins, the player's
   * HQ pin + label, particles, and the closing vignette. Camera-agnostic —
   * driven entirely by `projector` — so it draws identically over the 2D
   * canvas background or the 3D WebGL city underneath.
   */
  draw(ctx: CanvasRenderingContext2D, t: number, dt: number, zoom: number) {
    void zoom; // kept for interface symmetry with drawAreaLabels/frame; unused here
    const { w, h } = this.size();

    // --- Hubs
    for (const hub of HUBS) {
      const p = this.projector(HUB_POS[hub.id]);
      if (!p) continue;
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
        this.drawShieldPin(ctx, pin.x, pin.y, 11, SECTOR_COLORS[rival.sectorId], false, hovered);
        if (hovered) {
          this.tooltip(ctx, pin.x, pin.y - 26, `${rival.name} · ${rival.stageName}`);
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
        if (hovered) this.tooltip(ctx, pin.x, pin.y - 24, ev.name);
      }
    }

    // --- Player HQ pin, drawn last so it sits on top
    if (this.scene.playerHubId && this.scene.mode === 'play') {
      const p = this.projector(HUB_POS[this.scene.playerHubId]);
      if (p) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 0.0035);
        ctx.beginPath();
        ctx.arc(p.x, p.y - 14, 17 + pulse * 4, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(248,195,58,${(0.45 - pulse * 0.25).toFixed(2)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        this.drawShieldPin(ctx, p.x, p.y, 15, PLAYER_COLOR, true, false);
        ctx.font = '800 12px ui-sans-serif, system-ui';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f8c33a';
        ctx.strokeStyle = 'rgba(7,12,26,0.85)';
        ctx.lineWidth = 3;
        const label = this.scene.companyName.toUpperCase();
        ctx.strokeText(label, p.x, p.y - 34);
        ctx.fillText(label, p.x, p.y - 34);
      }
    }

    // --- Particles
    this.stepParticles(ctx, dt);

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
}
