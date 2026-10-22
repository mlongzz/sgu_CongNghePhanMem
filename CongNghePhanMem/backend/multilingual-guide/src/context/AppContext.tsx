import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as Speech from "expo-speech";
import { LANGS, type Language, type Place, type NarrationContent } from "../data/places";
import { type Coordinates, fetchNearbyPlaces, validateBackendPlace } from "../services/nearby";
import { getSessionToken, writeSessionToken, getRefreshToken, writeRefreshToken } from "../services/session";
import { apiFetch, checkAdmin, getUserProfile, refreshTokens, ApiError, setSessionRecovery, type UserResponse } from "../services/api";
import { createSpeechPlayer, createWebSpeechDriver, type PlayerState } from "../services/speechPlayer";
import { resolveNarration, NO_NARRATION } from "../services/narration";
import { validateDiscoveredPlace, parseDiscoveredPlaces, serializeDiscoveredPlaces } from "../services/placeRegistry";
import { getCurrentCoordinates, type LocationCoordinates } from "../services/location";

const STORE_FAVORITES = "mg_favorites_v2";
const STORE_LANG = "mg_language_v2";
const STORE_DRAFTS = "mg_guide_drafts_v3";
const STORE_DISCOVERED = "mg_selected_places_v1";
type Drafts = Record<string, Partial<Record<Language, string>>>;
type AppState = {
  language: Language;
  setLanguage: (v: Language) => void;
  favorites: string[];
  favoriteError: string;
  favoritesLoading: boolean;
  refreshFavorites: () => Promise<void>;
  toggleFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;
  playingId: string | null;
  speechError: string;
  speechStatus: PlayerState['status'];
  speechRate: number;
  setSpeechRate: (rate: number) => void;
  pauseSpeech: () => void;
  resumeSpeech: () => void;
  canPauseSpeech: boolean;
  speak: (p: Place, content?: NarrationContent, voiceIdentifier?: string) => Promise<boolean>;
  stop: () => void;
  testSpeech: () => void;
  token: string | null;
  setToken: (token: string | null) => void;
  isAdmin: boolean;
  user: UserResponse | null;
  updateProfile: (profile: UserResponse) => void;
  authLoading: boolean;
  logout: () => void;
  loginWithTokens: (accessToken: string, refreshToken: string) => Promise<void>;
  places: Place[];
  location: LocationCoordinates | null;
  locationSource: "gps" | "manual" | null;
  locationProgress: string;
  cancelLocation: () => void;
  radiusKm: number;
  setRadiusKm: (km: number) => void;
  loadingPlaces: boolean;
  placesError: string;
  placesWarning: string;
  nearbyStatus: "idle" | "locating" | "loading" | "success" | "error" | "location-error";
  source: "demo" | "live" | "fallback";
  refreshNearby: (options?: { radiusKm?: number; reuseLocation?: boolean; coordinates?: Coordinates; gpsCoordinates?: LocationCoordinates }) => Promise<void>;
  refreshCatalog: () => Promise<void>;
  findPlace: (id: string) => Place | undefined;
  registerPlace: (place: Place) => void;
  drafts: Drafts;
  saveDraft: (id: string, lang: Language, text: string) => Promise<void>;
};
const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [language, saveLanguage] = useState<Language>("vi");
  const [guestFavorites, saveGuestFavorites] = useState<string[]>([]);
  const [accountFavorites, saveAccountFavorites] = useState<string[]>([]);
  const [favoriteError, setFavoriteError] = useState("");
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const favoritePending = useRef(new Set<string>());
  const catalogSeq = useRef(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [speechError, setSpeechError] = useState("");
  const [speechStatus, setSpeechStatus] = useState<PlayerState['status']>('idle');
  const [speechRate, saveSpeechRate] = useState(1);
  const player = useRef<ReturnType<typeof createSpeechPlayer> | null>(null);
  const speechRequest = useRef<AbortController | null>(null);
  const selectedPlaces = useRef(new Map<string, Place>());
  const [registeredPlaces, setRegisteredPlaces] = useState<ReadonlyMap<string, Place>>(new Map());
  const [token, saveToken] = useState<string | null>(null);
  const favorites = useMemo(() => token ? [...accountFavorites, ...guestFavorites.filter(id => !id.startsWith('db-'))] : guestFavorites, [token, accountFavorites, guestFavorites]);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const isAdmin = !!token && adminToken === token;
  const [places, setPlaces] = useState<Place[]>([]);
  const [location, setLocation] = useState<LocationCoordinates | null>(null);
  const [locationSource, setLocationSource] = useState<AppState["locationSource"]>(null);
  const [locationProgress, setLocationProgress] = useState("");
  const locationRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { catalogSeq.current++; locationRequest.current?.abort(); }, []);
  const [radiusKm, saveRadiusKm] = useState(3);
  const currentRadius = useRef(3);
  const radiusWasChosen = useRef(false);
  const setRadiusKm = useCallback((km: number) => {
    if (!Number.isFinite(km) || km < 1 || km > 20) return;
    radiusWasChosen.current = true;
    currentRadius.current = km;
    saveRadiusKm(km);
  }, []);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [placesError, setPlacesError] = useState("");
  const [placesWarning, setPlacesWarning] = useState("");
  const [nearbyStatus, setNearbyStatus] = useState<AppState["nearbyStatus"]>("idle");
  const [source, setSource] = useState<"demo" | "live" | "fallback">("live");
  const [drafts, setDrafts] = useState<Drafts>({});
  const [user, setUser] = useState<UserResponse | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const speechSeq = useRef(0);
  const authSeq = useRef(0);
  const tokenRef = useRef<string | null>(null);
  const recovery = useRef<Promise<string | null> | null>(null);
  const logout = useCallback(() => {
    authSeq.current++;
    tokenRef.current = null;
    saveToken(null); saveAccountFavorites([]); setFavoritesLoading(false); setFavoriteError(""); setUser(null); setAdminToken(null); setAuthLoading(false);
    void Promise.all([writeSessionToken(null), writeRefreshToken(null)]).catch(() => {});
  }, []);
  const loginWithTokens = useCallback(async (access: string, refresh: string, keepLoading = false) => {
    const seq = ++authSeq.current;
    setAuthLoading(true);
    try {
      const profile = await getUserProfile(access, false);
      const admin = await checkAdmin(access, false).catch(e => {
        if (e instanceof ApiError && e.status === 403) return { enabled: false };
        throw e;
      });
      if (seq !== authSeq.current) return;
      await Promise.all([writeSessionToken(access), writeRefreshToken(refresh || null)]);
      if (seq !== authSeq.current) return;
      if (!tokenRef.current && LANGS.some(l => l.key === profile.language)) {
        saveLanguage(profile.language as Language);
        void AsyncStorage.setItem(STORE_LANG, profile.language).catch(() => {});
      }
      tokenRef.current = access;
      saveToken(access); setUser(profile); setAdminToken(admin.enabled ? access : null);
    } finally { if (seq === authSeq.current && !keepLoading) setAuthLoading(false); }
  }, []);
  useEffect(() => {
    setSessionRecovery(async failed => {
      if (!tokenRef.current) return null;
      if (failed !== tokenRef.current) return tokenRef.current;
      if (!recovery.current) {
        const seq = authSeq.current;
        recovery.current = (async () => {
          try {
            const refresh = await getRefreshToken();
            if (!refresh) { logout(); return null; }
            const result = await refreshTokens(refresh);
            if (seq !== authSeq.current) return null;
            await loginWithTokens(result.access_token, result.refresh_token);
            return tokenRef.current;
          } catch (e) {
            if (e instanceof ApiError && e.status === 401) logout();
            throw e;
          } finally { recovery.current = null; }
        })();
      }
      return recovery.current;
    });
    return () => setSessionRecovery(null);
  }, [loginWithTokens, logout]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const access = await getSessionToken();
        if (!active) return;
        if (access) {
          const refresh = (await getRefreshToken()) ?? '';
          try { await loginWithTokens(access, refresh, true); }
          catch (e) {
            if (!(e instanceof ApiError) || e.status !== 401 || !refresh) throw e;
            const result = await refreshTokens(refresh);
            if (active) await loginWithTokens(result.access_token, result.refresh_token, true);
          }
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) logout();
        else { tokenRef.current = null; saveToken(null); }
      } finally { if (active) setAuthLoading(false); }
    })();
    return () => { active = false; };
  }, [loginWithTokens, logout]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const [saved, lang, guideDrafts, settings] =
        await Promise.allSettled([
          AsyncStorage.getItem(STORE_FAVORITES),
          AsyncStorage.getItem(STORE_LANG),
          AsyncStorage.getItem(STORE_DRAFTS),
          apiFetch<{ default_language: string; nearby_radius_km: number }>("/settings"),
        ]);
      if (!mounted) return;
      try {
        if (saved.status === "fulfilled" && saved.value) {
          const a = JSON.parse(saved.value);
          if (Array.isArray(a))
            saveGuestFavorites(a.filter((x) => typeof x === "string"));
        }
        if (
          !tokenRef.current && lang.status === "fulfilled" &&
          LANGS.some((l) => l.key === lang.value)
        )
          saveLanguage(lang.value as Language);
        if (settings.status === "fulfilled" && settings.value && typeof settings.value === "object") {
          const defaultRadius = settings.value.nearby_radius_km;
          if (!radiusWasChosen.current && typeof defaultRadius === "number" && Number.isFinite(defaultRadius) && defaultRadius >= 1 && defaultRadius <= 20) {
            currentRadius.current = defaultRadius;
            saveRadiusKm(defaultRadius);
          }
          if (!tokenRef.current && !(lang.status === "fulfilled" && lang.value) && LANGS.some(l => l.key === settings.value.default_language))
            saveLanguage(settings.value.default_language as Language);
        }

        if (guideDrafts.status === "fulfilled" && guideDrafts.value)
          setDrafts(JSON.parse(guideDrafts.value));
      } catch {
        /* Keep initial data if local cache is damaged */
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  const refreshCatalog = useCallback(async () => {
    const seq = ++catalogSeq.current;
    locationRequest.current?.abort();
    locationRequest.current = null;
    setLocationProgress("");
    setNearbyStatus("idle");
    setPlacesWarning("");
    setLoadingPlaces(true);
    setPlaces([]);
    try {
      const rows: unknown[] = [];
      for (let offset = 0; ; offset += 100) {
        const page = await apiFetch<unknown[]>(`/places?limit=100&offset=${offset}`);
        if (seq !== catalogSeq.current) return;
        rows.push(...page);
        if (page.length < 100) break;
      }
      setPlaces(rows.map(validateBackendPlace).filter((p): p is Place => Boolean(p)));
      setSource("live"); setPlacesError("");
    } catch (e) { if (seq === catalogSeq.current) setPlacesError(e instanceof Error ? e.message : "Không tải được địa điểm."); }
    finally { if (seq === catalogSeq.current) setLoadingPlaces(false); }
  }, []);
  const updateProfile = useCallback((profile: UserResponse) => {
    setUser(current => current?.id === profile.id ? profile : current);
  }, []);
  const setToken = useCallback((value: string | null) => {
    if (!value) logout();
    else void loginWithTokens(value, '').catch(() => logout());
  }, [loginWithTokens, logout]);
  const setLanguage = useCallback((value: Language) => {
    speechSeq.current++;
    speechRequest.current?.abort();
    player.current?.stop();
    setPlayingId(null);
    setSpeechStatus('idle');
    setSpeechError("");
    saveLanguage(value);
    void AsyncStorage.setItem(STORE_LANG, value).catch(() => {});
  }, []);
  const refreshFavorites = useCallback(async () => {
    const access = tokenRef.current;
    if (!access) return;
    const seq = authSeq.current;
    setFavoritesLoading(true); setFavoriteError("");
    try {
      const rows = await apiFetch<{ place_id: number }[]>("/favorites", { token: access });
      if (seq === authSeq.current) saveAccountFavorites(rows.map(r => `db-${r.place_id}`));
    } catch (e) { if (seq === authSeq.current) setFavoriteError(e instanceof Error ? e.message : "Không tải được yêu thích."); }
    finally { if (seq === authSeq.current) setFavoritesLoading(false); }
  }, []);
  useEffect(() => { if (token) void refreshFavorites(); }, [token, refreshFavorites]);
  const toggleFavorite = useCallback((id: string) => {
    if (authLoading) return;
    if (!token || !id.startsWith('db-')) {
      saveGuestFavorites(current => {
        const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
        void AsyncStorage.setItem(STORE_FAVORITES, JSON.stringify(next)).catch(() => {});
        return next;
      });
      return;
    }
    if (favoritePending.current.has(id)) return;
    const seq = authSeq.current;
    const removing = accountFavorites.includes(id);
    favoritePending.current.add(id); setFavoriteError("");
    void apiFetch(removing ? `/favorites/${Number(id.slice(3))}` : '/favorites', {
      token, method: removing ? 'DELETE' : 'POST',
      ...(removing ? {} : { body: JSON.stringify({ place_id: Number(id.slice(3)) }) }),
    }).then(() => {
      if (seq === authSeq.current) saveAccountFavorites(current => removing ? current.filter(x => x !== id) : [...new Set([...current, id])]);
    }).catch(e => {
      if (seq === authSeq.current) setFavoriteError(e instanceof Error ? e.message : "Không lưu được yêu thích.");
    }).finally(() => { favoritePending.current.delete(id); });
  }, [token, accountFavorites, authLoading]);
  const speechState = useRef<PlayerState>({ id: null, status: 'idle', error: '' });
  const audioSession = useRef<{ id: string; token: string; session: Promise<number | null>; progressQueue: Promise<void> } | null>(null);
  const getPlayer = useCallback(() => {
    if (!player.current) player.current = createSpeechPlayer(
      Platform.OS === 'web' ? createWebSpeechDriver() : Speech,
      Platform.OS,
      state => { speechState.current = state; setPlayingId(state.id); setSpeechStatus(state.status); setSpeechError(state.error); },
      { onProgress: (id, progress) => {
        const saved = audioSession.current;
        if (saved?.id === id) saved.progressQueue = saved.progressQueue.then(async () => {
          const sessionId = await saved.session;
          if (sessionId) await apiFetch(`/audio-sessions/${sessionId}`, {
            token: saved.token, method: 'PATCH', body: JSON.stringify({ progress, completed: progress === 1 }),
          });
        }).catch(() => {});
      } },
    );
    return player.current;
  }, []);
  const stop = useCallback(() => {
    speechSeq.current++;
    speechRequest.current?.abort();
    speechRequest.current = null;
    player.current?.stop();
    setPlayingId(null); setSpeechStatus('idle');
  }, []);
  useEffect(() => () => { stop(); player.current?.dispose(); player.current = null; }, [stop]);
  const setSpeechRate = useCallback((rate: number) => {
    if (![0.75, 1, 1.25, 1.5].includes(rate)) return;
    stop(); saveSpeechRate(rate);
  }, [stop]);
  const pauseSpeech = useCallback(() => { void player.current?.pause(); }, []);
  const resumeSpeech = useCallback(() => { void player.current?.resume(); }, []);
  const speak = useCallback(async (p: Place, supplied?: NarrationContent, voiceIdentifier?: string): Promise<boolean> => {
    if (speechState.current.id === p.id) { stop(); return false; }
    const current = ++speechSeq.current;
    speechRequest.current?.abort();
    const controller = new AbortController();
    speechRequest.current = controller;
    getPlayer().stop();
    speechState.current = { id: p.id, status: 'loading', error: '' };
    setPlayingId(p.id); setSpeechStatus('loading'); setSpeechError('');
    try {
      const content = supplied?.language === language ? supplied : await resolveNarration(p, language, { signal: controller.signal, officialPlaces: places });
      if (controller.signal.aborted || current !== speechSeq.current) return false;
      if (!content?.text.trim()) throw new Error(NO_NARRATION + ' Hãy chọn ngôn ngữ khác nếu có.');
      audioSession.current = null;
      if (/^db-\d+$/.test(p.id) && content.source === 'published' && token) {
        audioSession.current = { id: p.id, token, progressQueue: Promise.resolve(), session: apiFetch<{id:number}>('/audio-sessions', {
          token, method: 'POST', body: JSON.stringify({ place_id: Number(p.id.slice(3)), language_code: language }),
        }).then(result => result.id).catch(() => null) };
      }
      await getPlayer().play(content.text, language, speechRate, p.id, voiceIdentifier);
      return current === speechSeq.current && !speechState.current.error;
    } catch (e) {
      if (current === speechSeq.current && !controller.signal.aborted) {
        const message = e instanceof Error ? e.message : 'Không thể phát tiếng.';
        speechState.current = { id: null, status: 'idle', error: message };
        setPlayingId(null); setSpeechStatus('idle'); setSpeechError(message);
      }
      return false;
    }
  }, [language, speechRate, token, places, stop, getPlayer]);
  const testSpeech = useCallback(() => {
    stop();
    const greetings: Record<Language, string> = {
      vi: 'Xin chào. Đây là kiểm tra giọng đọc của ứng dụng Multilingual Guide.',
      en: 'Hello. This is a voice test for Multilingual Guide.',
      fr: 'Bonjour. Ceci est un test vocal de Multilingual Guide.',
      ja: 'こんにちは。マルチリンガルガイドの音声テストです。',
    };
    void getPlayer().play(greetings[language], language, speechRate, 'speech-test');
  }, [language, speechRate, stop, getPlayer]);
  const refreshNearby = useCallback(async (options: { radiusKm?: number; reuseLocation?: boolean; coordinates?: Coordinates; gpsCoordinates?: LocationCoordinates } = {}) => {
    const seq = ++catalogSeq.current;
    locationRequest.current?.abort();
    const controller = new AbortController();
    locationRequest.current = controller;
    setLocationProgress("");
    let queryingPlaces = false;
    const reusable = options.reuseLocation && location && (locationSource === 'manual' ||
      (typeof location.timestamp === 'number' && Date.now() - location.timestamp <= 60_000));
    setLoadingPlaces(true);
    setPlacesError("");
    setPlacesWarning("");
    setPlaces([]);
    setNearbyStatus(options.coordinates || options.gpsCoordinates || reusable ? "loading" : "locating");
    try {
      let coordinates: LocationCoordinates | null = options.coordinates ?? options.gpsCoordinates ?? (reusable ? location : null);
      if (!coordinates) coordinates = await getCurrentCoordinates({ signal: controller.signal, onProgress: message => {
        if (seq === catalogSeq.current) setLocationProgress(message);
      } });
      if (!Number.isFinite(coordinates.latitude) || !Number.isFinite(coordinates.longitude) || Math.abs(coordinates.latitude) > 90 || Math.abs(coordinates.longitude) > 180) throw new Error("Tọa độ tìm kiếm không hợp lệ.");
      if (options.gpsCoordinates) {
        const age = typeof coordinates.timestamp === 'number' ? Date.now() - coordinates.timestamp : NaN;
        if (!Number.isFinite(age) || age > 60_000 || age < -5000) throw new Error('Vị trí GPS đã cũ. Hãy định vị lại.');
        if (coordinates.accuracy !== undefined && (!Number.isFinite(coordinates.accuracy) || coordinates.accuracy < 0)) throw new Error('Độ chính xác GPS không hợp lệ. Hãy định vị lại.');
      }
      if (seq !== catalogSeq.current) return;
      setLocation(coordinates);
      setLocationSource(options.coordinates ? "manual" : reusable ? locationSource : "gps");
      setLocationProgress("");
      queryingPlaces = true;
      setNearbyStatus("loading");
      const result = await fetchNearbyPlaces(coordinates, reusable || options.coordinates || options.gpsCoordinates ? options.radiusKm ?? currentRadius.current : currentRadius.current, { signal: controller.signal });
      if (seq !== catalogSeq.current) return;
      setPlaces(result.places);
      setSource(result.source);
      setPlacesWarning(result.warning);
      setNearbyStatus("success");
    } catch (e) {
      if (seq === catalogSeq.current) {
        setNearbyStatus(queryingPlaces ? "error" : "location-error");
        setPlacesError(
          e instanceof Error ? e.message : e && typeof e === "object" && "code" in e && (e.code === 1 || e.code === "ERR_LOCATION_UNAUTHORIZED")
            ? "Bạn chưa cấp quyền vị trí. Hãy cho phép vị trí trong cài đặt ứng dụng hoặc trình duyệt để tìm địa điểm gần bạn."
            : "Không thể tải danh sách địa điểm.",
        );
      }
    } finally {
      if (seq === catalogSeq.current) { setLoadingPlaces(false); setLocationProgress(""); }
      if (locationRequest.current === controller) locationRequest.current = null;
    }
  }, [location, locationSource]);
  const cancelLocation = useCallback(() => {
    if (!locationRequest.current) return;
    catalogSeq.current++;
    locationRequest.current.abort();
    locationRequest.current = null;
    setLocationProgress("");
    setLoadingPlaces(false);
    setNearbyStatus("location-error");
    setPlacesError("Đã hủy lấy vị trí. Bạn có thể bấm lấy GPS để thử lại.");
  }, []);
  const registerPlace = useCallback((place: Place) => {
    const checked = validateDiscoveredPlace(place);
    if (!checked) return;
    selectedPlaces.current.delete(place.id);
    selectedPlaces.current.set(place.id, checked);
    if (selectedPlaces.current.size > 20) selectedPlaces.current.delete(selectedPlaces.current.keys().next().value!);
    setRegisteredPlaces(new Map(selectedPlaces.current));
    void AsyncStorage.setItem(STORE_DISCOVERED, serializeDiscoveredPlaces([...selectedPlaces.current.values()])).catch(() => {});
  }, []);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(STORE_DISCOVERED).then(raw => {
      if (!active || !raw) return;
      for (const p of parseDiscoveredPlaces(raw)) {
        if (!selectedPlaces.current.has(p.id)) selectedPlaces.current.set(p.id, p);
      }
      if (active) setRegisteredPlaces(new Map(selectedPlaces.current));
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  const findPlace = useCallback((id: string) => places.find(p => p.id === id) ?? registeredPlaces.get(id), [places, registeredPlaces]);
  const saveDraft = useCallback(
    async (id: string, lang: Language, text: string) => {
      const updated = {
        ...drafts,
        [id]: { ...(drafts[id] ?? {}), [lang]: text },
      };
      setDrafts(updated);
      await AsyncStorage.setItem(STORE_DRAFTS, JSON.stringify(updated));
    },
    [drafts],
  );
  const value = useMemo<AppState>(
    () => ({
      language,
      setLanguage,
      favorites, favoriteError, favoritesLoading, refreshFavorites,
      toggleFavorite,
      isFavorite: (id: string) => favorites.includes(id),
      playingId,
      speechError, speechStatus, speechRate, setSpeechRate, pauseSpeech, resumeSpeech,
      canPauseSpeech: Platform.OS !== "android",
      speak,
      stop,
      testSpeech,
      token,
      setToken,
      isAdmin,
      user, updateProfile, authLoading, logout, loginWithTokens,
      places,
      location,
      locationSource,
      locationProgress,
      cancelLocation,
      radiusKm,
      setRadiusKm,
      loadingPlaces,
      placesError,
      placesWarning,
      nearbyStatus,
      source,
      refreshNearby,
      refreshCatalog,
      findPlace, registerPlace,
      drafts,
      saveDraft,
    }),
    [
      language,
      setLanguage,
      favorites, favoriteError, favoritesLoading, refreshFavorites,
      toggleFavorite,
      playingId,
      speechError, speechStatus, speechRate, setSpeechRate, pauseSpeech, resumeSpeech,
      speak,
      stop,
      testSpeech,
      token,
      setToken,
      isAdmin,
      user, updateProfile, authLoading, logout, loginWithTokens,
      places,
      location,
      locationSource,
      locationProgress,
      cancelLocation,
      radiusKm,
      setRadiusKm,
      loadingPlaces,
      placesError,
      placesWarning,
      nearbyStatus,
      source,
      refreshNearby,
      refreshCatalog,
      findPlace, registerPlace,
      drafts,
      saveDraft,
    ],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("AppProvider is missing");
  return context;
}
