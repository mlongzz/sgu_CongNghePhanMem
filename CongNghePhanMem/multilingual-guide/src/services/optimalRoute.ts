import type { Place } from '../data/places';
import { distanceKm, type Coordinates } from './nearby';

/** Straight-line distances are scaled to approximate real walking along streets. */
export const WALKING_DETOUR = 1.3;
export const WALKING_SPEED_KMH = 4.5;
/** Exact search is used up to this many candidates (2^16 × 16 states); beyond it a heuristic. */
const EXACT_LIMIT = 16;

export type RouteLeg = { place: Place; legKm: number; cumulativeKm: number };
export type OptimalRoute = {
  start: Coordinates;
  legs: RouteLeg[];
  /** Estimated walking distance including the detour factor. */
  walkingKm: number;
  walkingMinutes: number;
  exact: boolean;
};

/**
 * Shortest open walk from `start` that visits exactly `count` of the candidates
 * (any subset, any order). Exact Held–Karp dynamic programming for up to 16 candidates;
 * nearest-neighbour + 2-opt for larger sets. Distances are great-circle × WALKING_DETOUR.
 */
export function planOptimalRoute(start: Coordinates, candidates: readonly Place[], count: number): OptimalRoute | null {
  const points = candidates.filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
  const n = points.length;
  const k = Math.max(0, Math.min(Math.floor(count), n));
  if (!k || !Number.isFinite(start.latitude) || !Number.isFinite(start.longitude)) return null;
  const fromStart = points.map(p => distanceKm(start, p));
  const between = points.map(a => points.map(b => distanceKm(a, b)));
  const order = n <= EXACT_LIMIT ? exactOrder(fromStart, between, k) : heuristicOrder(fromStart, between, k);
  let cumulative = 0;
  let previous: Coordinates = start;
  const legs = order.map(index => {
    const place = points[index];
    const legKm = distanceKm(previous, place) * WALKING_DETOUR;
    cumulative += legKm;
    previous = place;
    return { place, legKm, cumulativeKm: cumulative };
  });
  return { start, legs, walkingKm: cumulative, walkingMinutes: Math.round((cumulative / WALKING_SPEED_KMH) * 60), exact: n <= EXACT_LIMIT };
}

/** dp[mask][j] = shortest path from start covering `mask` and ending at j. */
function exactOrder(fromStart: number[], between: number[][], k: number): number[] {
  const n = fromStart.length;
  const size = 1 << n;
  const dp = new Float64Array(size * n).fill(Infinity);
  const parent = new Int8Array(size * n).fill(-1);
  for (let j = 0; j < n; j++) dp[(1 << j) * n + j] = fromStart[j];
  let best = Infinity, bestMask = 0, bestEnd = -1;
  for (let mask = 1; mask < size; mask++) {
    const bits = popcount(mask);
    if (bits > k) continue;
    for (let j = 0; j < n; j++) {
      if (!(mask & (1 << j))) continue;
      const here = dp[mask * n + j];
      if (here === Infinity) continue;
      if (bits === k) {
        if (here < best) { best = here; bestMask = mask; bestEnd = j; }
        continue;
      }
      for (let next = 0; next < n; next++) {
        if (mask & (1 << next)) continue;
        const nextMask = mask | (1 << next);
        const cost = here + between[j][next];
        if (cost < dp[nextMask * n + next]) {
          dp[nextMask * n + next] = cost;
          parent[nextMask * n + next] = j;
        }
      }
    }
  }
  const path: number[] = [];
  let mask = bestMask, j = bestEnd;
  while (j >= 0) {
    path.push(j);
    const previous = parent[mask * n + j];
    mask &= ~(1 << j);
    j = previous;
  }
  return path.reverse();
}

function heuristicOrder(fromStart: number[], between: number[][], k: number): number[] {
  const n = fromStart.length;
  const used = new Set<number>();
  const path: number[] = [];
  let current = -1;
  while (path.length < k) {
    let next = -1, nearest = Infinity;
    for (let i = 0; i < n; i++) {
      if (used.has(i)) continue;
      const d = current < 0 ? fromStart[i] : between[current][i];
      if (d < nearest) { nearest = d; next = i; }
    }
    used.add(next); path.push(next); current = next;
  }
  const length = (route: number[]) => route.reduce((sum, p, i) => sum + (i ? between[route[i - 1]][p] : fromStart[p]), 0);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < path.length - 1; i++) {
      for (let j = i + 1; j < path.length; j++) {
        const candidate = [...path.slice(0, i), ...path.slice(i, j + 1).reverse(), ...path.slice(j + 1)];
        if (length(candidate) + 1e-9 < length(path)) { path.splice(0, path.length, ...candidate); improved = true; }
      }
    }
  }
  return path;
}

function popcount(value: number): number {
  let count = 0;
  while (value) { value &= value - 1; count++; }
  return count;
}

/** Google Maps walking directions through the stops (the URL format allows at most 9 waypoints). */
export function googleMapsRouteUrl(route: OptimalRoute): string {
  const stops = route.legs.map(leg => `${leg.place.latitude},${leg.place.longitude}`);
  const destination = stops[stops.length - 1];
  const waypoints = stops.slice(0, -1).slice(0, 9);
  const params = new URLSearchParams({ api: '1', travelmode: 'walking', origin: `${route.start.latitude},${route.start.longitude}`, destination });
  if (waypoints.length) params.set('waypoints', waypoints.join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Same stops in the given order, with legs and totals recomputed (e.g. after removing a stop). */
export function routeThrough(start: Coordinates, stops: readonly Place[], exact = true): OptimalRoute | null {
  if (!stops.length) return null;
  let cumulative = 0;
  let previous: Coordinates = start;
  const legs = stops.map(place => {
    const legKm = distanceKm(previous, place) * WALKING_DETOUR;
    cumulative += legKm;
    previous = place;
    return { place, legKm, cumulativeKm: cumulative };
  });
  return { start, legs, walkingKm: cumulative, walkingMinutes: Math.round((cumulative / WALKING_SPEED_KMH) * 60), exact };
}

/** Validates a visitor-typed number of stops: a whole number from 1 to `max`. */
export function parseStopCount(text: string, max: number): { value: number | null; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { value: null, error: 'Nhập số điểm muốn tham quan.' };
  if (!/^-?\d+$/.test(trimmed)) return { value: null, error: 'Số điểm phải là số nguyên.' };
  const value = Number(trimmed);
  if (value <= 0) return { value: null, error: 'Số điểm phải lớn hơn 0.' };
  if (value > max) return { value: null, error: `Tối đa ${max} điểm.` };
  return { value, error: '' };
}
