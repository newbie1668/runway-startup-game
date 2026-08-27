/**
 * RUNWAY — procedural CanvasTexture generators for the 3D city.
 *
 * Called once at CityRenderer3D construction (behind the dynamic import, so
 * never at module scope / SSR time).
 */

import * as THREE from 'three';

/**
 * Two 512×512 four-band atlases sharing UVs.
 *
 * Albedo is white wall + dark window holes so vertex colours (brick, cream,
 * charcoal, glass) actually show. Emissive is black wall + a few lit panes.
 * The old single-texture path used only emissiveMap, so City offices all
 * read as the same cream ribbon regardless of palette.
 */
export function createFacadeAtlases(): { albedo: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const size = 512;
  const band = 128;
  const albedoCanvas = document.createElement('canvas');
  const emitCanvas = document.createElement('canvas');
  albedoCanvas.width = emitCanvas.width = size;
  albedoCanvas.height = emitCanvas.height = size;
  const albedo = albedoCanvas.getContext('2d')!;
  const emit = emitCanvas.getContext('2d')!;
  albedo.fillStyle = '#ffffff';
  albedo.fillRect(0, 0, size, size);
  emit.fillStyle = '#000000';
  emit.fillRect(0, 0, size, size);

  let seed = 20260826;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const windowHole = (x: number, y: number, w: number, h: number, lit: boolean) => {
    albedo.fillStyle = '#1a2838';
    albedo.fillRect(x, y, w, h);
    if (!lit) return;
    emit.fillStyle = rnd() < 0.72 ? '#ffd28a' : '#c8dcff';
    emit.fillRect(x + 1, y + 1, Math.max(1, w - 2), Math.max(1, h - 2));
  };

  // Band 0 — terrace / house: tall paired sashes.
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      if (gx === 0 && gy === 0) continue;
      const x = gx * 64 + 14;
      const y = gy * 32 + 6;
      const lit = rnd() > 0.45;
      windowHole(x, y, 14, 20, lit);
      windowHole(x + 22, y, 14, 20, lit && rnd() > 0.2);
    }
  }

  // Band 1 — apartments / retail: square punches.
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      const x = gx * 64 + 10;
      const y = band + gy * 32 + 6;
      windowHole(x, y, 18, 18, rnd() > 0.4);
      windowHole(x + 28, y, 18, 18, rnd() > 0.4);
    }
  }

  // Band 2 — office / tower: grid of dark panes, not a full-width cream ribbon.
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 16; gx++) {
      windowHole(gx * 32 + 6, band * 2 + gy * 16 + 4, 20, 9, rnd() > 0.55);
    }
  }

  // Band 3 — warehouse: sparse large voids.
  for (let gy = 0; gy < 2; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      if (rnd() < 0.4) continue;
      windowHole(gx * 128 + 24, band * 3 + gy * 64 + 16, 80, 32, rnd() > 0.35);
    }
  }

  // Roof / plinth / cornice UVs sit at (0,0) — keep albedo white, emit black.
  albedo.fillStyle = '#ffffff';
  albedo.fillRect(0, 0, 16, 16);
  emit.fillStyle = '#000000';
  emit.fillRect(0, 0, 16, 16);

  const toTexture = (canvas: HTMLCanvasElement) => {
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };

  return { albedo: toTexture(albedoCanvas), emissive: toTexture(emitCanvas) };
}

/** @deprecated kept for call-sites; prefer createFacadeAtlases(). */
export function createFacadeAtlas(): THREE.CanvasTexture {
  return createFacadeAtlases().emissive;
}

/** Carriageway atlas: asphalt, edge lines, dashed centre line. U = along-road. */
export function createRoadTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#151920';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#d0d8ec';
  ctx.fillRect(0, 1, w, 4);
  ctx.fillRect(0, h - 5, w, 4);
  ctx.fillStyle = '#f2d45a';
  const dash = 96;
  const gap = 64;
  for (let x = 4; x < w; x += dash + gap) {
    ctx.fillRect(x, h / 2 - 3, dash, 6);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** @deprecated kept for call-sites; facade atlas is the SFSIM-style night look. */
export function createWindowsTexture(): THREE.CanvasTexture {
  return createFacadeAtlas();
}

/** Diagonal ±45° line sets — the Gherkin's diagrid, used as an emissiveMap. */
export function createDiagridTexture(): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  const step = 32;
  const onLine = (x: number, y: number) => {
    const a = Math.abs(((x - y) % step) + (x - y < 0 ? step : 0));
    const b = Math.abs(((x + y) % step) + (x + y < 0 ? step : 0));
    return a < 3 || a > step - 3 || b < 3 || b > step - 3;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (onLine(x, y)) {
        data[i] = 180;
        data[i + 1] = 220;
        data[i + 2] = 210;
        data[i + 3] = 230;
      } else {
        data[i] = 10;
        data[i + 1] = 26;
        data[i + 2] = 26;
        data[i + 3] = 255;
      }
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 4);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
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
