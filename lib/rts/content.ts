import type { HubId, SectorId } from '@/lib/game/types';
import { EVENT_TEMPLATES } from '@/lib/game/content';
import { METERS_TO_WORLD, project, type LandmarkKind } from '@/lib/game/geo';
import type {
  ChapterSpec,
  CustomerPlace,
  Feature,
  InvestorPlace,
  Place,
  Segment,
  TalentPlace,
} from './types';

type LngLat = [number, number];

export const JOURNAL_RADIUS = 250 * METERS_TO_WORLD;
export const JOURNAL_HYPE = 2;

/** Real coordinates for every place (lng, lat). Replaces the hub-offset positions. */
export const PLACE_AT: Record<string, LngLat> = {
  'ucl-careers': [-0.1340, 51.5246],
  'silicon-roundabout': [-0.0862, 51.5229],
  'soho-studios': [-0.1324, 51.5155],
  'wharf-alumni': [-0.0235, 51.5058],
  'old-street': [-0.0877, 51.5256],
  'farringdon-cowork': [-0.1053, 51.5203],
  'camden-market': [-0.1466, 51.5413],
  'soho-high-street': [-0.1389, 51.5133],
  'borough-traders': [-0.0910, 51.5055],
  'battersea-shops': [-0.1446, 51.4819],
  'kx-devs': [-0.1255, 51.5358],
  'wharf-banks': [-0.0176, 51.5033],
  'more-london': [-0.0806, 51.5050],
  'brick-lane-capital': [-0.0717, 51.5210],
  'thames-ventures': [-0.1260, 51.5330],
  'dean-street-partners': [-0.1325, 51.5138],
  'level39-fund': [-0.0196, 51.5050],
  'borough-seed': [-0.0920, 51.5038],
};

/** Display-name changes for places (others keep their names). */
export const PLACE_RENAME: Record<string, string> = {
  'soho-high-street': 'Carnaby Street shoppers',
  'wharf-banks': 'Canada Square bank HQs',
  'kx-devs': 'Coal Drops Yard dev community',
};

/** One true line per landmark for the London journal postcard. */
export const LANDMARK_FACTS: Record<LandmarkKind, string> = {
  eye: '135 m tall, it opened in 2000 as the Millennium Wheel.',
  shard: 'At 310 m, the tallest building in the UK, completed in 2012.',
  bigben: 'Big Ben is the bell, not the tower. The tower became Elizabeth Tower in 2012.',
  bttower: 'Opened in 1965 and long treated as an official secret, missing from maps.',
  stpauls: "Christopher Wren's cathedral, rebuilt after the Great Fire of 1666.",
  o2: 'Built as the Millennium Dome. Its 12 yellow masts stand for the months of the year.',
  gherkin: '30 St Mary Axe, finished in 2003. The only curved glass is the lens at the top.',
  towerbridge: 'Opened in 1894. Its bascules still lift to let tall ships through.',
  walkie: '20 Fenchurch Street. In 2013 its curved glass focused sunlight hot enough to melt parts of a car.',
  grater: "The Leadenhall Building slopes back to protect views of St Paul's.",
  canadasq: "One Canada Square, 235 m, was the UK's tallest building until 2010.",
  battersea: "Its four chimneys are on the cover of Pink Floyd's Animals.",
  bishop: '22 Bishopsgate is the tallest tower in the City of London, at 278 m.',
  heron: 'Heron Tower has one of the largest private aquariums in the UK in its lobby.',
  tower42: 'Built as the NatWest Tower. From above it is shaped like the NatWest logo.',
  abbey: 'Every coronation since 1066 has taken place here.',
  oldstreet: "The heart of 'Silicon Roundabout', London's tech cluster.",
  westminsterbr: 'Painted green to match the seats in the House of Commons.',
  lambethbr: 'Painted red to match the benches in the House of Lords.',
  waterloobr: "Built during the Second World War largely by women: 'the Ladies' Bridge'.",
  blackfriarsbr: 'Next to it, Blackfriars is the only London station that spans the Thames.',
  londonbr: 'The previous London Bridge was sold in 1968 and rebuilt in Lake Havasu City, Arizona.',
  millennium: "Nicknamed the 'Wobbly Bridge' after it swayed on opening day in 2000.",
  albertbr: 'Signs still tell troops to break step when marching across.',
  hungerford: 'The Golden Jubilee footbridges either side of the rail bridge opened in 2002.',
  towerlondon: 'Home of the Crown Jewels, and by legend of at least six ravens.',
  buckingham: 'The palace has 775 rooms, including 78 bathrooms.',
  monument: 'It is 202 ft tall and stands 202 ft from where the Great Fire of 1666 began.',
  britishmuseum: 'Home of the Rosetta Stone. It has been free to visit since 1759.',
  allsouls: "John Nash's round portico turns the corner where Regent Street meets Langham Place.",
  goodgest: "Its deep-level shelter was used by Eisenhower's staff in the Second World War.",
  stcharles: 'A Catholic church tucked away on Ogle Street in Fitzrovia.',
  nationaltheatre: "Denys Lasdun's Brutalist theatre on the South Bank, opened in 1976.",
  tatemodern: 'A former power station. The Turbine Hall once held its generators.',
  stpancras: "Its 1868 train shed was the world's largest single-span roof when built.",
  alberthall: 'Opened by Queen Victoria in 1871. It hosts the Proms every summer.',
  lcy: 'Its short runway means jets come in on a steep 5.5° approach.',
};

