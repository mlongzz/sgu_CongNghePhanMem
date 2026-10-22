import { distanceKm } from './nearby';
import type { LocationCoordinates } from './locationOptions';

export type TrackedSearch = LocationCoordinates & { at: number };
/** Reject noise, stale fixes and small movements before dispatching any provider request. */
export function shouldRefreshTrackedPlaces(fix: LocationCoordinates, previous: TrackedSearch | null, now = Date.now()): boolean {
  if (!Number.isFinite(fix.latitude) || Math.abs(fix.latitude) > 90 || !Number.isFinite(fix.longitude) || Math.abs(fix.longitude) > 180 ||
    typeof fix.timestamp !== 'number' || !Number.isFinite(fix.timestamp) || now - fix.timestamp > 60_000 || fix.timestamp - now > 5000 ||
    typeof fix.accuracy !== 'number' || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > 100) return false;
  return !previous || (now - previous.at >= 30_000 && distanceKm(previous, fix) * 1000 >= Math.max(100, fix.accuracy + (previous.accuracy ?? 0)));
}
