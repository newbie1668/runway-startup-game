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
  sign?: string;
}

export const HUB_THEMES: Record<HubId, HubVisualTheme> = {
  shoreditch: { gag: '☕', sign: 'BRICK LN', plaza: '#b8c9a8', plazaStroke: '#8aa67a', buildingStyle: 'brick-loft' },
  kingscross: { gag: '🧠', sign: 'ST PANCRAS', plaza: '#a8b8c9', plazaStroke: '#7a8aa6', buildingStyle: 'campus' },
  soho: { gag: '🎬', sign: 'WARDOUR ST', plaza: '#c9b0b8', plazaStroke: '#a67a8a', buildingStyle: 'terrace' },
  farringdon: { gag: '🚇', sign: 'CLERKENWELL', plaza: '#b8c0a8', plazaStroke: '#8a967a', buildingStyle: 'warehouse' },
  canarywharf: { gag: '🏦', sign: 'CANARY WHARF', plaza: '#a8c4d4', plazaStroke: '#6a94b4', buildingStyle: 'glass-tower' },
  londonbridge: { gag: '🥪', sign: 'BOROUGH', plaza: '#c4b8a8', plazaStroke: '#968a7a', buildingStyle: 'riverside' },
  camden: { gag: '🎸', sign: 'CAMDEN LOCK', plaza: '#c0c9a8', plazaStroke: '#8a9670', buildingStyle: 'market' },
  battersea: { gag: '⚡', sign: 'POWER STN', plaza: '#b0c9c0', plazaStroke: '#7a968a', buildingStyle: 'industrial' },
};

function shade(hex: string, amount: number): string {
  if (!hex.startsWith('#')) return hex;
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, ((n >> 16) & 0xff) + amount));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (n & 0xff) + amount));
  return `rgb(${r},${g},${b})`;
}