/** Real venues where pop-up leads appear. Replaces hub-centre lead positions. */
export const LEAD_VENUES: readonly { name: string; at: LngLat; hubId: HubId }[] = [
  { name: 'Tate Modern Turbine Hall', at: [-0.0993, 51.5077], hubId: 'londonbridge' },
  { name: 'The Shard, 31st floor', at: [-0.0865, 51.5045], hubId: 'londonbridge' },
  { name: 'The O2', at: [0.0032, 51.5029], hubId: 'canarywharf' },
  { name: 'British Museum Great Court', at: [-0.1269, 51.5194], hubId: 'kingscross' },
  { name: 'St Pancras station', at: [-0.1254, 51.5304], hubId: 'kingscross' },
  { name: 'Battersea Power Station', at: [-0.1446, 51.4819], hubId: 'battersea' },
  { name: 'Boxpark Shoreditch', at: [-0.0752, 51.5234], hubId: 'shoreditch' },
  { name: 'Somerset House', at: [-0.1172, 51.5110], hubId: 'soho' },
  { name: 'Barbican Centre', at: [-0.0937, 51.5202], hubId: 'farringdon' },
  { name: 'Smithfield Market', at: [-0.1020, 51.5196], hubId: 'farringdon' },
  { name: 'The Roundhouse, Camden', at: [-0.1517, 51.5434], hubId: 'camden' },
  { name: 'Crossrail Place roof garden', at: [-0.0187, 51.5061], hubId: 'canarywharf' },
  { name: 'Royal Festival Hall', at: [-0.1166, 51.5056], hubId: 'soho' },
  { name: 'Granary Square', at: [-0.1248, 51.5352], hubId: 'kingscross' },
];

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
// Mean street/straight ratio across 1,558 ordered pairs of 18 places, 8 hub centres, and 14 lead venues.
export const STREET_DETOUR = 1.3978461974933534;
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

