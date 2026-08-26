/**
 * RUNWAY — procedural CanvasTexture generators for the 3D city.
 *
 * Called once at CityRenderer3D construction (behind the dynamic import, so
 * never at module scope / SSR time).
 */

import * as THREE from 'three';

/**
 * 256×256, 32×32 grid of 8px window cells: 62% dark, else a small lit rect
 * (warm/cool/white). The (0,0) cell is reserved fully dark so roof UVs
 * (pinned to 0,0) never show a lit window.
 */
export function createWindowsTexture(): THREE.CanvasTexture {
  const size = 256;
  const cell = 8;
  const grid = size / cell;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, size, size);

  let seed = 20260826;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      if (gx === 0 && gy === 0) continue; // reserved dark texel for roof UVs
      if (rnd() < 0.62) continue;
      const roll = rnd();
      const base: [number, number, number] =
        roll < 0.7 ? [255, 214, 140] : roll < 0.95 ? [160, 196, 255] : [255, 255, 255];
      const jitter = 1 + (rnd() - 0.5) * 0.5; // ±25%
      const r = Math.min(255, Math.round(base[0] * jitter));
      const g = Math.min(255, Math.round(base[1] * jitter));
      const b = Math.min(255, Math.round(base[2] * jitter));
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(gx * cell + 2, gy * cell + 1, 4, 5);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** White radial-gradient sprite; tint via SpriteMaterial.color per use (hub glow, accents). */
export function createGlowSpriteTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
