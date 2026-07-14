/**
 * City base scenery — parks, river, roads with illustrated detail.
 */

import { HUBS } from './content';
import { THAMES, PARKS, project } from './geo';
import { hubIsoPoint, isoToScreen, worldToScreen, type IsoCamera } from './iso';
import { HUB_ROAD_EDGES, ISO_PALETTE } from './sprites';
import type { HubId } from './types';

function scatterTrees(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  zoom: number,
) {
  for (const p of points) {
    const r = Math.max(3, 5 * zoom);
    ctx.fillStyle = '#2d5a3a';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(p.x, p.y - r * 0.8, r * 0.85, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#6ec6e8');
  sky.addColorStop(0.45, ISO_PALETTE.skyTop);
  sky.addColorStop(1, ISO_PALETTE.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  const clouds: [number, number, number][] = [
    [w * 0.15, h * 0.12, 42],
    [w * 0.55, h * 0.08, 56],
    [w * 0.82, h * 0.15, 38],
  ];
  for (const [cx, cy, r] of clouds) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.45, cy + 4, r * 0.55, r * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.4, cy + 2, r * 0.5, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const ground = ctx.createLinearGradient(0, h * 0.5, 0, h);
  ground.addColorStop(0, ISO_PALETTE.groundFar);
  ground.addColorStop(1, '#c5dbb0');
  ctx.fillStyle = ground;
  ctx.fillRect(0, h * 0.5, w, h * 0.5);
}

export function drawParks(ctx: CanvasRenderingContext2D, cam: IsoCamera, w: number, h: number) {
  for (const park of PARKS) {
    const pts: { x: number; y: number }[] = [];
    ctx.beginPath();
    park.points.forEach((pt, i) => {
      const p = worldToScreen(project(pt), cam, w, h);
      pts.push(p);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fillStyle = ISO_PALETTE.park;
    ctx.fill();
    ctx.strokeStyle = ISO_PALETTE.parkStroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (pts.length >= 3) {
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      const trees = pts.slice(0, 4).map((p, i) => ({
        x: cx + (p.x - cx) * 0.55 + (i % 2) * 8,
        y: cy + (p.y - cy) * 0.55,
      }));
      scatterTrees(ctx, trees, cam.zoom);
    }
  }
}

export function drawThames(ctx: CanvasRenderingContext2D, cam: IsoCamera, w: number, h: number) {
  ctx.beginPath();
  THAMES.forEach((pt, i) => {
    const p = worldToScreen(project(pt), cam, w, h);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  const z = cam.zoom;
  ctx.strokeStyle = ISO_PALETTE.thamesBank;
  ctx.lineWidth = Math.max(10, z * 4);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.strokeStyle = ISO_PALETTE.thames;
  ctx.lineWidth = Math.max(6, z * 2.6);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = Math.max(2, z * 0.8);
  ctx.setLineDash([8, 14]);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawRoads(ctx: CanvasRenderingContext2D, cam: IsoCamera, w: number, h: number) {
  const z = cam.zoom;
  for (const [a, b] of HUB_ROAD_EDGES) {
    const pa = isoToScreen(hubIsoPoint(a), cam, w, h);
    const pb = isoToScreen(hubIsoPoint(b), cam, w, h);
    ctx.strokeStyle = ISO_PALETTE.roadEdge;
    ctx.lineWidth = Math.max(14, 16 * z);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
    ctx.strokeStyle = ISO_PALETTE.road;
    ctx.lineWidth = Math.max(9, 11 * z);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(1.5, 2 * z);
    ctx.setLineDash([6, 10]);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

export function drawHubSign(
  ctx: CanvasRenderingContext2D,
  hubId: HubId,
  x: number,
  y: number,
  zoom: number,
) {
  const hub = HUBS.find((h) => h.id === hubId)!;
  const label = hub.name.toUpperCase();
  ctx.font = `bold ${Math.max(8, 9 * zoom)}px system-ui`;
  const tw = ctx.measureText(label).width;
  const pad = 5;
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.strokeStyle = 'rgba(15,23,42,0.25)';
  ctx.lineWidth = 1;
  const bx = x - tw / 2 - pad;
  const by = y - 28 * zoom;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(bx, by, tw + pad * 2, 16 + pad, 4);
  } else {
    ctx.rect(bx, by, tw + pad * 2, 16 + pad);
  }
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(15,23,42,0.75)';
  ctx.textAlign = 'center';
  ctx.fillText(label, x, by + 12 + pad * 0.5);
}