export const CHAPTERS: ChapterSpec[] = [
  {
    id: 'kitchen-table',
    title: 'Chapter 1 · The Kitchen Table',
    focus: { kind: 'hq' },
    briefing:
      "It's you, a laptop and one engineer. Ship something people want, find your first 150 users, then walk into an investor's office and ask for money.",
    objectives: [
      { kind: 'feature', id: 'mvp', label: 'Ship the MVP' },
      { kind: 'users', atLeast: 150, label: 'Sign up 150 users' },
      { kind: 'stage', atLeast: 1, label: 'Raise Pre-Seed' },
    ],
    bonus: { kind: 'journal', count: 3, label: 'Discover 3 London landmarks' },
    parDays: 70,
    bonusReward: { cash: 5_000, hype: 6 },
  },
  {
    id: 'silicon-roundabout',
    title: 'Chapter 2 · Silicon Roundabout',
    focus: { kind: 'landmark', landmark: 'oldstreet' },
    briefing:
      'You have money and a deadline. Move off the kitchen table, ship what customers keep asking for, and get to 1,600 users before the Seed funds lose interest.',
    objectives: [
      { kind: 'officeLevel', atLeast: 1, label: 'Move into co-working desks' },
      { kind: 'shipped', count: 3, label: 'Ship 3 features' },
      { kind: 'users', atLeast: 1_600, label: 'Reach 1,600 users' },
      { kind: 'stage', atLeast: 2, label: 'Raise Seed' },
    ],
    bonus: { kind: 'leadsWon', count: 2, label: 'Win 2 pop-up opportunities' },
    parDays: 90,
    bonusReward: { cash: 20_000, hype: 8 },
  },
  {
    id: 'kings-cross',
    title: "Chapter 3 · King's Cross",
    focus: { kind: 'landmark', landmark: 'stpancras' },
    briefing:
      "Google is next door and every engineer in London has three offers. Build a team of six, plant a second office, and prove you can sell beyond early adopters.",
    objectives: [
      { kind: 'team', count: 6, label: 'Grow the team to 6' },
      { kind: 'offices', count: 2, label: 'Open a second office' },
      { kind: 'users', atLeast: 9_000, label: 'Reach 9,000 users' },
      { kind: 'stage', atLeast: 3, label: 'Raise Series A' },
    ],
    bonus: { kind: 'journal', count: 10, label: 'Discover 10 London landmarks' },
    parDays: 110,
    bonusReward: { cash: 100_000, hype: 8 },
  },
  {
    id: 'london-bridge',
    title: 'Chapter 4 · Across the River',
    focus: { kind: 'landmark', landmark: 'shard' },
    briefing:
      'The view from the Shard is all banks and big companies. Take your own floor, win enterprise customers, and get to 40,000 users.',
    objectives: [
      { kind: 'officeLevel', atLeast: 2, label: 'Take your own floor' },
      { kind: 'segment', id: 'enterprise', label: 'Unlock enterprise customers' },
      { kind: 'users', atLeast: 40_000, label: 'Reach 40,000 users' },
      { kind: 'stage', atLeast: 4, label: 'Raise Series B' },
    ],
    bonus: { kind: 'shipped', count: 6, label: 'Ship 6 features' },
    parDays: 130,
    bonusReward: { cash: 300_000, hype: 10 },
  },
  {
    id: 'canary-wharf',
    title: 'Chapter 5 · The Billion',
    focus: { kind: 'landmark', landmark: 'canadasq' },
    briefing:
      'Canary Wharf is where the big money lives. Move into an HQ building, close Series C, and become the next London unicorn before a rival does.',
    objectives: [
      { kind: 'officeLevel', atLeast: 3, label: 'Move into an HQ building' },
      { kind: 'stage', atLeast: 5, label: 'Raise Series C' },
      { kind: 'stage', atLeast: 6, label: 'Reach Unicorn' },
    ],
    bonus: { kind: 'journal', count: 20, label: 'Discover 20 London landmarks' },
    parDays: 160,
    bonusReward: { cash: 500_000, hype: 10 },
  },
];

/**
 * Real buildings an office moves into at each level (index 1..3; level 0 = hub centre kitchen table).
 * Coordinates are approximate (±100 m). Level 3 sites in Farringdon/Camden sit just outside the hub.
 */
