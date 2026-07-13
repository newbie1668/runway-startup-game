/**
 * Illustrated isometric drawing helpers — diorama-style facades, not flat boxes.
 */

import type { ScreenPoint } from './iso';
import type { HubId } from './types';

export interface IsoBuildingColors {
  roof: string;
  left: string;
  right: string;
  accent?: string;
}

export interface HubVisualTheme {
  gag?: string;
  plaza: string;
  plazaStroke: string;
  buildingStyle: 'brick-loft' | 'glass-tower' | 'terrace' | 'warehouse' | 'market' | 'campus' | 'industrial' | 'riverside';
}

export const HUB_THEMES: Record<HubId, HubVisualTheme> = {
  shoreditch: { gag: '☕', plaza: '#b8c9a8', plazaStroke: '#8aa67a', buildingStyle: 'brick-loft' },
  kingscross: { gag: '🧠', plaza: '#a8b8c9', plazaStroke: '#7a8aa6', buildingStyle: 'campus' },
  soho: { gag: '🎬', plaza: '#c9b0b8', plazaStroke: '#a67a8a', buildingStyle: 'terrace' },
  farringdon: { gag: '🚇', plaza: '#b8c0a8', plazaStroke: '#8a967a', buildingStyle: 'warehouse' },
  canarywharf: { gag: '🏦', plaza: '#a8c4d4', plazaStroke: '#6a94b4', buildingStyle: 'glass-tower' },
  londonbridge: { gag: '🥪', plaza: '#c4b8a8', plazaStroke: '#968a7a', buildingStyle: 'riverside' },
  camden: { gag: '🎸', plaza: '#c0c9a8', plazaStroke: '#8a9670', buildingStyle: 'market' },
  battersea: { gag: '⚡', plaza: '#b0c9c0', plazaStroke: '#7a968a', buildingStyle: 'industrial' },
};

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, ((n >> 16) & 0xff) + amount));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (n & 0xff) + amount));
  return `rgb(${r},${g},${b})`;
}

function drawFacadeWindows(
  ctx: CanvasRenderingContext2D,
  base: ScreenPoint,
  hw: number,
  rise: number,
  face: 'left' | 'right',
  lit: string,
) {
  const cols = 3;
  const rows = Math.max(2, Math.floor(rise / 14));
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const t = (col + 1) / (cols + 1);
      const v = (row + 1) / (rows + 1);
      const wx = face === 'left' ? base.x - hw * (1 - t * 0.85) : base.x + hw * (1 - t * 0.85);
      const wy = base.y - rise * v;
      ctx.fillStyle = lit;
      ctx.fillRect(wx - 2, wy - 3, 4, 5);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(wx - 2, wy - 3, 2, 2);
    }
  }
}

function drawRoofDetail(
  ctx: CanvasRenderingContext2D,
  base: ScreenPoint,
  hw: number,
  hd: number,
  rise: number,
  style: HubVisualTheme['buildingStyle'],
  accent: string,
) {
  if (style === 'glass-tower') {
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const y = base.y - rise + i * (rise / 4);
      ctx.beginPath();
      ctx.moveTo(base.x - hw * 0.7, y);
      ctx.lineTo(base.x + hw * 0.7, y);
      ctx.stroke();
    }
    ctx.fillStyle = accent;
    ctx.fillRect(base.x - 1, base.y - hd - rise - 8, 2, 8);
  } else if (style === 'brick-loft') {
    ctx.fillStyle = '#6b4f3a';
    ctx.fillRect(base.x - hw * 0.3, base.y - hd - rise - 4, hw * 0.6, 4);
  } else if (style === 'market') {
    ctx.fillStyle = '#e879f9';
    ctx.beginPath();
    ctx.moveTo(base.x - hw * 0.5, base.y - hd - rise);
    ctx.lineTo(base.x, base.y - hd - rise - 10);
    ctx.lineTo(base.x + hw * 0.5, base.y - hd - rise);
    ctx.closePath();
    ctx.fill();
  }
}

