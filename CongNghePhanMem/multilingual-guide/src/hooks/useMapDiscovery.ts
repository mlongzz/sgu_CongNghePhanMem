import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useApp } from '../context/AppContext';
import { useJourney } from '../context/JourneyContext';
import { parseJourneyId } from '../services/journey';
import type { Place } from '../data/places';
import { API_BASE_URL } from '../services/api';
import { fetchOsmExploreResult, normalizeSearch, osmExploreKey } from '../services/nearby';
import { fetchWikipediaNearby, wikipediaNearbyKey } from '../services/wikipedia';
import { mergeNearbyPlaces } from '../services/nearbyMerge';
import { partialCoverage, discoveryOutcome, freshGps } from '../services/discoveryStatus';
import { fetchWikipediaPhotos, type ProviderPhoto } from '../services/providerImages';
import { applyPlaceFilters, isTouristPlace, withTouristCategory } from '../services/touristFilter';
import { usePlaceFilters } from './usePlaceFilters';
import { DISTRICT1_CENTER, DISTRICT1_MAX_RADIUS_KM, DISTRICT1_RADII, isInDistrict1 } from '../data/district1';

export const MAP_RADII = [1, 3, 5, 10, 20];
export const MAP_CATEGORIES = ['Tất cả', 'Lịch sử', 'Kiến trúc', 'Văn hóa', 'Khám phá'];
type CommunityState = { key: string; places: Place[]; warning: string; error: string; stale: boolean; searchedRadiusKm?: number | null; truncated?: boolean };
const initialState: CommunityState = { key: '', places: [], warning: '', error: '', stale: false };

