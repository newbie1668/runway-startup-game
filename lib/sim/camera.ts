import { SIM_HUBS, type SimHub } from './constants';
import { projectLngLat } from './projection';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraPose {
  target: Vec3;
  position: Vec3;
}

export function hubTarget(hub: SimHub): Vec3 {
  const p = projectLngLat(hub.lng, hub.lat);
  return { x: p.x, y: 0, z: p.z };
}

export function overviewPose(): CameraPose {
  const west = projectLngLat(SIM_HUBS.find((h) => h.id === 'battersea')!.lng, 51.49);
  const east = projectLngLat(0.0, 51.505);
  const target = { x: (west.x + east.x) * 0.42, y: 0, z: 80 };
  const position = { x: target.x - 900, y: 4200, z: target.z - 5200 };
  return { target, position };
}

export function hubPose(hub: SimHub): CameraPose {
  const target = hubTarget(hub);
  const distance = hub.id === 'canarywharf' || hub.id === 'city' ? 720 : 560;
  const height = hub.id === 'canarywharf' ? 380 : 260;
  const position = { x: target.x - distance * 0.35, y: height, z: target.z - distance };
  return { target, position };
}

export function pointPose(x: number, z: number, height: number): CameraPose {
  const distance = Math.max(280, Math.min(900, height * 2.4 + 220));
  return {
    target: { x, y: 0, z },
    position: { x: x - distance * 0.4, y: Math.max(140, height * 0.7 + 80), z: z - distance },
  };
}

function smoothstep(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

export function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  const e = smoothstep(t);
  return {
    x: a.x + (b.x - a.x) * e,
    y: a.y + (b.y - a.y) * e,
    z: a.z + (b.z - a.z) * e,
  };
}
