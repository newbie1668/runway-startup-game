import assert from 'node:assert/strict';
import { HUBS, SECTORS, STAGES } from '@/lib/game/content';
import { LANDMARKS, WORLD, project } from '@/lib/game/geo';
import { MapRenderer } from '@/lib/game/render';
import { hasProjection } from '@/lib/game/mapProjection';
import {
  DILEMMAS,
  FEATURES,
  JOURNAL_HYPE,
  LEAD_VENUES,
  LANDMARK_FACTS,
  OFFICE_LEVELS,
  PLACE_AT,
  PLACE_RENAME,
  PLACES,
} from '@/lib/rts/content';
import {
  autoCommands,
  canResearch,
  hire,
  journalProgress,
  movePeople,
  newRtsGame,
  openOffice,
  personActivity,
  pitch,
  pitchPreview,
  resolveDilemma,
  setResearch,
  teamCap,
  tick,
  upgradeOffice,
  unlockedSegments,
} from '@/lib/rts/sim';
import { polylineLength, streetPath } from '@/lib/rts/walk';
import type { CompanyId, Person, RtsState } from '@/lib/rts/types';

let checks = 0;

function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  console.log(`✓ ${name}`);
}

function game(seed = 'rts-test'): RtsState {
  return newRtsGame({
    seed,
    companyName: 'Test Startup',
    sectorId: 'devtools',
    hqHub: 'shoreditch',
  });
}

