/**
 * RUNWAY: London Live — map overlay renderer.
 *
 * Draws places, offices, people, move paths, timed pins, particles and the
 * minimap on its own canvas over a projected London map renderer.
 */

import { HUBS } from '@/lib/game/content';
import { LANDMARKS, project, THAMES, WORLD, type LandmarkKind, type WorldPoint } from '@/lib/game/geo';
import type { ProjectedMapRenderer } from '@/lib/game/mapProjection';
import type { HubId } from '@/lib/game/types';
import {
  DEFAULT_LANDMARK_PERK,
  FEATURES,
  LANDMARK_PERKS,
  OFFICE_LEVELS,
  SEGMENT_INFO,
} from './content';
import type { AmbientState } from './ambient';
import { personActivity, pitchPreview, unlockedSegments } from './sim';
import { fmtRtsMoney } from './format';
import { defaultStop, summarizePlan, type PlannedLeg, type PlanStop } from './turns';
import type { CompanyId, Lead, MoveTarget, Person, Place, Role, RtsFx, RtsState, Segment } from './types';

export type RtsHit =
  | { type: 'person'; id: string }
  | { type: 'lead'; id: string }
  | { type: 'place'; id: string }
  | { type: 'office'; id: string }
  | { type: 'landmark'; id: LandmarkKind };

type LabelCategory = 'office' | 'investor' | 'lead' | 'place' | 'person';

interface LabelCandidate {
  category: LabelCategory;
  x: number;
  y: number;
  text: string;
  color: string;
  hovered: boolean;
  selected: boolean;
}

interface LabelRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

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

function samePlanTarget(a: MoveTarget, b: MoveTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'point' && b.kind === 'point') return a.x === b.x && a.y === b.y;
  return 'id' in a && 'id' in b && a.id === b.id;
}

