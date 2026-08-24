'use client';

/**
 * Canvas host for the RUNWAY 3D map. The renderer owns orbit/zoom;
 * this component maps pointer clicks onto HitTargets and paints
 * Atlas-style HTML name/stage pills over the 3D pin stems.
 */

import { useEffect, useRef, type RefObject } from 'react';
import { MapRenderer, type HitTarget, type PinLabel, type Scene } from '@/lib/game/render';

interface Props {
  scene: Scene;
  rendererRef: RefObject<MapRenderer | null>;
  onHit?: (target: HitTarget) => void;
  onSelect?: (target: HitTarget | null) => void;
  className?: string;
}

const PIN_BTN =
  'pointer-events-auto absolute flex -translate-x-1/2 -translate-y-[112%] items-center gap-1.5 rounded-full border border-white/90 bg-white py-1 pr-1.5 pl-1 shadow-[0_8px_22px_rgba(15,23,42,0.16)]';
const PIN_MARK =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-black text-white';
const PIN_NAME = 'max-w-[9.5rem] truncate text-[12px] font-bold tracking-tight text-slate-900';
const PIN_TAG = 'rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-none';

function hitKey(hit: HitTarget): string {
  if (hit.type === 'hub') return `hub:${hit.hubId}`;
  if (hit.type === 'rival') return `rival:${hit.rivalId}`;
  return `event:${hit.eventId}`;
}

function sameHit(a: HitTarget | null, b: HitTarget | null): boolean {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === 'hub' && b.type === 'hub') return a.hubId === b.hubId;
  if (a.type === 'rival' && b.type === 'rival') return a.rivalId === b.rivalId;
  if (a.type === 'event' && b.type === 'event') return a.eventId === b.eventId;
  return false;
}

function pinRank(hit: HitTarget, selected: HitTarget | null): number {
  if (sameHit(hit, selected)) return 0;
  if (hit.type === 'hub') return 1;
  if (hit.type === 'rival') return 2;
  return 3;
}

export function MapCanvas({ scene, rendererRef, onHit, onSelect, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const onHitRef = useRef(onHit);
  const onSelectRef = useRef(onSelect);
  const sceneRef = useRef(scene);

  useEffect(() => {
    onHitRef.current = onHit;
    onSelectRef.current = onSelect;
    sceneRef.current = scene;
  }, [onHit, onSelect, scene]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;
    const renderer = new MapRenderer(canvas);
    renderer.scene = sceneRef.current;
    rendererRef.current = renderer;
    renderer.resize();
    renderer.fitAll();

    const buttons = new Map<string, HTMLButtonElement>();

    const pick = (hit: HitTarget) => {
      renderer.select(hit);
      onSelectRef.current?.(hit);
      onHitRef.current?.(hit);
    };

    const ensureButton = (pin: PinLabel): HTMLButtonElement => {
      const key = hitKey(pin.hit);
      let btn = buttons.get(key);
      if (btn) return btn;
      btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.pin = key;
      btn.className = PIN_BTN;
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pick(pin.hit);
      });
      overlay.appendChild(btn);
      buttons.set(key, btn);
      return btn;
    };

    const paintPins = () => {
      const selected = renderer.getSelection();
      const pins = renderer.pinLabels().sort((a, b) => pinRank(a.hit, selected) - pinRank(b.hit, selected));
      const seen = new Set<string>();
      const placed: { x: number; y: number; w: number; h: number }[] = [];

      for (const pin of pins) {
        const key = hitKey(pin.hit);
        seen.add(key);
        const btn = ensureButton(pin);
        const hash = `${pin.title}|${pin.tag}|${pin.color}`;
        if (btn.dataset.hash !== hash) {
          btn.dataset.hash = hash;
          btn.replaceChildren();
          const mark = document.createElement('span');
          mark.className = PIN_MARK;
          mark.style.background = pin.color;
          mark.textContent = pin.title.slice(0, 1).toUpperCase();
          const name = document.createElement('span');
          name.className = PIN_NAME;
          name.textContent = pin.title;
          const tag = document.createElement('span');
          tag.className = PIN_TAG;
          tag.style.color = pin.color;
          tag.style.background = `${pin.color}1f`;
          tag.textContent = pin.tag;
          btn.append(mark, name, tag);
        }

        const scr = renderer.projectWorld(pin.x, pin.y, pin.z);
        const on = sameHit(selected, pin.hit);
        btn.classList.toggle('ring-2', on);
        btn.classList.toggle('ring-sky-500', on);
        btn.style.zIndex = on ? '8' : String(6 - pinRank(pin.hit, selected));

        const w = btn.offsetWidth || Math.min(220, 72 + pin.title.length * 7);
        const h = btn.offsetHeight || 30;
        const box = { x: scr.x - w / 2, y: scr.y - h - 6, w, h };
        const overlap = placed.some(
          (p) => box.x < p.x + p.w - 8 && box.x + box.w > p.x + 8 && box.y < p.y + p.h - 6 && box.y + box.h > p.y + 6,
        );
        const hide = !scr.visible || (overlap && !on);
        if (!hide) placed.push(box);
        btn.style.left = `${scr.x}px`;
        btn.style.top = `${scr.y}px`;
        btn.style.display = hide ? 'none' : 'flex';
        btn.style.opacity = on ? '1' : hide ? '0' : '0.98';
      }

      for (const [key, btn] of buttons) {
        if (seen.has(key)) continue;
        btn.remove();
        buttons.delete(key);
      }
    };

    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      renderer.frame(t, Math.min(0.05, (t - last) / 1000));
      paintPins();
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
        renderer.select(hit);
        onSelectRef.current?.(hit);
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
      overlay.replaceChildren();
      renderer.dispose();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.scene = scene;
  }, [scene, rendererRef]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className={className ?? 'block h-full w-full touch-none select-none'}
        aria-label="3D London startup neighbourhood map; use the neighbourhood selector to choose an HQ"
      />
      <div ref={overlayRef} className="pointer-events-none absolute inset-0 z-[6] overflow-hidden" />
    </>
  );
}
