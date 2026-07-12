/**
 * RUNWAY — static game content.
 *
 * Everything flavourful lives here: sectors, London hubs, funding stages,
 * event templates, dilemma cards, and the procedural name generator.
 * The engine only reads this file; it never mutates it.
 */

import type { ActionInfo, Dilemma, EventKind, Hub, HubId, Sector, SectorId, Stage } from './types';
import type { Dice } from './rng';

// ---------------------------------------------------------------------------
// Sectors
// ---------------------------------------------------------------------------

export const SECTORS: readonly Sector[] = [
  {
    id: 'ai',
    name: 'AI',
    emoji: '🤖',
    tagline: 'Foundation models, agents, and a GPU bill that haunts your dreams.',
    perk: 'Hype builds fast — the press cannot get enough.',
    drawback: 'Burn is brutal and investors expect miracles.',
    hypeGainMult: 1.45,
    hypeDecayMult: 1.25,
    buildMult: 1.0,
    tractionMult: 1.0,
    burnMult: 1.3,
    pitchBar: 0,
  },
  {
    id: 'fintech',
    name: 'Fintech',
    emoji: '💳',
    tagline: 'Move money, mind the FCA.',
    perk: 'Traction converts to revenue — every user stretches your runway.',
    drawback: 'Compliance slows the build.',
    hypeGainMult: 0.9,
    hypeDecayMult: 0.9,
    buildMult: 0.85,
    tractionMult: 1.1,
    burnMult: 1.0,
    pitchBar: 0,
  },
  {
    id: 'climate',
    name: 'Climate',
    emoji: '🌱',
    tagline: 'Decarbonise everything, starting with your pitch deck.',
    perk: 'Investors who commit, commit big — rounds close easier once you qualify.',
    drawback: 'Slow burn: traction takes longer to show.',
    hypeGainMult: 1.0,
    hypeDecayMult: 0.75,
    buildMult: 1.0,
    tractionMult: 0.8,
    burnMult: 0.9,
    pitchBar: -6,
  },
  {
    id: 'healthtech',
    name: 'HealthTech',
    emoji: '🩺',
    tagline: 'Fixing healthcare, one NHS procurement cycle at a time.',
    perk: 'Deep moat — product progress is worth more.',
    drawback: 'Everything needs sign-off; hype is hard to come by.',
    hypeGainMult: 0.75,
    hypeDecayMult: 0.8,
    buildMult: 1.2,
    tractionMult: 0.85,
    burnMult: 1.0,
    pitchBar: 4,
  },
  {
    id: 'devtools',
    name: 'DevTools',
    emoji: '🛠️',
    tagline: 'Developers building tools for developers building tools.',
    perk: 'Small team, big output — you build faster and cheaper.',
    drawback: 'Niche market: growth is a grind.',
    hypeGainMult: 1.0,
    hypeDecayMult: 1.0,
    buildMult: 1.3,
    tractionMult: 0.85,
    burnMult: 0.8,
    pitchBar: 2,
  },
  {
    id: 'consumer',
    name: 'Consumer',
    emoji: '🛍️',
    tagline: 'The next app everyone deletes in January.',
    perk: 'Growth compounds — users bring users.',
    drawback: 'Fickle: hype evaporates fast when you go quiet.',
    hypeGainMult: 1.2,
    hypeDecayMult: 1.5,
    buildMult: 1.0,
    tractionMult: 1.3,
    burnMult: 1.0,
    pitchBar: 3,
  },
] as const;

export function sectorById(id: SectorId): Sector {
  return SECTORS.find((s) => s.id === id)!;
}

// ---------------------------------------------------------------------------
// Hubs — real London startup neighbourhoods, stylised
// ---------------------------------------------------------------------------

