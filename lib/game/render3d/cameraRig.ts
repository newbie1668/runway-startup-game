/**
 * RUNWAY — 3D camera rig.
 *
 * Wraps a THREE.PerspectiveCamera so the rest of the 3D renderer can keep
 * thinking in the same logical `{x, y, zoom}` camera the 2D renderer uses.
 * Ground plane = XZ; world `(x, y)` -> three `(x, 0, y)`, so north = -Z.
 */

import * as THREE from 'three';
import type { CameraState } from '../scene';

export const FOV_DEG = 45;
const NEAR = 1;
const FAR = 4000;
const PITCH_FAR_DEG = 64; // top-down-ish, used when fully zoomed out
const PITCH_NEAR_DEG = 38; // cinematic, used when zoomed in
const PITCH_NEAR_ZOOM = 18;
const DEG2RAD = Math.PI / 180;

/** sin(64°) — the "far" pitch used to approximate fitAll's vertical foreshortening. */
export const FIT_PITCH_SIN = Math.sin(PITCH_FAR_DEG * DEG2RAD);

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private cssW = 1;
  private cssH = 1;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ndc = new THREE.Vector2();
  private readonly hitPoint = new THREE.Vector3();
  private readonly projected = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private lastDist = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(FOV_DEG, 1, NEAR, FAR);
  }

  /** Camera-to-target distance computed by the most recent update() call. */
  getDistance(): number {
    return this.lastDist;
  }

  /** Current pitch in degrees for a given zoom/minZoom pair — exposed for fog/animation. */
  static pitchDeg(zoom: number, minZoom: number): number {
    const t = clamp01((zoom - minZoom) / (PITCH_NEAR_ZOOM - minZoom));
    return lerp(PITCH_FAR_DEG, PITCH_NEAR_DEG, t);
  }

  setViewport(cssW: number, cssH: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.camera.aspect = this.cssW / this.cssH;
  }

  /** Position/orient the camera for the given logical camera state. */
  update(cam: CameraState, minZoom: number): void {
    const pitch = CameraRig.pitchDeg(cam.zoom, minZoom) * DEG2RAD;
    const dist = this.cssH / (2 * cam.zoom * Math.tan((FOV_DEG * DEG2RAD) / 2));
    this.lastDist = dist;
    this.target.set(cam.x, 0, cam.y);
    this.camera.position.set(
      this.target.x,
      dist * Math.sin(pitch),
      this.target.z + dist * Math.cos(pitch),
    );
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }

  /** World ground point -> screen pixel, or null when behind the camera. */
  worldToScreen(p: { x: number; y: number }): { x: number; y: number } | null {
    this.projected.set(p.x, 0, p.y).project(this.camera);
    if (this.projected.z > 1) return null;
    return {
      x: ((this.projected.x + 1) / 2) * this.cssW,
      y: ((1 - this.projected.y) / 2) * this.cssH,
    };
  }

  /** Screen pixel -> world ground point (raycast onto y=0). */
  groundUnproject(sx: number, sy: number): { x: number; y: number } {
    this.ndc.set((sx / this.cssW) * 2 - 1, -(sy / this.cssH) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.raycaster.ray.intersectPlane(this.groundPlane, this.hitPoint);
    return { x: this.hitPoint.x, y: this.hitPoint.z };
  }
}
