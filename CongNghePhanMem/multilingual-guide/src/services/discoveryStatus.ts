export type DiscoverySource = { error?: string; warning?: string; searchedRadiusKm?: number | null; truncated?: boolean };
/** Coverage describes the data actually searched, independently of a successful empty response. */
export function partialCoverage(source: DiscoverySource, radiusKm: number) {
  return source.truncated === true || (typeof source.searchedRadiusKm === 'number' && source.searchedRadiusKm < radiusKm);
}
export function discoveryOutcome({ count, loading, errors, partial }: {count:number;loading:boolean;errors:boolean;partial:boolean}) {
  if (count > 0) return 'results';
  if (loading) return 'loading';
  if (errors) return 'source-error';
  return partial ? 'partial-empty' : 'empty';
}
export function freshGps(timestamp: unknown, now = Date.now()) {
  return typeof timestamp === 'number' && Number.isFinite(timestamp) && now-timestamp >= -5000 && now-timestamp <= 60_000;
}
