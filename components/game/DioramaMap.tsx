'use client';

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { HUBS, hubById } from '@/lib/game/content';
import { DIORAMA_ASSETS, DIORAMA_HUBS, SECTOR_HUE_ROTATION, focusAssets } from '@/lib/game/diorama';
import type { DioramaController, HitTarget, Scene } from '@/lib/game/map-scene';
import type { HubId } from '@/lib/game/types';

interface Props {
  scene: Scene;
  controllerRef: RefObject<DioramaController | null>;
  onHit?: (target: HitTarget) => void;
  celebrateHubId?: HubId | null;
  onCelebrationShown?: () => void;
  showHubChips?: boolean;
  className?: string;
}

interface ArtRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface FxItem {
  id: number;
  kind: 'confetti' | 'float' | 'smoke' | 'spark';
  hubId: HubId | null;
  text?: string;
  color?: string;
}

const MASTER_ASPECT = 16 / 9;
const FX_LIFETIME = 2300;

export function focusIsVisible(
  focusReady: boolean,
  reducedMotion: boolean,
  focusSettled: boolean,
): boolean {
  return focusReady && (reducedMotion || focusSettled);
}

export function elasticPinchScale(ratio: number): number {
  return Math.max(0.92, Math.min(1.08, 1 + (ratio - 1) * 0.18));
}

export function rivalMarkerSlot(hubRivalIndex: number): number {
  return 1 + hubRivalIndex;
}

export function eventMarkerSlot(hubRivalCount: number, hubEventIndex: number): number {
  return 1 + hubRivalCount + hubEventIndex;
}

export function leftMobileBreakpoint(previouslyNarrow: boolean, nextNarrow: boolean): boolean {
  return previouslyNarrow && !nextNarrow;
}

function TokenPlaceholder() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 3 42 13v22L24 45 6 35V13Z" fill="currentColor" />
      <path d="m24 8 12 7v16l-12 7-12-7V15Z" fill="none" stroke="white" strokeWidth="2" />
    </svg>
  );
}