export const HUBS: readonly Hub[] = [
  {
    id: 'shoreditch',
    name: 'Shoreditch',
    areaLabel: 'SHOREDITCH',
    lng: -0.081,
    lat: 51.526,
    rent: 2600,
    blurb: 'The classic. Exposed brick, flat whites, an event every night.',
    eventFrequencyMult: 1.5,
    hireQualityMult: 1.0,
    hypeMult: 1.15,
    synergySector: 'consumer',
  },
  {
    id: 'kingscross',
    name: "King's Cross",
    areaLabel: "KING'S CROSS",
    lng: -0.124,
    lat: 51.533,
    rent: 2900,
    blurb: 'DeepMind next door, UCL up the road. Talent everywhere.',
    eventFrequencyMult: 1.1,
    hireQualityMult: 1.35,
    hypeMult: 1.0,
    synergySector: 'ai',
  },
  {
    id: 'soho',
    name: 'Soho',
    areaLabel: 'SOHO',
    lng: -0.135,
    lat: 51.513,
    rent: 3300,
    blurb: 'Media land. Journalists drink here — so does your hype.',
    eventFrequencyMult: 1.2,
    hireQualityMult: 0.95,
    hypeMult: 1.35,
  },
  {
    id: 'farringdon',
    name: 'Farringdon',
    areaLabel: 'CLERKENWELL',
    lng: -0.105,
    lat: 51.52,
    rent: 2400,
    blurb: 'Quietly serious. On the Elizabeth line, near everything.',
    eventFrequencyMult: 1.0,
    hireQualityMult: 1.1,
    hypeMult: 1.0,
    synergySector: 'devtools',
  },
  {
    id: 'canarywharf',
    name: 'Canary Wharf',
    areaLabel: 'CANARY WHARF',
    lng: -0.019,
    lat: 51.505,
    rent: 3100,
    blurb: 'Suits and skyscrapers. Fintech money lives in the lifts.',
    eventFrequencyMult: 0.8,
    hireQualityMult: 1.05,
    hypeMult: 0.9,
    synergySector: 'fintech',
  },
  {
    id: 'londonbridge',
    name: 'London Bridge',
    areaLabel: 'BOROUGH',
    lng: -0.086,
    lat: 51.503,
    rent: 2200,
    blurb: 'Borough Market lunches, sensible rent, a view of the Shard.',
    eventFrequencyMult: 0.9,
    hireQualityMult: 1.0,
    hypeMult: 1.0,
    synergySector: 'healthtech',
  },
  {
    id: 'camden',
    name: 'Camden',
    areaLabel: 'CAMDEN',
    lng: -0.142,
    lat: 51.539,
    rent: 1900,
    blurb: 'Cheap-ish, loud, creative. Your office smells of incense.',
    eventFrequencyMult: 0.9,
    hireQualityMult: 0.9,
    hypeMult: 1.1,
  },
  {
    id: 'battersea',
    name: 'Battersea',
    areaLabel: 'BATTERSEA',
    lng: -0.144,
    lat: 51.48,
    rent: 2500,
    blurb: 'Power Station glamour south of the river. Apple for neighbours.',
    eventFrequencyMult: 0.7,
    hireQualityMult: 1.05,
    hypeMult: 1.0,
    synergySector: 'climate',
  },
] as const;

export function hubById(id: HubId): Hub {
  return HUBS.find((h) => h.id === id)!;
}

// ---------------------------------------------------------------------------
// Funding stages
// ---------------------------------------------------------------------------

