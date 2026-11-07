import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { DEFAULT_PLACE_FILTERS, type PlaceFilters } from '../services/touristFilter';

// One filter state shared by the Explore and Map tabs. On web the viewer's last choice is
// remembered in localStorage (a per-browser convenience; it never affects other users).
const STORAGE_KEY = 'mg.placeFilters';

function readSaved(): PlaceFilters {
  if (Platform.OS !== 'web') return DEFAULT_PLACE_FILTERS;
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PLACE_FILTERS;
    const value = JSON.parse(raw) as Partial<PlaceFilters>;
    return {
      touristOnly: typeof value.touristOnly === 'boolean' ? value.touristOnly : DEFAULT_PLACE_FILTERS.touristOnly,
      withImageOnly: typeof value.withImageOnly === 'boolean' ? value.withImageOnly : DEFAULT_PLACE_FILTERS.withImageOnly,
      district1Only: typeof value.district1Only === 'boolean' ? value.district1Only : DEFAULT_PLACE_FILTERS.district1Only,
    };
  } catch { return DEFAULT_PLACE_FILTERS; }
}

let current: PlaceFilters = readSaved();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => current;

export function setPlaceFilters(next: Partial<PlaceFilters>) {
  current = { ...current, ...next };
  if (Platform.OS === 'web') {
    try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* private mode: keep in memory */ }
  }
  listeners.forEach(listener => listener());
}

export function usePlaceFilters(): [PlaceFilters, typeof setPlaceFilters] {
  return [useSyncExternalStore(subscribe, snapshot, snapshot), setPlaceFilters];
}
