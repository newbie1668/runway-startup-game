import type { HubId, SectorId } from '@/lib/game/types';
import { EVENT_TEMPLATES, VENUES_BY_HUB, hubById } from '@/lib/game/content';
import { project } from '@/lib/game/geo';
import type { CustomerPlace, Feature, InvestorPlace, Place, Segment, TalentPlace } from './types';

export const STARTING_CASH = 150_000;
export const OFFICE_OPEN_COST = 20_000;
export const ENGINEER_HIRE_FEE = 8_000;
export const GROWTH_HIRE_FEE = 6_000;
export const ENGINEER_SALARY_WEEK = 1_600;
export const GROWTH_SALARY_WEEK = 1_400;
export const ENGINEER_WEEKLY_SALARY = ENGINEER_SALARY_WEEK;
export const GROWTH_WEEKLY_SALARY = GROWTH_SALARY_WEEK;
export const BASE_BURN_WEEK = 350;
export const BASE_ARPU = 0.3;
export const SECTOR_REVENUE_MULT: Record<SectorId, number> = {
  ai: 1,
  fintech: 2.5,
  climate: 1.25,
  healthtech: 1.5,
  devtools: 1.7,
  consumer: 0.8,
};
export const BUILD_POINTS_PER_DAY = 5;
export const POLISH_POINTS_PER_DAY = 0.45;
export const SIGNUPS_PER_SKILL_DAY = 68;
export const POOL_REFILL_PER_DAY = 0.02;
export const USERS_CHURN_PER_WEEK = 0.005;
export const TRAVEL_SPEED = 22;
export const PLAYER_COLOR = '#f8c33a';
export const RIVAL_COLORS = ['#f87171', '#60a5fa', '#c084fc'] as const;
export const PERSON_NAMES = [
  'Alex',
  'Aisha',
  'Amira',
  'Ben',
  'Charlie',
  'Chloe',
  'Dara',
  'Ellie',
  'Farah',
  'Freya',
  'George',
  'Hana',
  'Imani',
  'Jamie',
  'Kai',
  'Leah',
  'Maya',
  'Noah',
  'Omar',
  'Priya',
  'Ravi',
  'Sam',
  'Theo',
  'Zara',
] as const;

export const FEATURES: readonly Feature[] = [
  {
    id: 'mvp',
    name: 'MVP',
    cost: 20,
    requires: [],
    quality: 15,
    blurb: 'Ship the first version of your product.',
  },
  {
    id: 'onboarding',
    name: 'Better onboarding',
    cost: 22,
    requires: ['mvp'],
    quality: 12,
    signupMult: 1.4,
    blurb: 'Help new customers reach their first win.',
  },
  {
    id: 'payments',
    name: 'Payments',
    cost: 25,
    requires: ['mvp'],
    quality: 12,
    unlocks: 'smb',
    arpuMult: 1.5,
    blurb: 'Make it easy for small businesses to pay.',
  },
  {
    id: 'mobile',
    name: 'Mobile app',
    cost: 30,
    requires: ['onboarding'],
    quality: 12,
    unlocks: 'consumers',
    blurb: 'Bring the product to customers on the move.',
  },
  {
    id: 'api',
    name: 'Public API',
    cost: 25,
    requires: ['mvp'],
    quality: 12,
    unlocks: 'developers',
    blurb: 'Let developers build on your platform.',
  },
  {
    id: 'analytics',
    name: 'Analytics',
    cost: 34,
    requires: ['payments'],
    quality: 10,
    arpuMult: 1.3,
    blurb: 'Give customers a clearer view of their business.',
  },
  {
    id: 'enterprise',
    name: 'Enterprise SSO',
    cost: 40,
    requires: ['payments', 'api'],
    quality: 12,
    unlocks: 'enterprise',
    arpuMult: 1.4,
    blurb: 'Meet the security needs of larger teams.',
  },
  {
    id: 'aiAssist',
    name: 'AI assistant',
    cost: 48,
    requires: ['analytics'],
    quality: 12,
    signupMult: 1.3,
    hype: 25,
    blurb: 'Put a helpful AI assistant inside the product.',
  },
];

export const SEGMENT_INFO: Record<Segment, { name: string; fit: SectorId[] }> = {
  earlyAdopters: { name: 'early adopters', fit: [] },
  consumers: { name: 'consumers', fit: ['consumer', 'healthtech'] },
  smb: { name: 'small businesses', fit: ['fintech', 'climate'] },
  developers: { name: 'developers', fit: ['devtools', 'ai'] },
  enterprise: { name: 'enterprise teams', fit: ['fintech', 'ai', 'healthtech'] },
};

export const OFFICE_LEVELS = [
  { name: 'Kitchen table', capacity: 3, rentMult: 0, cost: 0 },
  { name: 'Co-working desks', capacity: 6, rentMult: 0.5, cost: 15_000 },
  { name: 'Own floor', capacity: 12, rentMult: 1, cost: 60_000 },
  { name: 'HQ building', capacity: 24, rentMult: 2.5, cost: 400_000 },
] as const;

function coords(hubId: HubId, dx: number, dy: number) {
  const hub = hubById(hubId);
  const point = project([hub.lng, hub.lat]);
  return { x: point.x + dx, y: point.y + dy };
}

function talent(
  id: string,
  name: string,
  hubId: HubId,
  quality: number,
  dx: number,
  dy: number,
): TalentPlace {
  return { id, kind: 'talent', name, hubId, quality, ...coords(hubId, dx, dy) };
}

