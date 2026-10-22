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
import * as Location from "expo-location";
import * as Speech from "expo-speech";
import { LANGS, type Language, type Place } from "../data/places";
import { type Coordinates, fetchNearbyPlaces, validateBackendPlace } from "../services/nearby";
import { getSessionToken, writeSessionToken, getRefreshToken, writeRefreshToken } from "../services/session";
import { apiFetch, checkAdmin, getGuideContent, getUserProfile, refreshTokens, ApiError, setSessionRecovery, type UserResponse } from "../services/api";
import { splitSpeechText } from "../services/speechText";
import { speechConfig } from "../services/speechConfig";

const STORE_FAVORITES = "mg_favorites_v2";
const STORE_LANG = "mg_language_v2";
const STORE_DRAFTS = "mg_guide_drafts_v3";
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
  speak: (p: Place) => void;
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
  location: Coordinates | null;
  radiusKm: number;
  setRadiusKm: (km: number) => void;
  loadingPlaces: boolean;
  placesError: string;
  source: "demo" | "live" | "fallback";
  refreshNearby: () => Promise<void>;
  refreshCatalog: () => Promise<void>;
  findPlace: (id: string) => Place | undefined;
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
  const [token, saveToken] = useState<string | null>(null);
  const favorites = token ? accountFavorites : guestFavorites;
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const isAdmin = !!token && adminToken === token;
  const [places, setPlaces] = useState<Place[]>([]);
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [radiusKm, setRadiusKm] = useState(3);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [placesError, setPlacesError] = useState("");
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
        if (settings.status === "fulfilled") {
          setRadiusKm(settings.value.nearby_radius_km);
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
      void Speech.stop();
    };
  }, []);
  const refreshCatalog = useCallback(async () => {
    const seq = ++catalogSeq.current;
    setLoadingPlaces(true);
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
    void Speech.stop();
    setPlayingId(null);
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
    if (!token) {
      saveGuestFavorites(current => {
        const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
        void AsyncStorage.setItem(STORE_FAVORITES, JSON.stringify(next)).catch(() => {});
        return next;
      });
      return;
    }
    if (!id.startsWith('db-') || favoritePending.current.has(id)) return;
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
  }, [token, accountFavorites]);
  const stop = useCallback(() => {
    speechSeq.current++;
    void Speech.stop();
    setPlayingId(null);
  }, []);
  const readText = useCallback(
    (id: string, defaultText: string) =>
      (isAdmin ? drafts[id]?.[language] : undefined) || defaultText,
    [drafts, language, isAdmin],
  );
  const playText = useCallback(
    async (text: string, id: string) => {
      const current = ++speechSeq.current;
      setSpeechError("");
      if (!text.trim()) {
        setSpeechError("Chưa có nội dung để đọc.");
        return;
      }
      try {
        await Speech.stop();
        if (current !== speechSeq.current) return;
        let sessionId: number | null = null;
        if (id.startsWith("db-")) {
          const placeId = Number(id.slice(3));
          const guide = await getGuideContent(String(placeId), language);
          if (!guide.content?.trim()) throw new Error("Chưa có nội dung thuyết minh cho ngôn ngữ này.");
          text = guide.content;
          if (current !== speechSeq.current) return;
          if (token) {
            const session = await apiFetch<{ id: number }>("/audio-sessions", { token, method: "POST", body: JSON.stringify({ place_id: placeId, language_code: language }) });
            sessionId = session.id;
          }
        }
        if (current !== speechSeq.current) return;
        const locale = LANGS.find((l) => l.key === language)?.voice ?? "vi-VN";
        let voice: string | undefined;
        try {
          const options = await Speech.getAvailableVoicesAsync();
          voice = options.find(
            (v) => v.language.toLowerCase() === locale.toLowerCase(),
          )?.identifier;
        } catch {
          /* system default voice */
        }
        if (current !== speechSeq.current) return;
        setPlayingId(id);
        // Read long audio guides in sequential sections rather than truncating at the device limit.
        const chunks = splitSpeechText(text, Math.min(750, Speech.maxSpeechInputLength));
        let progressQueue = Promise.resolve();
        const playChunk = (index: number) => {
          if (current !== speechSeq.current) return;
          if (index >= chunks.length) {
            setPlayingId(null);
            return;
          }
          Speech.speak(chunks[index], {
            language: locale,
            ...(voice ? { voice } : {}),
            ...speechConfig,
            volume: 1,
            onDone: () => {
              if (current !== speechSeq.current) return;
              if (sessionId && token) progressQueue = progressQueue.then(async () => {
                await apiFetch(`/audio-sessions/${sessionId}`, { token, method: "PATCH", body: JSON.stringify({ progress: (index + 1) / chunks.length, completed: index + 1 === chunks.length }) });
              }).catch(() => setSpeechError("Không lưu được tiến độ nghe. Hãy kiểm tra kết nối API."));
              playChunk(index + 1);
            },
            onStopped: () => {
              if (current === speechSeq.current) setPlayingId(null);
            },
            onError: () => {
              if (current === speechSeq.current) {
                setPlayingId(null);
                setSpeechError(
                  "Không phát được giọng đọc. Kiểm tra chế độ im lặng, âm lượng và giọng nói đã cài trong iPhone.",
                );
              }
            },
          });
        };
        playChunk(0);
      } catch (e) {
        if (current === speechSeq.current) {
          setPlayingId(null);
          setSpeechError(
            e instanceof Error ? e.message : "Không thể phát tiếng.",
          );
        }
      }
    },
    [language, token],
  );
  const speak = useCallback(
    (p: Place) => {
      if (playingId === p.id) {
        stop();
        return;
      }
      void playText(
        `${p.title}. ${readText(p.id, p.description[language])}`,
        p.id,
      );
    },
    [language, playingId, playText, readText, stop],
  );
  const testSpeech = useCallback(() => {
    const greetings: Record<Language, string> = {
      vi: "Xin chào. Đây là kiểm tra giọng đọc của ứng dụng Multilingual Guide.",
      en: "Hello. This is a voice test for Multilingual Guide.",
      fr: "Bonjour. Ceci est un test vocal de Multilingual Guide.",
      ja: "こんにちは。マルチリンガルガイドの音声テストです。",
    };
    void playText(greetings[language], "speech-test");
  }, [language, playText]);
  const refreshNearby = useCallback(async () => {
    const seq = ++catalogSeq.current;
    setLoadingPlaces(true);
    setPlacesError("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted)
        throw new Error(
          "Bạn chưa cấp quyền vị trí. Hãy cho phép vị trí trong cài đặt ứng dụng hoặc trình duyệt để tìm địa điểm gần bạn.",
        );
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      if (seq !== catalogSeq.current) return;
      setLocation(coordinates);
      const result = await fetchNearbyPlaces(coordinates, radiusKm);
      if (seq !== catalogSeq.current) return;
      setPlaces(result.places);
      setSource(result.source);
      setPlacesError(result.warning);
    } catch (e) {
      if (seq === catalogSeq.current) setPlacesError(
        e instanceof Error ? e.message : "Không thể tải danh sách địa điểm.",
      );
    } finally {
      if (seq === catalogSeq.current) setLoadingPlaces(false);
    }
  }, [radiusKm]);
  const findPlace = useCallback(
    (id: string) =>
      places.find((p) => p.id === id),
    [places],
  );
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
      speechError,
      speak,
      stop,
      testSpeech,
      token,
      setToken,
      isAdmin,
      user, updateProfile, authLoading, logout, loginWithTokens,
      places,
      location,
      radiusKm,
      setRadiusKm,
      loadingPlaces,
      placesError,
      source,
      refreshNearby,
      refreshCatalog,
      findPlace,
      drafts,
      saveDraft,
    }),
    [
      language,
      setLanguage,
      favorites, favoriteError, favoritesLoading, refreshFavorites,
      toggleFavorite,
      playingId,
      speechError,
      speak,
      stop,
      testSpeech,
      token,
      setToken,
      isAdmin,
      user, updateProfile, authLoading, logout, loginWithTokens,
      places,
      location,
      radiusKm,
      loadingPlaces,
      placesError,
      source,
      refreshNearby,
      refreshCatalog,
      findPlace,
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
