'use client';

/**
 * Canvas host for the RUNWAY isometric map renderer.
 */

import { useEffect, useRef, type RefObject } from 'react';
import { IsoMapRenderer } from '@/lib/game/iso-render';
import type { MapRendererApi } from '@/lib/game/map-renderer';
import type { HitTarget, Scene } from '@/lib/game/map-scene';

interface Props {
  scene: Scene;
  rendererRef: RefObject<MapRendererApi | null>;
  onHit?: (target: HitTarget, point: { x: number; y: number }) => void;
  onHover?: (target: HitTarget | null) => void;
  className?: string;
}

export function MapCanvas({ scene, rendererRef, onHit, onHover, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onHitRef = useRef(onHit);
  const onHoverRef = useRef(onHover);
  const sceneRef = useRef(scene);

  useEffect(() => {
    onHitRef.current = onHit;
    onHoverRef.current = onHover;
    sceneRef.current = scene;
  }, [onHit, onHover, scene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new IsoMapRenderer(canvas);
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
    ro.observe(canvas);

    const pointers = new Map<number, { x: number; y: number }>();
    let dragging = false;
    let moved = 0;
    let pinchDist = 0;

    const pos = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
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
      if (pointers.has(e.pointerId)) {
        const prev = pointers.get(e.pointerId)!;
        pointers.set(e.pointerId, p);
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinchDist > 0) {
            renderer.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchDist);
          }
          pinchDist = d;
        } else if (dragging) {
          renderer.pan(p.x - prev.x, p.y - prev.y);
          moved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
        }
      } else {
        const hit = renderer.hitTest(p.x, p.y);
        if (renderer.hover !== hit) {
          renderer.hover = hit;
          onHoverRef.current?.(hit);
        }
        canvas.style.cursor = hit ? 'pointer' : 'grab';
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const p = pos(e);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (pointers.size === 0) {
        dragging = false;
        if (moved < 6) {
          const hit = renderer.hitTest(p.x, p.y);
          if (hit) onHitRef.current?.(hit, p);
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0016);
      renderer.zoomAt(e.clientX - canvas.getBoundingClientRect().left, e.clientY - canvas.getBoundingClientRect().top, factor);
    };

    const onLeave = () => {
      renderer.hover = null;
      onHoverRef.current?.(null);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
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
      className={className ?? 'h-full w-full touch-none select-none'}
      aria-label="Illustrated isometric London startup map"
    />
  );
}
