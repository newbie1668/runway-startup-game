/**
 * Pure helpers for the bake-time "noticed tower" factory.
 * No DOM, no three.js — tests and bake-noticed.ts import this.
 */

export const MIN_NOTICED_HEIGHT_M = 100;
export const MAX_NOTICED = 32;

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'building';
}

export function isUsefulName(name: string): boolean {
  const n = name.trim();
  if (n.length < 3) return false;
  if (/^(block|building|residential|house|parking|car park|garage|warehouse)\b/i.test(n)) return false;
  if (/^the tower$/i.test(n)) return false;
  return true;
}

export function heightFromTags(tags: Record<string, string>): number {
  const tagHeight = parseFloat(tags.height ?? '');
  if (Number.isFinite(tagHeight) && tagHeight > 0) return tagHeight;
  const tagLevels = parseFloat(tags['building:levels'] ?? '');
  if (Number.isFinite(tagLevels) && tagLevels > 0) return tagLevels * 3.2 + 3;
  return 0;
}

/** `en:22 Bishopsgate` → `22 Bishopsgate`. Non-English wikipedia tags are ignored. */
export function wikiTitleFromTags(tags: Record<string, string>): string | null {
  const raw = tags.wikipedia?.trim();
  if (!raw) return null;
  const colon = raw.indexOf(':');
  if (colon <= 0) return raw;
  const lang = raw.slice(0, colon).toLowerCase();
  if (lang !== 'en') return null;
  const title = raw.slice(colon + 1).trim();
  return title || null;
}

export function uniqueSlug(base: string, used: Set<string>): string {
  let slug = base;
  let n = 2;
  while (used.has(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  used.add(slug);
  return slug;
}
