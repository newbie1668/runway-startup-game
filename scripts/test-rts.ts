import assert from 'node:assert/strict';
import { HUBS, SECTORS, STAGES } from '@/lib/game/content';
import { LANDMARKS, WORLD, project } from '@/lib/game/geo';
import { MapRenderer } from '@/lib/game/render';
import { hasProjection } from '@/lib/game/mapProjection';
import { advanceAmbient, createAmbient } from '@/lib/rts/ambient';
import {
  DILEMMAS,
  CHAPTERS,
  FEATURES,
  JOURNAL_HYPE,
  LEAD_VENUES,
  LANDMARK_FACTS,
  OFFICE_LEVELS,
  OFFICE_SITES,
  PLACE_AT,
  PLACE_RENAME,
  PLACES,
} from '@/lib/rts/content';
import {
  autoCommands,
  canResearch,
  campaignStatus,
  hire,
  journalProgress,
  movePeople,
  newRtsGame,
  objectiveProgress,
  openOffice,
  personActivity,
  pitch,
  pitchPreview,
  resolveDilemma,
  setResearch,
  teamCap,
  tick,
  travelDays,
  upgradeOffice,
  unlockedSegments,
} from '@/lib/rts/sim';
import { polylineLength, streetPath } from '@/lib/rts/walk';
import type { CompanyId, Lead, ObjectiveSpec, Person, RtsState } from '@/lib/rts/types';

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
  const pending: unknown[] = [state];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (const child of value) {
        if (typeof child === 'number') assert.ok(Number.isFinite(child), 'state value must be finite');
        else if (child && typeof child === 'object') pending.push(child);
      }
    } else if (value && typeof value === 'object') {
      for (const key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        const child = (value as Record<string, unknown>)[key];
        if (typeof child === 'number') assert.ok(Number.isFinite(child), 'state value must be finite');
        else if (child && typeof child === 'object') pending.push(child);
      }
    }
  }
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

check('objective progress covers every authored kind and campaign status', () => {
  const state = game('objective-progress');
  const company = state.companies.player;
  company.stageIndex = 2;
  company.users = 1_500;
  company.shipped = ['mvp', 'onboarding', 'payments'];
  const office = state.offices.find((item) => item.company === 'player')!;
  office.level = 2;
  state.offices.push({
    ...office,
    id: 'test-second-office',
    hubId: 'soho',
    level: 1,
  });
  addWorkerAtPlace(state, 'player', 'growth', office.id);
  state.journal = Object.fromEntries(
    LANDMARKS.slice(0, 2).map((landmark) => [landmark.kind, 0]),
  ) as RtsState['journal'];
  state.stats.leadsWon = 3;
  const specs: ObjectiveSpec[] = [
    { kind: 'stage', atLeast: 2, label: 'stage' },
    { kind: 'users', atLeast: 1_500, label: 'users' },
    { kind: 'shipped', count: 3, label: 'shipped' },
    { kind: 'feature', id: 'payments', label: 'feature' },
    { kind: 'segment', id: 'earlyAdopters', label: 'segment' },
    { kind: 'officeLevel', atLeast: 2, label: 'office level' },
    { kind: 'offices', count: 2, label: 'offices' },
    { kind: 'team', count: 3, label: 'team' },
    { kind: 'journal', count: 2, label: 'journal' },
    { kind: 'leadsWon', count: 3, label: 'leads' },
  ];
  for (const spec of specs) {
    const progress = objectiveProgress(state, spec);
    assert.ok(progress.done, `${spec.kind} objective should be done`);
    assert.ok(progress.value >= progress.target, `${spec.kind} progress should meet its target`);
  }
  assert.deepEqual(objectiveProgress(state, specs[3]!), { value: 1, target: 1, done: true });
  assert.deepEqual(objectiveProgress(state, specs[4]!), { value: 1, target: 1, done: true });
  const status = campaignStatus(state);
  assert.equal(status.chapter?.id, CHAPTERS[0]!.id);
  assert.equal(status.complete, false);
  assert.equal(status.daysElapsed, state.day - state.campaign.chapterStartDay);
  assert.equal(status.objectives.length, CHAPTERS[0]!.objectives.length);
  assert.equal(status.bonus?.value, 2);
  assert.equal(status.bonus?.target, 3);
  assert.equal(status.bonus?.done, false);
});