export const STAGES: readonly Stage[] = [
  {
    id: 'garage',
    name: 'Bootstrapped',
    raise: 0,
    valuation: 0,
    minProduct: 0,
    minTraction: 0,
    baseOdds: 0,
  },
  {
    id: 'preseed',
    name: 'Pre-Seed',
    raise: 500_000,
    valuation: 3_000_000,
    minProduct: 15,
    minTraction: 150,
    baseOdds: 0.55,
  },
  {
    id: 'seed',
    name: 'Seed',
    raise: 2_500_000,
    valuation: 15_000_000,
    minProduct: 32,
    minTraction: 1_600,
    baseOdds: 0.48,
  },
  {
    id: 'seriesA',
    name: 'Series A',
    raise: 12_000_000,
    valuation: 60_000_000,
    minProduct: 50,
    minTraction: 9_000,
    baseOdds: 0.42,
  },
  {
    id: 'seriesB',
    name: 'Series B',
    raise: 40_000_000,
    valuation: 220_000_000,
    minProduct: 66,
    minTraction: 40_000,
    baseOdds: 0.38,
  },
  {
    id: 'seriesC',
    name: 'Series C',
    raise: 120_000_000,
    valuation: 520_000_000,
    minProduct: 80,
    minTraction: 150_000,
    baseOdds: 0.35,
  },
  {
    id: 'unicorn',
    name: 'Unicorn',
    raise: 250_000_000,
    valuation: 1_000_000_000,
    minProduct: 90,
    minTraction: 400_000,
    baseOdds: 0.33,
  },
] as const;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const ACTIONS: readonly ActionInfo[] = [
  {
    id: 'build',
    name: 'Build product',
    focusCost: 1,
    hotkey: 'B',
    blurb: 'Heads-down engineering. Product up; scaled by team & morale.',
  },
  {
    id: 'growth',
    name: 'Chase growth',
    focusCost: 1,
    hotkey: 'G',
    blurb: 'Launches, outreach, SEO. Users up; scaled by product & hype.',
  },
  {
    id: 'hire',
    name: 'Hire',
    focusCost: 1,
    hotkey: 'H',
    blurb: 'Add a teammate. More output — and more burn, forever.',
  },
  {
    id: 'press',
    name: 'Press push',
    focusCost: 1,
    hotkey: 'P',
    blurb: 'Pitch journalists. Hype up now, fades if you go quiet.',
  },
  {
    id: 'retreat',
    name: 'Team social',
    focusCost: 1,
    hotkey: 'T',
    blurb: 'Pub, pizza, ping-pong. Morale up; costs a little cash.',
  },
  {
    id: 'pitch',
    name: 'Pitch investors',
    focusCost: 2,
    hotkey: 'I',
    blurb: 'Full fundraising sprint. Close the next round — or lose face.',
  },
] as const;

// ---------------------------------------------------------------------------
// Weekly events
// ---------------------------------------------------------------------------

interface EventTemplate {
  name: string;
  kind: EventKind;
  sectorId?: SectorId;
}

export const EVENT_TEMPLATES: readonly EventTemplate[] = [
  { name: 'Demo Night', kind: 'demo' },
  { name: 'Founders & Coffee', kind: 'social' },
  { name: 'Pitch Practice', kind: 'pitch' },
  { name: 'How I Raised My Seed', kind: 'talk' },
  { name: 'AI Tinkerers London', kind: 'talk', sectorId: 'ai' },
  { name: 'GenAI Builders Meetup', kind: 'demo', sectorId: 'ai' },
  { name: 'Fintech Drinks', kind: 'party', sectorId: 'fintech' },
  { name: 'Open Banking Social', kind: 'social', sectorId: 'fintech' },
  { name: 'Climate Tech Social', kind: 'social', sectorId: 'climate' },
  { name: 'Net Zero Founders', kind: 'talk', sectorId: 'climate' },
  { name: 'HealthTech Founders Dinner', kind: 'social', sectorId: 'healthtech' },
  { name: 'DevTools Happy Hour', kind: 'party', sectorId: 'devtools' },
  { name: 'Platform Engineering Meetup', kind: 'talk', sectorId: 'devtools' },
  { name: 'Consumer Apps Showcase', kind: 'demo', sectorId: 'consumer' },
  { name: 'Growth Hackers London', kind: 'talk', sectorId: 'consumer' },
  { name: 'First Cheque Investor Mixer', kind: 'pitch' },
  { name: 'Startup Quiz Night', kind: 'party' },
  { name: 'Hiring Fair for Startups', kind: 'social' },
] as const;

export const VENUES_BY_HUB: Record<HubId, readonly string[]> = {
  shoreditch: ['The Trampery', 'Second Home', 'a Brick Lane taproom', 'Shoreditch Works'],
  kingscross: ['the Coal Drops loft', 'a Granary Square rooftop', 'the Lighthouse block'],
  soho: ['a Dean Street members club', 'the Soho Screening Room', 'a Berwick St basement'],
  farringdon: ['the Clerkenwell Sessions House', 'a Leather Lane studio', 'St John space'],
  canarywharf: ['Level39', 'a 40th-floor boardroom', 'the East Wintergarden'],
  londonbridge: ['a Borough Market mezzanine', 'the Vinegar Yard', 'a Shard-view loft'],
  camden: ['the Roundhouse bar', 'a Camden Lock warehouse', 'the Stables Market attic'],
  battersea: ['the Power Station turbine hall', 'a Circus West studio', 'the Boiler House'],
};

