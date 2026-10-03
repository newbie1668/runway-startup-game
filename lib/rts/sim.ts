import type { HubId, SectorId } from '@/lib/game/types';
import { HUBS, STAGES, generateCompanyName, hubById, sectorById } from '@/lib/game/content';
import { LANDMARKS, project } from '@/lib/game/geo';
import { Dice, seedFromString } from '@/lib/game/rng';
import {
  BASE_ARPU,
  BASE_BURN_WEEK,
  BUILD_POINTS_PER_DAY,
  DILEMMAS,
  ENGINEER_HIRE_FEE,
  ENGINEER_SALARY_WEEK,
  FEATURES,
  GROWTH_HIRE_FEE,
  GROWTH_SALARY_WEEK,
  JOURNAL_HYPE,
  JOURNAL_RADIUS,
  OFFICE_LEVELS,
  OFFICE_OPEN_COST,
  PERSON_NAMES,
  PLAYER_COLOR,
  PLACES,
  POOL_REFILL_PER_DAY,
  POLISH_POINTS_PER_DAY,
  RIVAL_COLORS,
  SEGMENT_INFO,
  SECTOR_REVENUE_MULT,
  SIGNUPS_PER_SKILL_DAY,
  STARTING_CASH,
  TRAVEL_SPEED,
  USERS_CHURN_PER_WEEK,
  generateLeadDetails,
} from './content';
import type {
  ActiveDilemma,
  Company,
  CompanyId,
  CustomerPlace,
  FeatureId,
  Lead,
  MoveTarget,
  Office,
  Person,
  PitchPreview,
  Place,
  Role,
  RtsFx,
  RtsResult,
  RtsState,
  Segment,
  NewRtsConfig,
} from './types';

const COMPANY_IDS: CompanyId[] = ['player', 'rival1', 'rival2', 'rival3'];
const RIVAL_IDS: CompanyId[] = ['rival1', 'rival2', 'rival3'];
const SECTOR_IDS: SectorId[] = ['ai', 'fintech', 'climate', 'healthtech', 'devtools', 'consumer'];
const CUSTOMER_SEGMENTS: Segment[] = [
  'earlyAdopters',
  'consumers',
  'smb',
  'developers',
  'enterprise',
];
const NEWS_LIMIT = 60;
const HYPE_DECAY_PER_DAY = 0.015;
const MAX_HYPE = 100;
const MAX_PRODUCT = 100;

function clone(state: RtsState): RtsState {
  return structuredClone(state);
}

function result(state: RtsState, fx: RtsFx[] = []): RtsResult {
  return { state, fx };
}

