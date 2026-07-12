/** Compact UK-flavoured number formatting for the HUD. */

export function fmtMoney(pounds: number): string {
  const sign = pounds < 0 ? '-' : '';
  const v = Math.abs(pounds);
  if (v >= 1_000_000_000) return `${sign}£${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${sign}£${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${sign}£${Math.round(v / 1000)}k`;
  if (v >= 1_000) return `${sign}£${(v / 1000).toFixed(1)}k`;
  return `${sign}£${Math.round(v)}`;
}

export function fmtUsers(users: number): string {
  const v = Math.floor(users);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `${Math.round(v / 1000)}k`;
  if (v >= 1_000) return `${(v / 1000).toFixed(1)}k`;
  return `${v}`;
}
