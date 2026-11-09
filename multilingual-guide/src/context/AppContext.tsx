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
import { LANGS, PLACES, type Language, type Place } from "../data/places";
import { type Coordinates, fetchNearbyPlaces } from "../services/nearby";
import { getSessionToken, writeSessionToken } from "../services/session";
import { checkAdmin } from "../services/api";

const STORE_FAVORITES = "mg_favorites_v2";
const STORE_LANG = "mg_language_v2";
const STORE_NEARBY = "mg_nearby_v3";
const STORE_DRAFTS = "mg_guide_drafts_v3";
type Drafts = Record<string, Partial<Record<Language, string>>>;
type AppState = {
  language: Language;
  setLanguage: (v: Language) => void;
  favorites: string[];
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
  places: Place[];
  location: Coordinates | null;
  radiusKm: number;
  setRadiusKm: (km: number) => void;
  loadingPlaces: boolean;
  placesError: string;
  source: "demo" | "live" | "fallback";
  refreshNearby: () => Promise<void>;
  findPlace: (id: string) => Place | undefined;
  drafts: Drafts;
  saveDraft: (id: string, lang: Language, text: string) => Promise<void>;
};
const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [language, saveLanguage] = useState<Language>("vi");
  const [favorites, saveFavorites] = useState<string[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [speechError, setSpeechError] = useState("");
  const [token, saveToken] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [places, setPlaces] = useState<Place[]>(PLACES);
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [radiusKm, setRadiusKm] = useState(3);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [placesError, setPlacesError] = useState("");
  const [source, setSource] = useState<"demo" | "live" | "fallback">("demo");
  const [drafts, setDrafts] = useState<Drafts>({});
  const speechSeq = useRef(0);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const [saved, lang, nearby, olderToken, guideDrafts] =
        await Promise.allSettled([
          AsyncStorage.getItem(STORE_FAVORITES),
          AsyncStorage.getItem(STORE_LANG),
          AsyncStorage.getItem(STORE_NEARBY),
          getSessionToken(),
          AsyncStorage.getItem(STORE_DRAFTS),
        ]);
      if (!mounted) return;
      try {
        if (saved.status === "fulfilled" && saved.value) {
          const a = JSON.parse(saved.value);
          if (Array.isArray(a))
            saveFavorites(a.filter((x) => typeof x === "string"));
        }
        if (
          lang.status === "fulfilled" &&
          LANGS.some((l) => l.key === lang.value)
        )
          saveLanguage(lang.value as Language);
        if (nearby.status === "fulfilled" && nearby.value) {
          const a = JSON.parse(nearby.value);
          if (Array.isArray(a) && a.length) {
            setPlaces(a.slice(0, 250));
            setSource("fallback");
          }
        }
        if (olderToken.status === "fulfilled") saveToken(olderToken.value);
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
  useEffect(() => {
    let active = true;
    setIsAdmin(false);
    if (token)
      void checkAdmin(token)
        .then((r) => {
          if (active) setIsAdmin(r.enabled === true);
        })
        .catch(() => {
          if (active) setIsAdmin(false);
        });
    return () => {
      active = false;
    };
  }, [token]);
  const setToken = useCallback((value: string | null) => {
    saveToken(value);
    void writeSessionToken(value).catch(() => {});
  }, []);
  const setLanguage = useCallback((value: Language) => {
    speechSeq.current++;
    void Speech.stop();
    setPlayingId(null);
    setSpeechError("");
    saveLanguage(value);
    void AsyncStorage.setItem(STORE_LANG, value).catch(() => {});
  }, []);
  const toggleFavorite = useCallback((id: string) => {
    saveFavorites((current) => {
      const next = current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id];
      void AsyncStorage.setItem(STORE_FAVORITES, JSON.stringify(next)).catch(
        () => {},
      );
      return next;
    });
  }, []);
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
        const chunks = text.match(
          /[\s\S]{1,750}(?:[.!?。！]\s*|$)|[\s\S]{1,750}/g,
        ) ?? [text];
        const playChunk = (index: number) => {
          if (current !== speechSeq.current) return;
          if (index >= chunks.length) {
            setPlayingId(null);
            return;
          }
          Speech.speak(chunks[index], {
            language: locale,
            ...(voice ? { voice } : {}),
            rate: 0.86,
            pitch: 1,
            volume: 1,
            onDone: () => playChunk(index + 1),
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
    [language],
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
    setLoadingPlaces(true);
    setPlacesError("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted)
        throw new Error(
          "Bạn chưa cấp quyền vị trí. Hãy cho phép GPS trong Cài đặt iPhone để tìm địa danh gần bạn.",
        );
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      setLocation(coordinates);
      const result = await fetchNearbyPlaces(coordinates, radiusKm);
      // Theo dõi kết quả tìm kiếm GPS
      console.log("GPS mới:", coordinates);
      console.log("Số địa danh nhận được:", result.places.length);
      console.log("Nguồn kết quả:", result.source);
      console.log("Cảnh báo:", result.warning);
      // Cập nhật dữ liệu lên giao diện
      setPlaces(result.places);
      setSource(result.source);
      setPlacesError(result.warning);
      // Lưu danh sách địa danh để sử dụng khi mở lại ứng dụng
      if (result.places.length) {
        void AsyncStorage.setItem(
          STORE_NEARBY,
          JSON.stringify(result.places.slice(0, 250)),
        ).catch(() => {});
      }
    } catch (e) {
      setPlacesError(
        e instanceof Error ? e.message : "Không thể tải danh sách địa điểm.",
      );
    } finally {
      setLoadingPlaces(false);
    }
  }, [radiusKm]);
  const findPlace = useCallback(
    (id: string) =>
      places.find((p) => p.id === id) || PLACES.find((p) => p.id === id),
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
      favorites,
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
      places,
      location,
      radiusKm,
      setRadiusKm,
      loadingPlaces,
      placesError,
      source,
      refreshNearby,
      findPlace,
      drafts,
      saveDraft,
    }),
    [
      language,
      setLanguage,
      favorites,
      toggleFavorite,
      playingId,
      speechError,
      speak,
      stop,
      testSpeech,
      token,
      setToken,
      isAdmin,
      places,
      location,
      radiusKm,
      loadingPlaces,
      placesError,
      source,
      refreshNearby,
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