check('campaign progression awards bonuses once, advances chapters, stars, and stays deterministic', () => {
  const readyForChapterOne = (journalCount: number): RtsState => {
    const state = game('campaign-progression');
    const company = state.companies.player;
    company.stageIndex = 1;
    company.shipped = ['mvp'];
    company.users = 200;
    company.cash = 250_000;
    company.hype = 40;
    state.journal = Object.fromEntries(
      LANDMARKS.slice(0, journalCount).map((landmark) => [landmark.kind, 0]),
    ) as RtsState['journal'];
    for (const person of state.people) {
      if (person.company !== 'player') continue;
      person.x = 0;
      person.y = 0;
      person.at = null;
      person.order = null;
    }
    return state;
  };
  const bonusInput = readyForChapterOne(3);
  const noBonusInput = readyForChapterOne(2);
  const bonus = tick(bonusInput, 0.1);
  const noBonus = tick(noBonusInput, 0.1);
  assert.equal(bonus.state.campaign.results.length, 1);
  assert.equal(bonus.state.campaign.results[0]!.chapterId, CHAPTERS[0]!.id);
  assert.equal(bonus.state.campaign.results[0]!.days, bonus.state.day - bonusInput.day);
  assert.equal(bonus.state.campaign.results[0]!.stars, 3);
  assert.equal(noBonus.state.campaign.results[0]!.stars, 2);
  assert.equal(bonus.state.campaign.chapter, 1);
  assert.equal(bonus.state.campaign.bonusDone, false);
  assert.equal(bonus.fx.filter((effect) => effect.kind === 'bonus').length, 1);
  assert.equal(bonus.fx.filter((effect) => effect.kind === 'chapter').length, 1);
  assert.equal(noBonus.fx.filter((effect) => effect.kind === 'bonus').length, 0);
  assert.equal(
    Math.round(bonus.state.companies.player.cash - noBonus.state.companies.player.cash),
    CHAPTERS[0]!.bonusReward.cash,
  );
  assert.equal(
    Math.round(bonus.state.companies.player.hype - noBonus.state.companies.player.hype),
    CHAPTERS[0]!.bonusReward.hype,
  );
  assert.ok(bonus.state.companies.player.hype <= 100);
  const cappedHype = readyForChapterOne(3);
  cappedHype.companies.player.hype = 98;
  assert.equal(tick(cappedHype, 0.1).state.companies.player.hype, 100);

  const secondBonusStep = tick(bonus.state, 0.1);
  const secondNoBonusStep = tick(noBonus.state, 0.1);
  assert.equal(secondBonusStep.fx.filter((effect) => effect.kind === 'bonus').length, 0);
  assert.equal(secondBonusStep.state.campaign.results.length, 1);
  assert.equal(
    Math.round(
      secondBonusStep.state.companies.player.cash - secondNoBonusStep.state.companies.player.cash,
    ),
    CHAPTERS[0]!.bonusReward.cash,
  );
  assert.deepEqual(tick(readyForChapterOne(3), 0.2), tick(readyForChapterOne(3), 0.2));

  const readyForTwoChapters = readyForChapterOne(3);
  readyForTwoChapters.companies.player.stageIndex = 2;
  readyForTwoChapters.companies.player.shipped = ['mvp', 'onboarding', 'payments'];
  readyForTwoChapters.companies.player.users = 1_700;
  readyForTwoChapters.offices.find((office) => office.company === 'player')!.level = 1;
  const oneChapterStep = tick(readyForTwoChapters, 0.1);
  assert.equal(oneChapterStep.state.campaign.results.length, 1);
  assert.equal(oneChapterStep.state.campaign.chapter, 1);
});