function TokenSprite({
  src,
  alt,
  className,
  style,
}: {
  src: string;
  alt: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <span className={`clay-token ${className ?? ''}`} style={style}>
      {!loaded && (
        <span className="clay-token-placeholder">
          <TokenPlaceholder />
        </span>
      )}
      {/* The placeholder remains until the decoded token is ready. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={() => setLoaded(true)}
        className={loaded ? 'is-loaded' : ''}
      />
    </span>
  );
}

function masterRect(width: number, height: number, scale: number, cover: boolean): ArtRect {
  const containerAspect = width / Math.max(1, height);
  let artWidth: number;
  let artHeight: number;
  if ((cover && containerAspect > MASTER_ASPECT) || (!cover && containerAspect < MASTER_ASPECT)) {
    artWidth = width;
    artHeight = width / MASTER_ASPECT;
  } else {
    artHeight = height;
    artWidth = height * MASTER_ASPECT;
  }
  artWidth *= scale;
  artHeight *= scale;
  return {
    left: (width - artWidth) / 2,
    top: (height - artHeight) / 2,
    width: artWidth,
    height: artHeight,
  };
}

function clampPan(pan: { x: number; y: number }, rect: ArtRect, width: number, height: number) {
  const limitX = Math.max(0, (rect.width - width) / 2);
  const limitY = Math.max(0, (rect.height - height) / 2);
  return {
    x: Math.max(-limitX, Math.min(limitX, pan.x)),
    y: Math.max(-limitY, Math.min(limitY, pan.y)),
  };
}

export function DioramaMap({
  scene,
  controllerRef,
  onHit,
  celebrateHubId,
  onCelebrationShown,
  showHubChips = true,
  className,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [narrow, setNarrow] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [pinchScale, setPinchScale] = useState(1);
  const [pinching, setPinching] = useState(false);
  const [masterLoaded, setMasterLoaded] = useState(false);
  const [focusHub, setFocusHub] = useState<HubId | null>(null);
  const [focusReady, setFocusReady] = useState(false);
  const [focusSettled, setFocusSettled] = useState(false);
  const [fx, setFx] = useState<FxItem[]>([]);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    panX: number;
    panY: number;
    moved: boolean;
  } | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchStartRef = useRef<{ distance: number } | null>(null);
  const wasNarrowRef = useRef(false);
  const fxId = useRef(0);
  const artScale = narrow ? 1.34 : 1.18;
  const rect = useMemo(
    () => masterRect(size.width, size.height, artScale, narrow),
    [size, artScale, narrow],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      const bounds = root.getBoundingClientRect();
      const nextNarrow = window.matchMedia('(max-width: 767px)').matches;
      if (leftMobileBreakpoint(wasNarrowRef.current, nextNarrow)) {
        setPan({ x: 0, y: 0 });
        setPinchScale(1);
        setPinching(false);
      }
      wasNarrowRef.current = nextNarrow;
      setSize({ width: bounds.width, height: bounds.height });
      setNarrow(nextNarrow);
      setReducedMotion(reducedMotionQuery.matches);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(root);
    window.addEventListener('resize', update);
    reducedMotionQuery.addEventListener('change', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      reducedMotionQuery.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;
      const bounds = root.getBoundingClientRect();
      setSize({ width: bounds.width, height: bounds.height });
      setNarrow(window.matchMedia('(max-width: 767px)').matches);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scene.mode]);

  const positionForHub = useCallback(
    (hubId: HubId) => {
      const anchor = DIORAMA_HUBS[hubId].anchor;
      return {
        x: rect.left + rect.width * anchor.x + pan.x,
        y: rect.top + rect.height * anchor.y + pan.y,
      };
    },
    [rect, pan],
  );

  const panToHub = useCallback(
    (hubId: HubId) => {
      if (!narrow) return;
      const anchor = DIORAMA_HUBS[hubId].anchor;
      const target = {
        x: size.width / 2 - (rect.left + rect.width * anchor.x),
        y: size.height * 0.48 - (rect.top + rect.height * anchor.y),
      };
      setPan(clampPan(target, rect, size.width, size.height));
    },
    [narrow, rect, size],
  );

  const chooseFocus = useCallback(
    (hubId: HubId) => {
      setFocusReady(false);
      setFocusSettled(false);
      setFocusHub(hubId);
      if (scene.mode === 'setup') onHit?.({ type: 'hub', hubId });
    },
    [onHit, scene.mode],
  );

  const fitAll = useCallback(() => {
    setFocusHub(null);
    setFocusReady(false);
    setFocusSettled(false);
    setPan({ x: 0, y: 0 });
  }, []);

  const addFx = useCallback((item: Omit<FxItem, 'id'>) => {
    const id = ++fxId.current;
    setFx((current) => [...current, { ...item, id }]);
    window.setTimeout(() => {
      setFx((current) => current.filter((candidate) => candidate.id !== id));
    }, FX_LIFETIME);
  }, []);

  useEffect(() => {
    if (scene.mode !== 'play' || !celebrateHubId) return;
    const timer = window.setTimeout(() => {
      addFx({ kind: 'confetti', hubId: celebrateHubId });
      onCelebrationShown?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [addFx, celebrateHubId, onCelebrationShown, scene.mode]);

  useImperativeHandle(
    controllerRef,
    () => ({
      fitAll,
      focusHub: chooseFocus,
      burstConfetti: (hubId) => addFx({ kind: 'confetti', hubId }),
      floatText: (hubId, text, color = '#28644d') => addFx({ kind: 'float', hubId, text, color }),
      puffSmoke: (hubId) => addFx({ kind: 'smoke', hubId }),
      sparkle: (hubId) => addFx({ kind: 'spark', hubId }),
    }),
    [addFx, chooseFocus, fitAll],
  );

  useEffect(() => {
    if (!focusHub) return;
    if (reducedMotion) return;
    const timer = window.setTimeout(() => setFocusSettled(true), 410);
    return () => window.clearTimeout(timer);
  }, [focusHub, reducedMotion]);

  useEffect(() => {
    if (!narrow || focusHub) return;
    if (!scene.playerHubId) return;
    const frame = window.requestAnimationFrame(() => panToHub(scene.playerHubId!));
    return () => window.cancelAnimationFrame(frame);
  }, [narrow, focusHub, panToHub, scene.playerHubId]);

  useEffect(() => {
    if (scene.mode !== 'play' || !scene.playerHubId) return;
    const playerFocus = focusAssets(scene.playerHubId);
    const timer = window.setTimeout(() => {
      const prefetchedFocus = new Image();
      prefetchedFocus.src = playerFocus.avifSmall;
    }, 800);
    return () => window.clearTimeout(timer);
  }, [scene.mode, scene.playerHubId]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!narrow || event.pointerType === 'mouse') return;
    if (event.nativeEvent.isTrusted) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()];
      pinchStartRef.current = {
        distance: Math.hypot(second.x - first.x, second.y - first.y),
      };
      dragRef.current = null;
      setPinching(true);
      return;
    }
    if (focusHub) return;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pointersRef.current.size >= 2 && pinchStartRef.current) {
      const [first, second] = [...pointersRef.current.values()];
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const ratio = distance / Math.max(1, pinchStartRef.current.distance);
      setPinchScale(elasticPinchScale(ratio));
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.moved ||= Math.abs(dx) + Math.abs(dy) > 5;
    const raw = { x: drag.panX + dx, y: drag.panY + dy };
    const clamped = clampPan(raw, rect, size.width, size.height);
    setPan({
      x: clamped.x + (raw.x - clamped.x) * 0.18,
      y: clamped.y + (raw.y - clamped.y) * 0.18,
    });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) {
      pinchStartRef.current = null;
      setPinching(false);
      setPinchScale(1);
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      dragRef.current = null;
      return;
    }
    setPan((current) => clampPan(current, rect, size.width, size.height));
    dragRef.current = null;
  };

  const focus = focusHub ? focusAssets(focusHub) : null;
  const focusVisible = focusIsVisible(focusReady, reducedMotion, focusSettled);
  const focusAnchor = focusHub ? DIORAMA_HUBS[focusHub].anchor : { x: 0.5, y: 0.5 };
  const focusHubInfo = focusHub ? hubById(focusHub) : null;
  const focusedRivals = focusHub
    ? scene.rivals.filter((rival) => rival.hubId === focusHub && rival.alive)
    : [];
  const focusedEvents = focusHub
    ? scene.events.filter((event) => event.hubId === focusHub && !event.attended)
    : [];

  const markerPosition = (hubId: HubId, index = 0) => {
    const offsets = [
      [0, -18],
      [-30, 16],
      [30, 16],
      [-44, -14],
      [44, -14],
      [-58, 28],
      [58, 28],
      [0, 46],
    ];
    const [offsetX, offsetY] = offsets[index % offsets.length];
    if (focusHub === hubId) {
      return {
        left: `calc(50% + ${offsetX * 1.8}px)`,
        top: `calc(50% + ${offsetY * 1.5}px)`,
      };
    }
    const point = positionForHub(hubId);
    return { left: point.x + offsetX, top: point.y + offsetY };
  };

  return (
    <div
      ref={rootRef}
      className={`diorama-map mode-${scene.mode} ${focusHub ? 'is-focused' : ''} ${pinching ? 'is-pinching' : ''} ${className ?? ''}`}
      style={
        {
          '--pinch-scale': pinchScale,
          backgroundImage: `url("${DIORAMA_ASSETS.master.avifSmall}")`,
        } as CSSProperties
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="region"
      aria-label="London startup diorama. Choose a neighbourhood marker to inspect that hub."
    >
      <div
        className={`diorama-master-layer ${masterLoaded ? 'is-loaded' : ''}`}
        style={
          {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            '--pan-x': `${pan.x}px`,
            '--pan-y': `${pan.y}px`,
            '--focus-x': `${focusAnchor.x * 100}%`,
            '--focus-y': `${focusAnchor.y * 100}%`,
            backgroundImage: `url("${DIORAMA_ASSETS.master.lqip}")`,
          } as CSSProperties
        }
      >
        <picture>
          <source
            type="image/avif"
            srcSet={`${DIORAMA_ASSETS.master.avifSmall} 2560w, ${DIORAMA_ASSETS.master.avif} 5120w`}
            sizes="(max-width: 767px) 180vw, calc(100vw - 398px)"
          />
          <source
            type="image/webp"
            srcSet={`${DIORAMA_ASSETS.master.webpSmall} 2560w, ${DIORAMA_ASSETS.master.webp} 5120w`}
            sizes="(max-width: 767px) 180vw, calc(100vw - 398px)"
          />
          <img
            src={DIORAMA_ASSETS.master.webpSmall}
            alt="A low-poly London startup city wrapped around the Thames"
            onLoad={() => setMasterLoaded(true)}
            draggable={false}
          />
        </picture>
      </div>

      {focusHub && focus && (
        <picture className={`diorama-focus-layer ${focusVisible ? 'is-visible' : ''}`}>
          <source
            type="image/avif"
            srcSet={`${focus.avifSmall} 1280w, ${focus.avif} 2560w`}
            sizes="100vw"
          />
          <source
            type="image/webp"
            srcSet={`${focus.webpSmall} 1280w, ${focus.webp} 2560w`}
            sizes="100vw"
          />
          <img
            src={focus.webpSmall}
            alt={`${focusHubInfo?.name} startup district in the London diorama`}
            onLoad={() => setFocusReady(true)}
            draggable={false}
          />
        </picture>
      )}

      {!focusHub &&
        HUBS.map((hub) => {
          const point = positionForHub(hub.id);
          const hasPlayer = scene.playerHubId === hub.id;
          const hasRival = scene.rivals.some((rival) => rival.hubId === hub.id && rival.alive);
          const hasEvent = scene.events.some((event) => event.hubId === hub.id && !event.attended);
          return (
            <button
              key={hub.id}
              type="button"
              className={`hub-hotspot ${hasPlayer ? 'has-player' : ''}`}
              style={
                {
                  left: point.x,
                  top: point.y,
                  '--hub-accent': DIORAMA_HUBS[hub.id].accent,
                } as CSSProperties
              }
              onClick={() => {
                chooseFocus(hub.id);
                if (scene.mode === 'play') onHit?.({ type: 'hub', hubId: hub.id });
              }}
              aria-label={`Focus ${hub.name}${hasPlayer ? ', your HQ' : ''}`}
            >
              <span>{hub.name}</span>
              <i aria-hidden="true">
                {hasPlayer && <b className="status-dot player" />}
                {hasRival && <b className="status-dot rival" />}
                {hasEvent && <b className="status-dot event" />}
              </i>
            </button>
          );
        })}

      {scene.playerHubId && (!focusHub || scene.playerHubId === focusHub) && (
        <button
          type="button"
          className="token-button player-token"
          style={markerPosition(scene.playerHubId, 0)}
          onClick={() => chooseFocus(scene.playerHubId!)}
          aria-label={`${scene.companyName || 'Your startup'} headquarters at ${hubById(scene.playerHubId).name}`}
        >
          <TokenSprite
            src={DIORAMA_ASSETS.tokens.hq}
            alt=""
            style={{
              filter: `brightness(0.92) sepia(1) saturate(4.5) hue-rotate(${
                scene.playerSectorId ? SECTOR_HUE_ROTATION[scene.playerSectorId] : 0
              }deg)`,
            }}
          />
        </button>
      )}

      {scene.rivals
        .filter((rival) => rival.alive && (!focusHub || rival.hubId === focusHub))
        .map((rival) => {
          const hubRivalIndex = scene.rivals
            .filter((candidate) => candidate.alive && candidate.hubId === rival.hubId)
            .findIndex((candidate) => candidate.id === rival.id);
          return (
            <button
              key={rival.id}
              type="button"
              className="token-button rival-token"
              style={markerPosition(rival.hubId, rivalMarkerSlot(hubRivalIndex))}
              onClick={() => onHit?.({ type: 'rival', rivalId: rival.id })}
              aria-label={`${rival.name}, ${rival.stageName} rival at ${hubById(rival.hubId).name}`}
            >
              <TokenSprite src={DIORAMA_ASSETS.tokens.rival} alt="" />
            </button>
          );
        })}

      {scene.events
        .filter((event) => !event.attended && (!focusHub || event.hubId === focusHub))
        .map((event) => {
          const rivalOffset = scene.rivals.filter(
            (rival) => rival.alive && rival.hubId === event.hubId,
          ).length;
          const hubEventIndex = scene.events
            .filter((candidate) => !candidate.attended && candidate.hubId === event.hubId)
            .findIndex((candidate) => candidate.id === event.id);
          return (
            <button
              key={event.id}
              type="button"
              className="token-button event-token"
              style={markerPosition(event.hubId, eventMarkerSlot(rivalOffset, hubEventIndex))}
              onClick={() => onHit?.({ type: 'event', eventId: event.id })}
              aria-label={`${event.name} at ${hubById(event.hubId).name}; attend event`}
            >
              <TokenSprite src={DIORAMA_ASSETS.tokens.event} alt="" />
            </button>
          );
        })}

      {focusHub && focusHubInfo && (
        <>
          <button type="button" className="focus-back" onClick={fitAll}>
            <span aria-hidden="true">←</span> City view
          </button>
          {scene.mode === 'play' && (
            <section className={`focus-card ${focusVisible ? 'is-visible' : ''}`}>
              <p>{DIORAMA_HUBS[focusHub].name}</p>
              <h2>{focusHubInfo.blurb}</h2>
              <dl>
                <div>
                  <dt>Rent</dt>
                  <dd>£{focusHubInfo.rent.toLocaleString('en-GB')}/wk</dd>
                </div>
                <div>
                  <dt>On the map</dt>
                  <dd>
                    {focusedRivals.length} rival{focusedRivals.length === 1 ? '' : 's'} ·{' '}
                    {focusedEvents.length} event{focusedEvents.length === 1 ? '' : 's'}
                  </dd>
                </div>
              </dl>
            </section>
          )}
        </>
      )}

      {showHubChips && (
        <nav className="hub-chip-strip" aria-label="Jump to a startup hub">
          {HUBS.map((hub) => {
            const active = focusHub === hub.id;
            const hasPlayer = scene.playerHubId === hub.id;
            const hasRival = scene.rivals.some((rival) => rival.hubId === hub.id && rival.alive);
            const hasEvent = scene.events.some(
              (event) => event.hubId === hub.id && !event.attended,
            );
            return (
              <button
                type="button"
                key={hub.id}
                className={active ? 'is-active' : ''}
                onClick={() => (focusHub ? chooseFocus(hub.id) : panToHub(hub.id))}
              >
                {hub.name.replace("King's Cross", "King's X").replace('London Bridge', 'Borough')}
                <span aria-hidden="true">
                  {hasPlayer && <i className="status-dot player" />}
                  {hasRival && <i className="status-dot rival" />}
                  {hasEvent && <i className="status-dot event" />}
                </span>
              </button>
            );
          })}
        </nav>
      )}

      <div className="diorama-fx-layer" aria-hidden="true">
        {fx.map((item) => {
          const point = item.hubId
            ? positionForHub(item.hubId)
            : { x: size.width / 2, y: size.height / 2 };
          return (
            <span
              key={item.id}
              className={`diorama-fx fx-${item.kind}`}
              style={{ left: point.x, top: point.y, color: item.color }}
            >
              {item.kind === 'float' ? item.text : item.kind === 'smoke' ? '●' : '✦'}
            </span>
          );
        })}
      </div>
    </div>
  );
}