/** One source contract and cancellation policy for both Leaflet and native maps. */
export function useMapDiscovery() {
  const app = useApp();
  const route = useJourney();
  const params = useLocalSearchParams<{ journey?: string | string[] }>();
  const journeyId = parseJourneyId(params.journey);
  const requestedJourney = params.journey !== undefined;
  const [journeyRetry, setJourneyRetry] = useState(0);
  const journeyRequest = useMemo(() => ({ id: journeyId, retry: journeyRetry }), [journeyId, journeyRetry]);
  const { open, pause, hydrated } = route;
  useFocusEffect(useCallback(() => {
    if (!hydrated || !requestedJourney) return;
    if (journeyRequest.id === null) { pause(); return; }
    const controller = new AbortController();
    void open(journeyRequest.id, controller.signal);
    return () => { controller.abort(); pause(); };
  }, [hydrated, requestedJourney, journeyRequest, open, pause]));
  const journeyMode = requestedJourney || !!route.progress;
  const routeProgress = !requestedJourney || route.progress?.journey.id === journeyId ? route.progress : null;
  const journeyError = requestedJourney && journeyId === null ? 'Mã hành trình không hợp lệ.' : journeyMode ? route.error : '';
  const { location, nearbyStatus, cancelLocation, radiusKm, refreshNearby, places } = app;
  const [placeFilters] = usePlaceFilters();
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
  const [retry, setRetry] = useState(0);
  const [wikiRetry, setWikiRetry] = useState(0);
  const [forceWikiRefresh, setForceWikiRefresh] = useState(false);
  const [osm, setOsm] = useState(initialState);
  const [wiki, setWiki] = useState(initialState);
  const [photos, setPhotos] = useState<{key:string;items:Record<string,ProviderPhoto>}>({key:'',items:{}});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [category, setCategory] = useState('Tất cả');
  const [diagnostics, setDiagnostics] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setDebouncedQuery(query), 180); return () => clearTimeout(timer); }, [query]);

  // Provider lookups use the last explicit/throttled search, not every GPS reading.
  const latitude = app.searchLocation?.latitude;
  const longitude = app.searchLocation?.longitude;
  const gpsTimestamp = location?.timestamp;
  useEffect(() => {
    const initial = setTimeout(() => observeTime(Date.now()), 0);
    const expiry = app.locationSource === 'gps' && typeof gpsTimestamp === 'number' && Number.isFinite(gpsTimestamp)
      ? setTimeout(() => observeTime(Date.now()), Math.max(1, gpsTimestamp + 60_001 - Date.now())) : undefined;
    return () => { clearTimeout(initial); if (expiry !== undefined) clearTimeout(expiry); };
  }, [gpsTimestamp, app.locationSource]);
  const locationStale = !!location && app.locationSource === 'gps' && !freshGps(gpsTimestamp, observedAt);
  const gpsCoordinates = useMemo(() => typeof latitude === 'number' && typeof longitude === 'number' ? { latitude, longitude } : null, [latitude, longitude]);
  // District 1 focus: search around the user only while they are inside the district;
  // otherwise (outside, stale or no GPS yet) explore the district from its centre.
  const district = placeFilters.district1Only && !journeyMode;
  const districtFallback = district && (!gpsCoordinates || !isInDistrict1(gpsCoordinates) || locationStale);
  const coordinates = districtFallback ? DISTRICT1_CENTER : gpsCoordinates;
  const searchRadius = district ? Math.min(radiusKm, DISTRICT1_MAX_RADIUS_KM) : radiusKm;
  const radii = district ? DISTRICT1_RADII : MAP_RADII;
  const wikiMode = wikiSetting === 'auto' && (location || districtFallback) ? 'on' : wikiSetting;
  // Without a usable GPS fix inside District 1 there is no nearby query, so load the curated
  // catalogue (all published places are in District 1) to show every official stop.
  const { refreshCatalog } = app;
  const needCatalog = districtFallback && focused && nearbyStatus !== 'locating';
  useEffect(() => { if (needCatalog) void refreshCatalog(); }, [needCatalog, refreshCatalog]);
  const isLocating = nearbyStatus === 'locating';
  const canSearch = focused && active && !isLocating && (districtFallback || (!locationStale && nearbyStatus !== 'location-error')) && !!coordinates;
  const osmKey = canSearch && API_BASE_URL && !journeyMode ? `${osmExploreKey(coordinates!, searchRadius)}:${retry}` : '';
  const wikiKey = canSearch && wikiMode === 'on' && !journeyMode ? `${wikipediaNearbyKey(coordinates!, searchRadius)}:${wikiRetry}` : '';
  useEffect(() => {
    if (!osmKey || !coordinates) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void Promise.resolve().then(() => fetchOsmExploreResult(coordinates, searchRadius, { signal: controller.signal })).then(result => {
        if (!controller.signal.aborted) setOsm({ ...result, key: osmKey, error: '' });
      }).catch(error => {
        if (!controller.signal.aborted) setOsm({ ...initialState, key: osmKey, error: error instanceof Error ? error.message : 'Không tải được OpenStreetMap.' });
      });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [osmKey, coordinates, searchRadius]);
  useEffect(() => {
    if (!wikiKey || !coordinates) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void Promise.resolve().then(() => fetchWikipediaNearby(coordinates, searchRadius, { signal: controller.signal, forceRefresh: forceWikiRefresh })).then(result => {
        if (!controller.signal.aborted) setWiki({ ...initialState, ...result, key: wikiKey });
      }).catch(error => {
        if (!controller.signal.aborted) setWiki({ ...initialState, key: wikiKey, error: error instanceof Error ? error.message : 'Không tải được Wikipedia.' });
      });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [wikiKey, coordinates, searchRadius, forceWikiRefresh]);

  useEffect(() => {
    if (!wikiKey || wiki.key !== wikiKey || !wiki.places.length) return;
    const controller = new AbortController();
    // Spend the photo lookups on attractions first; in the District 1 guide every attraction also
    // tries the Wikidata/Commons fallbacks so that each one can show a photo.
    const lookup = placeFilters.touristOnly ? wiki.places.filter(isTouristPlace) : wiki.places;
    const photoKey = `${wikiKey}:${placeFilters.touristOnly ? 't' : 'a'}${placeFilters.district1Only ? 'd' : ''}`;
    if (!lookup.length) return;
    void fetchWikipediaPhotos(lookup, controller.signal, { limit: 50, fallback: placeFilters.district1Only }).then(items => { if (!controller.signal.aborted) setPhotos({key:photoKey,items}); });
    return () => controller.abort();
  }, [wikiKey, wiki.key, wiki.places, placeFilters.touristOnly, placeFilters.district1Only]);
  const osmCurrent = osmKey && osm.key === osmKey ? osm : initialState;
  const wikiCurrent = wikiKey && wiki.key === wikiKey ? wiki : initialState;
  const photoKey = `${wikiKey}:${placeFilters.touristOnly ? 't' : 'a'}${placeFilters.district1Only ? 'd' : ''}`;
  const photoLookupCount = !wikiKey || wiki.key !== wikiKey ? 0 : placeFilters.touristOnly ? wiki.places.filter(isTouristPlace).length : wiki.places.length;
  const photosLoading = photoLookupCount > 0 && photos.key !== photoKey;
  const wikiWithPhotos = useMemo(() => wikiCurrent.places.map(withTouristCategory).map(place => photos.key === photoKey && photos.items[place.id] ? {...place,...photos.items[place.id]} : place), [wikiCurrent.places,photos,photoKey]);
  const allPlaces = useMemo(() => journeyMode ? routeProgress?.journey.stops ?? [] : locationStale && !districtFallback ? [] : mergeNearbyPlaces([places, osmCurrent.places, wikiWithPhotos], districtFallback ? DISTRICT1_CENTER : location, searchRadius), [journeyMode, routeProgress?.journey.stops, places, osmCurrent.places, wikiWithPhotos, location, searchRadius, locationStale, districtFallback]);
  // Journey stops are curated by Admin and always shown; discovery results honour the filter bar.
  const visiblePlaces = useMemo(() => journeyMode ? allPlaces : applyPlaceFilters(allPlaces, placeFilters), [allPlaces, placeFilters, journeyMode]);
  const hiddenCount = journeyMode ? 0 : allPlaces.length - visiblePlaces.length;
  const filteredPlaces = useMemo(() => {
    const term = normalizeSearch(debouncedQuery).trim();
    return journeyMode ? allPlaces : visiblePlaces.filter(place => (category === 'Tất cả' || place.category === category) && (!term || normalizeSearch(`${place.title} ${place.district}`).includes(term)));
  }, [allPlaces, visiblePlaces, debouncedQuery, category, journeyMode]);
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
    if (!radii.includes(km)) return;
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
  const coveragePartial = partialCoverage(osmCurrent, searchRadius) || partialCoverage(wikiCurrent, searchRadius) || /tối đa 100/.test(app.placesWarning);
  const outcome = discoveryOutcome({count: filteredPlaces.length, loading: app.loadingPlaces || (!!osmKey && osm.key !== osmKey) || (!!wikiKey && wiki.key !== wikiKey) || (photosLoading && placeFilters.withImageOnly), errors: nearbyStatus === 'error' || !!osmCurrent.error || !!wikiCurrent.error, partial: coveragePartial});
  const officialCount = allPlaces.filter(place => place.source === 'backend').length;
  const osmLoading = !!osmKey && osm.key !== osmKey;
  const wikiLoading = !!wikiKey && wiki.key !== wikiKey;
  return { ...app, radiusKm: searchRadius, radii, district, districtFallback, journeyMode, journeyId, routeProgress, journeyError, journeyLoading: route.busy,
    retryJourney: () => setJourneyRetry(value => value + 1), isLocating, locationStale, allPlaces, visiblePlaces, hiddenCount, photosLoading: photosLoading && placeFilters.withImageOnly, filteredPlaces, selectedId, selectPlace,
    selected: filteredPlaces.find(place => place.id === selectedId) ?? null,
    query, setQuery, category, setCategory, diagnostics, setDiagnostics,
    osm: osmCurrent, wiki: wikiCurrent, osmLoading, wikiLoading, osmKey, wikiKey,
    wikiMode, setWikiMode, officialCount, coveragePartial, outcome, locate, changeRadius, searchWikipedia, retrySources,
    retryOsm: () => setRetry(value => value + 1),
  };
}
export type MapDiscovery = ReturnType<typeof useMapDiscovery>;