check('the final chapter records before a Unicorn end condition', () => {
  const state = game('final-chapter');
  state.campaign.chapter = CHAPTERS.length - 1;
  state.campaign.chapterStartDay = state.day;
  state.companies.player.stageIndex = STAGES.length - 1;
  state.offices.find((office) => office.company === 'player')!.level = 3;
  const completed = tick(state, 0.1);
  assert.equal(completed.state.phase, 'won');
  assert.equal(completed.state.campaign.results.length, 1);
  assert.equal(completed.state.campaign.results[0]!.chapterId, CHAPTERS[4]!.id);
  assert.ok(completed.fx.some((effect) => effect.kind === 'chapter' && effect.index === 4));
  assert.equal(campaignStatus(completed.state).complete, true);
});

check('only player people increment the cumulative leads-won statistic', () => {
  const playerState = game('player-lead-claim');
  const player = playerState.people.find(
    (person) => person.company === 'player' && person.role === 'founder',
  )!;
  const lead: Lead = {
    id: 'player-test-lead',
    kind: 'meetup',
    name: 'Test meetup',
    venue: 'Old Street',
    hubId: 'shoreditch',
    x: player.x,
    y: player.y,
    spawnDay: 0,
    expiresDay: 10,
    takenBy: ['founder'],
  };
  playerState.leads.push(lead);
  const moving = movePeople(playerState, [player.id], { kind: 'lead', id: lead.id });
  const claimed = tick(moving.state, 0.001).state;
  assert.equal(claimed.stats.leadsWon, 1);

  const rivalState = game('rival-lead-claim');
  const rival = rivalState.people.find(
    (person) => person.company === 'rival1' && person.role === 'founder',
  )!;
  const rivalLead = { ...lead, id: 'rival-test-lead', x: rival.x, y: rival.y };
  rivalState.leads.push(rivalLead);
  rival.at = null;
  rival.order = {
    target: { kind: 'lead', id: rivalLead.id },
    fromX: rival.x,
    fromY: rival.y,
    toX: rival.x,
    toY: rival.y,
    path: [rival.x, rival.y, rival.x, rival.y],
    length: 0,
    progress: 0,
    durationDays: 0.001,
  };
  const rivalClaimed = tick(rivalState, 0.001).state;
  assert.equal(rivalClaimed.stats.leadsWon, 0);
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
  const teammate = state.people.find((person) => person.company === 'player')!;
  teammate.x = office.x;
  teammate.y = office.y;
  teammate.at = office.id;
  teammate.order = null;
  const before = teamCap(state, 'player');
  const upgraded = upgradeOffice(state, office.id);
  assert.equal(upgraded.error, undefined);
  const upgradedOffice = upgraded.state.offices.find((item) => item.id === office.id)!;
  const site = OFFICE_SITES[office.hubId][1]!;
  const point = project(site.at);
  assert.equal(upgradedOffice.level, 1);
  assert.equal(upgradedOffice.siteName, site.name);
  assert.deepEqual([upgradedOffice.x, upgradedOffice.y], [point.x, point.y]);
  const movedTeammate = upgraded.state.people.find((person) => person.id === teammate.id)!;
  assert.equal(movedTeammate.order?.target.kind, 'office');
  assert.equal(movedTeammate.order?.target.id, office.id);
  assert.deepEqual([movedTeammate.order?.toX, movedTeammate.order?.toY], [point.x, point.y]);
  assert.ok(upgraded.fx.some((effect) => effect.kind === 'focus' && effect.x === point.x && effect.y === point.y));
  assert.ok(upgraded.fx.some((effect) => effect.kind === 'moment' && effect.moment === 'office-move'));
  assert.ok(teamCap(upgraded.state, 'player') > before);
});

