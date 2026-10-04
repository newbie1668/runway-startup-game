export function fmtRtsMoney(pounds: number): string {
  const sign = pounds < 0 ? '-' : '';
  const value = Math.abs(pounds);
  if (value >= 1_000_000_000) return `${sign}£${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${sign}£${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${sign}£${Math.round(value / 1000)}k`;
  if (value >= 1_000) return `${sign}£${(value / 1000).toFixed(1)}k`;
  return `${sign}£${Math.round(value)}`;
}
