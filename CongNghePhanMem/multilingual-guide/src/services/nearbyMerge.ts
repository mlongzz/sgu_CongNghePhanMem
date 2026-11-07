import type { Place } from '../data/places';
import { distanceKm, normalizeSearch, type Coordinates } from './nearby';

// City/district names and generic building words appear in many titles and do not identify a landmark.
const STOP = new Set(['thanh', 'pho', 'ho', 'chi', 'minh', 'tp', 'quan', '1', 'hcm', 'tphcm', 'city', 'district']);
const GENERIC = new Set(['nha', 'tho', 'chua', 'den', 'dinh', 'mieu', 'cho', 'ba', 'ong', 'cong', 'vien', 'bao', 'tang', 'toa', 'thap', 'tru', 'so',
  'buu', 'dien', 'pho', 'di', 'bo', 'hat', 'truong', 'cau', 'ben', 'chinh', 'trung', 'tam', 'tower', 'temple', 'church', 'park', 'museum', 'market']);
const tokens = (title: string) => new Set(normalizeSearch(title).replace(/\([^)]*\)/g, ' ').split(/[^a-z0-9]+/).filter(t => t && !STOP.has(t)));

/**
 * A community entry describes the same landmark as an official one when it carries the same
 * Wikipedia identity, or when it is close by and the names share their distinctive words
 * (e.g. "Bưu điện Sài Gòn" vs "Bưu điện Trung tâm Sài Gòn"), or it sits on the same spot.
 */
function sameLandmark(official: Place, other: Place): boolean {
  if (official.wikipedia?.pageId && official.wikipedia.pageId === other.wikipedia?.pageId && official.wikipedia.language === other.wikipedia?.language) return true;
  const metres = distanceKm(official, other) * 1000;
  if (metres > 250) return false;
  const a = tokens(official.title), b = tokens(other.title);
  const jaccard = (x: Set<string>, y: Set<string>) => {
    const union = new Set([...x, ...y]).size;
    return union ? [...x].filter(t => y.has(t)).length / union : 0;
  };
  // Same spot: half of all name words in common (e.g. "Đền Bà Mariamman" / "Đền Bà Ấn").
  if (metres < 25 && jaccard(a, b) >= 0.5) return true;
  // Nearby: the distinctive words (not "nhà", "chùa", "tháp"…) mostly agree.
  const distinct = (x: Set<string>) => new Set([...x].filter(t => !GENERIC.has(t)));
  return jaccard(distinct(a), distinct(b)) >= 0.5;
}

/** Keep the official record when providers describe the same landmark. */
export function mergeNearbyPlaces(groups: Place[][], location: Coordinates | null, radiusKm: number): Place[] {
  const combined: Place[] = [];
  const priority = (place: Place) => place.source === 'backend' ? 0 : place.source === 'wikipedia' ? 1 : 2;
  const ordered = groups.flat().slice().sort((a,b) => priority(a)-priority(b));
  for (const place of ordered) {
    if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude) || Math.abs(place.latitude) > 90 || Math.abs(place.longitude) > 180) continue;
    if (location && distanceKm(location, place) > radiusKm + 1e-7) continue;
    const duplicate = combined.findIndex(existing => existing.id === place.id || (place.source !== 'backend' && (
      (normalizeSearch(existing.title).trim() === normalizeSearch(place.title).trim() && distanceKm(existing, place) < 0.15)
      || (existing.source === 'backend' && sameLandmark(existing, place)))));
    if (duplicate >= 0) {
      const existing = combined[duplicate];
      // A matching name and nearby coordinates help declutter the map, but do
      // not establish article/image identity. Never transfer provenance here.
      if (existing.wikipedia?.pageId && existing.wikipedia.language === place.wikipedia?.language && existing.wikipedia.pageId === place.wikipedia.pageId && !existing.wikipediaUrl && place.wikipediaUrl)
        combined[duplicate] = { ...existing, wikipediaUrl: place.wikipediaUrl };
      continue;
    }
    combined.push(place);
  }
  return combined.sort((a, b) => location ? distanceKm(location, a) - distanceKm(location, b) : 0);
}
