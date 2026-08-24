'use client';

/**
 * Canvas host for the RUNWAY 3D map. The renderer owns orbit/zoom;
 * this component only maps pointer clicks/hovers onto HitTargets.
 */

import { useEffect, useRef, type RefObject } from 'react';
import { MapRenderer, type HitTarget, type Scene } from '@/lib/game/render';

interface Props {
  scene: Scene;
  rendererRef: RefObject<MapRenderer | null>;
  onHit?: (target: HitTarget) => void;
  className?: string;
}

export function MapCanvas({ scene, rendererRef, onHit, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onHitRef = useRef(onHit);
  const sceneRef = useRef(scene);

  useEffect(() => {
    onHitRef.current = onHit;
    sceneRef.current = scene;
  }, [onHit, scene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new MapRenderer(canvas);
    renderer.scene = sceneRef.current;
    rendererRef.current = renderer;
    renderer.resize();
    renderer.fitAll();

    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      renderer.frame(t, Math.min(0.05, (t - last) / 1000));
      last = t;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => renderer.resize());
    ro.observe(canvas.parentElement ?? canvas);

    let dragging = false;
    let moved = 0;

    const pos = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      moved = 0;
      canvas.setPointerCapture(e.pointerId);
      void pos(e);
    };

    const onPointerMove = (e: PointerEvent) => {
      const p = pos(e);
      if (dragging) {
        moved += Math.abs(e.movementX) + Math.abs(e.movementY);
        canvas.style.cursor = 'grabbing';
        return;
      }
      const hit = renderer.hitTest(p.x, p.y);
      renderer.hover = hit;
      canvas.style.cursor = hit ? 'pointer' : 'grab';
    };

    const onPointerUp = (e: PointerEvent) => {
      const p = pos(e);
      dragging = false;
      canvas.style.cursor = 'grab';
      if (moved < 6) {
        const hit = renderer.hitTest(p.x, p.y);
        if (hit) onHitRef.current?.(hit);
      }
    };

    const onLeave = () => {
      renderer.hover = null;
      canvas.style.cursor = 'grab';
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onLeave);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onLeave);
      renderer.dispose();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.scene = scene;
  }, [scene, rendererRef]);

  return (
    <canvas
      ref={canvasRef}
      className={className ?? 'block h-full w-full touch-none select-none'}
      aria-label="3D London startup neighbourhood map; use the neighbourhood selector to choose an HQ"
    />
  );
}