check('shared AI expands toward its strongest customer hub and campaign goals', () => {
  const state = game('bot-office-expansion');
  const company = state.companies.player;
  company.stageIndex = 2;
  company.cash = 10_000_000;
  const customer = state.places.find(
    (place) =>
      place.kind === 'customers' &&
      unlockedSegments(company).includes(place.segment),
  );
  assert.ok(customer && customer.kind === 'customers');
  customer.userSignups!.player = 500;
  const expectedHub = HUBS.filter((hub) => hub.id !== company.hqHub)
    .slice()
    .sort((a, b) => {
      const aPoint = project([a.lng, a.lat]);
      const bPoint = project([b.lng, b.lat]);
      return (
        travelDays(aPoint.x, aPoint.y, customer.x, customer.y) -
        travelDays(bPoint.x, bPoint.y, customer.x, customer.y)
      );
    })[0]!;
  const expanded = autoCommands(state, 'player').state;
  assert.equal(expanded.offices.filter((office) => office.company === 'player').length, 2);
  assert.equal(
    expanded.offices.find((office) => office.company === 'player' && office.hubId !== company.hqHub)?.hubId,
    expectedHub.id,
  );

  const chapterPriority = game('chapter-office-priority');
  chapterPriority.companies.player.cash = 10_000_000;
  chapterPriority.companies.player.stageIndex = 1;
  chapterPriority.campaign.chapter = 1;
  const prioritized = autoCommands(chapterPriority, 'player').state;
  assert.equal(prioritized.offices.filter((office) => office.company === 'player').length, 2);
});

check('founder first-customer, first-hire, and launch moments emit once', () => {
  const customerState = game('first-customer-moment');
  customerState.companies.player.users = 0;
  const customerPlace = customerState.places.find(
    (place) =>
      place.kind === 'customers' &&
      unlockedSegments(customerState.companies.player).includes(place.segment),
  )!;
  const founderAtCustomer = customerState.people.find(
    (person) => person.company === 'player' && person.role === 'founder',
  )!;
  setPersonAtPlace(customerState, founderAtCustomer, customerPlace.id);
  const firstCustomers = tick(customerState, 0.1);
  const firstCustomerMoments = firstCustomers.fx.filter(
    (effect) => effect.kind === 'moment' && effect.moment === 'first-customer',
  );
  assert.equal(firstCustomerMoments.length, 1);
  assert.equal(firstCustomerMoments[0]?.kind === 'moment' ? firstCustomerMoments[0].title : '', 'First customer!');
  assert.equal(firstCustomers.state.milestones['first-customer'], true);
  const moreCustomers = tick(firstCustomers.state, 0.1);
  assert.equal(
    moreCustomers.fx.filter((effect) => effect.kind === 'moment' && effect.moment === 'first-customer').length,
    0,
  );

  const hiring = game('first-hire-moment');
  const recruiter = hiring.people.find(
    (person) => person.company === 'player' && person.role === 'founder',
  )!;
  const talent = hiring.places.find((place) => place.kind === 'talent')!;
  setPersonAtPlace(hiring, recruiter, talent.id);
  const firstHire = hire(hiring, 'engineer', talent.id);
  assert.equal(firstHire.error, undefined);
  assert.equal(
    firstHire.fx.filter((effect) => effect.kind === 'moment' && effect.moment === 'first-hire').length,
    1,
  );
  const upgraded = upgradeOffice(
    firstHire.state,
    firstHire.state.offices.find((office) => office.company === 'player')!.id,
  );
  const secondHire = hire(upgraded.state, 'growth', talent.id);
  assert.equal(secondHire.error, undefined);
  assert.equal(
    secondHire.fx.filter((effect) => effect.kind === 'moment' && effect.moment === 'first-hire').length,
    0,
  );
  assert.equal(secondHire.state.milestones['first-hire'], true);

  const launchState = game('launch-day-moment');
  launchState.companies.player.researchProgress = FEATURES.find(
    (feature) => feature.id === 'mvp',
  )!.cost;
  const launch = tick(launchState, 0.1);
  assert.equal(launch.state.companies.player.shipped[0], 'mvp');
  assert.equal(
    launch.fx.filter((effect) => effect.kind === 'moment' && effect.moment === 'launch-day').length,
    1,
  );
  const afterLaunch = tick(launch.state, 0.1);
  assert.equal(
    afterLaunch.fx.filter((effect) => effect.kind === 'moment' && effect.moment === 'launch-day').length,
    0,
  );
  const onboarding = FEATURES.find((feature) => feature.id === 'onboarding')!;
  afterLaunch.state.companies.player.researching = onboarding.id;
  afterLaunch.state.companies.player.researchProgress = onboarding.cost;
  const feature = tick(afterLaunch.state, 0.1);
  assert.equal(
    feature.fx.filter((effect) => effect.kind === 'moment' && effect.moment === 'feature-shipped').length,
    1,
  );
});