function customer(
  id: string,
  name: string,
  hubId: HubId,
  segment: Segment,
  poolMax: number,
  dx: number,
  dy: number,
): CustomerPlace {
  return {
    id,
    kind: 'customers',
    name,
    hubId,
    segment,
    pool: poolMax,
    poolMax,
    ...coords(hubId, dx, dy),
  };
}

function investor(id: string, name: string, hubId: HubId, dx: number, dy: number): InvestorPlace {
  return { id, kind: 'investor', name, hubId, cooldownUntil: {}, ...coords(hubId, dx, dy) };
}

export const PLACES: readonly Place[] = [
  talent('ucl-careers', 'UCL careers fair', 'kingscross', 1.2, -6, -5),
  talent('silicon-roundabout', 'Silicon Roundabout meetup', 'shoreditch', 1.0, -6, 5),
  talent('soho-studios', 'Soho design studios', 'soho', 1.0, -6, -5),
  talent('wharf-alumni', 'Ex-bankers, Canary Wharf', 'canarywharf', 1.1, 6, -5),

  customer('old-street', 'Old Street early adopters', 'shoreditch', 'earlyAdopters', 3_000, 5, -5),
  customer(
    'farringdon-cowork',
    'Farringdon co-working floors',
    'farringdon',
    'earlyAdopters',
    2_500,
    6,
    4,
  ),
  customer('camden-market', 'Camden Market crowds', 'camden', 'consumers', 39_500, -5, 4),
  customer('soho-high-street', 'Soho high street', 'soho', 'consumers', 39_500, 5, -4),
  customer('borough-traders', 'Borough Market traders', 'londonbridge', 'smb', 29_500, -6, 4),
  customer('battersea-shops', 'Battersea Power Station shops', 'battersea', 'smb', 29_500, 6, 4),
  customer('kx-devs', "King's Cross dev community", 'kingscross', 'developers', 34_500, 6, 4),
  customer('wharf-banks', 'Canary Wharf bank HQs', 'canarywharf', 'enterprise', 49_750, -5, 4),
  customer('more-london', 'More London offices', 'londonbridge', 'enterprise', 49_750, 5, -4),

  investor('brick-lane-capital', 'Brick Lane Capital', 'shoreditch', 3, 7),
  investor('thames-ventures', 'Thames Ventures', 'kingscross', 3, 7),
  investor('dean-street-partners', 'Dean Street Partners', 'soho', 3, 7),
  investor('level39-fund', 'Level39 Fund', 'canarywharf', -2, 8),
  investor('borough-seed', 'Borough Seed', 'londonbridge', 2, 8),
];

export const DILEMMAS = [
  {
    id: 'poached-engineer',
    title: 'A rival wants your engineer',
    body: 'A well-funded startup has offered your engineer a bigger salary.',
    options: [
      {
        label: 'Match the offer',
        body: 'Keep the team together, but take a cash hit.',
        effect: 'retain',
      },
      { label: 'Wish them well', body: 'Save cash and take the time to reset.', effect: 'letGo' },
    ],
  },
  {
    id: 'press-exclusive',
    title: 'The press wants an exclusive',
    body: 'A journalist is ready to put your product in front of thousands of readers.',
    options: [
      { label: 'Go all in', body: 'Enjoy the attention and a surge of signups.', effect: 'press' },
      {
        label: 'Keep building quietly',
        body: 'Avoid the distraction and protect your focus.',
        effect: 'quiet',
      },
    ],
  },
  {
    id: 'product-outage',
    title: 'A rough product outage',
    body: 'A release has knocked the service offline for a few customers.',
    options: [
      {
        label: 'Bring in a specialist',
        body: 'Pay for help and get the service stable quickly.',
        effect: 'specialist',
      },
      {
        label: 'Fix it yourselves',
        body: 'Spend time on the fix and learn from the incident.',
        effect: 'selfFix',
      },
    ],
  },
  {
    id: 'accelerator-offer',
    title: 'Accelerator offer',
    body: 'A respected accelerator has offered a place in its next cohort.',
    options: [
      {
        label: 'Join the cohort',
        body: 'Pay the programme fee for mentorship and a little hype.',
        effect: 'accelerator',
      },
      {
        label: 'Stay independent',
        body: 'Keep the cash and work at your own pace.',
        effect: 'independent',
      },
    ],
  },
  {
    id: 'rent-hike',
    title: 'Your landlord raises the rent',
    body: 'The landlord says the building is popular and wants more each week.',
    options: [
      {
        label: 'Negotiate hard',
        body: 'Spend cash to keep your workspace affordable.',
        effect: 'negotiate',
      },
      {
        label: 'Move to a smaller space',
        body: 'Save on rent, even if the team has less room.',
        effect: 'downsize',
      },
    ],
  },
] as const;

export type DilemmaEffect = (typeof DILEMMAS)[number]['options'][number]['effect'];

export function generateLeadDetails(dice: { pick<T>(items: readonly T[]): T }, hubId: HubId) {
  const template = dice.pick(EVENT_TEMPLATES);
  const venue = dice.pick(VENUES_BY_HUB[hubId]);
  return {
    title: template.name,
    venue,
  };
}

export function featureById(id: string) {
  return FEATURES.find((feature) => feature.id === id);
}
