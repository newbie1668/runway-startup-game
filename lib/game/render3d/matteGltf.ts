/**
 * glTF from three's exporter / photogrammetry arrives as MeshStandardMaterial.
 * This scene has no environment map, so even modest metalness reads as black.
 * Convert to matte Lambert. Landmarks drop albedo maps (SFSIM solid paint) and
 * lift photogrammetry-white / crushed-black bases. Noticed towers keep bake-time
 * window grids and photo colours — Kansas's unique-mesh layer.
 */

import * as THREE from 'three';

export interface MatteGltfOptions {
  /** Keep albedo maps (noticed-tower window grids). Default drops maps. */
  keepMaps?: boolean;
}

function rgbToL(hex: number): number {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  return (max + min) / 2;
}

function liftIfTooDark(hex: number): number {
  const l = rgbToL(hex);
  if (l >= 0.22) return hex;
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  const scale = 0.42 / Math.max(l, 0.05);
  const nr = Math.min(255, Math.round(r * scale));
  const ng = Math.min(255, Math.round(g * scale));
  const nb = Math.min(255, Math.round(b * scale));
  return (nr << 16) | (ng << 8) | nb;
}

/** White photogrammetry bases and crushed blacks both become readable glass. */
function resolveMatteColor(hex: number, hadMap: boolean): number {
  const l = rgbToL(hex);
  if (hadMap && (l > 0.82 || l < 0.22)) return 0x7a92a4;
  if (l > 0.82) return 0x7a92a4;
  return liftIfTooDark(hex);
}

export function makeMatteLambert(root: THREE.Object3D, opts?: MatteGltfOptions): void {
  const keepMaps = opts?.keepMaps ?? false;
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    const mapped = list.map((mat) => {
      if (!mat || mat instanceof THREE.MeshBasicMaterial) return mat;
      const color =
        'color' in mat && mat.color instanceof THREE.Color ? mat.color.getHex() : 0x9aa4ae;
      const map = 'map' in mat && mat.map ? mat.map : null;
      const hadMap = !!map;
      if (!keepMaps && map && 'dispose' in map) map.dispose();
      const next = new THREE.MeshLambertMaterial({
        color: keepMaps
          ? hadMap
            ? 0xffffff
            : liftIfTooDark(color)
          : resolveMatteColor(color, hadMap),
        map: keepMaps ? (map as THREE.Texture | null) : null,
        fog: true,
        side: mat.side ?? THREE.FrontSide,
        transparent: !!mat.transparent,
        opacity: mat.opacity ?? 1,
        vertexColors: !!mat.vertexColors,
      });
      mat.dispose();
      return next;
    });
    obj.material = Array.isArray(obj.material) ? mapped : mapped[0]!;
  });
}

/** Photo-true unique towers: unlit so pale stone / glass bands survive the sun. */
export function makeUnlitBasic(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    const mapped = list.map((mat) => {
      if (!mat || mat instanceof THREE.MeshBasicMaterial) return mat;
      const color =
        'color' in mat && mat.color instanceof THREE.Color ? mat.color.getHex() : 0x9aa4ae;
      const next = new THREE.MeshBasicMaterial({
        color,
        fog: true,
        side: mat.side ?? THREE.FrontSide,
        transparent: !!mat.transparent,
        opacity: mat.opacity ?? 1,
        vertexColors: !!mat.vertexColors,
      });
      mat.dispose();
      return next;
    });
    obj.material = Array.isArray(obj.material) ? mapped : mapped[0]!;
  });
}