export function drawHubPlaza(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  theme: HubVisualTheme,
  zoom: number,
) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - ry);
  ctx.lineTo(cx + rx, cy);
  ctx.lineTo(cx, cy + ry);
  ctx.lineTo(cx - rx, cy);
  ctx.closePath();
  ctx.fillStyle = theme.plaza;
  ctx.fill();
  ctx.strokeStyle = theme.plazaStroke;
  ctx.lineWidth = Math.max(1, zoom * 0.8);
  ctx.stroke();

  // Cobble cross-hatch
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 1;
  const step = Math.max(6, 10 * zoom);
  for (let x = cx - rx; x < cx + rx; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, cy - ry);
    ctx.lineTo(x + ry, cy + ry);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawIllustratedBuilding(
  ctx: CanvasRenderingContext2D,
  base: ScreenPoint,
  hw: number,
  hd: number,
  rise: number,
  colors: IsoBuildingColors,
  style: HubVisualTheme['buildingStyle'],
  options: {
    kind: 'player' | 'rival' | 'neutral' | 'event';
    gag?: string;
    companyName?: string;
    hover: boolean;
  },
) {
  const leftDark = shade(colors.left, -18);
  const rightDark = shade(colors.right, -22);
  const roofDark = shade(colors.roof, -15);

  // Drop shadow on plaza
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.ellipse(base.x, base.y + hd * 0.35, hw * 1.1, hd * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  // Left face
  ctx.beginPath();
  ctx.moveTo(base.x - hw, base.y);
  ctx.lineTo(base.x, base.y + hd);
  ctx.lineTo(base.x, base.y + hd - rise);
  ctx.lineTo(base.x - hw, base.y - rise);
  ctx.closePath();
  const leftGrad = ctx.createLinearGradient(base.x - hw, base.y, base.x, base.y);
  leftGrad.addColorStop(0, leftDark);
  leftGrad.addColorStop(1, colors.left);
  ctx.fillStyle = leftGrad;
  ctx.fill();
  drawFacadeWindows(ctx, base, hw, rise, 'left', 'rgba(255,255,220,0.55)');

  // Right face
  ctx.beginPath();
  ctx.moveTo(base.x + hw, base.y);
  ctx.lineTo(base.x, base.y + hd);
  ctx.lineTo(base.x, base.y + hd - rise);
  ctx.lineTo(base.x + hw, base.y - rise);
  ctx.closePath();
  const rightGrad = ctx.createLinearGradient(base.x, base.y, base.x + hw, base.y);
  rightGrad.addColorStop(0, colors.right);
  rightGrad.addColorStop(1, rightDark);
  ctx.fillStyle = rightGrad;
  ctx.fill();
  drawFacadeWindows(ctx, base, hw, rise, 'right', 'rgba(255,255,220,0.4)');

  // Roof
  ctx.beginPath();
  ctx.moveTo(base.x, base.y - hd - rise);
  ctx.lineTo(base.x + hw, base.y - rise);
  ctx.lineTo(base.x, base.y + hd - rise);
  ctx.lineTo(base.x - hw, base.y - rise);
  ctx.closePath();
  ctx.fillStyle = colors.roof;
  ctx.fill();
  ctx.strokeStyle = roofDark;
  ctx.lineWidth = 1;
  ctx.stroke();

  drawRoofDetail(ctx, base, hw, hd, rise, style, colors.accent ?? colors.roof);

  // Hub gag on neutral roofs
  if (options.gag && options.kind === 'neutral') {
    ctx.font = `${Math.max(10, rise * 0.12)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText(options.gag, base.x, base.y - hd - rise - 4);
  }

  if (options.kind === 'player') {
    ctx.fillStyle = '#f8c33a';
    ctx.beginPath();
    ctx.moveTo(base.x, base.y - hd - rise - 12);
    ctx.lineTo(base.x + 9, base.y - hd - rise - 5);
    ctx.lineTo(base.x, base.y - hd - rise + 1);
    ctx.closePath();
    ctx.fill();
    if (options.companyName) {
      const name = options.companyName.length > 14 ? `${options.companyName.slice(0, 12)}…` : options.companyName;
      ctx.font = `bold ${Math.max(8, rise * 0.09)}px system-ui`;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeStyle = 'rgba(15,23,42,0.5)';
      ctx.lineWidth = 2;
      ctx.strokeText(name, base.x, base.y - rise * 0.45);
      ctx.fillText(name, base.x, base.y - rise * 0.45);
    }
  } else if (options.kind === 'rival') {
    ctx.fillStyle = colors.accent ?? colors.roof;
    ctx.beginPath();
    ctx.arc(base.x + hw * 0.45, base.y - rise * 0.62, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  if (options.hover) {
    ctx.strokeStyle = 'rgba(15,23,42,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y - hd);
    ctx.lineTo(base.x + hw, base.y);
    ctx.lineTo(base.x, base.y + hd);
    ctx.lineTo(base.x - hw, base.y);
    ctx.closePath();
    ctx.stroke();
  }
}

export function truncateLabel(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

export function drawIllustratedTent(
  ctx: CanvasRenderingContext2D,
  base: ScreenPoint,
  hw: number,
  hd: number,
  rise: number,
  label: string,
  hover: boolean,
) {
  ctx.fillStyle = 'rgba(125,211,252,0.35)';
  ctx.beginPath();
  ctx.moveTo(base.x, base.y - hd);
  ctx.lineTo(base.x + hw, base.y);
  ctx.lineTo(base.x, base.y + hd);
  ctx.lineTo(base.x - hw, base.y);
  ctx.closePath();
  ctx.fill();

  const tentGrad = ctx.createLinearGradient(base.x, base.y - hd - rise, base.x, base.y);
  tentGrad.addColorStop(0, '#7dd3fc');
  tentGrad.addColorStop(1, '#38bdf8');
  ctx.fillStyle = tentGrad;
  ctx.beginPath();
  ctx.moveTo(base.x, base.y - hd - rise);
  ctx.lineTo(base.x + hw, base.y);
  ctx.lineTo(base.x - hw, base.y);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#f8c33a';
  ctx.beginPath();
  ctx.arc(base.x, base.y - hd - rise - 4, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = `bold ${Math.max(9, rise * 0.14)}px system-ui`;
  ctx.fillStyle = 'rgba(15,23,42,0.8)';
  ctx.textAlign = 'center';
  ctx.fillText(truncateLabel(label.replace(/^\★\s*/, ''), 12), base.x, base.y - hd - rise - 10);

  if (hover) {
    ctx.strokeStyle = 'rgba(15,23,42,0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(base.x - hw - 4, base.y - hd - rise - 4, hw * 2 + 8, rise + hd + 8);
  }
}
