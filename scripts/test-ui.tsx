/**
 * RUNWAY structural UI regression checks.
 *
 * These deliberately render the real React components without a browser.
 * Native-dialog focus trapping and responsive geometry still receive live
 * browser QA, while this suite guards the stable markup and layout contracts.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { metadata as gameMetadata } from '../app/game/page';
import {
  DioramaMap,
  elasticPinchScale,
  eventMarkerSlot,
  focusIsVisible,
  leftMobileBreakpoint,
  rivalMarkerSlot,
} from '../components/game/DioramaMap';
import { GameApp } from '../components/game/GameApp';
import { DilemmaModal, EndOverlay, MoveModal } from '../components/game/Modals';
import { SetupOverlay } from '../components/game/SetupOverlay';
import { DILEMMAS, HUBS } from '../lib/game/content';
import { newGame } from '../lib/game/engine';
import type { DioramaController } from '../lib/game/map-scene';

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

const noop = () => undefined;
const SetupForTest = SetupOverlay as ComponentType<Record<string, unknown>>;
const dioramaSource = readFileSync(
  new URL('../components/game/DioramaMap.tsx', import.meta.url),
  'utf8',
);
const gameAppSource = readFileSync(
  new URL('../components/game/GameApp.tsx', import.meta.url),
  'utf8',
);

function setupMarkup(step: 'identity' | 'hq'): string {
  return renderToStaticMarkup(
    <SetupForTest
      step={step}
      name="Test Foundry"
      sectorId="ai"
      hubChoice={null}
      onName={noop}
      onSector={noop}
      onHub={noop}
      onRollName={noop}
      onToHq={noop}
      onBack={noop}
      onConfirm={noop}
    />,
  );
}

console.log('RUNWAY UI regression tests');

check('title and setup use the full mobile viewport when no sidebar exists', () => {
  const html = renderToStaticMarkup(<GameApp />);
  const dioramaAt = html.indexOf('aria-label="London startup diorama');
  assert.ok(dioramaAt > 0, 'title screen should render the London diorama');
  const dioramaTagAt = html.lastIndexOf('<div class="', dioramaAt);
  const paneAt = html.lastIndexOf('<div class="', dioramaTagAt - 1);
  const paneTag = html.slice(paneAt, html.indexOf('>', paneAt) + 1);
  assert.match(
    paneTag,
    /min-h-0 flex-1/,
    'title map pane should take the full remaining mobile viewport',
  );
  assert.doesNotMatch(paneTag, /h-\[44dvh\]/, '44dvh is reserved for the in-game split view');
});

check('the London diorama ships responsive master art without covering the title CTA', () => {
  const html = renderToStaticMarkup(<GameApp />);
  assert.match(html, /master-2560\.avif 2560w/);
  assert.match(html, /master-5120\.avif 5120w/);
  assert.doesNotMatch(html, /aria-label="Jump to a startup hub"/);
  for (const hub of HUBS) {
    const escapedName = hub.name.replaceAll("'", '&#x27;');
    assert.ok(
      html.includes(`Focus ${escapedName}`),
      `city state should expose a focus control for ${hub.name}`,
    );
  }
  assert.doesNotMatch(html, /<canvas/, 'the superseded canvas renderer should not remain');

  const map = renderToStaticMarkup(
    <DioramaMap
      controllerRef={React.createRef<DioramaController | null>()}
      showHubChips
      scene={{
        mode: 'setup',
        playerHubId: null,
        playerSectorId: null,
        companyName: '',
        rivals: [],
        events: [],
      }}
    />,
  );
  assert.match(map, /aria-label="Jump to a startup hub"/);
});

check('identity setup is a labelled, top-reachable dialog', () => {
  const html = setupMarkup('identity');
  assert.match(html, /<dialog[^>]+aria-modal="true"/);
  assert.match(html, /aria-labelledby="setup-title"/);
  assert.match(html, /<label[^>]+for="company-name"/);
  assert.match(html, /<input[^>]+id="company-name"/);
  assert.match(html, /my-auto/, 'the card should centre only when vertical space is available');
});

check('HQ setup exposes every neighbourhood through a labelled native selector', () => {
  const html = setupMarkup('hq');
  assert.match(html, /<label[^>]+for="hq-select"/);
  assert.match(html, /<select[^>]+id="hq-select"/);
  for (const hub of HUBS) {
    assert.ok(html.includes(`value="${hub.id}"`), `selector should include ${hub.name}`);
    assert.ok(
      html.includes(`£${hub.rent.toLocaleString('en-GB')}/week`),
      `selector should explain ${hub.name} rent`,
    );
  }
});

check('dilemma, move, and end overlays use modal dialog semantics', () => {
  const dilemma = renderToStaticMarkup(
    <DilemmaModal dilemma={DILEMMAS[0]} week={4} onChoose={noop} />,
  );
  assert.match(dilemma, /<dialog[^>]+aria-modal="true"/);
  assert.match(dilemma, /aria-labelledby="dilemma-title-/);
  assert.match(dilemma, /aria-describedby="dilemma-body-/);

  const game = newGame({
    companyName: 'ModalCo',
    sectorId: 'devtools',
    hubId: 'farringdon',
    seed: 42,
  });
  const move = renderToStaticMarkup(<MoveModal game={game} onMove={noop} onClose={noop} />);
  assert.match(move, /<dialog[^>]+aria-modal="true"/);
  assert.match(move, /aria-labelledby="move-title-/);
  assert.match(move, /aria-describedby="move-description-/);
  assert.match(move, /aria-label="Close move office dialog"/);

  game.phase = 'bankrupt';
  const end = renderToStaticMarkup(<EndOverlay game={game} onRestart={noop} onTitle={noop} />);
  assert.match(end, /<dialog[^>]+aria-modal="true"/);
  assert.match(end, /aria-labelledby="end-title-/);
});

check('the London game uses pounds consistently for its unicorn goal', () => {
  const title = renderToStaticMarkup(<GameApp />);
  assert.match(title, /£1B valuation/);
  assert.doesNotMatch(title, /\$1B/);

  const game = newGame({
    companyName: 'PoundCo',
    sectorId: 'fintech',
    hubId: 'canarywharf',
    seed: 99,
  });
  game.phase = 'won';
  const end = renderToStaticMarkup(<EndOverlay game={game} onRestart={noop} onTitle={noop} />);
  assert.match(end, /One billion pounds/);
  assert.doesNotMatch(end, /dollars/i);

  assert.doesNotMatch(JSON.stringify(gameMetadata), /\$1B/);
});

check('the mobile hero keeps its copy readable and sound control named', () => {
  const html = renderToStaticMarkup(<GameApp />);
  assert.match(html, /class="title-copy"/);
  assert.match(html, /class="title-primary"/);
  assert.match(html, /aria-label="Mute sound"/);
});

check('motion and touch fallbacks preserve the two designed zoom states', () => {
  assert.match(dioramaSource, /prefers-reduced-motion: reduce/);
  assert.match(dioramaSource, /pointersRef/);
  assert.equal(focusIsVisible(true, true, false), true);
  assert.equal(focusIsVisible(true, false, false), false);
  assert.equal(focusIsVisible(true, false, true), true);
  assert.equal(focusIsVisible(false, true, true), false);
  assert.equal(elasticPinchScale(2), 1.08);
  assert.equal(elasticPinchScale(0.5), 0.92);
  assert.equal(elasticPinchScale(1), 1);
  assert.deepEqual(
    [rivalMarkerSlot(0), rivalMarkerSlot(1), eventMarkerSlot(2, 0), eventMarkerSlot(2, 1)],
    [1, 2, 3, 4],
  );
  assert.equal(leftMobileBreakpoint(true, false), true);
  assert.equal(leftMobileBreakpoint(false, false), false);
  assert.doesNotMatch(gameAppSource, /backdrop-blur|shadow-xl/);
});

console.log(`\nAll ${passed} UI checks passed.`);