check('every successful player raise emits a round-closed moment', () => {
  const state = game('round-closed-moment');
  const founder = state.people.find(
    (person) => person.company === 'player' && person.role === 'founder',
  )!;
  const investor = state.places.find((place) => place.kind === 'investor')!;
  const company = state.companies.player;
  company.product = 100;
  company.users = 1_000_000;
  company.hype = 100;
  founder.x = investor.x;
  founder.y = investor.y;
  founder.at = investor.id;
  founder.order = null;
  let raised: ReturnType<typeof pitch> | null = null;
  for (let seed = 1; seed <= 30 && !raised; seed++) {
    state.rng = seed;
    const attempt = pitch(state, investor.id);
    if (attempt.state.companies.player.stageIndex > 0) raised = attempt;
  }
  assert.ok(raised);
  const moment = raised.fx.find((effect) => effect.kind === 'moment' && effect.moment === 'round-closed');
  assert.ok(moment?.kind === 'moment');
  assert.equal(moment.title, `${STAGES[1]!.name} closed`);
  assert.match(moment.text, /£[\d,]+ raised at £[\d,]+ valuation/);
});

check('rival claims emit a bad moment when they beat an ordered player person', () => {
  const state = game('rival-steal-moment');
  const point = project([-0.0877, 51.5256]);
  const lead: Lead = {
    id: 'moment-test-lead',
    kind: 'meetup',
    name: 'Founder breakfast',
    venue: 'Old Street',
    hubId: 'shoreditch',
    x: point.x,
    y: point.y,
    spawnDay: 0,
    expiresDay: 100,
    takenBy: ['founder'],
  };
  state.leads.push(lead);
  const player = state.people.find(
    (person) => person.company === 'player' && person.role === 'founder',
  )!;
  const rival = state.people.find(
    (person) => person.company === 'rival1' && person.role === 'founder',
  )!;
  player.x = lead.x + 20;
  player.y = lead.y;
  player.at = null;
  player.order = {
    target: { kind: 'lead', id: lead.id },
    fromX: player.x,
    fromY: player.y,
    toX: lead.x,
    toY: lead.y,
    path: [player.x, player.y, lead.x, lead.y],
    length: 20,
    progress: 0,
    durationDays: 20,
  };
  rival.x = lead.x;
  rival.y = lead.y;
  rival.at = null;
  rival.order = {
    target: { kind: 'lead', id: lead.id },
    fromX: lead.x,
    fromY: lead.y,
    toX: lead.x,
    toY: lead.y,
    path: [lead.x, lead.y, lead.x, lead.y],
    length: 0,
    progress: 0,
    durationDays: 0.001,
  };
  const result = tick(state, 0.1);
  const moment = result.fx.find(
    (effect) => effect.kind === 'moment' && effect.moment === 'rival-steal',
  );
  assert.ok(moment?.kind === 'moment');
  assert.equal(moment.tone, 'bad');
  assert.equal(moment.title, `${state.companies.rival1.name} got there first`);
  assert.match(moment.text, /grabbed Founder breakfast before .+ arrived/);
});