// ---------------------------------------------------------------------------
// Dilemma cards
// ---------------------------------------------------------------------------
// `condition` keys are interpreted by engine.ts (see dilemmaAllowed):
//   funded        — player has closed at least one round
//   team3         — team of 3 or more
//   hype40        — hype at 40+
//   traction1k    — 1,000+ users
//   lowMorale     — morale under 45

export const DILEMMAS: readonly Dilemma[] = [
  {
    id: 'acquihire',
    title: 'An offer you might refuse',
    body: 'A US giant wants to acqui-hire the whole team. Decent money today — but the dream ends here.',
    condition: 'funded',
    weight: 0.7,
    once: true,
    options: [
      {
        label: 'Take the money',
        detail: 'Sell now. Game over — score what you built.',
        effectId: 'acquihire_accept',
      },
      {
        label: 'Politely decline',
        detail: 'The team walks taller. Morale and hype up.',
        effectId: 'acquihire_decline',
      },
    ],
  },
  {
    id: 'poach',
    title: 'Your best engineer got a call',
    body: 'A rival has offered your strongest engineer a 40% raise and a fancy title.',
    condition: 'team3',
    weight: 1.2,
    once: false,
    options: [
      {
        label: 'Counter-offer',
        detail: 'Pay £4,000 to keep them; morale lifts.',
        effectId: 'poach_counter',
      },
      {
        label: 'Wish them well',
        detail: 'Lose a teammate; morale takes a knock.',
        effectId: 'poach_release',
      },
    ],
  },
  {
    id: 'viral',
    title: 'You are (accidentally) famous',
    body: 'A screenshot of your product is going viral. The internet demands a response.',
    condition: 'hype40',
    weight: 1.0,
    once: false,
    options: [
      {
        label: 'Lean in — meme it up',
        detail: 'Big hype spike. Product slips a touch this week.',
        effectId: 'viral_leanin',
      },
      {
        label: 'Stay heads-down',
        detail: 'A modest, quieter bump. The work continues.',
        effectId: 'viral_ignore',
      },
    ],
  },
  {
    id: 'flood',
    title: 'The Thames pays a visit',
    body: 'A burst main floods your floor. Laptops on radiators, standing desks literally standing in water.',
    weight: 0.8,
    once: true,
    options: [
      {
        label: 'Pay for emergency repairs',
        detail: 'Costs cash, back to work tomorrow.',
        effectId: 'flood_pay',
      },
      {
        label: 'Work from cafés for a while',
        detail: 'Free, but morale and progress suffer.',
        effectId: 'flood_cafes',
      },
    ],
  },
  {
    id: 'enterprise',
    title: 'A whale swims by',
    body: 'A FTSE 100 firm wants a big annual contract — if you build their pet feature and keep it exclusive.',
    condition: 'traction1k',
    weight: 1.0,
    once: false,
    options: [
      {
        label: 'Sign the deal',
        detail: 'A juicy cash injection; roadmap bends to one customer.',
        effectId: 'enterprise_sign',
      },
      {
        label: 'Stay product-led',
        detail: 'No cash, but the team believes. Morale up.',
        effectId: 'enterprise_decline',
      },
    ],
  },
  {
    id: 'journalist',
    title: 'A journalist is sniffing around',
    body: 'A well-known tech reporter wants a fly-on-the-wall week inside your startup.',
    weight: 1.0,
    once: false,
    options: [
      {
        label: 'Open the doors',
        detail: 'Could be a glowing feature… could be a hit piece.',
        effectId: 'journalist_open',
      },
      {
        label: 'Not this quarter',
        detail: 'No risk, no story.',
        effectId: 'journalist_decline',
      },
    ],
  },
  {
    id: 'accelerator',
    title: 'The accelerator calls',
    body: 'A famous accelerator offers cash and their network — for a slice of the company.',
    condition: 'funded',
    weight: 0.9,
    once: true,
    options: [
      {
        label: 'Take the batch',
        detail: 'Cash + investor intros now; valuation and morale take a hit.',
        effectId: 'accelerator_join',
      },
      {
        label: 'Go it alone',
        detail: 'Keep the cap table clean.',
        effectId: 'accelerator_decline',
      },
    ],
  },
  {
    id: 'outage',
    title: 'Everything is on fire',
    body: 'A botched deploy takes you down on your busiest day. Users are tweeting screenshots.',
    condition: 'traction1k',
    weight: 1.1,
    once: false,
    options: [
      {
        label: 'All-hands war room',
        detail: 'Fix it fast; the team is exhausted after.',
        effectId: 'outage_warroom',
      },
      {
        label: 'Own it publicly',
        detail: 'Post a candid post-mortem. Some users leave; respect grows.',
        effectId: 'outage_postmortem',
      },
    ],
  },
  {
    id: 'burnout',
    title: 'The team is running on fumes',
    body: 'Three people cried at standup this week. Something has to give.',
    condition: 'lowMorale',
    weight: 1.4,
    once: false,
    options: [
      {
        label: 'Mandatory week off',
        detail: 'Progress pauses; the team comes back human.',
        effectId: 'burnout_rest',
      },
      {
        label: 'Push through to the milestone',
        detail: 'Keep shipping and hope nobody quits.',
        effectId: 'burnout_push',
      },
    ],
  },
  {
    id: 'regulator',
    title: 'A letter from the regulator',
    body: 'A formal inquiry about how you handle user data. Probably routine. Probably.',
    condition: 'funded',
    weight: 0.8,
    once: false,
    options: [
      {
        label: 'Lawyer up properly',
        detail: 'Expensive, thorough, done.',
        effectId: 'regulator_lawyers',
      },
      {
        label: 'Handle it in-house',
        detail: 'Cheap — and risky if you missed something.',
        effectId: 'regulator_inhouse',
      },
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// Name generator + rival flavour
// ---------------------------------------------------------------------------

const NAME_A = [
  'Pixel',
  'Quant',
  'Nimbus',
  'Forge',
  'Ledger',
  'Beacon',
  'Vault',
  'Sprout',
  'Magpie',
  'Otter',
  'Raven',
  'Willow',
  'Ember',
  'Drift',
  'Anchor',
  'Marble',
  'Comet',
  'Bramble',
  'Fable',
  'Hazel',
  'Onyx',
  'Juniper',
  'Falcon',
  'Tidal',
];
const NAME_B = [
  'ly',
  'ify',
  'base',
  'stack',
  'flow',
  'grid',
  'loop',
  'mind',
  'pay',
  'lab',
  'works',
  'wise',
  'nest',
  'port',
  'forge',
  'field',
  'byte',
  'sense',
  'craft',
];
const NAME_STANDALONE = [
  'Marmalade',
  'Paternoster',
  'Wren & Co',
  'Bletchley',
  'Threadneedle',
  'Whitechapel AI',
  'Peabody Labs',
  'Brunel Systems',
  'Ada Loop',
  'Doubledecker',
];

export function generateCompanyName(dice: Dice): string {
  if (dice.chance(0.2)) return dice.pick(NAME_STANDALONE);
  const a = dice.pick(NAME_A);
  const b = dice.pick(NAME_B);
  return a + b;
}

export const RIVAL_TAUNTS = [
  'Their founder just posted a thread about "grind".',
  'They hired a Head of Vibes.',
  'Their office has a slide. An actual slide.',
  'Rumour: their MRR chart is drawn in crayon.',
  'They ran out of cold brew mid-sprint. Chaos.',
];

// News flavour lines, keyed loosely by situation. {co} = player company.
export const NEWS_FLAVOUR = {
  weekQuiet: [
    'A quiet week on the scene. Even the pigeons look underfunded.',
    'Overheard at the coffee machine: "we\'re basically pre-revenue by choice".',
    'The Northern line was down again. Half of tech worked from home.',
    'Someone shipped on a Friday. Thoughts and prayers.',
  ],
  raiseClosed: [
    'TechCrunch Europe: {co} closes its {stage} round. 🎉',
    'Sifted: {co} announces {stage} — "we\'re just getting started", says founder.',
    "City A.M.: London's {co} banks a fresh {stage}.",
  ],
  pitchFailed: [
    'VC on the {co} pitch: "love the energy, circle back post-traction".',
    'A partner fell asleep during the {co} demo. The associate took notes though.',
    '{co} got a "not a fit for our thesis right now". Classic.',
  ],
} as const;
