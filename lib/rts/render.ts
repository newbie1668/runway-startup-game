/**
 * RUNWAY: London Live — map overlay renderer.
 *
 * Draws places, offices, people, move paths, timed pins, particles and the
 * minimap on its own canvas over a projected London map renderer.
 */

import { HUBS } from '@/lib/game/content';
import { project, THAMES, WORLD, type WorldPoint } from '@/lib/game/geo';
import type { ProjectedMapRenderer } from '@/lib/game/mapProjection';
import type { HubId } from '@/lib/game/types';
import { FEATURES, OFFICE_LEVELS, SEGMENT_INFO } from './content';
import { personActivity, unlockedSegments } from './sim';
import type { CompanyId, Lead, Person, Place, Role, RtsFx, RtsState, Segment } from './types';

export type RtsHit =
  | { type: 'person'; id: string }
  | { type: 'lead'; id: string }
  | { type: 'place'; id: string }
  | { type: 'office'; id: string };

export const HUB_WORLD: Record<HubId, WorldPoint> = Object.fromEntries(
  HUBS.map((h) => [h.id, project([h.lng, h.lat])]),
) as Record<HubId, WorldPoint>;

const PERSON_R = 10;
const COMPANY_ORDER: CompanyId[] = ['player', 'rival1', 'rival2', 'rival3'];

export const ROLE_LABEL: Record<Role, string> = {
  founder: 'Founder',
  engineer: 'Engineer',
  growth: 'Growth',
};
export const ROLE_ICON: Record<Role, string> = { founder: '🧑‍💼', engineer: '🧑‍💻', growth: '📣' };

export const SEGMENT_ICON: Record<Segment, string> = {
  earlyAdopters: '✨',
  consumers: '🛍️',
  smb: '🏪',
  developers: '⌨️',
  enterprise: '🏦',
};

export const LEAD_STYLE: Record<Lead['kind'], { color: string; icon: string; label: string }> = {
  meetup: { color: '#7dd3fc', icon: '🍕', label: 'Meetup' },
  candidate: { color: '#a3e635', icon: '🙋', label: 'Candidate' },
  journalist: { color: '#f472b6', icon: '📰', label: 'Journalist' },
  angel: { color: '#fbbf24', icon: '😇', label: 'Angel' },
};

/** Which feature unlocks a segment (undefined = open from day one). */
export function featureForSegment(segment: Segment) {
  return FEATURES.find((f) => f.unlocks === segment);
}

export function placeIcon(place: Place): string {
  if (place.kind === 'talent') return '🎓';
  if (place.kind === 'investor') return '💷';
  return SEGMENT_ICON[place.segment];
}

interface Particle {
  kind: 'float' | 'confetti' | 'spark';
  wx: number;
  wy: number;
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  age: number;
  ttl: number;
  color: string;
  text?: string;
  size: number;
}

export class RtsRenderer {
  map: ProjectedMapRenderer;
  atmosphere: 'day' | 'night' = 'night';
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  state: RtsState | null = null;
  selected = new Set<string>();
  /** Selected place/office/lead (highlighted). */
  focus: RtsHit | null = null;
  hover: RtsHit | null = null;
  /** Screen-space selection box while shift-dragging. */
  box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private particles: Particle[] = [];
  private personScreen = new Map<string, { x: number; y: number }>();

  constructor(canvas: HTMLCanvasElement, map: ProjectedMapRenderer) {
    this.canvas = canvas;
    this.map = map;
    this.ctx = canvas.getContext('2d')!;
  }

  // --- camera helpers -------------------------------------------------------
  private get cssW() {
    return this.canvas.getBoundingClientRect().width;
  }
  private get cssH() {
    return this.canvas.getBoundingClientRect().height;
  }
  zoom(): number {
    return this.map.getCamera().zoom;
  }
  w2s(p: WorldPoint) {
    return this.map.worldToScreen(p);
  }
  centerOn(p: WorldPoint) {
    this.map.lookAt(p.x, p.y);
  }
  viewCorners(): WorldPoint[] {
    return [
      this.map.screenToWorld(0, 0),
      this.map.screenToWorld(this.cssW, 0),
      this.map.screenToWorld(this.cssW, this.cssH),
      this.map.screenToWorld(0, this.cssH),
    ];
  }

  private anchorOf(id: string): WorldPoint | null {
    const s = this.state!;
    return s.places.find((p) => p.id === id) ?? s.offices.find((o) => o.id === id) ?? null;
  }

