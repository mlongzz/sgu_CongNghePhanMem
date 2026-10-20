import type { Place } from '../data/places';
import { distanceKm, type Coordinates } from './nearby';

export function chooseAutoGuide(location: Coordinates, accuracy: number | null, places: Place[], heard: Set<string>): Place | null {
  if (accuracy === null || accuracy > 50) return null;
  for (const p of places) if (distanceKm(location, p) > 0.2) heard.delete(p.id);
  const nearby = places.filter(p => p.source === 'backend' && !heard.has(p.id)).map(p => ({ p, distance: distanceKm(location, p) })).filter(v => v.distance <= 0.08).sort((a, b) => a.distance - b.distance);
  return nearby[0]?.p ?? null;
}
