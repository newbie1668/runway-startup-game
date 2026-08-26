'use client';

/**
 * Canvas host for the RUNWAY map renderer. Two stacked canvases — a city
 * layer (background/3D scene) and an overlay layer (game chrome, drawn by
 * MapOverlay) — sit inside a shell div that owns the requestAnimationFrame
 * loop and translates pointer input into camera moves (drag pan, wheel zoom,
 * two-finger pinch) and hit-tested clicks/hovers.
 *
 * Every loop tick and input handler reads `rendererRef.current` fresh (never
 * a closed-over renderer) so the renderer instance can be swapped at runtime
 * — e.g. the 3D→2D fallback swap — without tearing this effect down.
 */

import { useEffect, useRef, type RefObject } from 'react';
import { MapRenderer, type HitTarget, type IMapRenderer, type Scene } from '@/lib/game/render';
import { createMapRenderer } from '@/lib/game/render3d/factory';

// Matches render.ts's 2D sky gradient exactly. The 2D canvas paints over this
// every frame; the 3D canvas is alpha-transparent, so this shows through as
// the sky behind the WebGL city (blended into the horizon by THREE.Fog).
const SKY_BACKGROUND = 'linear-gradient(180deg, #070c1a 0%, #0a1124 55%, #0d142b 100%)';

interface Props {
  scene: Scene;
  rendererRef: RefObject<IMapRenderer | null>;
  onHit?: (target: HitTarget) => void;
  className?: string;
}

export function MapCanvas({ scene, rendererRef, onHit, className }: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const cityRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const onHitRef = useRef(onHit);
  const sceneRef = useRef(scene);

  useEffect(() => {
    onHitRef.current = onHit;
    sceneRef.current = scene;
  }, [onHit, scene]);

  useEffect(() => {
    const shell = shellRef.current;
    const cityCanvas = cityRef.current;
    const overlayCanvas = overlayRef.current;
    if (!shell || !cityCanvas || !overlayCanvas) return;

    let cancelled = false;

    // 3D→2D fallback: carry the camera over so the swap is invisible.
    const onFatal = () => {
      const old = rendererRef.current;
      const cam = old?.getCamera();
      old?.dispose();
      const fallback = new MapRenderer(overlayCanvas);
      fallback.scene = sceneRef.current;
      if (cam) fallback.setCamera(cam);
      fallback.resize();
      rendererRef.current = fallback; // loop picks it up next frame — it's ref-driven
    };

    createMapRenderer(cityCanvas, overlayCanvas, onFatal).then(({ renderer }) => {
      if (cancelled) {
        renderer.dispose();
        return;
      }
      renderer.scene = sceneRef.current;
      renderer.resize();
      renderer.fitAll();
      rendererRef.current = renderer;
    });

    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const r = rendererRef.current;
      if (r) r.frame(t, Math.min(0.05, (t - last) / 1000));
      last = t;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => rendererRef.current?.resize());
    ro.observe(shell);

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // --- Pointer input --------------------------------------------------
    const pointers = new Map<number, { x: number; y: number }>();
    let dragging = false;
    let moved = 0;
    let pinchDist = 0;

    const pos = (e: PointerEvent) => {
      const rect = shell.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onPointerDown = (e: PointerEvent) => {
      shell.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, pos(e));
      if (pointers.size === 1) {
        dragging = true;
        moved = 0;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const p = pos(e);
      const r = rendererRef.current;
      if (pointers.has(e.pointerId)) {
        const prev = pointers.get(e.pointerId)!;
        pointers.set(e.pointerId, p);
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinchDist > 0) {
            r?.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchDist);
          }
          pinchDist = d;
        } else if (dragging) {
          r?.pan(p.x - prev.x, p.y - prev.y);
          moved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
        }
      } else if (r) {
        // Pure hover.
        const hit = r.hitTest(p.x, p.y);
        r.hover = hit;
        shell.style.cursor = hit ? 'pointer' : 'grab';
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const p = pos(e);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (pointers.size === 0) {
        dragging = false;
        if (moved < 6) {
          const hit = rendererRef.current?.hitTest(p.x, p.y);
          if (hit) onHitRef.current?.(hit);
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = shell.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0016);
      rendererRef.current?.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    };

    const onLeave = () => {
      const r = rendererRef.current;
      if (r) r.hover = null;
    };

    shell.addEventListener('pointerdown', onPointerDown);
    shell.addEventListener('pointermove', onPointerMove);
    shell.addEventListener('pointerup', onPointerUp);
    shell.addEventListener('pointercancel', onPointerUp);
    shell.addEventListener('pointerleave', onLeave);
    shell.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      shell.removeEventListener('pointerdown', onPointerDown);
      shell.removeEventListener('pointermove', onPointerMove);
      shell.removeEventListener('pointerup', onPointerUp);
      shell.removeEventListener('pointercancel', onPointerUp);
      shell.removeEventListener('pointerleave', onLeave);
      shell.removeEventListener('wheel', onWheel);
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.scene = scene;
  }, [scene, rendererRef]);

  return (
    <div
      data-map-shell=""
      ref={shellRef}
      role="img"
      aria-label="Illustrated London startup neighbourhood map; use the neighbourhood selector to choose an HQ"
      className={className ?? 'relative h-full w-full touch-none select-none'}
      style={{ background: SKY_BACKGROUND }}
    >
      <canvas ref={cityRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      <canvas ref={overlayRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
    </div>
  );
}