export const OFFICE_SITES: Record<HubId, [null, { name: string; at: LngLat }, { name: string; at: LngLat }, { name: string; at: LngLat }]> = {
  shoreditch: [null,
    { name: 'Tea Building co-working', at: [-0.0770, 51.5236] },
    { name: 'A floor at Principal Place', at: [-0.0798, 51.5215] },
    { name: 'The Stage, Shoreditch', at: [-0.0790, 51.5245] }],
  kingscross: [null,
    { name: 'Kings Place co-working', at: [-0.1223, 51.5350] },
    { name: 'A floor on Pancras Square', at: [-0.1250, 51.5338] },
    { name: "King's Boulevard landscraper", at: [-0.1268, 51.5343] }],
  soho: [null,
    { name: 'Golden Square studios', at: [-0.1370, 51.5115] },
    { name: 'A floor on Soho Square', at: [-0.1318, 51.5157] },
    { name: 'Centre Point', at: [-0.1300, 51.5160] }],
  farringdon: [null,
    { name: 'Clerkenwell Green studios', at: [-0.1050, 51.5236] },
    { name: 'A floor on Cowcross Street', at: [-0.1040, 51.5205] },
    { name: 'No 1 Poultry', at: [-0.0909, 51.5134] }],
  canarywharf: [null,
    { name: 'Wood Wharf co-working', at: [-0.0130, 51.5025] },
    { name: 'A floor at 25 Churchill Place', at: [-0.0145, 51.5048] },
    { name: '8 Canada Square', at: [-0.0175, 51.5054] }],
  londonbridge: [null,
    { name: 'Bermondsey Street studios', at: [-0.0815, 51.5000] },
    { name: "A floor at Hay's Galleria", at: [-0.0838, 51.5063] },
    { name: 'The Shard', at: [-0.0865, 51.5045] }],
  camden: [null,
    { name: 'Camden Collective', at: [-0.1400, 51.5370] },
    { name: 'A floor at Hawley Wharf', at: [-0.1450, 51.5418] },
    { name: "Regent's Place", at: [-0.1410, 51.5260] }],
  battersea: [null,
    { name: 'Circus West Village co-working', at: [-0.1470, 51.4818] },
    { name: 'A floor on Electric Boulevard', at: [-0.1450, 51.4805] },
    { name: 'Battersea Power Station', at: [-0.1446, 51.4815] }],
};

function placePosition(id: string) {
  return project(PLACE_AT[id]);
}

function placeName(id: string, name: string) {
  return PLACE_RENAME[id] ?? name;
}

function talent(id: string, name: string, hubId: HubId, quality: number): TalentPlace {
  return { id, kind: 'talent', name: placeName(id, name), hubId, quality, ...placePosition(id) };
}

function customer(id: string, name: string, hubId: HubId, segment: Segment, poolMax: number): CustomerPlace {
  return {
    id,
    kind: 'customers',
    name: placeName(id, name),
    hubId,
    segment,
    pool: poolMax,
    poolMax,
    ...placePosition(id),
  };
}

function investor(id: string, name: string, hubId: HubId): InvestorPlace {
  return { id, kind: 'investor', name: placeName(id, name), hubId, cooldownUntil: {}, ...placePosition(id) };
}

export const PLACES: readonly Place[] = [
  talent('ucl-careers', 'UCL careers fair', 'kingscross', 1.2),
  talent('silicon-roundabout', 'Silicon Roundabout meetup', 'shoreditch', 1.0),
  talent('soho-studios', 'Soho design studios', 'soho', 1.0),
  talent('wharf-alumni', 'Ex-bankers, Canary Wharf', 'canarywharf', 1.1),

  customer('old-street', 'Old Street early adopters', 'shoreditch', 'earlyAdopters', 2_700),
  customer(
    'farringdon-cowork',
    'Farringdon co-working floors',
    'farringdon',
    'earlyAdopters',
    2_250,
  ),
  customer('camden-market', 'Camden Market crowds', 'camden', 'consumers', 35_550),
  customer('soho-high-street', 'Soho high street', 'soho', 'consumers', 35_550),
  customer('borough-traders', 'Borough Market traders', 'londonbridge', 'smb', 26_550),
  customer('battersea-shops', 'Battersea Power Station shops', 'battersea', 'smb', 26_550),
  customer('kx-devs', "King's Cross dev community", 'kingscross', 'developers', 31_050),
  customer('wharf-banks', 'Canary Wharf bank HQs', 'canarywharf', 'enterprise', 44_775),
  customer('more-london', 'More London offices', 'londonbridge', 'enterprise', 44_775),

  investor('brick-lane-capital', 'Brick Lane Capital', 'shoreditch'),
  investor('thames-ventures', 'Thames Ventures', 'kingscross'),
  investor('dean-street-partners', 'Dean Street Partners', 'soho'),
  investor('level39-fund', 'Level39 Fund', 'canarywharf'),
  investor('borough-seed', 'Borough Seed', 'londonbridge'),
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

export function generateLeadDetails(dice: { pick<T>(items: readonly T[]): T }) {
  const template = dice.pick(EVENT_TEMPLATES);
  const venue = dice.pick(LEAD_VENUES);
  return {
    title: template.name,
    venue: venue.name,
    hubId: venue.hubId,
    ...project(venue.at),
  };
}

export function featureById(id: string) {
  return FEATURES.find((feature) => feature.id === id);
}
