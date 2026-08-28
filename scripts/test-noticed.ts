/**
 * Noticed-tower factory helpers — offline, no DOM.
 */
import assert from 'node:assert/strict';
import {
  isUsefulName,
  slugify,
  uniqueSlug,
  wikiTitleFromTags,
  heightFromTags,
} from './noticedSelect';

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

console.log('Noticed tower factory');

check('slugify strips punctuation', () => {
  assert.equal(slugify('22 Bishopsgate Tower'), '22-bishopsgate-tower');
  assert.equal(slugify('HSBC UK'), 'hsbc-uk');
});

check('rejects generic names', () => {
  assert.equal(isUsefulName('The Tower'), false);
  assert.equal(isUsefulName('8 Bishopsgate'), true);
});

check('reads English wikipedia titles only', () => {
  assert.equal(wikiTitleFromTags({ wikipedia: 'en:22 Bishopsgate' }), '22 Bishopsgate');
  assert.equal(wikiTitleFromTags({ wikipedia: 'de:Irgendwas' }), null);
  assert.equal(wikiTitleFromTags({}), null);
});

check('height prefers metres over levels', () => {
  assert.equal(heightFromTags({ height: '183', 'building:levels': '42' }), 183);
  assert.equal(heightFromTags({ 'building:levels': '10' }), 10 * 3.2 + 3);
});

check('uniqueSlug disambiguates', () => {
  const used = new Set<string>();
  assert.equal(uniqueSlug('tower', used), 'tower');
  assert.equal(uniqueSlug('tower', used), 'tower-2');
});

console.log(`\nAll ${passed} noticed-factory checks passed.`);
