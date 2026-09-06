/**
 * RUNWAY — 3D camera rig.
 *
 * Orthographic isometric lock: pan on the ground plane, no tilt or orbit.
 * Zoom scales the frustum only, so parallel lines stay parallel.
 *
 * Ground plane = XZ; world `(x, y)` -> three `(x, 0, y)`, so north = -Z.
 */

import * as THREE from 'three';
import type { CameraState } from '../scene';

const NEAR = 0.02;
const FAR = 4000;
/** High isometric — toy / strategy-overview, not street-level FPS. */
export const ISO_PITCH_DEG = 48;
const DEG2RAD = Math.PI / 180;
const ISO_PITCH = ISO_PITCH_DEG * DEG2RAD;
const ISO_SIN = Math.sin(ISO_PITCH);
const ISO_COS = Math.cos(ISO_PITCH);

/** sin(isometric pitch) — used to approximate fitAll's vertical foreshortening. */
export const FIT_PITCH_SIN = ISO_SIN;

export class CameraRig {
  readonly camera: THREE.OrthographicCamera;
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
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, NEAR, FAR);
  }

  /** Camera-to-target distance computed by the most recent update() call. */
  getDistance(): number {
    return this.lastDist;
  }

  /** Locked isometric pitch. Zoom no longer tilts the camera. */
  static pitchDeg(): number {
    return ISO_PITCH_DEG;
  }

  setViewport(cssW: number, cssH: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
  }

  /** Position/orient the camera for the given logical camera state.
   *  `azimuthRad` 0 = from the south (default); π/2 = from the east. */
  update(cam: CameraState, azimuthRad = 0): void {
    const zoom = Math.max(1e-6, cam.zoom);
    const halfH = this.cssH / (2 * zoom);
    const halfW = this.cssW / (2 * zoom);
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.near = NEAR;
    this.camera.far = FAR;

    // Distance only places the camera; ortho scale comes from the frustum.
    // Stay well above the Shard (~6 wu) so the near plane never clips it.
    const dist = Math.max(28, halfH * 14);
    this.lastDist = dist;
    this.target.set(cam.x, 0, cam.y);
    const ground = dist * ISO_COS;
    this.camera.position.set(
      this.target.x + Math.sin(azimuthRad) * ground,
      dist * ISO_SIN,
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