  // --- layout ---------------------------------------------------------------
  /** People standing at the same place fan out in a ring below/around its pin. */
  private layoutPeople() {
    this.personScreen.clear();
    const s = this.state;
    if (!s) return;
    const groups = new Map<string, Person[]>();
    for (const p of s.people) {
      if (p.at && !p.order) {
        const list = groups.get(p.at) ?? [];
        list.push(p);
        groups.set(p.at, list);
      } else {
        const q = this.w2s(p);
        if (q) this.personScreen.set(p.id, q);
      }
    }
    for (const [at, list] of groups) {
      const anchor = this.anchorOf(at);
      if (!anchor) continue;
      list.sort((a, b) => COMPANY_ORDER.indexOf(a.company) - COMPANY_ORDER.indexOf(b.company));
      const c = this.w2s(anchor);
      if (!c) continue;
      const rings = [
        { n: 6, r: 26 },
        { n: 11, r: 44 },
        { n: 40, r: 62 },
      ];
      let i = 0;
      for (const ring of rings) {
        for (let k = 0; k < ring.n && i < list.length; k++, i++) {
          const a = Math.PI / 2 + ((k + 0.5) / ring.n) * Math.PI * 2;
          this.personScreen.set(list[i].id, {
            x: c.x + Math.cos(a) * ring.r,
            y: c.y + 4 + Math.sin(a) * ring.r * 0.75,
          });
        }
      }
    }
  }

  peopleInBox(x0: number, y0: number, x1: number, y1: number): string[] {
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    const out: string[] = [];
    for (const p of this.state?.people ?? []) {
      if (p.company !== 'player') continue;
      const q = this.personScreen.get(p.id);
      if (q && q.x >= ax && q.x <= bx && q.y >= ay && q.y <= by) out.push(p.id);
    }
    return out;
  }

  hitTest(sx: number, sy: number): RtsHit | null {
    const s = this.state;
    if (!s) return null;
    const near = (x: number, y: number, r: number) => (sx - x) ** 2 + (sy - y) ** 2 <= r * r;
    for (let i = s.people.length - 1; i >= 0; i--) {
      const q = this.personScreen.get(s.people[i].id);
      if (q && near(q.x, q.y, PERSON_R + 3)) return { type: 'person', id: s.people[i].id };
    }
    for (const lead of s.leads) {
      const q = this.w2s(lead);
      if (!q) continue;
      if (near(q.x, q.y, 16)) return { type: 'lead', id: lead.id };
    }
    for (const place of s.places) {
      const q = this.w2s(place);
      if (!q) continue;
      if (near(q.x, q.y - 12, 17)) return { type: 'place', id: place.id };
    }
    for (const office of s.offices) {
      const q = this.w2s(office);
      if (!q) continue;
      if (near(q.x, q.y - 10, 18)) return { type: 'office', id: office.id };
    }
    return null;
  }

  private isFocused(h: RtsHit) {
    const eq = (a: RtsHit | null) => !!a && a.type === h.type && a.id === h.id;
    return eq(this.focus) || eq(this.hover);
  }

