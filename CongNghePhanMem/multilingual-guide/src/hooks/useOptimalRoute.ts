import { useCallback, useSyncExternalStore } from 'react';
import type { Place } from '../data/places';
import { DISTRICT1_CENTER, isInDistrict1 } from '../data/district1';
import { apiFetch } from '../services/api';
import { validateBackendPlace, type Coordinates } from '../services/nearby';
import { planOptimalRoute, routeThrough, type OptimalRoute } from '../services/optimalRoute';
import { hasPlaceImage } from '../services/touristFilter';

export const ROUTE_SIZES = [4, 6, 8, 0] as const; // 0 = every published District 1 place

/** Hands-free tour over the planned route. The visitor confirms arrival; GPS is never checked. */
export type TourPhase = 'intro' | 'confirm' | 'narrating' | 'transition' | 'closing' | 'done';
export type TourState = { phase: TourPhase; index: number; visited: string[]; heardEarly: string[]; early: boolean };

type State = {
  route: OptimalRoute | null; size: number; busy: boolean; error: string; fromCenter: boolean;
  maxStops: number | null; tour: TourState | null;
};
// Kept outside React so the planned route and tour survive switching tabs.
let state: State = { route: null, size: 6, busy: false, error: '', fromCenter: false, maxStops: null, tour: null };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => { state = { ...state, ...next }; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => state;

let candidatesRequest: Promise<Place[]> | null = null;
/** Every published, photographed official place inside District 1 (the curated catalogue). */
function loadCandidates(force = false): Promise<Place[]> {
  if (!candidatesRequest || force) {
    candidatesRequest = apiFetch<unknown[]>('/places?limit=100&offset=0')
      .then(rows => (Array.isArray(rows) ? rows : []).map(validateBackendPlace)
        .filter((p): p is Place => !!p && isInDistrict1(p) && hasPlaceImage(p)))
      .then(places => { set({ maxStops: places.length }); return places; })
      .catch(error => { candidatesRequest = null; throw error; });
  }
  return candidatesRequest;
}

export function useOptimalRoute() {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const setSize = useCallback((size: number) => set({ size }), []);
  const loadMax = useCallback(() => { void loadCandidates().catch(() => {}); }, []);
  const clear = useCallback(() => set({ route: null, error: '', fromCenter: false, tour: null }), []);
  /** Plan from `start` (the visitor's GPS) or, when it is missing, from the centre of District 1. */
  const plan = useCallback(async (start: Coordinates | null, count?: number) => {
    set({ busy: true, error: '', tour: null });
    try {
      const candidates = await loadCandidates(true);
      if (!candidates.length) throw new Error('Chưa có địa điểm Quận 1 để lập hành trình.');
      const origin = start ?? DISTRICT1_CENTER;
      const wanted = count ?? (state.size || candidates.length);
      const route = planOptimalRoute(origin, candidates, Math.min(wanted, candidates.length));
      if (!route) throw new Error('Không lập được hành trình. Hãy thử lại.');
      set({ route, busy: false, fromCenter: !start });
    } catch (error) {
      set({ busy: false, error: error instanceof Error ? error.message : 'Không lập được hành trình. Hãy thử lại.' });
    }
  }, []);
  /** Remove one stop; the remaining order is kept and the legs are recomputed. */
  const removeStop = useCallback((placeId: string) => {
    const route = state.route;
    if (!route) return;
    const position = route.legs.findIndex(leg => leg.place.id === placeId);
    if (position < 0) return;
    const remaining = route.legs.map(leg => leg.place).filter(place => place.id !== placeId);
    const next = routeThrough(route.start, remaining, route.exact);
    let tour = state.tour;
    if (tour) {
      const index = position < tour.index ? tour.index - 1 : tour.index;
      tour = !next ? null : index >= remaining.length ? { ...tour, index: remaining.length - 1, phase: 'closing' }
        : { ...tour, index, phase: position === tour.index ? 'confirm' : tour.phase, early: false };
    }
    set({ route: next, tour });
  }, []);
  const setTour = useCallback((tour: TourState | null) => set({ tour }), []);
  return { ...current, setSize, loadMax, plan, clear, removeStop, setTour };
}