function drawBrickTexture(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 0.8;
  const minY = Math.min(y0, y1, y2, y3);
  const maxY = Math.max(y0, y1, y2, y3);
  for (let y = minY; y < maxY; y += 5) {
    ctx.beginPath();
    ctx.moveTo(x0 - 10, y);
    ctx.lineTo(x1 + 10, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFacadeWindows(
  ctx: CanvasRenderingContext2D,
  base: ScreenPoint,
  hw: number,
  hd: number,
  rise: number,
  face: 'left' | 'right',
  lit: string,
  style: HubVisualTheme['buildingStyle'],
) {
  const cols = style === 'glass-tower' ? 4 : 3;
  const rows = Math.max(2, Math.floor(rise / 12));
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const t = (col + 1) / (cols + 1);
      const v = (row + 1) / (rows + 1);
      const wx = face === 'left' ? base.x - hw * (1 - t * 0.88) : base.x + hw * (1 - t * 0.88);
      const wy = base.y - rise * v;
      const ww = style === 'glass-tower' ? 5 : 4;
      const wh = style === 'glass-tower' ? 7 : 5;
      ctx.fillStyle = lit;
      ctx.fillRect(wx - ww / 2, wy - wh, ww, wh);
      if (style === 'glass-tower') {
        ctx.fillStyle = 'rgba(186,230,253,0.5)';
        ctx.fillRect(wx - ww / 2, wy - wh, ww, wh * 0.45);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillRect(wx - ww / 2, wy - wh, ww * 0.5, wh * 0.45);
      }
    }
  }
  // Ground floor door
  if (face === 'right') {
    ctx.fillStyle = '#3d3028';
    const dx = base.x + hw * 0.35;
    ctx.fillRect(dx - 3, base.y - hd * 0.35, 6, hd * 0.35);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(dx - 2, base.y - hd * 0.32, 2, 3);
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
  switch (style) {
    case 'glass-tower':
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const y = base.y - rise + i * (rise / 5);
        ctx.beginPath();
        ctx.moveTo(base.x - hw * 0.75, y);
        ctx.lineTo(base.x + hw * 0.75, y);
        ctx.stroke();
      }
      ctx.fillStyle = accent;
      ctx.fillRect(base.x - 1.5, base.y - hd - rise - 12, 3, 12);
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(base.x, base.y - hd - rise - 14, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'brick-loft':
      ctx.fillStyle = '#6b4f3a';
      ctx.fillRect(base.x - hw * 0.35, base.y - hd - rise - 5, hw * 0.7, 5);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(base.x + hw * 0.15, base.y - hd - rise - 18, 4, 14);
      break;
    case 'market':
      ctx.fillStyle = '#e879f9';
      ctx.beginPath();
      ctx.moveTo(base.x - hw * 0.55, base.y - hd - rise);
      ctx.lineTo(base.x, base.y - hd - rise - 12);
      ctx.lineTo(base.x + hw * 0.55, base.y - hd - rise);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(base.x + i * 6, base.y - hd - rise - 12);
        ctx.lineTo(base.x + i * 6, base.y - hd - rise - 4);
        ctx.stroke();
      }
      break;
    case 'campus':
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(8, rise * 0.1)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText('UCL', base.x, base.y - hd - rise - 6);
      break;
    case 'warehouse':
      ctx.fillStyle = '#64748b';
      ctx.fillRect(base.x - hw * 0.5, base.y - hd - rise - 3, hw, 3);
      break;
    case 'industrial':
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(base.x - hw * 0.3, base.y - hd - rise);
      ctx.lineTo(base.x - hw * 0.3, base.y - hd - rise - 16);
      ctx.moveTo(base.x + hw * 0.2, base.y - hd - rise);
      ctx.lineTo(base.x + hw * 0.2, base.y - hd - rise - 12);
      ctx.stroke();
      break;
    case 'riverside':
      ctx.fillStyle = '#0ea5e9';
      ctx.fillRect(base.x - hw * 0.4, base.y - hd - rise - 2, hw * 0.8, 2);
      break;
    case 'terrace':
      ctx.fillStyle = '#fbbf24';
      for (let i = -1; i <= 1; i++) {
        ctx.fillRect(base.x + i * 8 - 2, base.y - hd - rise - 8, 4, 8);
      }
      break;
  }
}

function drawPlazaTrees(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, zoom: number) {
  const spots = [
    [cx - rx * 0.65, cy],
    [cx + rx * 0.6, cy - ry * 0.2],
    [cx, cy + ry * 0.55],
  ];
  for (const [tx, ty] of spots) {
    const r = Math.max(2.5, 4 * zoom);
    ctx.fillStyle = '#2d5a3a';
    ctx.beginPath();
    ctx.arc(tx, ty, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(tx, ty - r, r, 0, Math.PI * 2);
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
  // Soft pad shadow
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + ry * 0.15, rx * 1.05, ry * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx, cy - ry);
  ctx.lineTo(cx + rx, cy);
  ctx.lineTo(cx, cy + ry);
  ctx.lineTo(cx - rx, cy);
  ctx.closePath();
  const grad = ctx.createLinearGradient(cx - rx, cy - ry, cx + rx, cy + ry);
  grad.addColorStop(0, theme.plaza);
  grad.addColorStop(1, shade(theme.plaza, -12));
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = theme.plazaStroke;
  ctx.lineWidth = Math.max(1.2, zoom);
  ctx.stroke();

  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(0,0,0,0.07)';
  ctx.lineWidth = 1;
  const step = Math.max(5, 8 * zoom);
  for (let x = cx - rx; x < cx + rx; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, cy - ry);
    ctx.lineTo(x + ry * 0.8, cy + ry);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, cy + ry);
    ctx.lineTo(x - ry * 0.8, cy - ry);
    ctx.stroke();
  }
  ctx.restore();

  if (zoom > 0.45) drawPlazaTrees(ctx, cx, cy, rx, ry, zoom);

  if (theme.sign && zoom > 0.7) {
    ctx.font = `600 ${Math.max(7, 8 * zoom)}px system-ui`;
    ctx.fillStyle = 'rgba(15,23,42,0.35)';
    ctx.textAlign = 'center';
    ctx.fillText(theme.sign, cx, cy + ry * 0.55);
  }
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
    kind: 'player' | 'rival' | 'neutral';
    gag?: string;
    companyName?: string;
    hover: boolean;
  },
) {
  const leftDark = shade(colors.left, -22);
  const rightDark = shade(colors.right, -26);
  const roofDark = shade(colors.roof, -18);

  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.beginPath();
  ctx.ellipse(base.x, base.y + hd * 0.4, hw * 1.15, hd * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();

  const lx0 = base.x - hw;
  const ly0 = base.y;
  const lx1 = base.x;
  const ly1 = base.y + hd;
  const lx2 = base.x;
  const ly2 = base.y + hd - rise;
  const lx3 = base.x - hw;
  const ly3 = base.y - rise;

  ctx.beginPath();
  ctx.moveTo(lx0, ly0);
  ctx.lineTo(lx1, ly1);
  ctx.lineTo(lx2, ly2);
  ctx.lineTo(lx3, ly3);
  ctx.closePath();
  const leftGrad = ctx.createLinearGradient(lx0, ly0, lx1, ly1);
  leftGrad.addColorStop(0, leftDark);
  leftGrad.addColorStop(1, colors.left);
  ctx.fillStyle = leftGrad;
  ctx.fill();
  if (style === 'brick-loft' || style === 'warehouse') {
    drawBrickTexture(ctx, lx0, ly0, lx1, ly1, lx2, ly2, lx3, ly3);
  }
  drawFacadeWindows(ctx, base, hw, hd, rise, 'left', 'rgba(255,255,230,0.6)', style);

  const rx0 = base.x + hw;
  const ry0 = base.y;
  ctx.beginPath();
  ctx.moveTo(rx0, ry0);
  ctx.lineTo(lx1, ly1);
  ctx.lineTo(lx2, ly2);
  ctx.lineTo(base.x + hw, base.y - rise);
  ctx.closePath();
  const rightGrad = ctx.createLinearGradient(lx1, ly1, rx0, ry0);
  rightGrad.addColorStop(0, colors.right);
  rightGrad.addColorStop(1, rightDark);
  ctx.fillStyle = rightGrad;
  ctx.fill();
  drawFacadeWindows(ctx, base, hw, hd, rise, 'right', 'rgba(255,255,220,0.45)', style);

  ctx.beginPath();
  ctx.moveTo(base.x, base.y - hd - rise);
  ctx.lineTo(base.x + hw, base.y - rise);
  ctx.lineTo(base.x, base.y + hd - rise);
  ctx.lineTo(base.x - hw, base.y - rise);
  ctx.closePath();
  ctx.fillStyle = colors.roof;
  ctx.fill();
  ctx.strokeStyle = roofDark;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Roof edge highlight
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(base.x - hw, base.y - rise);
  ctx.lineTo(base.x, base.y - hd - rise);
  ctx.lineTo(base.x + hw, base.y - rise);
  ctx.stroke();

  drawRoofDetail(ctx, base, hw, hd, rise, style, colors.accent ?? colors.roof);

  if (options.gag && options.kind === 'neutral') {
    ctx.font = `${Math.max(11, rise * 0.14)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText(options.gag, base.x, base.y - hd - rise - 8);
  }

  if (options.kind === 'player') {
    ctx.strokeStyle = 'rgba(248,195,58,0.85)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y - hd);
    ctx.lineTo(base.x + hw + 4, base.y);
    ctx.lineTo(base.x, base.y + hd + 4);
    ctx.lineTo(base.x - hw - 4, base.y);
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = '#f8c33a';
    ctx.beginPath();
    ctx.moveTo(base.x, base.y - hd - rise - 14);
    ctx.lineTo(base.x + 10, base.y - hd - rise - 6);
    ctx.lineTo(base.x, base.y - hd - rise);
    ctx.closePath();
    ctx.fill();

    if (options.companyName) {
      const name = options.companyName.length > 16 ? `${options.companyName.slice(0, 14)}…` : options.companyName;
      const fs = Math.max(8, rise * 0.1);
      ctx.font = `bold ${fs}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeStyle = 'rgba(15,23,42,0.55)';
      ctx.lineWidth = 2.5;
      ctx.strokeText(name, base.x, base.y - rise * 0.42);
      ctx.fillText(name, base.x, base.y - rise * 0.42);
    }
  } else if (options.kind === 'rival') {
    const bx = base.x + hw * 0.42;
    const by = base.y - rise * 0.6;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(bx, by, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colors.accent ?? colors.roof;
    ctx.beginPath();
    ctx.arc(bx, by, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if (options.hover) {
    ctx.strokeStyle = 'rgba(15,23,42,0.65)';
    ctx.lineWidth = 2.5;
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
  ctx.fillStyle = 'rgba(125,211,252,0.3)';
  ctx.beginPath();
  ctx.moveTo(base.x, base.y - hd);
  ctx.lineTo(base.x + hw, base.y);
  ctx.lineTo(base.x, base.y + hd);
  ctx.lineTo(base.x - hw, base.y);
  ctx.closePath();
  ctx.fill();

  const stripes = ['#7dd3fc', '#38bdf8', '#0ea5e9'];
  for (let i = 0; i < 3; i++) {
    const t = i / 3;
    ctx.fillStyle = stripes[i];
    ctx.beginPath();
    ctx.moveTo(base.x, base.y - hd - rise);
    ctx.lineTo(base.x + hw * (1 - t * 2), base.y);
    ctx.lineTo(base.x + hw * (1 - (t + 1 / 3) * 2), base.y);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = '#f8c33a';
  ctx.beginPath();
  ctx.arc(base.x, base.y - hd - rise - 5, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `bold ${Math.max(9, rise * 0.14)}px system-ui`;
  ctx.fillStyle = 'rgba(15,23,42,0.85)';
  ctx.textAlign = 'center';
  ctx.fillText(truncateLabel(label.replace(/^\★\s*/, ''), 14), base.x, base.y - hd - rise - 12);

  if (hover) {
    ctx.strokeStyle = 'rgba(15,23,42,0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(base.x - hw - 4, base.y - hd - rise - 4, hw * 2 + 8, rise + hd + 8);
  }
}
