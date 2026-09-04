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
/** Near plane in world units (~111 m each). Must stay well below street-level camera distance. */
const NEAR = 0.02;
const FAR = 4000;
const PITCH_FAR_DEG = 50; // city-scale isometric; roofs + façades both read
const PITCH_MID_DEG = 42; // cinematic, reached around zoom 18
const PITCH_CLOSE_DEG = 32; // isometric neighbourhood with a strip of sky
const PITCH_STREET_DEG = 22; // street corner; top of the 45° FOV hits the horizon
const PITCH_MID_ZOOM = 18;
const PITCH_CLOSE_ZOOM = 80;
const PITCH_STREET_ZOOM = 260;
const DEG2RAD = Math.PI / 180;
/** ~36 m — stay above terraces when fully zoomed in (1 wu ≈ 111 m). */
const MIN_CAM_HEIGHT = 0.32;

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
    const midSpan = Math.max(1e-6, PITCH_MID_ZOOM - minZoom);
    const mid = lerp(PITCH_FAR_DEG, PITCH_MID_DEG, clamp01((zoom - minZoom) / midSpan));
    const close = lerp(
      mid,
      PITCH_CLOSE_DEG,
      clamp01((zoom - PITCH_MID_ZOOM) / (PITCH_CLOSE_ZOOM - PITCH_MID_ZOOM)),
    );
    return lerp(
      close,
      PITCH_STREET_DEG,
      clamp01((zoom - PITCH_CLOSE_ZOOM) / (PITCH_STREET_ZOOM - PITCH_CLOSE_ZOOM)),
    );
  }

  setViewport(cssW: number, cssH: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.camera.aspect = this.cssW / this.cssH;
  }

  /** Position/orient the camera for the given logical camera state.
   *  `azimuthRad` 0 = from the south (default); π/2 = from the east. */
  update(cam: CameraState, minZoom: number, azimuthRad = 0): void {
    const pitch = CameraRig.pitchDeg(cam.zoom, minZoom) * DEG2RAD;
    let dist = this.cssH / (2 * cam.zoom * Math.tan((FOV_DEG * DEG2RAD) / 2));
    let height = dist * Math.sin(pitch);
    if (height < MIN_CAM_HEIGHT && Math.sin(pitch) > 1e-6) {
      dist *= MIN_CAM_HEIGHT / height;
      height = MIN_CAM_HEIGHT;
    }
    this.lastDist = dist;
    this.target.set(cam.x, 0, cam.y);
    const ground = dist * Math.cos(pitch);
    this.camera.position.set(
      this.target.x + Math.sin(azimuthRad) * ground,
      height,
      this.target.z + Math.cos(azimuthRad) * ground,
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
