export const baseUrl = process.env.RUNWAY_BASE_URL ?? 'http://127.0.0.1:4317';

export const viewports = [
  { id: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { id: 'mobile', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];

export const cases = [
  ['B1', '/game'],
  ['B2', '/game?map=3d&look=citystreet&chrome=0'],
  ['B3', '/game?map=3d&view=mid&chrome=0'],
  ['B4', '/game?map=3d&view=wide&chrome=0'],
  ['B5', '/game?map=3d&look=buckingham&chrome=0'],
  ['B8', '/game?map=2d'],
].map(([id, path]) => ({ id, path }));

export const hubTour = [
  'Shoreditch', 'Canary Wharf', 'Battersea', 'Camden', 'Fitzrovia',
  "King's Cross", 'Soho', 'Farringdon', 'London Bridge',
];
