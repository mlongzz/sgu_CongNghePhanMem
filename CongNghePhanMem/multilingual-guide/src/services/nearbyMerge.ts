import type { Place } from '../data/places';
import { distanceKm, normalizeSearch, type Coordinates } from './nearby';

/** Keep the official record when providers describe the same landmark. */
export function mergeNearbyPlaces(groups: Place[][], location: Coordinates | null, radiusKm: number): Place[] {
  const combined: Place[] = [];
  for (const group of groups) for (const place of group) {
    if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude) || Math.abs(place.latitude) > 90 || Math.abs(place.longitude) > 180) continue;
    if (location && distanceKm(location, place) > radiusKm + 0.03) continue;
    const duplicate = combined.findIndex(existing => existing.id === place.id || (place.source !== 'backend' && normalizeSearch(existing.title).trim() === normalizeSearch(place.title).trim() && distanceKm(existing, place) < 0.15));
    if (duplicate >= 0) {
      const existing = combined[duplicate];
      // Keep the official marker and its content priority while preserving a verified nearby article identity for missing translations.
      if (!existing.wikipedia && place.wikipedia) combined[duplicate] = { ...existing, wikipedia: place.wikipedia };
      if (!combined[duplicate].wikipediaUrl && place.wikipediaUrl) combined[duplicate] = { ...combined[duplicate], wikipediaUrl: place.wikipediaUrl };
      continue;
    }
    combined.push(place);
  }
  return combined.sort((a, b) => location ? distanceKm(location, a) - distanceKm(location, b) : 0);
}
