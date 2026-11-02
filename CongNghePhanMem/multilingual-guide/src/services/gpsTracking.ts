import { distanceKm } from './nearby';
import type { LocationCoordinates } from './locationOptions';

export type TrackedSearch = LocationCoordinates & { at: number };
/** A new sensor reading is independent of movement and provider throttling. */
export function acceptGpsFix(fix: LocationCoordinates, previous: LocationCoordinates | null, now = Date.now()): boolean {
  return Number.isFinite(fix.latitude) && Math.abs(fix.latitude) <= 90 && Number.isFinite(fix.longitude) && Math.abs(fix.longitude) <= 180 &&
    typeof fix.timestamp === 'number' && Number.isFinite(fix.timestamp) && fix.timestamp > 0 && now - fix.timestamp <= 60_000 && fix.timestamp - now <= 5000 &&
    (fix.accuracy === undefined || (Number.isFinite(fix.accuracy) && fix.accuracy >= 0)) &&
    (!previous || typeof previous.timestamp !== 'number' || fix.timestamp > previous.timestamp);
}
/** Reject noise, stale fixes and small movements before dispatching any provider request. */
export function shouldRefreshTrackedPlaces(fix: LocationCoordinates, previous: TrackedSearch | null, now = Date.now()): boolean {
  if (!acceptGpsFix(fix, previous, now) ||
    typeof fix.accuracy !== 'number' || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > 100) return false;
  return !previous || (now - previous.at >= 30_000 && distanceKm(previous, fix) * 1000 >= Math.max(100, fix.accuracy + (previous.accuracy ?? 0)));
}
