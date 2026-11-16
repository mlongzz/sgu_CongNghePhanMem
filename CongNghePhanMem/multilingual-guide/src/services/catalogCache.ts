export const CATALOG_MAX_AGE_MS = 5 * 60 * 1000;

export function isCatalogFresh(loadedAt: number | null, now: number, maxAgeMs: number): boolean {
  return loadedAt !== null && now >= loadedAt && now - loadedAt < maxAgeMs;
}