function assertSane(state: RtsState): void {
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'number')
      assert.ok(Number.isFinite(value), `${path} must be finite, got ${value}`);
    else if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${path}[${index}]`));
    else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
    }
  };
  walk(state, 'state');
  for (const company of Object.values(state.companies)) {
    assert.ok(company.product >= 0 && company.product <= 100, `${company.id} product out of range`);
    assert.ok(company.hype >= 0 && company.hype <= 100, `${company.id} hype out of range`);
  }
  for (const place of state.places) {
    if (place.kind === 'customers') {
      assert.ok(place.pool >= 0 && place.pool <= place.poolMax, `${place.id} pool out of range`);
    }
  }
  assert.equal(
    state.phase === 'dilemma',
    state.dilemma !== null,
    'phase and active dilemma must agree',
  );
  const validLocations = new Set([
    ...state.places.map((place) => place.id),
    ...state.offices.map((office) => office.id),
  ]);
  for (const person of state.people) {
    assert.ok(
      person.at === null || validLocations.has(person.at),
      `${person.id} has invalid location ${person.at}`,
    );
  }
}

function snapshot(state: RtsState): RtsState {
  return structuredClone(state);
}

function expectRefusedUnchanged(
  state: RtsState,
  invoke: (input: RtsState) => { state: RtsState; error?: string },
): void {
  const before = snapshot(state);
  const result = invoke(state);
  assert.ok(result.error, 'expected command to be refused');
  assert.deepEqual(state, before, 'refused command mutated input');
  assert.deepEqual(result.state, before, 'refused command returned a changed state');
}

function setPersonAtPlace(state: RtsState, person: Person, placeId: string): void {
  const place = state.places.find((item) => item.id === placeId);
  assert.ok(place);
  person.x = place.x;
  person.y = place.y;
  person.at = place.id;
  person.order = null;
}

function addWorkerAtPlace(
  state: RtsState,
  company: CompanyId,
  role: 'growth' | 'engineer',
  placeId: string,
): Person {
  const place =
    state.places.find((item) => item.id === placeId) ??
    state.offices.find((item) => item.id === placeId);
  assert.ok(place);
  const person: Person = {
    id: `test-${company}-${role}-${state.people.length}`,
    company,
    role,
    name: 'Test',
    x: place.x,
    y: place.y,
    at: place.id,
    order: null,
    salary: role === 'engineer' ? 1_600 : 1_400,
    skill: 1,
  };
  state.people.push(person);
  return person;
}

function makeActiveDilemma(state: RtsState): void {
  const card = DILEMMAS[0];
  state.phase = 'dilemma';
  state.dilemma = {
    id: card.id,
    title: card.title,
    body: card.body,
    hubId: 'shoreditch',
    options: card.options.map((option) => ({ label: option.label, hint: option.body })),
  };
}

function simulateBot(seed: number, maxDays = 300): { state: RtsState; winDay: number | null } {
  const sectors = SECTORS.map((sector) => sector.id);
  const hubs = HUBS.map((hub) => hub.id);
  let state = newRtsGame({
    seed: `balance-${seed}`,
    companyName: 'London Startup',
    sectorId: sectors[seed % sectors.length],
    hqHub: hubs[Math.floor(seed / sectors.length) % hubs.length],
  });
  let winDay: number | null = null;
  while (state.day < maxDays && state.phase !== 'won' && state.phase !== 'bankrupt') {
    state = tick(state, 0.5).state;
    assertSane(state);
    if (state.phase === 'dilemma') {
      state = resolveDilemma(state, 0).state;
      assertSane(state);
    }
    if (state.phase === 'playing') {
      state = autoCommands(state, 'player').state;
      assertSane(state);
    }
    if (state.phase === 'won') {
      winDay = state.day;
      break;
    }
  }
  return { state, winDay };
}

check('initial state has a separate founder, engineer, office, and place pool per company', () => {
  const state = game();
  assert.equal(state.people.filter((person) => person.company === 'player').length, 2);
  assert.equal(state.offices.filter((office) => office.company === 'player').length, 1);
  assert.equal(teamCap(state, 'player'), OFFICE_LEVELS[0].capacity);
  assert.ok(state.places.some((place) => place.kind === 'customers' && place.poolMax > 0));
  assert.equal(state.companies.player.researching, 'mvp');
  assertSane(state);
});

check('all authored places use their real projected coordinates within the map bounds', () => {
  for (const place of PLACES) {
    const at = PLACE_AT[place.id];
    assert.ok(at, `${place.id} is missing an authored coordinate`);
    const point = project(at);
    assert.deepEqual({ x: place.x, y: place.y }, point);
    assert.ok(point.x >= 0 && point.x <= WORLD.width, `${place.id} is outside the world x bounds`);
    assert.ok(point.y >= 0 && point.y <= WORLD.height, `${place.id} is outside the world y bounds`);
    assert.equal(place.name, PLACE_RENAME[place.id] ?? place.name);
  }
  for (const id of Object.keys(PLACE_AT)) {
    assert.ok(PLACES.some((place) => place.id === id), `${id} has coordinates but no place`);
  }
});

check('street paths follow the London road graph deterministically', () => {
  const oldStreet = PLACES.find((place) => place.id === 'old-street')!;
  const borough = PLACES.find((place) => place.id === 'borough-traders')!;
  const path = streetPath(oldStreet.x, oldStreet.y, borough.x, borough.y);
  const straight = Math.hypot(borough.x - oldStreet.x, borough.y - oldStreet.y);
  const length = polylineLength(path);
  assert.ok(path.length / 2 > 4, 'expected a route with more than four points');
  assert.deepEqual(path.slice(0, 2), [oldStreet.x, oldStreet.y]);
  assert.deepEqual(path.slice(-2), [borough.x, borough.y]);
  assert.ok(length >= straight, `route length ${length} is shorter than straight distance ${straight}`);
  assert.ok(length <= straight * 2.2, `route detour ${length / straight} exceeds 2.2×`);
  assert.deepEqual(streetPath(oldStreet.x, oldStreet.y, borough.x, borough.y), path);
});

check('people follow stored street routes and arrive at their target', () => {
  const state = game('street-move');
  const founder = state.people.find(
    (person) => person.company === 'player' && person.role === 'founder',
  )!;
  const target = state.places.find((place) => place.id === 'old-street')!;
  const moved = movePeople(state, [founder.id], { kind: 'place', id: target.id });
  const movingFounder = moved.state.people.find((person) => person.id === founder.id)!;
  const order = movingFounder.order!;
  assert.deepEqual(order.path.slice(-2), [target.x, target.y]);
  assert.equal(order.length, polylineLength(order.path));
  const arrived = tick(moved.state, order.durationDays).state.people.find(
    (person) => person.id === founder.id,
  )!;
  assert.equal(arrived.order, null);
  assert.equal(arrived.at, target.id);
  assert.deepEqual([arrived.x, arrived.y], [target.x, target.y]);
});

check('MapRenderer exposes the additive projection contract on a stub canvas', () => {
  const canvas = { getContext: () => ({}) } as unknown as HTMLCanvasElement;
  const renderer = new MapRenderer(canvas);
  assert.ok(hasProjection(renderer));
  assert.ok(renderer.worldToScreen({ x: 2, y: 3 }));
  assert.ok(Number.isFinite(renderer.screenToWorld(20, 30).x));
});

check('seeded leads use authored London venues and coordinates', () => {
  let state = game('authored-leads');
  const seen = new Map<string, RtsState['leads'][number]>();
  while (state.day < 40 && seen.size < 5) {
    state = tick(state, 0.1).state;
    for (const lead of state.leads) seen.set(lead.id, lead);
  }
  assert.ok(seen.size >= 5, `only observed ${seen.size} spawned leads`);
  for (const lead of seen.values()) {
    assert.ok(
      LEAD_VENUES.some((venue) => {
        const point = project(venue.at);
        return (
          lead.venue === venue.name &&
          lead.hubId === venue.hubId &&
          lead.x === point.x &&
          lead.y === point.y
        );
      }),
      `${lead.id} does not match an authored lead venue`,
    );
  }
});

check('player landmark discoveries stamp once, add hype and queue one postcard', () => {
  const state = game('journal-discovery');
  const founder = state.people.find(
    (person) => person.company === 'player' && person.role === 'founder',
  )!;
  const landmark = LANDMARKS[0]!;
  const point = project(landmark.at);
  founder.x = point.x;
  founder.y = point.y;
  founder.at = null;
  founder.order = null;
  const hypeBefore = state.companies.player.hype;

  const first = tick(state, 0.01);
  assert.equal(first.state.journal[landmark.kind], first.state.day);
  assert.ok(
    Math.abs(first.state.companies.player.hype - (hypeBefore + JOURNAL_HYPE)) < 0.01,
  );
  assert.equal(first.fx.filter((effect) => effect.kind === 'postcard').length, 1);
  assert.equal(journalProgress(first.state).found, 1);
  assert.equal(journalProgress(first.state).total, LANDMARKS.length);
  assert.ok(first.state.news.some((item) => item.text === `📮 Discovered ${landmark.name}`));
  assert.equal(LANDMARK_FACTS[landmark.kind].length > 0, true);

  const second = tick(first.state, 0.01);
  assert.equal(second.fx.filter((effect) => effect.kind === 'postcard').length, 0);
  assert.ok(second.state.companies.player.hype <= first.state.companies.player.hype);
});

check('landmark discovery uses the movement segment and ignores rival people', () => {
  const crossing = game('journal-crossing');
  const founder = crossing.people.find(
    (person) => person.company === 'player' && person.role === 'founder',
  )!;
  const landmark = LANDMARKS.find((item) => item.kind === 'lcy')!;
  const point = project(landmark.at);
  founder.x = point.x - 5;
  founder.y = point.y;
  founder.at = null;
  founder.order = {
    target: { kind: 'place', id: 'ucl-careers' },
    fromX: point.x - 5,
    fromY: point.y,
    toX: point.x + 5,
    toY: point.y,
    path: [point.x - 5, point.y, point.x + 5, point.y],
    length: 10,
    progress: 0,
    durationDays: 0.01,
  };
  const crossed = tick(crossing, 0.1);
  assert.equal(crossed.state.journal[landmark.kind], crossed.state.day);
  assert.ok(crossed.fx.some((effect) => effect.kind === 'postcard' && effect.landmark === landmark.kind));

  const rivalState = game('journal-rival');
  const rival = rivalState.people.find(
    (person) => person.company === 'rival1' && person.role === 'founder',
  )!;
  const rivalLandmark = LANDMARKS.find((item) => item.kind === 'lcy')!;
  const rivalPoint = project(rivalLandmark.at);
  rival.x = rivalPoint.x;
  rival.y = rivalPoint.y;
  rival.at = null;
  rival.order = null;
  assert.equal(tick(rivalState, 0.01).state.journal[rivalLandmark.kind], undefined);
});

check('every exported command leaves its input unchanged', () => {
  const moving = game('immutable-move');
  const founder = moving.people.find(
    (person) => person.company === 'player' && person.role === 'founder',
  )!;
  const beforeMove = snapshot(moving);
  movePeople(moving, [founder.id], { kind: 'place', id: 'ucl-careers' });
  assert.deepEqual(moving, beforeMove);

  const hiring = game('immutable-hire');
  const recruiter = hiring.people.find(
    (person) => person.company === 'player' && person.role === 'founder',
  )!;
  setPersonAtPlace(hiring, recruiter, 'silicon-roundabout');
  const beforeHire = snapshot(hiring);
  hire(hiring, 'growth', 'silicon-roundabout');
  assert.deepEqual(hiring, beforeHire);

  const officeState = game('immutable-office');
  const officeOpener = officeState.people.find(
    (person) => person.company === 'player' && person.role === 'founder',
  )!;
  setPersonAtPlace(officeState, officeOpener, 'soho-studios');
  const beforeOpen = snapshot(officeState);
  openOffice(officeState, 'soho');
  assert.deepEqual(officeState, beforeOpen);

  const upgrading = game('immutable-upgrade');
  const beforeUpgrade = snapshot(upgrading);
  upgradeOffice(upgrading, upgrading.offices.find((office) => office.company === 'player')!.id);
  assert.deepEqual(upgrading, beforeUpgrade);

  const researching = game('immutable-research');
  const beforeResearch = snapshot(researching);
  setResearch(researching, null);
  assert.deepEqual(researching, beforeResearch);

  const pitching = game('immutable-pitch');
  const player = pitching.companies.player;
  const investor = pitching.places.find((place) => place.kind === 'investor')!;
  player.product = 40;
  player.users = 1_000;
  const pitchFounder = pitching.people.find(
    (person) => person.company === 'player' && person.role === 'founder',
  )!;
  setPersonAtPlace(pitching, pitchFounder, investor.id);
  const beforePitch = snapshot(pitching);
  pitch(pitching, investor.id);
  assert.deepEqual(pitching, beforePitch);

  const dilemmaState = game('immutable-dilemma');
  makeActiveDilemma(dilemmaState);
  const beforeDilemma = snapshot(dilemmaState);
  resolveDilemma(dilemmaState, 0);
  assert.deepEqual(dilemmaState, beforeDilemma);

  const aiState = game('immutable-ai');
  const beforeAi = snapshot(aiState);
  autoCommands(aiState, 'player');
  assert.deepEqual(aiState, beforeAi);

  const ticking = game('immutable-tick');
  const beforeTick = snapshot(ticking);
  tick(ticking, 0.5);
  assert.deepEqual(ticking, beforeTick);
});

check('refused commands return an error and the unchanged state', () => {
  const state = game('refusals');
  const rivalPerson = state.people.find((person) => person.company === 'rival1')!;
  expectRefusedUnchanged(state, (input) =>
    movePeople(input, [rivalPerson.id], { kind: 'place', id: 'ucl-careers' }),
  );
  expectRefusedUnchanged(state, (input) =>
    movePeople(input, ['missing-person'], { kind: 'place', id: 'ucl-careers' }),
  );
  expectRefusedUnchanged(state, (input) =>
    movePeople(input, ['player-founder'], { kind: 'place', id: 'ucl-careers' }),
  );
  expectRefusedUnchanged(state, (input) => hire(input, 'engineer', 'ucl-careers'));
  expectRefusedUnchanged(state, (input) => setResearch(input, 'mobile'));

  const investor = state.places.find((place) => place.kind === 'investor')!;
  expectRefusedUnchanged(state, (input) => pitch(input, investor.id));
  expectRefusedUnchanged(state, (input) => openOffice(input, 'soho'));

  const atCapacity = snapshot(state);
  const recruiter = atCapacity.people.find(
    (person) => person.company === 'player' && person.role === 'founder',
  )!;
  setPersonAtPlace(atCapacity, recruiter, 'ucl-careers');
  const firstHire = hire(atCapacity, 'engineer', 'ucl-careers');
  assert.equal(firstHire.error, undefined);
  expectRefusedUnchanged(firstHire.state, (input) => hire(input, 'growth', 'ucl-careers'));
});

check('pitch preview reports blockers and zero odds at the start', () => {
  const preview = pitchPreview(game(), 'player');
  assert.equal(preview.eligible, false);
  assert.ok(preview.blockers.length > 0);
  assert.equal(preview.odds, 0);
});

check('work only happens at the matching office or customer place', () => {
  const state = game('work-locations');
  const engineer = state.people.find(
    (person) => person.company === 'player' && person.role === 'engineer',
  )!;
  const founder = state.people.find(
    (person) => person.company === 'player' && person.role === 'founder',
  )!;
  setPersonAtPlace(state, engineer, 'old-street');
  setPersonAtPlace(state, founder, 'old-street');
  const offsite = tick(state, 0.2).state;
  assert.equal(offsite.companies.player.researchProgress, 0);

  const growthAtOffice = game('growth-at-office');
  const office = growthAtOffice.offices.find((item) => item.company === 'player')!;
  addWorkerAtPlace(growthAtOffice, 'player', 'growth', office.id);
  assert.equal(tick(growthAtOffice, 0.2).state.companies.player.users, 0);
});

check(
  'locked customer segments do not sign users, and unlocks let workers sign from the shared pool',
  () => {
    const state = game('segment-unlock');
    const customer = state.places.find((place) => place.id === 'camden-market')!;
    const company = state.companies.player;
    company.researching = null;
    company.product = 35;
    const growth = addWorkerAtPlace(state, 'player', 'growth', 'camden-market');
    const locked = tick(state, 0.2).state;
    assert.equal(locked.companies.player.users, 0);
    assert.equal(
      personActivity(
        locked,
        locked.people.find((person) => person.id === growth.id)!,
      ).working,
      false,
    );

    const unlocked = snapshot(state);
    unlocked.companies.player.shipped = ['mvp', 'onboarding', 'mobile'];
    unlocked.companies.player.product = 35;
    const poolBefore = unlocked.places.find((place) => place.id === 'camden-market')!.pool;
    const signed = tick(unlocked, 0.2).state;
    assert.ok(signed.companies.player.users > 0);
    assert.ok(signed.places.find((place) => place.id === 'camden-market')!.pool < poolBefore);
    assert.ok(unlockedSegments(signed.companies.player).includes('consumers'));
    assert.ok(
      personActivity(
        signed,
        signed.people.find((person) => person.id === growth.id)!,
      ).text.startsWith('Signing consumers'),
    );
    assertSane(locked);
    assertSane(signed);
    assert.ok(customer.kind === 'customers');
  },
);

check('two companies at one customer place drain its pool faster than one', () => {
  const single = game('one-seller');
  single.companies.player.researching = null;
  single.companies.player.shipped = ['mvp'];
  single.companies.player.product = 45;
  addWorkerAtPlace(single, 'player', 'growth', 'old-street');
  const oneAfter = tick(single, 0.1).state.places.find((place) => place.id === 'old-street')!.pool;

  const competing = game('two-sellers');
  competing.companies.player.researching = null;
  competing.companies.player.shipped = ['mvp'];
  competing.companies.player.product = 45;
  competing.companies.rival1.researching = null;
  competing.companies.rival1.shipped = ['mvp'];
  competing.companies.rival1.product = 45;
  addWorkerAtPlace(competing, 'player', 'growth', 'old-street');
  addWorkerAtPlace(competing, 'rival1', 'growth', 'old-street');
  const twoAfter = tick(competing, 0.1).state.places.find(
    (place) => place.id === 'old-street',
  )!.pool;
  assert.ok(twoAfter < oneAfter);
});

check('shipping near-cost research adds product quality and unlocks its segment', () => {
  const state = game('ship-feature');
  const company = state.companies.player;
  company.shipped = ['mvp'];
  company.product = 20;
  company.researching = 'payments';
  const payments = FEATURES.find((feature) => feature.id === 'payments')!;
  company.researchProgress = payments.cost - 0.1;
  assert.equal(canResearch(company, 'payments'), true);
  const shipped = tick(state, 0.1).state;
  assert.ok(shipped.companies.player.shipped.includes('payments'));
  assert.ok(shipped.companies.player.product > 20);
  assert.ok(unlockedSegments(shipped.companies.player).includes('smb'));
  assert.equal(shipped.companies.player.researching, null);
  assert.equal(shipped.companies.player.researchProgress, 0);
  assert.ok(tick(state, 0.1).fx.some((effect) => effect.kind === 'sparkle'));
  assertSane(shipped);
});

check('upgrading a player office increases team capacity', () => {
  const state = game('office-upgrade');
  const office = state.offices.find((item) => item.company === 'player')!;
  const before = teamCap(state, 'player');
  const upgraded = upgradeOffice(state, office.id);
  assert.equal(upgraded.error, undefined);
  assert.equal(upgraded.state.offices.find((item) => item.id === office.id)!.level, 1);
  assert.ok(teamCap(upgraded.state, 'player') > before);
});

check('an idle player does not win within 200 days', () => {
  let state = game('idle-player');
  while (state.day < 200 && state.phase !== 'won' && state.phase !== 'bankrupt') {
    state = tick(state, 0.5).state;
    if (state.phase === 'dilemma') state = resolveDilemma(state, 0).state;
    assertSane(state);
  }
  assert.notEqual(state.phase, 'won');
});

check('same seed and bot commands produce identical states', () => {
  const left = simulateBot(719, 260).state;
  const right = simulateBot(719, 260).state;
  assert.equal(JSON.stringify(left), JSON.stringify(right));
});

check('200-seed bot balance reaches the requested win-rate and timing window', () => {
  const wins: number[] = [];
  let bankruptCount = 0;
  let featuresAtWin = 0;
  let unicornWins = 0;
  for (let seed = 0; seed < 200; seed++) {
    const { state, winDay } = simulateBot(seed);
    if (winDay !== null) {
      wins.push(winDay);
      featuresAtWin += state.companies.player.shipped.length;
      if (state.companies.player.stageIndex === STAGES.length - 1) unicornWins += 1;
    }
    if (state.phase === 'bankrupt') bankruptCount += 1;
  }
  const sorted = [...wins].sort((a, b) => a - b);
  const medianDays = sorted.length
    ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2
    : Number.NaN;
  const winRate = wins.length / 200;
  const meanFeaturesAtWin = wins.length ? featuresAtWin / wins.length : 0;
  console.log(
    `bot stats: win rate ${(winRate * 100).toFixed(1)}%, median win day ${medianDays.toFixed(1)}, ` +
      `wins unicorn ${unicornWins} / other ${wins.length - unicornWins}, bankrupt ${bankruptCount}, ` +
      `mean features at win ${meanFeaturesAtWin.toFixed(1)}`,
  );
  assert.ok(winRate >= 0.35 && winRate <= 0.75, `win rate ${winRate.toFixed(3)} outside 35–75%`);
  assert.ok(
    medianDays >= 90 && medianDays <= 260,
    `median win day ${medianDays.toFixed(1)} outside 90–260`,
  );
});

console.log(`RTS checks passed: ${checks}`);
