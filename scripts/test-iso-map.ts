/**
 * Offline isometric map hit-test contract tests.
 * Run via: pnpm test:game
 */
import assert from 'node:assert/strict';
import { HUBS } from '../lib/game/content';
import { newGame } from '../lib/game/engine';
import { IsoMapRenderer } from '../lib/game/iso-render';
import { MIN_HIT_PX } from '../lib/game/sprites';
import type { Scene } from '../lib/game/map-scene';

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function playScene(): Scene {
  const g = newGame({ companyName: 'Test Co', sectorId: 'ai', hubId: 'shoreditch' });
  return {
    mode: 'play',
    playerHubId: g.hubId,
    playerSectorId: g.sectorId,
    companyName: g.companyName,
    stageName: 'Pre-seed',
    rivals: g.rivals
      .filter((r) => r.alive)
      .slice(0, 2)
      .map((r) => ({
        id: r.id,
        name: r.name,
        hubId: r.hubId,
        sectorId: r.sectorId,
        stageName: 'Seed',
        alive: true,
      })),
    events: g.eventsThisWeek
      .filter((e) => !e.attended)
      .slice(0, 1)
      .map((e) => ({
        id: e.id,
        name: `★ ${e.name}`,
        hubId: e.hubId,
        attended: false,
      })),
  };
}

function hubGroundPoint(renderer: IsoMapRenderer, hubId: (typeof HUBS)[number]['id']) {
  return renderer.hubScreenCenter(hubId);
}

export function runIsoMapTests(): void {
  console.log('\nIso map hit-test contract');

  check('hub ground resolves to hub target at city zoom', () => {
    const r = IsoMapRenderer.forTest(390, 844);
    r.scene = { mode: 'setup', playerHubId: null, playerSectorId: null, companyName: '', stageName: '', rivals: [], events: [] };
    const p = hubGroundPoint(r, 'shoreditch');
    const hit = r.hitTest(p.x, p.y);
    assert.ok(hit?.type === 'hub' && hit.hubId === 'shoreditch');
  });

  check('all eight hub grounds are hittable at city zoom', () => {
    const r = IsoMapRenderer.forTest(390, 844);
    r.scene = { mode: 'setup', playerHubId: null, playerSectorId: null, companyName: '', stageName: '', rivals: [], events: [] };
    for (const hub of HUBS) {
      const p = hubGroundPoint(r, hub.id);
      const hit = r.hitTest(p.x, p.y);
      assert.ok(hit?.type === 'hub' && hit.hubId === hub.id, `hub ${hub.id} should be hittable`);
    }
  });

  check('dead rivals and attended events are not hittable', () => {
    const r = IsoMapRenderer.forTest(390, 844);
    const scene = playScene();
    const rivalId = scene.rivals[0]?.id;
    const eventId = scene.events[0]?.id;
    assert.ok(rivalId && eventId);
    r.scene = scene;
    r.focusHub('shoreditch');

    const rivalHitBefore = r.hitTest(195, 400);
    r.scene = {
      ...scene,
      rivals: scene.rivals.map((rv) => (rv.id === rivalId ? { ...rv, alive: false } : rv)),
      events: scene.events.map((ev) => (ev.id === eventId ? { ...ev, attended: true } : ev)),
    };

    // Probe several points — none should return removed entities
    for (let y = 200; y < 600; y += 40) {
      for (let x = 80; x < 310; x += 40) {
        const hit = r.hitTest(x, y);
        if (hit?.type === 'rival') assert.notEqual(hit.rivalId, rivalId);
        if (hit?.type === 'event') assert.notEqual(hit.eventId, eventId);
      }
    }
    assert.ok(rivalHitBefore?.type === 'rival' || rivalHitBefore?.type === 'hub' || rivalHitBefore?.type === 'player');
  });

  check('building hits meet minimum touch target size on mobile preset', () => {
    const r = IsoMapRenderer.forTest(390, 844);
    r.scene = playScene();
    r.focusHub(r.scene.playerHubId!);

    let checked = 0;
    for (let y = 120; y < 700; y += 24) {
      for (let x = 40; x < 350; x += 24) {
        const hit = r.hitTest(x, y);
        if (!hit || hit.type === 'hub') continue;
        const size = r.hitRegionSizeAt(x, y);
        assert.ok(size, 'hit region should exist');
        assert.ok(size!.w >= MIN_HIT_PX || size!.h >= MIN_HIT_PX, `target ${hit.type} too small: ${size!.w}x${size!.h}`);
        checked += 1;
      }
    }
    assert.ok(checked > 0, 'expected at least one entity hit region');
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runIsoMapTests();
  console.log(`\n${passed} iso map tests passed.`);
}
