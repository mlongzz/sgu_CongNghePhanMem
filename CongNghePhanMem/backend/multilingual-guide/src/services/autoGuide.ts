import type { Place } from '../data/places';
import { distanceKm, type Coordinates } from './nearby';

export function chooseAutoGuide(location: Coordinates, accuracy: number | null, places: Place[], heard: Set<string>, priority: 'nearest' | 'official' = 'nearest'): Place | null {
  if (!Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90 || !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180 ||
    accuracy === null || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 50) return null;
  // Use the uncertainty envelope instead of claiming the reported centre is exact.
  for (const p of places) if (distanceKm(location, p) - accuracy / 1000 > 0.2) heard.delete(p.id);
  const nearby = places.filter(p => !heard.has(p.id) && (p.source === 'backend' || p.source === 'wikipedia' || p.wikipedia || p.wikipediaUrl ||
    Object.values(p.narration ?? {}).some(content => !!content?.text.trim())))
    .map(p => ({ p, distance: distanceKm(location, p) })).filter(v => v.distance + accuracy / 1000 <= 0.08).sort((a, b) =>
      (priority === 'official' ? Number(b.p.source === 'backend') - Number(a.p.source === 'backend') : 0) || a.distance - b.distance);
  return nearby[0]?.p ?? null;
}
