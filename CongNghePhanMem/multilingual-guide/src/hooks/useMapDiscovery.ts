import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useApp } from '../context/AppContext';
import type { Place } from '../data/places';
import { API_BASE_URL } from '../services/api';
import { fetchOsmExploreResult, normalizeSearch, osmExploreKey } from '../services/nearby';
import { fetchWikipediaNearby, wikipediaNearbyKey } from '../services/wikipedia';
import { mergeNearbyPlaces } from '../services/nearbyMerge';

export const MAP_RADII = [1, 3, 5, 10, 20];
export const MAP_CATEGORIES = ['Tất cả', 'Lịch sử', 'Kiến trúc', 'Văn hóa', 'Khám phá'];
type CommunityState = { key: string; places: Place[]; warning: string; error: string; stale: boolean };
const initialState: CommunityState = { key: '', places: [], warning: '', error: '', stale: false };

/** One source contract and cancellation policy for both Leaflet and native maps. */
export function useMapDiscovery() {
  const app = useApp();
  const { location, nearbyStatus, cancelLocation, radiusKm, refreshNearby, places } = app;
  const [focused, setFocused] = useState(true);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [observedAt, observeTime] = useState(() => Date.now());
  const locating = useRef(false);
  useEffect(() => { locating.current = nearbyStatus === 'locating'; }, [nearbyStatus]);
  useFocusEffect(useCallback(() => {
    setFocused(true); observeTime(Date.now());
    return () => { setFocused(false); if (locating.current) cancelLocation(); };
  }, [cancelLocation]));
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      setActive(state === 'active');
      if (state === 'active') observeTime(Date.now());
      if (state !== 'active' && locating.current) cancelLocation();
    });
    return () => listener.remove();
  }, [cancelLocation]);

  const [wikiSetting, setWikiMode] = useState<'auto' | 'on' | 'off'>('auto');
  const wikiMode = wikiSetting === 'auto' && location ? 'on' : wikiSetting;
  const [retry, setRetry] = useState(0);
  const [wikiRetry, setWikiRetry] = useState(0);
  const [forceWikiRefresh, setForceWikiRefresh] = useState(false);
  const [osm, setOsm] = useState(initialState);
  const [wiki, setWiki] = useState(initialState);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [category, setCategory] = useState('Tất cả');
  const [diagnostics, setDiagnostics] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setDebouncedQuery(query), 180); return () => clearTimeout(timer); }, [query]);

  const latitude = location?.latitude;
  const longitude = location?.longitude;
  const gpsTimestamp = location?.timestamp;
  useEffect(() => {
    const initial = setTimeout(() => observeTime(Date.now()), 0);
    const expiry = app.locationSource === 'gps' && typeof gpsTimestamp === 'number' && Number.isFinite(gpsTimestamp)
      ? setTimeout(() => observeTime(Date.now()), Math.max(1, gpsTimestamp + 60_001 - Date.now())) : undefined;
    return () => { clearTimeout(initial); if (expiry !== undefined) clearTimeout(expiry); };
  }, [gpsTimestamp, app.locationSource]);
  const age = typeof gpsTimestamp === 'number' ? observedAt - gpsTimestamp : NaN;
  const locationStale = !!location && app.locationSource === 'gps' && (!Number.isFinite(age) || age > 60_000 || age < -5000);
  const coordinates = useMemo(() => typeof latitude === 'number' && typeof longitude === 'number' ? { latitude, longitude } : null, [latitude, longitude]);
  const isLocating = nearbyStatus === 'locating';
  const canSearch = focused && active && !isLocating && !locationStale && nearbyStatus !== 'location-error' && !!coordinates;
  const osmKey = canSearch && API_BASE_URL ? `${osmExploreKey(coordinates!, radiusKm)}:${retry}` : '';
  const wikiKey = canSearch && wikiMode === 'on' ? `${wikipediaNearbyKey(coordinates!, radiusKm)}:${wikiRetry}` : '';
  useEffect(() => {
    if (!osmKey || !coordinates) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void Promise.resolve().then(() => fetchOsmExploreResult(coordinates, radiusKm, { signal: controller.signal })).then(result => {
        if (!controller.signal.aborted) setOsm({ ...result, key: osmKey, error: '' });
      }).catch(error => {
        if (!controller.signal.aborted) setOsm({ ...initialState, key: osmKey, error: error instanceof Error ? error.message : 'Không tải được OpenStreetMap.' });
      });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [osmKey, coordinates, radiusKm]);
  useEffect(() => {
    if (!wikiKey || !coordinates) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void Promise.resolve().then(() => fetchWikipediaNearby(coordinates, radiusKm, { signal: controller.signal, forceRefresh: forceWikiRefresh })).then(result => {
        if (!controller.signal.aborted) setWiki({ ...initialState, ...result, key: wikiKey });
      }).catch(error => {
        if (!controller.signal.aborted) setWiki({ ...initialState, key: wikiKey, error: error instanceof Error ? error.message : 'Không tải được Wikipedia.' });
      });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [wikiKey, coordinates, radiusKm, forceWikiRefresh]);

  const osmCurrent = osmKey && osm.key === osmKey ? osm : initialState;
  const wikiCurrent = wikiKey && wiki.key === wikiKey ? wiki : initialState;
  const allPlaces = useMemo(() => locationStale ? [] : mergeNearbyPlaces([places, osmCurrent.places, wikiCurrent.places], location, radiusKm), [places, osmCurrent.places, wikiCurrent.places, location, radiusKm, locationStale]);
  const filteredPlaces = useMemo(() => {
    const term = normalizeSearch(debouncedQuery).trim();
    return allPlaces.filter(place => (category === 'Tất cả' || place.category === category) && (!term || normalizeSearch(`${place.title} ${place.district}`).includes(term)));
  }, [allPlaces, debouncedQuery, category]);
  const selectPlace = useCallback((id: string | null) => setSelectedId(id), []);
  const locate = async () => {
    setForceWikiRefresh(false);
    setSelectedId(null);
    setRetry(value => value + 1);
    if (wikiMode !== 'off') { setWikiMode('on'); setWikiRetry(value => value + 1); }
    await refreshNearby();
  };
  const changeRadius = (km: number) => {
    setForceWikiRefresh(false);
    setSelectedId(null); app.setRadiusKm(km);
    if (location && !isLocating) void refreshNearby({ radiusKm: km, reuseLocation: true });
  };
  const searchWikipedia = async () => {
    setForceWikiRefresh(true);
    setWikiMode('on'); setWikiRetry(value => value + 1);
    if (!location || locationStale || nearbyStatus === 'location-error') await refreshNearby();
  };
  const retrySources = () => {
    setRetry(value => value + 1); setWikiRetry(value => value + 1);
    void refreshNearby({ reuseLocation: true });
  };
  const officialCount = allPlaces.filter(place => place.source === 'backend').length;
  const osmLoading = !!osmKey && osm.key !== osmKey;
  const wikiLoading = !!wikiKey && wiki.key !== wikiKey;
  return { ...app, isLocating, locationStale, allPlaces, filteredPlaces, selectedId, selectPlace,
    selected: filteredPlaces.find(place => place.id === selectedId) ?? null,
    query, setQuery, category, setCategory, diagnostics, setDiagnostics,
    osm: osmCurrent, wiki: wikiCurrent, osmLoading, wikiLoading, osmKey, wikiKey,
    wikiMode, setWikiMode, officialCount, locate, changeRadius, searchWikipedia, retrySources,
    retryOsm: () => setRetry(value => value + 1),
  };
}
export type MapDiscovery = ReturnType<typeof useMapDiscovery>;