function refused(state: RtsState, error: string): RtsResult {
  return { state: clone(state), fx: [], error };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nextId(state: RtsState, kind: 'person' | 'office' | 'lead'): string {
  return `${kind}-${state.nextId++}`;
}

function addNews(
  state: RtsState,
  text: string,
  tone: 'good' | 'bad' | 'neutral' | 'rival' | 'money',
  hubId?: HubId,
) {
  state.news.unshift({ day: state.day, text, tone, hubId });
  state.news.length = Math.min(state.news.length, NEWS_LIMIT);
}

function companyPeople(state: RtsState, companyId: CompanyId): Person[] {
  return state.people.filter((person) => person.company === companyId);
}

function companyOffices(state: RtsState, companyId: CompanyId): Office[] {
  return state.offices.filter((office) => office.company === companyId);
}

function findPlace(state: RtsState, id: string): Place | undefined {
  return state.places.find((place) => place.id === id);
}

function findOffice(state: RtsState, id: string): Office | undefined {
  return state.offices.find((office) => office.id === id);
}

function hubPoint(hubId: HubId): { x: number; y: number } {
  const hub = hubById(hubId);
  return project([hub.lng, hub.lat]);
}

function firstName(dice: Dice): string {
  return dice.pick(PERSON_NAMES);
}

function createPerson(
  state: RtsState,
  company: CompanyId,
  role: Role,
  name: string,
  x: number,
  y: number,
  at: string | null,
  salary: number,
  skill: number,
): Person {
  return {
    id: nextId(state, 'person'),
    company,
    role,
    name,
    x,
    y,
    at,
    order: null,
    salary,
    skill,
  };
}

function createOffice(state: RtsState, company: CompanyId, hubId: HubId, level: number): Office {
  const point = hubPoint(hubId);
  return {
    id: nextId(state, 'office'),
    company,
    hubId,
    x: point.x,
    y: point.y,
    level,
  };
}

function makeCompany(
  id: CompanyId,
  name: string,
  sectorId: SectorId,
  hqHub: HubId,
  color: string,
): Company {
  return {
    id,
    name,
    sectorId,
    color,
    hqHub,
    cash: STARTING_CASH,
    users: 0,
    product: 5,
    hype: 10,
    stageIndex: 0,
    equity: 1,
    valuation: 0,
    shipped: [],
    researching: 'mvp',
    researchProgress: 0,
    alive: true,
  };
}

export function newRtsGame(cfg: NewRtsConfig): RtsState {
  const dice = new Dice(seedFromString(cfg.seed));
  const rivalsHubs = dice.shuffle(HUBS.filter((hub) => hub.id !== cfg.hqHub)).slice(0, 3);
  const rivalsSectors = dice
    .shuffle(SECTOR_IDS.filter((sectorId) => sectorId !== cfg.sectorId))
    .slice(0, 3);
  const companies = {} as Record<CompanyId, Company>;
  const state: RtsState = {
    seed: cfg.seed,
    rng: dice.state,
    day: 0,
    phase: 'playing',
    companies,
    people: [],
    offices: [],
    places: PLACES.map((place) => {
      if (place.kind === 'customers') return { ...place };
      if (place.kind === 'investor') return { ...place, cooldownUntil: {} };
      return { ...place };
    }),
    leads: [],
    journal: {},
    dilemma: null,
    news: [],
    nextId: 1,
    nextLeadDay: 0,
    nextDilemmaDay: 0,
    nextAiDay: 0.5,
  };
  companies.player = makeCompany('player', cfg.companyName, cfg.sectorId, cfg.hqHub, PLAYER_COLOR);
  for (let index = 0; index < RIVAL_IDS.length; index++) {
    const rivalId = RIVAL_IDS[index];
    companies[rivalId] = makeCompany(
      rivalId,
      generateCompanyName(dice),
      rivalsSectors[index],
      rivalsHubs[index].id,
      RIVAL_COLORS[index],
    );
  }

  for (const companyId of COMPANY_IDS) {
    const company = companies[companyId];
    const office = createOffice(state, companyId, company.hqHub, 0);
    state.offices.push(office);
    state.people.push(
      createPerson(
        state,
        companyId,
        'founder',
        firstName(dice),
        office.x,
        office.y,
        office.id,
        0,
        1,
      ),
      createPerson(
        state,
        companyId,
        'engineer',
        firstName(dice),
        office.x,
        office.y,
        office.id,
        ENGINEER_SALARY_WEEK,
        1,
      ),
    );
  }

  state.rng = dice.state;
  state.nextLeadDay = dice.int(2, 4);
  state.nextDilemmaDay = dice.int(12, 20);
  state.rng = dice.state;
  addNews(
    state,
    `${cfg.companyName} opens its doors in ${hubById(cfg.hqHub).name}.`,
    'good',
    cfg.hqHub,
  );
  return state;
}

export function travelDays(x0: number, y0: number, x1: number, y1: number): number {
  return Math.hypot(x1 - x0, y1 - y0) / TRAVEL_SPEED;
}

export function teamCap(state: RtsState, companyId: CompanyId): number {
  return companyOffices(state, companyId).reduce((capacity, office) => {
    const level = OFFICE_LEVELS[office.level];
    return capacity + (level?.capacity ?? 0);
  }, 0);
}

export function unlockedSegments(company: Company): Segment[] {
  const unlocked = new Set<Segment>(['earlyAdopters']);
  for (const id of company.shipped) {
    const feature = FEATURES.find((item) => item.id === id);
    if (feature?.unlocks) unlocked.add(feature.unlocks);
  }
  return CUSTOMER_SEGMENTS.filter((segment) => unlocked.has(segment));
}

export function canResearch(company: Company, featureId: FeatureId): boolean {
  const feature = FEATURES.find((item) => item.id === featureId);
  return Boolean(
    feature &&
    !company.shipped.includes(featureId) &&
    feature.requires.every((required) => company.shipped.includes(required)),
  );
}

function featureMultipliers(company: Company, key: 'signupMult' | 'arpuMult'): number {
  return company.shipped.reduce((multiplier, id) => {
    const feature = FEATURES.find((item) => item.id === id);
    return multiplier * (feature?.[key] ?? 1);
  }, 1);
}

export function arpu(company: Company): number {
  return (
    BASE_ARPU * SECTOR_REVENUE_MULT[company.sectorId] * featureMultipliers(company, 'arpuMult')
  );
}

export function weeklyBurn(state: RtsState, companyId: CompanyId): number {
  const company = state.companies[companyId];
  if (!company) return 0;
  const salaries = companyPeople(state, companyId).reduce(
    (total, person) => total + person.salary,
    0,
  );
  const rent = companyOffices(state, companyId).reduce((total, office) => {
    return total + hubById(office.hubId).rent * (OFFICE_LEVELS[office.level]?.rentMult ?? 0);
  }, 0);
  return (salaries + rent + BASE_BURN_WEEK) * (sectorById(company.sectorId).burnMult ?? 1);
}

export function weeklyRevenue(state: RtsState, companyId: CompanyId): number {
  const company = state.companies[companyId];
  return company ? company.users * arpu(company) : 0;
}

export function runwayWeeks(state: RtsState, companyId: CompanyId): number {
  const company = state.companies[companyId];
  if (!company) return 0;
  const netBurn = weeklyBurn(state, companyId) - weeklyRevenue(state, companyId);
  return netBurn <= 0 ? Number.POSITIVE_INFINITY : company.cash / netBurn;
}

function stageBlockers(company: Company): string[] {
  const nextStage = STAGES[company.stageIndex + 1];
  if (!nextStage) return ['Already at Unicorn'];
  const blockers: string[] = [];
  if (company.product < nextStage.minProduct) {
    blockers.push(
      `Needs product ${nextStage.minProduct} (you have ${Math.floor(company.product)})`,
    );
  }
  if (company.users < nextStage.minTraction) {
    blockers.push(
      `Needs ${nextStage.minTraction.toLocaleString()} users (you have ${Math.floor(company.users).toLocaleString()})`,
    );
  }
  return blockers;
}

function investorPlaces(state: RtsState) {
  return state.places.filter((place) => place.kind === 'investor');
}

function pitchOdds(company: Company): number {
  const nextStage = STAGES[company.stageIndex + 1];
  if (!nextStage) return 0;
  const tractionBonus =
    nextStage.minTraction > 0 ? 0.25 * Math.min(1, company.users / nextStage.minTraction - 1) : 0;
  const productBonus = 0.15 * Math.min(1, (company.product - nextStage.minProduct) / 20);
  return clamp(
    nextStage.baseOdds +
      tractionBonus +
      productBonus +
      company.hype / 400 -
      sectorById(company.sectorId).pitchBar / 100,
    0.05,
    0.92,
  );
}

function pitchDilution(odds: number): number {
  return clamp(0.25 - (0.12 * (odds - 0.3)) / 0.6, 0.1, 0.25);
}

export function pitchPreview(state: RtsState, companyId: CompanyId): PitchPreview {
  const company = state.companies[companyId];
  const nextStage = company && STAGES[company.stageIndex + 1];
  if (!company || !nextStage) {
    return {
      eligible: false,
      blockers: company ? ['Already at Unicorn'] : ['Company not found'],
      odds: 0,
      nextStageName: 'Unicorn',
      raise: 0,
      dilution: 0,
    };
  }
  const blockers = stageBlockers(company);
  const hasAvailableInvestor = investorPlaces(state).some(
    (place) => (place.cooldownUntil[companyId] ?? 0) <= state.day,
  );
  if (!hasAvailableInvestor) blockers.push('Investors need time before another meeting');
  const eligible = blockers.length === 0 && company.alive;
  const odds = eligible ? pitchOdds(company) : 0;
  return {
    eligible,
    blockers: company.alive ? blockers : ['Company is no longer active'],
    odds,
    nextStageName: nextStage.name,
    raise: nextStage.raise,
    dilution: eligible ? pitchDilution(odds) : 0,
  };
}

function canPitchAt(state: RtsState, company: Company, placeId: string): boolean {
  const place = findPlace(state, placeId);
  return Boolean(
    place &&
    place.kind === 'investor' &&
    (place.cooldownUntil[company.id] ?? 0) <= state.day &&
    stageBlockers(company).length === 0,
  );
}

function pitchAt(state: RtsState, company: Company, place: Place, fx: RtsFx[]): void {
  if (place.kind !== 'investor' || !canPitchAt(state, company, place.id)) return;
  const odds = pitchOdds(company);
  const dice = new Dice(state.rng);
  const success = dice.chance(odds);
  state.rng = dice.state;
  if (!success) {
    place.cooldownUntil[company.id] = state.day + 10;
    company.hype = clamp(company.hype - 5, 0, MAX_HYPE);
    addNews(state, `${company.name}'s pitch at ${place.name} is a no for now.`, 'bad', place.hubId);
    fx.push({ kind: 'float', x: place.x, y: place.y, text: 'Not yet', color: '#f87171' });
    return;
  }
  const nextStage = STAGES[company.stageIndex + 1];
  if (!nextStage) return;
  const overshoot = Math.max(
    0,
    (company.users / Math.max(1, nextStage.minTraction) - 1) * 0.05 +
      (company.product - nextStage.minProduct) * 0.001,
  );
  company.stageIndex += 1;
  company.cash += nextStage.raise;
  company.valuation = nextStage.valuation * (1 + Math.min(0.35, overshoot));
  company.equity *= 1 - pitchDilution(odds);
  addNews(
    state,
    `${company.name} closes its ${nextStage.name} round for £${nextStage.raise.toLocaleString()}.`,
    'money',
    place.hubId,
  );
  fx.push({ kind: 'confetti', x: place.x, y: place.y });
  fx.push({
    kind: 'float',
    x: place.x,
    y: place.y,
    text: `£${nextStage.raise.toLocaleString()}`,
    color: '#34d399',
  });
  if (company.id === 'player' && company.stageIndex >= STAGES.length - 1) state.phase = 'won';
}

function targetPosition(state: RtsState, target: MoveTarget): { x: number; y: number } | null {
  if (target.kind === 'place') {
    const place = findPlace(state, target.id);
    return place ? { x: place.x, y: place.y } : null;
  }
  if (target.kind === 'office') {
    const office = findOffice(state, target.id);
    return office ? { x: office.x, y: office.y } : null;
  }
  const lead = state.leads.find((item) => item.id === target.id);
  return lead ? { x: lead.x, y: lead.y } : null;
}

function targetName(state: RtsState, target: MoveTarget): string {
  if (target.kind === 'place') return findPlace(state, target.id)?.name ?? 'place';
  if (target.kind === 'office') {
    const office = findOffice(state, target.id);
    return office ? `${hubById(office.hubId).name} office` : 'office';
  }
  return state.leads.find((lead) => lead.id === target.id)?.name ?? 'meetup';
}

function sameTarget(left: MoveTarget, right: MoveTarget): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function movePerson(
  state: RtsState,
  person: Person,
  target: MoveTarget,
  pitchOnArrival = false,
): void {
  const point = targetPosition(state, target);
  if (!point) return;
  if (person.at === target.id && !person.order) return;
  if (
    person.order &&
    sameTarget(person.order.target, target) &&
    Boolean(person.order.pitchOnArrival) === pitchOnArrival
  )
    return;
  const duration = travelDays(person.x, person.y, point.x, point.y);
  person.at = null;
  person.order = {
    target,
    fromX: person.x,
    fromY: person.y,
    toX: point.x,
    toY: point.y,
    progress: 0,
    durationDays: Math.max(duration, 0.001),
    ...(pitchOnArrival ? { pitchOnArrival: true } : {}),
  };
}

function claimLead(state: RtsState, person: Person, lead: Lead, fx: RtsFx[]): void {
  const leadIndex = state.leads.findIndex((item) => item.id === lead.id);
  if (leadIndex < 0 || lead.expiresDay <= state.day || !lead.takenBy.includes(person.role)) return;
  const company = state.companies[person.company];
  if (!company?.alive) return;
  state.leads.splice(leadIndex, 1);
  const point = { x: lead.x, y: lead.y };
  const dice = new Dice(state.rng);
  if (lead.kind === 'meetup') {
    company.hype = clamp(company.hype + 8, 0, MAX_HYPE);
    company.users += 350;
    addNews(
      state,
      `${company.name} leaves ${lead.name} with a buzz and a few hundred new users.`,
      'good',
      lead.hubId,
    );
    fx.push({ kind: 'float', ...point, text: '+350 users', color: '#34d399' });
  } else if (lead.kind === 'candidate') {
    if (companyPeople(state, company.id).length < teamCap(state, company.id)) {
      const role: Role = company.product < 60 ? 'engineer' : 'growth';
      state.people.push(
        createPerson(
          state,
          company.id,
          role,
          firstName(dice),
          lead.x,
          lead.y,
          null,
          role === 'engineer' ? ENGINEER_SALARY_WEEK : GROWTH_SALARY_WEEK,
          1.25,
        ),
      );
      addNews(
        state,
        `${company.name} picks up a talented ${role} at ${lead.venue}.`,
        'good',
        lead.hubId,
      );
      fx.push({ kind: 'float', ...point, text: 'New hire', color: '#34d399' });
    } else {
      company.hype = clamp(company.hype + 5, 0, MAX_HYPE);
      addNews(
        state,
        `${company.name} meets a promising candidate, but the team is at capacity.`,
        'neutral',
        lead.hubId,
      );
      fx.push({ kind: 'float', ...point, text: '+5 hype', color: '#f8c33a' });
    }
  } else if (lead.kind === 'journalist') {
    company.hype = clamp(company.hype + 22, 0, MAX_HYPE);
    addNews(state, `${company.name} gets a glowing mention from a journalist.`, 'good', lead.hubId);
    fx.push({ kind: 'float', ...point, text: '+22 hype', color: '#f8c33a' });
  } else {
    company.cash += 60_000;
    company.equity *= 0.98;
    addNews(
      state,
      `${company.name} gets a £60,000 angel cheque at ${lead.venue}.`,
      'money',
      lead.hubId,
    );
    fx.push({ kind: 'float', ...point, text: '+£60k', color: '#34d399' });
  }
  state.rng = dice.state;
  fx.push({ kind: 'sparkle', ...point });
}

function advanceMovement(state: RtsState, dt: number, fx: RtsFx[]): void {
  for (const person of state.people) {
    const order = person.order;
    if (!order) continue;
    order.progress = clamp(order.progress + dt / order.durationDays, 0, 1);
    person.x = order.fromX + (order.toX - order.fromX) * order.progress;
    person.y = order.fromY + (order.toY - order.fromY) * order.progress;
    if (order.progress < 1) continue;
    const target = order.target;
    const shouldPitch = order.pitchOnArrival === true;
    person.x = order.toX;
    person.y = order.toY;
    person.order = null;
    if (target.kind === 'lead') {
      person.at = null;
      const lead = state.leads.find((item) => item.id === target.id);
      if (lead) claimLead(state, person, lead, fx);
    } else if (target.kind === 'place' && findPlace(state, target.id)) {
      person.at = target.id;
    } else if (target.kind === 'office' && findOffice(state, target.id)) {
      person.at = target.id;
    } else {
      person.at = null;
    }
    if (shouldPitch && person.role === 'founder' && target.kind === 'place') {
      const place = findPlace(state, target.id);
      const company = state.companies[person.company];
      if (place?.kind === 'investor' && company) pitchAt(state, company, place, fx);
    }
  }
}

function signupRate(state: RtsState, person: Person, place: CustomerPlace): number {
  const company = state.companies[person.company];
  if (!company?.alive || !unlockedSegments(company).includes(place.segment)) return 0;
  const hub = hubById(place.hubId);
  const segmentFit = SEGMENT_INFO[place.segment].fit.includes(company.sectorId) ? 1.3 : 1;
  const roleMultiplier = person.role === 'founder' ? 0.6 : person.role === 'growth' ? 1 : 0;
  return (
    person.skill *
    SIGNUPS_PER_SKILL_DAY *
    roleMultiplier *
    segmentFit *
    (0.4 + company.product / 100) *
    (0.6 + company.hype / 100) *
    hub.hypeMult *
    sectorById(company.sectorId).tractionMult *
    featureMultipliers(company, 'signupMult')
  );
}

function researchRate(state: RtsState, person: Person, company: Company): number {
  const buildMult = sectorById(company.sectorId).buildMult;
  const roleMultiplier = person.role === 'founder' ? 0.5 : person.role === 'engineer' ? 1 : 0;
  return person.skill * buildMult * BUILD_POINTS_PER_DAY * roleMultiplier;
}

function workAtOffices(state: RtsState, dt: number, fx: RtsFx[]): void {
  const contributions = new Map<CompanyId, number>();
  const polishes: Array<{ company: Company; person: Person; amount: number; office: Office }> = [];
  for (const person of state.people) {
    if (person.order || (person.role !== 'engineer' && person.role !== 'founder') || !person.at)
      continue;
    const office = findOffice(state, person.at);
    const company = state.companies[person.company];
    if (!office || office.company !== person.company || !company?.alive) continue;
    if (company.researching && canResearch(company, company.researching)) {
      const amount = researchRate(state, person, company) * dt;
      contributions.set(company.id, (contributions.get(company.id) ?? 0) + amount);
    } else if (!company.researching) {
      const roleMultiplier = person.role === 'founder' ? 0.5 : 1;
      const amount =
        POLISH_POINTS_PER_DAY *
        person.skill *
        sectorById(company.sectorId).buildMult *
        roleMultiplier *
        Math.max(0, 1 - company.product / 110) *
        dt;
      polishes.push({ company, person, amount, office });
    }
  }

  for (const [companyId, amount] of contributions) {
    const company = state.companies[companyId];
    const feature = company.researching && FEATURES.find((item) => item.id === company.researching);
    if (!feature) continue;
    company.researchProgress += amount;
    if (company.researchProgress < feature.cost) continue;
    company.shipped.push(feature.id);
    company.product = clamp(company.product + feature.quality, 0, MAX_PRODUCT);
    company.hype = clamp(company.hype + (feature.hype ?? 0), 0, MAX_HYPE);
    company.researching = null;
    company.researchProgress = 0;
    const office = companyOffices(state, companyId)[0];
    const point = office ? { x: office.x, y: office.y } : hubPoint(company.hqHub);
    addNews(
      state,
      `${company.name} ships ${feature.name}.`,
      'good',
      office?.hubId ?? company.hqHub,
    );
    fx.push({ kind: 'float', ...point, text: `${feature.name} shipped`, color: '#34d399' });
    fx.push({ kind: 'sparkle', ...point });
  }

  for (const { company, amount, office } of polishes) {
    company.product = clamp(company.product + amount, 0, MAX_PRODUCT);
    if (amount > 0.05)
      fx.push({ kind: 'float', x: office.x, y: office.y, text: '+product', color: '#93c5fd' });
  }
}

function performWork(state: RtsState, dt: number, fx: RtsFx[]): void {
  for (const place of state.places) {
    if (place.kind === 'customers') {
      place.pool = Math.min(
        place.poolMax,
        place.pool + (place.poolMax - place.pool) * POOL_REFILL_PER_DAY * dt,
      );
    }
  }
  workAtOffices(state, dt, fx);
  for (const person of state.people) {
    if (person.order || !person.at || (person.role !== 'growth' && person.role !== 'founder'))
      continue;
    const place = findPlace(state, person.at);
    if (place?.kind !== 'customers') continue;
    const rate = signupRate(state, person, place);
    const company = state.companies[person.company];
    if (!company || rate <= 0) continue;
    const signups = Math.min(place.pool, rate * dt);
    place.pool -= signups;
    company.users += signups;
  }
}

function applyEconomy(state: RtsState, dt: number): void {
  for (const companyId of COMPANY_IDS) {
    const company = state.companies[companyId];
    if (!company?.alive) continue;
    company.users = Math.max(0, company.users * (1 - (USERS_CHURN_PER_WEEK * dt) / 7));
    company.cash += ((weeklyRevenue(state, companyId) - weeklyBurn(state, companyId)) * dt) / 7;
  }
  for (const companyId of RIVAL_IDS) {
    const company = state.companies[companyId];
    if (company.alive && company.cash < 0) {
      company.alive = false;
      state.people = state.people.filter((person) => person.company !== companyId);
      state.offices = state.offices.filter((office) => office.company !== companyId);
      addNews(state, `${company.name} runs out of runway and shuts down.`, 'rival', company.hqHub);
    }
  }
}

function decayHype(state: RtsState, dt: number): void {
  for (const company of Object.values(state.companies)) {
    if (!company.alive) continue;
    company.hype = clamp(
      company.hype * (1 - HYPE_DECAY_PER_DAY * sectorById(company.sectorId).hypeDecayMult * dt),
      0,
      MAX_HYPE,
    );
  }
}

function spawnLead(state: RtsState, dice: Dice): void {
  if (state.leads.length >= 5) return;
  const kindRoll = dice.float();
  const kind =
    kindRoll < 0.28
      ? 'meetup'
      : kindRoll < 0.53
        ? 'candidate'
        : kindRoll < 0.79
          ? 'journalist'
          : 'angel';
  const details = generateLeadDetails(dice);
  const lead: Lead = {
    id: nextId(state, 'lead'),
    kind,
    name: details.title,
    venue: details.venue,
    hubId: details.hubId,
    x: details.x,
    y: details.y,
    spawnDay: state.day,
    expiresDay: state.day + dice.int(4, 7),
    takenBy:
      kind === 'journalist'
        ? ['founder', 'growth']
        : kind === 'angel'
          ? ['founder']
          : ['founder', 'engineer', 'growth'],
  };
  state.leads.push(lead);
  addNews(state, `${lead.name} is happening at ${lead.venue}.`, 'neutral', lead.hubId);
}

function hubForPerson(state: RtsState, person: Person): HubId | null {
  if (!person.at) return null;
  const place = findPlace(state, person.at);
  if (place) return place.hubId;
  return findOffice(state, person.at)?.hubId ?? null;
}

function openDilemma(state: RtsState, dice: Dice, fx: RtsFx[]): boolean {
  const eligiblePeople = companyPeople(state, 'player').filter(
    (person) => !person.order && hubForPerson(state, person) !== null,
  );
  if (eligiblePeople.length === 0) return false;
  const person = dice.pick(eligiblePeople);
  const hubId = hubForPerson(state, person)!;
  const entry = dice.pick(DILEMMAS);
  const dilemma: ActiveDilemma = {
    id: entry.id,
    title: entry.title,
    body: entry.body,
    hubId,
    options: entry.options.map((option) => ({ label: option.label, hint: option.body })),
  };
  state.dilemma = dilemma;
  state.phase = 'dilemma';
  const point = hubPoint(hubId);
  fx.push({ kind: 'focus', ...point });
  return true;
}

function applyDilemmaEffect(state: RtsState, effect: string, label: string, fx: RtsFx[]): void {
  const company = state.companies.player;
  const dilemma = state.dilemma;
  if (!dilemma) return;
  const point = hubPoint(dilemma.hubId);
  if (effect === 'retain') {
    company.cash -= 5_000;
    company.hype = clamp(company.hype + 3, 0, MAX_HYPE);
  } else if (effect === 'letGo') {
    const engineerIndex = state.people.findIndex(
      (person) => person.company === 'player' && person.role === 'engineer',
    );
    if (engineerIndex >= 0) state.people.splice(engineerIndex, 1);
    company.hype = clamp(company.hype - 3, 0, MAX_HYPE);
  } else if (effect === 'press') {
    company.hype = clamp(company.hype + 20, 0, MAX_HYPE);
    company.users += 1_000;
  } else if (effect === 'quiet') {
    company.cash += 5_000;
  } else if (effect === 'specialist') {
    company.cash -= 7_000;
    company.product = clamp(company.product + 3, 0, MAX_PRODUCT);
  } else if (effect === 'selfFix') {
    company.product = clamp(company.product + 1, 0, MAX_PRODUCT);
    company.hype = clamp(company.hype + 4, 0, MAX_HYPE);
  } else if (effect === 'accelerator') {
    company.cash -= 10_000;
    company.hype = clamp(company.hype + 15, 0, MAX_HYPE);
  } else if (effect === 'independent') {
    company.cash += 8_000;
  } else if (effect === 'negotiate') {
    company.cash -= 8_000;
  } else if (effect === 'downsize') {
    company.cash += 4_000;
    company.hype = clamp(company.hype - 4, 0, MAX_HYPE);
  }
  addNews(state, `${company.name} decides: ${label}.`, 'neutral', dilemma.hubId);
  fx.push({ kind: 'float', ...point, text: 'Decision made', color: '#f8c33a' });
}

function schedulerStep(state: RtsState, fx: RtsFx[]): void {
  const dice = new Dice(state.rng);
  for (const lead of state.leads) {
    if (lead.expiresDay <= state.day)
      addNews(state, `${lead.name} has wrapped up at ${lead.venue}.`, 'neutral', lead.hubId);
  }
  state.leads = state.leads.filter((lead) => lead.expiresDay > state.day);

  if (state.day >= state.nextLeadDay) {
    spawnLead(state, dice);
    state.nextLeadDay = state.day + dice.int(2, 4);
  }

  if (state.phase === 'playing' && state.day >= state.nextDilemmaDay) {
    if (!openDilemma(state, dice, fx)) state.nextDilemmaDay = state.day + 1;
    else state.nextDilemmaDay = state.day + dice.int(12, 20);
  }

  while (state.nextAiDay <= state.day + 1e-8 && state.phase === 'playing') {
    state.nextAiDay += 0.5;
    for (const companyId of RIVAL_IDS) runCompanyAI(state, companyId);
  }
  state.rng = dice.state;
}

function updateEndConditions(state: RtsState): void {
  const player = state.companies.player;
  if (player.stageIndex >= STAGES.length - 1) {
    state.phase = 'won';
  } else if (player.cash < 0) {
    state.phase = 'bankrupt';
    addNews(
      state,
      `${player.name} runs out of cash. The startup is out of runway.`,
      'bad',
      player.hqHub,
    );
  }
}

function distanceToSegmentSquared(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  const nearestX = start.x + t * dx;
  const nearestY = start.y + t * dy;
  return (point.x - nearestX) ** 2 + (point.y - nearestY) ** 2;
}

function stampNearbyLandmarks(
  state: RtsState,
  previous: Map<string, { x: number; y: number }>,
  fx: RtsFx[],
): void {
  const player = state.companies.player;
  if (!player.alive) return;
  const radiusSquared = JOURNAL_RADIUS * JOURNAL_RADIUS;
  for (const person of state.people) {
    if (person.company !== 'player') continue;
    const start = previous.get(person.id) ?? person;
    for (const landmark of LANDMARKS) {
      if (state.journal[landmark.kind] !== undefined) continue;
      const point = project(landmark.at);
      if (distanceToSegmentSquared(point, start, person) > radiusSquared) continue;
      state.journal[landmark.kind] = state.day;
      player.hype = clamp(player.hype + JOURNAL_HYPE, 0, MAX_HYPE);
      addNews(state, `📮 Discovered ${landmark.name}`, 'good');
      fx.push({ kind: 'postcard', landmark: landmark.kind, x: point.x, y: point.y });
    }
  }
}

export function tick(state: RtsState, dtDays: number): RtsResult {
  const next = clone(state);
  const fx: RtsFx[] = [];
  if (next.phase !== 'playing' || !Number.isFinite(dtDays) || dtDays <= 0) return result(next, fx);
  let remaining = dtDays;
  while (remaining > 1e-9 && next.phase === 'playing') {
    const dt = Math.min(0.1, remaining);
    next.day += dt;
    const previous = new Map(
      next.people
        .filter((person) => person.company === 'player')
        .map((person) => [person.id, { x: person.x, y: person.y }]),
    );
    advanceMovement(next, dt, fx);
    stampNearbyLandmarks(next, previous, fx);
    performWork(next, dt, fx);
    applyEconomy(next, dt);
    decayHype(next, dt);
    schedulerStep(next, fx);
    updateEndConditions(next);
    remaining -= dt;
  }
  return result(next, fx);
}

export function journalProgress(state: RtsState): { found: number; total: number } {
  return {
    found: LANDMARKS.reduce((count, landmark) => count + Number(state.journal[landmark.kind] !== undefined), 0),
    total: LANDMARKS.length,
  };
}

export function movePeople(
  state: RtsState,
  personIds: string[],
  target: MoveTarget,
  opts?: { pitchOnArrival?: boolean },
): RtsResult {
  if (state.phase !== 'playing') return refused(state, 'The company cannot move people right now.');
  if (!targetPosition(state, target)) return refused(state, 'That destination no longer exists.');
  if (opts?.pitchOnArrival) {
    const place = target.kind === 'place' ? findPlace(state, target.id) : undefined;
    if (!place || place.kind !== 'investor')
      return refused(state, 'Pitch-on-arrival needs an investor place.');
  }
  const uniqueIds = [...new Set(personIds)];
  const people = uniqueIds.map((id) => state.people.find((person) => person.id === id));
  if (people.some((person) => !person || person.company !== 'player')) {
    return refused(state, 'You can only move your own people.');
  }
  if (opts?.pitchOnArrival && people.some((person) => person?.role !== 'founder')) {
    return refused(state, 'Only the founder can pitch on arrival.');
  }
  const next = clone(state);
  for (const id of uniqueIds) {
    const person = next.people.find((item) => item.id === id)!;
    movePerson(next, person, target, Boolean(opts?.pitchOnArrival && person.role === 'founder'));
  }
  return result(next);
}

function hireAt(
  state: RtsState,
  companyId: CompanyId,
  role: 'engineer' | 'growth',
  placeId: string,
): string | undefined {
  const place = findPlace(state, placeId);
  if (!place || place.kind !== 'talent') return 'Choose a talent place to hire from.';
  const recruiter = companyPeople(state, companyId).find(
    (person) => person.at === placeId && !person.order,
  );
  if (!recruiter) return 'Someone from your team must be at that talent place.';
  if (companyPeople(state, companyId).length >= teamCap(state, companyId))
    return 'Your team is at capacity; upgrade an office first.';
  const company = state.companies[companyId];
  const fee = role === 'engineer' ? ENGINEER_HIRE_FEE : GROWTH_HIRE_FEE;
  if (company.cash < fee) return `You need £${fee.toLocaleString()} to hire a ${role}.`;
  const dice = new Dice(state.rng);
  const skill = (0.85 + dice.float() * 0.3) * hubById(place.hubId).hireQualityMult * place.quality;
  company.cash -= fee;
  state.people.push(
    createPerson(
      state,
      companyId,
      role,
      firstName(dice),
      place.x,
      place.y,
      place.id,
      role === 'engineer' ? ENGINEER_SALARY_WEEK : GROWTH_SALARY_WEEK,
      skill,
    ),
  );
  state.rng = dice.state;
  addNews(state, `${company.name} hires a ${role} at ${place.name}.`, 'good', place.hubId);
  return undefined;
}

export function hire(
  state: RtsState,
  role: 'engineer' | 'growth',
  talentPlaceId: string,
): RtsResult {
  if (state.phase !== 'playing') return refused(state, 'The company cannot hire right now.');
  const next = clone(state);
  const error = hireAt(next, 'player', role, talentPlaceId);
  return error ? refused(state, error) : result(next);
}

function openOfficeAt(state: RtsState, hubId: HubId): string | undefined {
  const people = companyPeople(state, 'player');
  const standing = people.some((person) => {
    if (person.order || !person.at) return false;
    return findPlace(state, person.at)?.hubId === hubId;
  });
  if (!standing) return `Someone from your team must be at a place in ${hubById(hubId).name}.`;
  if (companyOffices(state, 'player').some((office) => office.hubId === hubId)) {
    return 'You already have an office in that hub.';
  }
  const company = state.companies.player;
  if (company.cash < OFFICE_OPEN_COST)
    return `You need £${OFFICE_OPEN_COST.toLocaleString()} to open an office.`;
  company.cash -= OFFICE_OPEN_COST;
  const office = createOffice(state, 'player', hubId, 1);
  state.offices.push(office);
  addNews(
    state,
    `${company.name} opens a ${OFFICE_LEVELS[1].name.toLowerCase()} office in ${hubById(hubId).name}.`,
    'good',
    hubId,
  );
  return undefined;
}

export function openOffice(state: RtsState, hubId: HubId): RtsResult {
  if (state.phase !== 'playing')
    return refused(state, 'The company cannot open an office right now.');
  const next = clone(state);
  const error = openOfficeAt(next, hubId);
  return error ? refused(state, error) : result(next);
}

function upgradeOfficeAt(state: RtsState, officeId: string): string | undefined {
  const office = findOffice(state, officeId);
  if (!office || office.company !== 'player') return 'That is not one of your offices.';
  const nextLevel = OFFICE_LEVELS[office.level + 1];
  if (!nextLevel) return 'That office is already at its highest level.';
  const company = state.companies.player;
  if (company.cash < nextLevel.cost)
    return `You need £${nextLevel.cost.toLocaleString()} to upgrade this office.`;
  company.cash -= nextLevel.cost;
  office.level += 1;
  addNews(
    state,
    `${company.name} upgrades its ${hubById(office.hubId).name} office to ${nextLevel.name}.`,
    'good',
    office.hubId,
  );
  return undefined;
}

export function upgradeOffice(state: RtsState, officeId: string): RtsResult {
  if (state.phase !== 'playing')
    return refused(state, 'The company cannot upgrade an office right now.');
  const next = clone(state);
  const error = upgradeOfficeAt(next, officeId);
  return error ? refused(state, error) : result(next);
}

function setResearchAt(state: RtsState, featureId: FeatureId | null): string | undefined {
  const company = state.companies.player;
  if (featureId === null) {
    company.researching = null;
    company.researchProgress = 0;
    return undefined;
  }
  if (!canResearch(company, featureId)) {
    const feature = FEATURES.find((item) => item.id === featureId);
    return feature
      ? `${feature.name} needs all prerequisite features to be shipped first.`
      : 'That feature does not exist.';
  }
  if (company.researching !== featureId) {
    company.researching = featureId;
    company.researchProgress = 0;
  }
  return undefined;
}

export function setResearch(state: RtsState, featureId: FeatureId | null): RtsResult {
  if (state.phase !== 'playing')
    return refused(state, 'The company cannot change its roadmap right now.');
  const next = clone(state);
  const error = setResearchAt(next, featureId);
  return error ? refused(state, error) : result(next);
}

export function pitch(state: RtsState, investorPlaceId: string): RtsResult {
  if (state.phase !== 'playing') return refused(state, 'The company cannot pitch right now.');
  const investor = findPlace(state, investorPlaceId);
  if (!investor || investor.kind !== 'investor')
    return refused(state, 'Choose an investor place to pitch.');
  const founder = companyPeople(state, 'player').find((person) => person.role === 'founder');
  if (!founder || founder.order || founder.at !== investorPlaceId) {
    return refused(state, 'Your founder must be idle at that investor place to pitch.');
  }
  const preview = pitchPreview(state, 'player');
  if (!preview.eligible) return refused(state, preview.blockers.join('. '));
  if ((investor.cooldownUntil.player ?? 0) > state.day) {
    return refused(state, 'That investor needs more time before another meeting.');
  }
  const next = clone(state);
  const nextInvestor = findPlace(next, investorPlaceId)!;
  const fx: RtsFx[] = [];
  pitchAt(next, next.companies.player, nextInvestor, fx);
  updateEndConditions(next);
  return result(next, fx);
}

export function resolveDilemma(state: RtsState, optionIndex: number): RtsResult {
  if (state.phase !== 'dilemma' || !state.dilemma)
    return refused(state, 'There is no decision to resolve.');
  if (
    !Number.isInteger(optionIndex) ||
    optionIndex < 0 ||
    optionIndex >= state.dilemma.options.length
  ) {
    return refused(state, 'Choose one of the available options.');
  }
  const next = clone(state);
  const dilemma = next.dilemma!;
  const content = DILEMMAS.find((item) => item.id === dilemma.id);
  const effect = content?.options[optionIndex]?.effect;
  if (!effect) return refused(state, 'That decision is no longer available.');
  const fx: RtsFx[] = [];
  applyDilemmaEffect(next, effect, dilemma.options[optionIndex].label, fx);
  next.dilemma = null;
  next.phase = 'playing';
  updateEndConditions(next);
  return result(next, fx);
}

function companyTargetPlaceFor(person: Person, place: CustomerPlace): number {
  const distance = travelDays(person.x, person.y, place.x, place.y);
  return distance;
}

function bestCustomerPlace(state: RtsState, person: Person): CustomerPlace | undefined {
  const company = state.companies[person.company];
  const unlocked = unlockedSegments(company);
  const customers = state.places.filter(
    (place): place is CustomerPlace =>
      place.kind === 'customers' && unlocked.includes(place.segment),
  );
  return customers
    .map((place) => {
      const otherGrowth = state.people.filter((other) => {
        if (other.role !== 'growth' || (other.company === person.company && other.id === person.id))
          return false;
        return (
          (other.at === place.id && !other.order) ||
          (other.order?.target.kind === 'place' && other.order.target.id === place.id)
        );
      }).length;
      const fit = SEGMENT_INFO[place.segment].fit.includes(company.sectorId) ? 1.3 : 1;
      const travel = companyTargetPlaceFor(person, place);
      return {
        place,
        score: (place.pool * fit) / (1 + travel) / (1 + otherGrowth * 0.65),
      };
    })
    .sort((a, b) => b.score - a.score)[0]?.place;
}

function nearestInvestor(state: RtsState, company: Company, person: Person) {
  return investorPlaces(state)
    .filter((place) => (place.cooldownUntil[company.id] ?? 0) <= state.day)
    .sort(
      (a, b) => travelDays(person.x, person.y, a.x, a.y) - travelDays(person.x, person.y, b.x, b.y),
    )[0];
}

function dispatchFounder(state: RtsState, company: Company): void {
  const founder = companyPeople(state, company.id).find((person) => person.role === 'founder');
  if (!founder || founder.order) return;
  const preview = pitchPreview(state, company.id);
  if (preview.eligible && preview.odds >= 0.45) {
    const investor = nearestInvestor(state, company, founder);
    if (investor) {
      if (founder.at === investor.id) pitchAt(state, company, investor, []);
      else movePerson(state, founder, { kind: 'place', id: investor.id }, true);
      return;
    }
  }
  const nearbyLead = state.leads
    .filter((lead) => lead.takenBy.includes('founder') && lead.expiresDay > state.day)
    .map((lead) => ({ lead, days: travelDays(founder.x, founder.y, lead.x, lead.y) }))
    .filter(({ days }) => days <= 2)
    .sort((a, b) => a.days - b.days)[0]?.lead;
  if (nearbyLead) {
    movePerson(state, founder, { kind: 'lead', id: nearbyLead.id });
    return;
  }
  const hq = companyOffices(state, company.id).find((office) => office.hubId === company.hqHub);
  if (hq && founder.at !== hq.id) movePerson(state, founder, { kind: 'office', id: hq.id });
}

function dispatchEngineers(state: RtsState, companyId: CompanyId): void {
  const offices = companyOffices(state, companyId);
  if (!offices.length) return;
  for (const person of companyPeople(state, companyId)) {
    if (person.role !== 'engineer' || person.order) continue;
    if (person.at && offices.some((office) => office.id === person.at)) continue;
    const nearest = offices
      .slice()
      .sort(
        (a, b) =>
          travelDays(person.x, person.y, a.x, a.y) - travelDays(person.x, person.y, b.x, b.y),
      )[0];
    movePerson(state, person, { kind: 'office', id: nearest.id });
  }
}

function dispatchGrowth(state: RtsState, companyId: CompanyId): void {
  for (const person of companyPeople(state, companyId)) {
    if (person.role !== 'growth' || person.order) continue;
    const target = bestCustomerPlace(state, person);
    if (target && person.at !== target.id)
      movePerson(state, person, { kind: 'place', id: target.id });
  }
}

function chooseNextFeature(company: Company): FeatureId | null {
  const options = FEATURES.filter((feature) => canResearch(company, feature.id));
  if (!options.length) return null;
  return options
    .map((feature) => {
      const fitBonus =
        feature.unlocks && SEGMENT_INFO[feature.unlocks].fit.includes(company.sectorId) ? 18 : 0;
      return { feature, score: feature.cost - fitBonus };
    })
    .sort((a, b) => a.score - b.score || a.feature.cost - b.feature.cost)[0].feature.id;
}

function manageStaffing(state: RtsState, companyId: CompanyId): void {
  const people = companyPeople(state, companyId);
  const cap = teamCap(state, companyId);
  const company = state.companies[companyId];
  if (people.length >= cap) {
    if (runwayWeeks(state, companyId) <= 12) return;
    const upgradeable = companyOffices(state, companyId)
      .filter(
        (office) =>
          OFFICE_LEVELS[office.level + 1] && company.cash >= OFFICE_LEVELS[office.level + 1].cost,
      )
      .sort((a, b) => OFFICE_LEVELS[a.level + 1].cost - OFFICE_LEVELS[b.level + 1].cost)[0];
    if (upgradeable) {
      const nextLevel = OFFICE_LEVELS[upgradeable.level + 1];
      company.cash -= nextLevel.cost;
      upgradeable.level += 1;
      addNews(
        state,
        `${company.name} upgrades its ${hubById(upgradeable.hubId).name} office to ${nextLevel.name}.`,
        'good',
        upgradeable.hubId,
      );
    }
    return;
  }
  if (runwayWeeks(state, companyId) <= 10) return;
  const companyEngineers = people.filter((person) => person.role === 'engineer').length;
  const nextStage = STAGES[company.stageIndex + 1];
  const role: 'engineer' | 'growth' =
    companyEngineers < 2 && company.product < (nextStage?.minProduct ?? 100) + 5
      ? 'engineer'
      : 'growth';
  const idle = people.filter((person) => !person.order);
  const recruiter = idle
    .filter(
      (person) =>
        !(
          person.role === 'growth' &&
          person.at &&
          findPlace(state, person.at)?.kind === 'customers'
        ),
    )
    .sort((a, b) => {
      const aIsFounderAtInvestor =
        a.role === 'founder' && a.at && findPlace(state, a.at)?.kind === 'investor';
      const bIsFounderAtInvestor =
        b.role === 'founder' && b.at && findPlace(state, b.at)?.kind === 'investor';
      return Number(aIsFounderAtInvestor) - Number(bIsFounderAtInvestor);
    })[0];
  if (!recruiter) return;
  const talentPlaces = state.places.filter((place) => place.kind === 'talent');
  const atTalent = recruiter.at && talentPlaces.find((place) => place.id === recruiter.at);
  if (atTalent) {
    hireAt(state, companyId, role, atTalent.id);
    return;
  }
  const destination = talentPlaces
    .slice()
    .sort(
      (a, b) =>
        travelDays(recruiter.x, recruiter.y, a.x, a.y) -
        travelDays(recruiter.x, recruiter.y, b.x, b.y),
    )[0];
  if (destination) movePerson(state, recruiter, { kind: 'place', id: destination.id });
}

function runCompanyAI(state: RtsState, companyId: CompanyId): void {
  const company = state.companies[companyId];
  if (!company?.alive || state.phase !== 'playing') return;
  if (!company.researching) {
    const nextFeature = chooseNextFeature(company);
    if (nextFeature) {
      company.researching = nextFeature;
      company.researchProgress = 0;
    }
  }
  manageStaffing(state, companyId);
  dispatchFounder(state, company);
  dispatchEngineers(state, companyId);
  dispatchGrowth(state, companyId);
}

export function autoCommands(state: RtsState, companyId: CompanyId): RtsResult {
  const next = clone(state);
  if (next.phase === 'playing') runCompanyAI(next, companyId);
  return result(next);
}

function activityTargetName(state: RtsState, target: MoveTarget): string {
  return targetName(state, target);
}

export function personActivity(
  state: RtsState,
  person: Person,
): { text: string; working: boolean; perDay?: number } {
  if (person.order) {
    const remaining = Math.max(0, person.order.durationDays * (1 - person.order.progress));
    return {
      text: `Walking to ${activityTargetName(state, person.order.target)} · ${remaining.toFixed(1)} days`,
      working: false,
    };
  }
  const company = state.companies[person.company];
  if (!company?.alive || !person.at) return { text: 'Idle', working: false };
  const office = findOffice(state, person.at);
  if (
    office &&
    office.company === person.company &&
    (person.role === 'engineer' || person.role === 'founder')
  ) {
    if (company.researching && canResearch(company, company.researching)) {
      const feature = FEATURES.find((item) => item.id === company.researching)!;
      const perDay = researchRate(state, person, company);
      const percent = Math.min(100, Math.floor((company.researchProgress / feature.cost) * 100));
      return { text: `Building ${feature.name} · ${percent}%`, working: true, perDay };
    }
    if (!company.researching) {
      const roleMultiplier = person.role === 'founder' ? 0.5 : 1;
      const perDay =
        POLISH_POINTS_PER_DAY *
        person.skill *
        sectorById(company.sectorId).buildMult *
        roleMultiplier *
        Math.max(0, 1 - company.product / 110);
      return { text: 'Polishing product', working: true, perDay };
    }
  }
  const place = findPlace(state, person.at);
  if (place?.kind === 'customers' && (person.role === 'growth' || person.role === 'founder')) {
    if (!unlockedSegments(company).includes(place.segment)) {
      const unlock = FEATURES.find((feature) => feature.unlocks === place.segment);
      return {
        text: `Can't sell here yet: needs ${unlock?.name ?? 'a product feature'}`,
        working: false,
        perDay: 0,
      };
    }
    const perDay = Math.min(place.pool, signupRate(state, person, place));
    return {
      text: `Signing ${SEGMENT_INFO[place.segment].name} · +${Math.floor(perDay).toLocaleString()} users/day`,
      working: perDay > 0,
      perDay,
    };
  }
  if (place?.kind === 'talent') {
    if (companyPeople(state, person.company).length >= teamCap(state, person.company)) {
      return { text: 'Team is at capacity', working: false };
    }
    return { text: 'Recruiting: open the place to hire', working: false };
  }
  if (place?.kind === 'investor' && person.role === 'founder') {
    return {
      text: pitchPreview(state, person.company).eligible ? 'Ready to pitch' : 'Waiting to pitch',
      working: false,
    };
  }
  return { text: 'Idle', working: false };
}