  // --- fx -------------------------------------------------------------------
  applyFx(fx: RtsFx[]) {
    for (const f of fx) {
      if (f.kind === 'float') {
        this.particles.push({
          kind: 'float',
          wx: f.x,
          wy: f.y,
          ox: (Math.random() - 0.5) * 24,
          oy: -22,
          vx: 0,
          vy: -26,
          age: 0,
          ttl: 2.2,
          color: f.color ?? '#4ade80',
          text: f.text,
          size: 14,
        });
      } else if (f.kind === 'confetti' || f.kind === 'sparkle') {
        const confetti = f.kind === 'confetti';
        const n = confetti ? 90 : 24;
        const colors = confetti ? ['#f8c33a', '#7dd3fc', '#f472b6', '#a3e635', '#a78bfa', '#ffffff'] : ['#fde68a'];
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = (confetti ? 90 : 40) + Math.random() * 220;
          this.particles.push({
            kind: confetti ? 'confetti' : 'spark',
            wx: f.x,
            wy: f.y,
            ox: 0,
            oy: 0,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp - (confetti ? 140 : 0),
            age: 0,
            ttl: confetti ? 1.8 + Math.random() : 0.9,
            color: colors[i % colors.length],
            size: confetti ? 4 + Math.random() * 4 : 2 + Math.random() * 2,
          });
        }
      }
    }
  }

  // --- frame ----------------------------------------------------------------
  frame(t: number, dt: number) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, rect.width, rect.height);
    const s = this.state;
    if (!s) return;
    const ctx = this.ctx;
    this.layoutPeople();
    const showLabels = this.zoom() > 6;
    const player = s.companies.player;
    const open = new Set(unlockedSegments(player));

    // Places
    for (const place of s.places) {
      const q = this.w2s(place);
      if (!q) continue;
      const hit: RtsHit = { type: 'place', id: place.id };
      const focused = this.isFocused(hit);
      const locked = place.kind === 'customers' && !open.has(place.segment);
      const color =
        place.kind === 'talent' ? '#a3e635' : place.kind === 'investor' ? '#fbbf24' : locked ? '#64748b' : '#38bdf8';
      this.drawPin(q.x, q.y, color, placeIcon(place), focused, locked);
      if (place.kind === 'customers') {
        const k = place.poolMax > 0 ? place.pool / place.poolMax : 0;
        ctx.fillStyle = 'rgba(15,23,42,0.9)';
        ctx.fillRect(q.x - 14, q.y + 3, 28, 4);
        ctx.fillStyle = locked ? '#475569' : k < 0.25 ? '#f87171' : '#38bdf8';
        ctx.fillRect(q.x - 14, q.y + 3, 28 * k, 4);
      }
      if (showLabels || focused) {
        this.label(q.x, q.y + (place.kind === 'customers' ? 17 : 13), place.name, locked ? '#94a3b8' : '#e2e8f0');
      }
      if (focused && locked) {
        const f = featureForSegment(place.segment);
        if (f) this.tooltip(q.x, q.y - 34, `🔒 Ship “${f.name}” to sell to ${SEGMENT_INFO[place.segment].name}`);
      }
    }

    // Offices
    for (const office of s.offices) {
      const c = s.companies[office.company];
      if (!c?.alive) continue;
      const q = this.w2s(office);
      if (!q) continue;
      const focused = this.isFocused({ type: 'office', id: office.id });
      this.drawOffice(q.x, q.y, c.color, office.level, focused, office.company === 'player');
      if (office.company === 'player' && (showLabels || focused)) {
        this.label(q.x, q.y + 13, `${c.name} · ${OFFICE_LEVELS[office.level].name}`, '#fde68a');
      } else if (focused) {
        this.label(q.x, q.y + 13, `${c.name} · ${OFFICE_LEVELS[office.level].name}`, '#e2e8f0');
      }
    }

    // Leads with countdown rings
    for (const lead of s.leads) {
      const q = this.w2s(lead);
      if (!q) continue;
      const st = LEAD_STYLE[lead.kind];
      const life = Math.max(1e-6, lead.expiresDay - lead.spawnDay);
      const left = Math.max(0, Math.min(1, (lead.expiresDay - s.day) / life));
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.005 + q.x);
      ctx.beginPath();
      ctx.arc(q.x, q.y, 14 + pulse * 7, 0, Math.PI * 2);
      ctx.strokeStyle = hexA(st.color, 0.5 - pulse * 0.35);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(q.x, q.y, 11, 0, Math.PI * 2);
      ctx.fillStyle = '#0b1226';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(q.x, q.y, 13, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2);
      ctx.strokeStyle = left < 0.3 ? '#f87171' : st.color;
      ctx.lineWidth = 3;
      ctx.stroke();
      this.emoji(st.icon, q.x, q.y, 13);
      if (this.isFocused({ type: 'lead', id: lead.id })) {
        this.tooltip(q.x, q.y - 22, `${st.label}: ${lead.name} · ${Math.max(0, lead.expiresDay - s.day).toFixed(1)}d left`);
      }
    }

    // Move paths (player people)
    for (const p of s.people) {
      if (!p.order || p.company !== 'player') continue;
      const a = this.w2s(p);
      const b = this.w2s({ x: p.order.toX, y: p.order.toY });
      if (!a || !b) continue;
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -(t * 0.03) % 12;
      ctx.strokeStyle = this.selected.has(p.id) ? 'rgba(74,222,128,0.95)' : 'rgba(248,195,58,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(248,195,58,0.85)';
      ctx.fill();
    }

    // People
    for (const p of s.people) {
      const q = this.personScreen.get(p.id);
      const c = s.companies[p.company];
      if (!q || !c) continue;
      const mine = p.company === 'player';
      const sel = this.selected.has(p.id);
      const hov = this.hover?.type === 'person' && this.hover.id === p.id;
      const act = personActivity(s, p);
      if (act.working) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 0.008 + q.x * 0.3);
        ctx.beginPath();
        ctx.arc(q.x, q.y, PERSON_R + 2 + pulse * 4, 0, Math.PI * 2);
        ctx.strokeStyle = hexA(c.color, 0.25 + 0.3 * (1 - pulse));
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (sel) {
        ctx.beginPath();
        ctx.ellipse(q.x, q.y + 7, PERSON_R + 6, (PERSON_R + 6) * 0.5, 0, 0, Math.PI * 2);
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      ctx.save();
      ctx.shadowColor = mine ? c.color : 'transparent';
      ctx.shadowBlur = sel || hov ? 12 : 4;
      ctx.beginPath();
      ctx.arc(q.x, q.y, PERSON_R, 0, Math.PI * 2);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(q.x, q.y, PERSON_R, 0, Math.PI * 2);
      ctx.strokeStyle = c.color;
      ctx.lineWidth = mine ? 3 : 2;
      ctx.stroke();
      this.emoji(ROLE_ICON[p.role], q.x, q.y + 0.5, p.role === 'founder' ? 13 : 11.5);
      if (hov) {
        this.tooltip(q.x, q.y - 16, `${p.name} (${c.name} ${ROLE_LABEL[p.role].toLowerCase()}) · ${act.text}`);
      }
    }

    this.stepParticles(dt);

    if (this.box) {
      const { x0, y0, x1, y1 } = this.box;
      ctx.fillStyle = 'rgba(74,222,128,0.1)';
      ctx.strokeStyle = 'rgba(74,222,128,0.85)';
      ctx.lineWidth = 1.2;
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    }
  }

  // --- primitives -------------------------------------------------------------
  private emoji(text: string, x: number, y: number, size: number) {
    const ctx = this.ctx;
    ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.textBaseline = 'alphabetic';
  }

  /** Map pin: a rounded badge on a short stem, anchored at (x, y). */
  private drawPin(x: number, y: number, color: string, icon: string, focused: boolean, muted: boolean) {
    const ctx = this.ctx;
    const by = y - 13;
    ctx.save();
    ctx.shadowColor = muted ? 'transparent' : color;
    ctx.shadowBlur = focused ? 16 : 6;
    ctx.beginPath();
    ctx.moveTo(x - 4, by + 9);
    ctx.lineTo(x, y);
    ctx.lineTo(x + 4, by + 9);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(x - 12, by - 11, 24, 22, 7);
    ctx.fillStyle = '#0b1226';
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.roundRect(x - 12, by - 11, 24, 22, 7);
    ctx.strokeStyle = focused ? '#ffffff' : color;
    ctx.lineWidth = focused ? 2.5 : 2;
    ctx.stroke();
    ctx.globalAlpha = muted ? 0.45 : 1;
    this.emoji(icon, x, by + 0.5, 13);
    ctx.globalAlpha = 1;
    if (muted) this.emoji('🔒', x + 11, by - 10, 9);
  }

  private drawOffice(x: number, y: number, color: string, level: number, focused: boolean, mine: boolean) {
    const ctx = this.ctx;
    const w = [14, 16, 18, 22][level] ?? 22;
    const h = [9, 14, 22, 32][level] ?? 32;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = focused ? 18 : mine ? 10 : 4;
    ctx.fillStyle = hexA(color, 0.95);
    if (level === 0) {
      // kitchen table: a little house
      ctx.beginPath();
      ctx.moveTo(x - w / 2 - 2, y - h);
      ctx.lineTo(x, y - h - 8);
      ctx.lineTo(x + w / 2 + 2, y - h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillRect(x - w / 2, y - h, w, h);
    ctx.restore();
    ctx.strokeStyle = focused ? '#ffffff' : '#0a1124';
    ctx.lineWidth = focused ? 2 : 1.2;
    ctx.strokeRect(x - w / 2, y - h, w, h);
    ctx.fillStyle = 'rgba(10,17,36,0.7)';
    for (let wy = y - h + 3; wy < y - 3; wy += 5) {
      for (let wx = x - w / 2 + 3; wx < x + w / 2 - 3; wx += 5) ctx.fillRect(wx, wy, 2.5, 2.5);
    }
  }

  private label(x: number, y: number, text: string, color: string) {
    const ctx = this.ctx;
    ctx.font = '700 10.5px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = this.atmosphere === 'day' ? '#fff' : 'rgba(5,9,20,0.9)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = this.atmosphere === 'day' ? '#0f172a' : color;
    ctx.fillText(text, x, y);
  }

  private tooltip(x: number, y: number, text: string) {
    const ctx = this.ctx;
    ctx.font = '600 11.5px ui-sans-serif, system-ui';
    const bw = ctx.measureText(text).width + 14;
    const bx = Math.min(Math.max(x - bw / 2, 6), this.cssW - bw - 6);
    ctx.fillStyle = 'rgba(10,17,36,0.95)';
    ctx.strokeStyle = 'rgba(125,211,252,0.45)';
    ctx.beginPath();
    ctx.roundRect(bx, y - 18, bw, 22, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'left';
    ctx.fillText(text, bx + 7, y - 3);
    ctx.textAlign = 'center';
  }

  private stepParticles(dt: number) {
    const ctx = this.ctx;
    this.particles = this.particles.filter((p) => p.age < p.ttl);
    for (const p of this.particles) {
      p.age += dt;
      if (p.kind === 'confetti') {
        p.vy += 380 * dt;
        p.vx *= 1 - 1.4 * dt;
      } else if (p.kind === 'spark') {
        p.vx *= 1 - 3 * dt;
        p.vy *= 1 - 3 * dt;
      }
      p.ox += p.vx * dt;
      p.oy += p.vy * dt;
      const b = this.w2s({ x: p.wx, y: p.wy });
      if (!b) continue;
      const x = b.x + p.ox;
      const y = b.y + p.oy;
      const k = p.age / p.ttl;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.kind === 'float' ? Math.min(1, 3 - 3 * k) : 1 - k);
      if (p.kind === 'float' && p.text) {
        ctx.font = `800 ${p.size}px ui-sans-serif, system-ui`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(7,12,26,0.9)';
        ctx.strokeText(p.text, x, y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, x, y);
      } else if (p.kind === 'spark') {
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(x - p.size / 2, y - p.size / 4, p.size, p.size / 2);
      }
      ctx.restore();
    }
  }

  // --- minimap --------------------------------------------------------------
  drawMinimap(mini: HTMLCanvasElement) {
    const s = this.state;
    const mctx = mini.getContext('2d');
    if (!mctx || !s) return;
    const rect = mini.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (mini.width !== Math.round(rect.width * dpr)) {
      mini.width = Math.round(rect.width * dpr);
      mini.height = Math.round(rect.height * dpr);
    }
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { k, ox, oy } = miniFit(rect);
    const m = (p: WorldPoint) => ({ x: ox + p.x * k, y: oy + p.y * k });
    mctx.fillStyle = '#070c1a';
    mctx.fillRect(0, 0, rect.width, rect.height);
    mctx.beginPath();
    THAMES_W.forEach((p, i) => {
      const q = m(p);
      if (i) mctx.lineTo(q.x, q.y);
      else mctx.moveTo(q.x, q.y);
    });
    mctx.strokeStyle = 'rgba(56,104,180,0.9)';
    mctx.lineWidth = 2.5;
    mctx.stroke();
    for (const place of s.places) {
      const q = m(place);
      mctx.fillStyle = place.kind === 'talent' ? '#a3e635' : place.kind === 'investor' ? '#fbbf24' : '#38bdf8';
      mctx.globalAlpha = 0.6;
      mctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3);
      mctx.globalAlpha = 1;
    }
    for (const o of s.offices) {
      const q = m(o);
      mctx.fillStyle = s.companies[o.company]?.color ?? '#fff';
      mctx.fillRect(q.x - 2.5, q.y - 2.5, 5, 5);
    }
    for (const p of s.people) {
      const q = m(p);
      mctx.fillStyle = s.companies[p.company]?.color ?? '#fff';
      mctx.beginPath();
      mctx.arc(q.x, q.y, p.company === 'player' ? 2 : 1.4, 0, Math.PI * 2);
      mctx.fill();
    }
    for (const lead of s.leads) {
      const q = m(lead);
      mctx.strokeStyle = LEAD_STYLE[lead.kind].color;
      mctx.beginPath();
      mctx.arc(q.x, q.y, 3, 0, Math.PI * 2);
      mctx.stroke();
    }
    const corners = this.viewCorners().map(m);
    mctx.beginPath();
    corners.forEach((p, i) => {
      if (i === 0) mctx.moveTo(p.x, p.y);
      else mctx.lineTo(p.x, p.y);
    });
    mctx.closePath();
    mctx.strokeStyle = 'rgba(226,232,240,0.85)';
    mctx.lineWidth = 1;
    mctx.stroke();
  }

  minimapToWorld(mini: HTMLCanvasElement, mx: number, my: number): WorldPoint {
    const { k, ox, oy } = miniFit(mini.getBoundingClientRect());
    return { x: (mx - ox) / k, y: (my - oy) / k };
  }
}

const THAMES_W = THAMES.map(project);

function miniFit(rect: { width: number; height: number }) {
  const k = Math.min(rect.width / WORLD.width, rect.height / WORLD.height);
  return { k, ox: (rect.width - WORLD.width * k) / 2, oy: (rect.height - WORLD.height * k) / 2 };
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}