check('ambient commuters are deterministic for matching seeds and game-time steps', () => {
  const left = createAmbient('ambient-test');
  const right = createAmbient('ambient-test');
  const initial = left.commuters.map(({ x, y }) => [x, y]);
  for (const days of [0.03, 0.12, 0.4, 0.01, 1.25]) {
    advanceAmbient(left, days);
    advanceAmbient(right, days);
  }
  assert.equal(left.commuters.length, 220);
  assert.ok(
    left.commuters.some((commuter, index) => {
      const start = initial[index]!;
      return commuter.x !== start[0] || commuter.y !== start[1];
    }),
  );
  assert.deepEqual(left, right);
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
  let totalChaptersCompleted = 0;
  let totalStars = 0;
  let winsCompletingCampaign = 0;
  const chapterCompletions = CHAPTERS.map(() => 0);
  for (let seed = 0; seed < 200; seed++) {
    const { state, winDay } = simulateBot(seed);
    totalChaptersCompleted += state.campaign.results.length;
    totalStars += state.campaign.results.reduce((total, result) => total + result.stars, 0);
    for (let index = 0; index < CHAPTERS.length; index++) {
      if (state.campaign.results.some((result) => result.chapterId === CHAPTERS[index]!.id))
        chapterCompletions[index] += 1;
    }
    if (winDay !== null) {
      wins.push(winDay);
      featuresAtWin += state.companies.player.shipped.length;
      if (state.companies.player.stageIndex === STAGES.length - 1) unicornWins += 1;
      if (state.campaign.results.length === CHAPTERS.length) winsCompletingCampaign += 1;
    }
    if (state.phase === 'bankrupt') bankruptCount += 1;
  }
  const sorted = [...wins].sort((a, b) => a - b);
  const medianDays = sorted.length
    ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2
    : Number.NaN;
  const winRate = wins.length / 200;
  const meanFeaturesAtWin = wins.length ? featuresAtWin / wins.length : 0;
  const meanChaptersCompleted = totalChaptersCompleted / 200;
  const meanStars = totalStars / 200;
  const chapterCompletionRates = chapterCompletions
    .map((count, index) => `chapter ${index + 1} ${(count / 200 * 100).toFixed(1)}%`)
    .join(', ');
  const winningCampaignRate = wins.length ? (winsCompletingCampaign / wins.length) * 100 : 0;
  console.log(
    `bot stats: win rate ${(winRate * 100).toFixed(1)}%, median win day ${medianDays.toFixed(1)}, ` +
      `wins unicorn ${unicornWins} / other ${wins.length - unicornWins}, bankrupt ${bankruptCount}, ` +
      `mean features at win ${meanFeaturesAtWin.toFixed(1)}`,
  );
  console.log(
    `campaign stats: mean chapters completed ${meanChaptersCompleted.toFixed(2)}, ` +
      `${chapterCompletionRates}, wins completing all five ${winningCampaignRate.toFixed(1)}%, ` +
      `mean stars per bot game ${meanStars.toFixed(2)}`,
  );
  // Bots follow chapter objectives, which guide toward a second office and team growth.
  assert.ok(winRate >= 0.35 && winRate <= 0.9, `win rate ${winRate.toFixed(3)} outside 35–90%`);
  assert.ok(
    medianDays >= 90 && medianDays <= 260,
    `median win day ${medianDays.toFixed(1)} outside 90–260`,
  );
  assert.ok(
    winsCompletingCampaign >= Math.ceil(wins.length * 0.5),
    `only ${winsCompletingCampaign}/${wins.length} bot wins completed all five chapters`,
  );
});

console.log(`RTS checks passed: ${checks}`);