interface Particle {
  kind: 'float' | 'confetti' | 'spark' | 'ring';
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
  ambient: AmbientState | null = null;
  profileAmbient = false;
  ambientDrawMs = 0;
  selected = new Set<string>();
  /** Selected place/office/lead (highlighted). */
  focus: RtsHit | null = null;
  hover: RtsHit | null = null;
  /** Screen-space selection box while shift-dragging. */
  box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  plannedLegs: PlannedLeg[] = [];
  planningTooltip: {
    point: WorldPoint;
    title: string;
    travelSlots: number;
    actionSlots: number;
    detail: string;
  } | null = null;
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
  viewHeight(): number {
    return this.zoom() > 0 ? this.cssH / this.zoom() : Number.POSITIVE_INFINITY;
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

  updatePlanningTooltip(hit: RtsHit | null, state: RtsState, stops: PlanStop[]): void {
    if (!hit || state.mode !== 'turns' || hit.type === 'person') {
      this.planningTooltip = null;
      return;
    }
    this.planningTooltip = null;
    let target: MoveTarget | null = null;
    let detail = '';
    if (hit.type === 'place') {
      const place = state.places.find((item) => item.id === hit.id);
      if (!place) return;
      target = { kind: 'place', id: place.id };
      if (place.kind === 'customers')
        detail = `+${Math.floor(place.pool).toLocaleString()} users available`;
      else if (place.kind === 'talent') detail = 'Hire an engineer';
      else {
        const preview = pitchPreview(state, 'player');
        detail = preview.eligible
          ? `Pitch: ${preview.nextStageName} · ${Math.round(preview.odds * 100)}% odds`
          : `Pitch: ${preview.blockers.join(' · ')}`;
      }
    } else if (hit.type === 'office') {
      const office = state.offices.find((item) => item.id === hit.id);
      if (!office) return;
      target = { kind: 'office', id: office.id };
      detail = 'Build at your office';
    } else if (hit.type === 'lead') {
      const lead = state.leads.find((item) => item.id === hit.id);
      if (!lead) return;
      target = { kind: 'lead', id: lead.id };
      detail = lead.clue ? 'Search this clue' : 'Visit this opportunity';
    } else {
      const landmark = LANDMARKS.find((item) => item.kind === hit.id);
      if (!landmark) return;
      const point = project(landmark.at);
      target = { kind: 'point', x: point.x, y: point.y, label: landmark.name };
      detail = this.landmarkBadgeLabel(landmark.kind);
    }
    if (!target) return;
    const candidate = defaultStop(state, target);
    const previousStop = stops[stops.length - 1];
    const alreadyPlanned = previousStop && samePlanTarget(previousStop.target, candidate.target);
    if (alreadyPlanned) detail = 'Already in your plan';
    const summary = summarizePlan(state, [...stops, candidate]);
    const leg = summary.legs[summary.legs.length - 1];
    if (!leg || leg.path.length < 2) {
      this.planningTooltip = null;
      return;
    }
    this.planningTooltip = {
      point: {
        x: leg.path[leg.path.length - 2]!,
        y: leg.path[leg.path.length - 1]!,
      },
      title: leg.label,
      travelSlots: leg.travelSlots,
      actionSlots: candidate.actionSlots,
      detail,
    };
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
      const q = this.w2s(s.mode === 'turns' && lead.clue ? lead.clue : lead);
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
    if (s.mode === 'turns') {
      for (const landmark of LANDMARKS) {
        if (s.journal[landmark.kind] !== undefined) continue;
        const q = this.w2s(project(landmark.at));
        if (!q) continue;
        if (this.viewHeight() > 12) {
          if (near(q.x, q.y, 8)) return { type: 'landmark', id: landmark.kind };
          continue;
        }
        const label = this.landmarkBadgeLabel(landmark.kind);
        const width = Math.max(24, label.length * 5.8 + 12);
        if (near(q.x + 18, q.y - 20, width / 2 + 3))
          return { type: 'landmark', id: landmark.kind };
      }
    }
    return null;
  }

  private isFocused(h: RtsHit) {
    return this.isSelected(h) || this.isHovered(h);
  }

  private isSelected(h: RtsHit) {
    return this.matchesHit(this.focus, h);
  }

  private isHovered(h: RtsHit) {
    return this.matchesHit(this.hover, h);
  }

  private matchesHit(a: RtsHit | null, b: RtsHit) {
    return !!a && a.type === b.type && a.id === b.id;
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

  applyMomentPulse(x: number, y: number): void {
    this.particles.push({
      kind: 'ring',
      wx: x,
      wy: y,
      ox: 0,
      oy: 0,
      vx: 0,
      vy: 0,
      age: 0,
      ttl: 1.1,
      color: '#ef4444',
      size: 8,
    });
  }

  private drawAmbient(width: number, height: number): void {
    const zoom = this.zoom();
    if (!this.ambient || zoom < 7) return;
    const white: { x: number; y: number }[] = [];
    const amber: { x: number; y: number }[] = [];
    const step = zoom < 14 ? 2 : 1;
    for (let index = 0; index < this.ambient.commuters.length; index += step) {
      const commuter = this.ambient.commuters[index]!;
      const point = this.w2s(commuter);
      if (!point || point.x < 0 || point.y < 0 || point.x > width || point.y > height) continue;
      (commuter.cyclist ? amber : white).push(point);
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(15,23,42,0.55)';
    ctx.lineWidth = 1;
    for (const [points, color] of [
      [white, '#f8fafc'],
      [amber, '#fbbf24'],
    ] as const) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const point of points) {
        ctx.moveTo(point.x + 2, point.y);
        ctx.arc(point.x, point.y, 2, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
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
    if (this.profileAmbient) {
      const started = performance.now();
      this.drawAmbient(rect.width, rect.height);
      this.ambientDrawMs = performance.now() - started;
    } else {
      this.drawAmbient(rect.width, rect.height);
      this.ambientDrawMs = 0;
    }
    this.layoutPeople();
    const showLabels = this.zoom() > 6;
    const player = s.companies.player;
    const open = new Set(unlockedSegments(player));
    const labels: LabelCandidate[] = [];
    const addLabel = (
      category: LabelCategory,
      hit: RtsHit,
      x: number,
      y: number,
      text: string,
      color: string,
      selected = false,
    ) => {
      labels.push({
        category,
        x,
        y,
        text,
        color,
        hovered: this.isHovered(hit),
        selected: selected || this.isSelected(hit),
      });
    };

    if (s.mode === 'turns') {
      const showLandmarkBadges = this.viewHeight() <= 12;
      for (const landmark of LANDMARKS) {
        if (s.journal[landmark.kind] !== undefined) continue;
        const q = this.w2s(project(landmark.at));
        if (!q) continue;
        const hit: RtsHit = { type: 'landmark', id: landmark.kind };
        const focused = this.isFocused(hit);
        const label = this.landmarkBadgeLabel(landmark.kind);
        const width = Math.max(24, label.length * 5.8 + 12);
        ctx.beginPath();
        ctx.arc(q.x, q.y, focused ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = focused ? '#fef3c7' : '#fbbf24';
        ctx.fill();
        if (!showLandmarkBadges) continue;
        ctx.save();
        ctx.font = '700 9px ui-sans-serif, system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(11,18,38,0.95)';
        ctx.strokeStyle = focused ? '#fef3c7' : 'rgba(251,191,36,0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(q.x + 18 - width / 2, q.y - 20 - 8, width, 16, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fde68a';
        ctx.fillText(label, q.x + 18, q.y - 20);
        ctx.restore();
      }
    }

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
        addLabel(
          place.kind === 'investor' ? 'investor' : 'place',
          hit,
          q.x,
          q.y + (place.kind === 'customers' ? 17 : 13),
          place.name,
          locked ? '#94a3b8' : '#e2e8f0',
        );
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
      if (showLabels || focused) {
        addLabel(
          'office',
          { type: 'office', id: office.id },
          q.x,
          q.y + 13,
          `${c.name} · ${office.siteName ?? OFFICE_LEVELS[office.level].name}`,
          office.company === 'player' ? '#fde68a' : '#e2e8f0',
        );
      }
    }

    // Leads with countdown rings
    for (const lead of s.leads) {
      const clue = s.mode === 'turns' ? lead.clue : undefined;
      const q = this.w2s(clue ?? lead);
      if (!q) continue;
      const st = LEAD_STYLE[lead.kind];
      const hit: RtsHit = { type: 'lead', id: lead.id };
      const focused = this.isFocused(hit);
      if (clue) {
        const edge = this.w2s({ x: clue.x + clue.radius, y: clue.y });
        const radius = edge ? Math.hypot(edge.x - q.x, edge.y - q.y) : 0;
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([7, 5]);
        ctx.arc(q.x, q.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = hexA(st.color, focused ? 0.95 : 0.65);
        ctx.lineWidth = focused ? 2.5 : 1.8;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(q.x, q.y, 13, 0, Math.PI * 2);
        ctx.fillStyle = '#0b1226';
        ctx.fill();
        ctx.strokeStyle = focused ? '#ffffff' : st.color;
        ctx.lineWidth = focused ? 2.5 : 2;
        ctx.stroke();
        ctx.fillStyle = st.color;
        ctx.font = '900 17px ui-sans-serif, system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', q.x, q.y + 0.5);
        ctx.restore();
        if (focused) addLabel('lead', hit, q.x, q.y - radius - 8, clue.hint, st.color);
        continue;
      }
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
      if (showLabels || focused) {
        const text =
          focused || !showLabels
            ? `${st.label}: ${lead.name} · ${Math.max(0, lead.expiresDay - s.day).toFixed(1)}d left`
            : `${st.label}: ${lead.name}`;
        addLabel('lead', hit, q.x, q.y - 22, text, st.color);
      }
    }

    for (let index = 0; index < this.plannedLegs.length; index++) {
      const leg = this.plannedLegs[index]!;
      if (leg.path.length < 2) continue;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([9, 6]);
      ctx.lineDashOffset = -(t * 0.02) % 15;
      ctx.strokeStyle = 'rgba(251,191,36,0.8)';
      ctx.lineWidth = 2.5;
      let started = false;
      for (let i = 0; i < leg.path.length; i += 2) {
        const point = this.w2s({ x: leg.path[i]!, y: leg.path[i + 1]! });
        if (!point) continue;
        if (!started) {
          ctx.moveTo(point.x, point.y);
          started = true;
        } else ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      const destination = this.w2s({
        x: leg.path[leg.path.length - 2]!,
        y: leg.path[leg.path.length - 1]!,
      });
      if (destination) {
        ctx.beginPath();
        ctx.arc(destination.x, destination.y, 11, 0, Math.PI * 2);
        ctx.fillStyle = '#fbbf24';
        ctx.fill();
        ctx.strokeStyle = '#0b1226';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#0b1226';
        ctx.font = '900 11px ui-sans-serif, system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${index + 1}`, destination.x, destination.y + 0.5);
      }
      ctx.restore();
    }

    // Move paths (player people)
    for (const p of s.people) {
      if (!p.order || p.company !== 'player') continue;
      const order = p.order;
      const route: WorldPoint[] = [{ x: p.x, y: p.y }];
      let travelled = 0;
      for (let i = 2; i < order.path.length; i += 2) {
        travelled += Math.hypot(order.path[i]! - order.path[i - 2]!, order.path[i + 1]! - order.path[i - 1]!);
        if (travelled > order.length * order.progress) {
          route.push({ x: order.path[i]!, y: order.path[i + 1]! });
        }
      }
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -(t * 0.03) % 12;
      ctx.strokeStyle = this.selected.has(p.id) ? 'rgba(74,222,128,0.95)' : 'rgba(248,195,58,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 1; i < route.length; i++) {
        const a = this.w2s(route[i - 1]!);
        const b = this.w2s(route[i]!);
        if (!a || !b) continue;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      ctx.restore();
      const destination = this.w2s({ x: order.toX, y: order.toY });
      if (destination) {
        ctx.beginPath();
        ctx.arc(destination.x, destination.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(248,195,58,0.85)';
        ctx.fill();
      }
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
      if (mine ? showLabels || sel || hov : hov) {
        const text = hov
          ? `${p.name} (${c.name} ${ROLE_LABEL[p.role].toLowerCase()}) · ${act.text}`
          : sel
            ? `${p.name} · ${act.text}`
            : p.name;
        addLabel('person', { type: 'person', id: p.id }, q.x, q.y - 16, text, mine ? '#e2e8f0' : '#cbd5e1', sel);
      }
    }

    this.drawLabels(labels);
    if (s.mode === 'turns' && this.planningTooltip) {
      const point = this.w2s(this.planningTooltip.point);
      const alreadyPlanned = this.planningTooltip.detail === 'Already in your plan';
      if (point)
        this.drawPlanningTooltip(point.x, point.y - 10, [
          this.planningTooltip.title,
          alreadyPlanned
            ? this.planningTooltip.detail
            : `${this.planningTooltip.travelSlots} travel + ${this.planningTooltip.actionSlots} action slots`,
          ...(alreadyPlanned ? [] : [this.planningTooltip.detail]),
        ]);
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

  private landmarkBadgeLabel(kind: LandmarkKind): string {
    const perk = LANDMARK_PERKS[kind] ?? DEFAULT_LANDMARK_PERK;
    if (perk.cash) return `+${fmtRtsMoney(perk.cash)}`;
    if (perk.users) return `+${perk.users} users`;
    if (perk.product) return `+${perk.product} product`;
    return `+${perk.hype ?? DEFAULT_LANDMARK_PERK.hype} hype`;
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

  private drawLabels(labels: LabelCandidate[]) {
    const ctx = this.ctx;
    const categoryPriority: Record<LabelCategory, number> = {
      office: 0,
      investor: 1,
      lead: 2,
      place: 3,
      person: 4,
    };
    const priority = (label: LabelCandidate) =>
      label.hovered ? 0 : label.selected ? 1 : 2 + categoryPriority[label.category];
    labels.sort((a, b) => priority(a) - priority(b));

    ctx.font = '700 10.5px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    const accepted: LabelRect[] = [];
    for (const label of labels) {
      const metrics = ctx.measureText(label.text);
      const padding = 4;
      const rect: LabelRect = {
        left: label.x - metrics.width / 2 - padding,
        right: label.x + metrics.width / 2 + padding,
        top: label.y - (metrics.actualBoundingBoxAscent || 10.5) - padding,
        bottom: label.y + (metrics.actualBoundingBoxDescent || 3) + padding,
      };
      const overlaps = accepted.some(
        (other) =>
          rect.left < other.right &&
          rect.right > other.left &&
          rect.top < other.bottom &&
          rect.bottom > other.top,
      );
      if (overlaps && !label.hovered) continue;
      this.label(label.x, label.y, label.text, label.color);
      accepted.push(rect);
    }
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

  private drawPlanningTooltip(x: number, y: number, lines: string[]): void {
    const ctx = this.ctx;
    const lineHeight = 14;
    const padding = 7;
    ctx.font = '700 11px ui-sans-serif, system-ui';
    const maxTextWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
    const width = Math.min(this.cssW - 12, maxTextWidth + padding * 2);
    const height = lineHeight * lines.length + padding * 2;
    const bx = Math.min(Math.max(x - width / 2, 6), this.cssW - width - 6);
    const by = Math.min(Math.max(y - height - 8, 6), this.cssH - height - 6);
    ctx.save();
    ctx.fillStyle = 'rgba(10,17,36,0.97)';
    ctx.strokeStyle = 'rgba(125,211,252,0.65)';
    ctx.beginPath();
    ctx.roundRect(bx, by, width, height, 6);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((line, index) => {
      ctx.font = index === 0 ? '800 11px ui-sans-serif, system-ui' : '600 10px ui-sans-serif, system-ui';
      ctx.fillStyle = index === 0 ? '#f8fafc' : index === 1 ? '#bae6fd' : '#fde68a';
      ctx.fillText(line, bx + padding, by + padding + index * lineHeight, width - padding * 2);
    });
    ctx.restore();
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
      } else if (p.kind === 'ring') {
        const progress = p.age / p.ttl;
        ctx.beginPath();
        ctx.arc(x, y, p.size + progress * 34, 0, Math.PI * 2);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3 * (1 - progress);
        ctx.stroke();
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
