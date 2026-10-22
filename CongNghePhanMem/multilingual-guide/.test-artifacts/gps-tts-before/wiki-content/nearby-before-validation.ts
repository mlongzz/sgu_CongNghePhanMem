/**
 * Nguon POI dung chung.
 * - fetchNearbyPlaces(): giu nguyen y nghia cu, tra ve POI backend khi da cau hinh API.
 * - Community IDs never enter PostgreSQL account APIs. Explicit, language-tagged
 *   descriptions and linked Wikipedia articles can supply attributed narration.
 */
import type { Category, Language, Place, Translated } from "../data/places";
import { API_BASE_URL, apiFetch } from "./api";

export type Coordinates = { latitude: number; longitude: number };
export type NearbyResult = {
  places: Place[];
  source: "live" | "fallback";
  warning: string;
};

type OsmItem = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export type OsmSearchProgress = { radiusKm: number; attempt: number; totalAttempts: number };
export type NearbyRequestOptions = {
  signal?: AbortSignal;
  forceRefresh?: boolean;
  onProgress?: (progress: OsmSearchProgress) => void;
};

function abortError(): Error {
  const error = new Error("Đã hủy tìm kiếm địa điểm.");
  error.name = "AbortError";
  return error;
}

function checkedRadius(location: Coordinates, radiusKm: number): number {
  if (!checkCoords(location)) throw new Error("Tọa độ GPS không hợp lệ.");
  if (!Number.isFinite(radiusKm)) throw new Error("Bán kính tìm kiếm không hợp lệ.");
  return Math.min(20, Math.max(1, radiusKm));
}

/** Use the same coordinates for the query and cache identity, without rounding into another location. */
export function osmExploreKey(location: Coordinates, radiusKm: number): string {
  return JSON.stringify([location.latitude, location.longitude, checkedRadius(location, radiusKm)]);
}

const PHOTO_FALLBACK = "";
const CACHE_MS = 5 * 60 * 1000;
const STALE_CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_OSM_ITEMS = 250;
export type OsmExploreResult = {
  places: Place[];
  requestedRadiusKm: number;
  searchedRadiusKm: number;
  warning: string;
  stale: boolean;
  cacheAgeSeconds: number;
  retryAfterSeconds: number | null;
};
const osmCache = new Map<string, { expiresAt: number; result: OsmExploreResult }>();
// Share duplicate FastAPI requests; provider retry/cooldown lives on the server.
const osmInFlight = new Map<string, Promise<OsmExploreResult>>();
function checkCoords(point: Coordinates): boolean {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  );
}

export function distanceKm(a: Coordinates, b: Coordinates): number {
  const rad = (degree: number) => (degree * Math.PI) / 180;
  const deltaLat = rad(b.latitude - a.latitude);
  const deltaLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(deltaLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function normalizeSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

export function filterPlaces(
  items: Place[],
  query: string,
  category: "Tất cả" | Category,
  language: Language,
): Place[] {
  const needle = normalizeSearch(query.trim());
  return items.filter(
    (item) =>
      (category === "Tất cả" || item.category === category) &&
      normalizeSearch(
        [
          item.title,
          item.district,
          item.category,
          item.subtitle[language],
          item.description[language],
        ].join(" "),
      ).includes(needle),
  );
}

const translated = (
  vi: string,
  en: string,
  fr: string,
  ja: string,
): Translated => ({
  vi,
  en,
  fr,
  ja,
});

function osmCategory(tags: Record<string, string>): Category {
  if (tags.historic === "building") return "Kiến trúc";
  if (
    tags.tourism === "museum" ||
    tags.tourism === "gallery" ||
    tags.amenity === "arts_centre"
  )
    return "Văn hóa";
  if (tags.historic) return "Lịch sử";
  if (tags.building === "yes") return "Kiến trúc";
  return "Khám phá";
}

function osmToPlace(value: unknown): Place | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<OsmItem>;
  if (!["node", "way", "relation"].includes(String(item.type)) || !Number.isInteger(item.id) || Number(item.id) <= 0) return null;
  const tags = item.tags && typeof item.tags === "object" ? item.tags : {};
  const latitude = item.lat ?? item.center?.lat;
  const longitude = item.lon ?? item.center?.lon;
  const title = tags["name:vi"] || tags.name || tags["name:en"];
  if (
    typeof title !== "string" ||
    !title.trim() ||
    latitude === undefined ||
    longitude === undefined ||
    !checkCoords({ latitude, longitude })
  )
    return null;

  const kind =
    tags.tourism === "museum"
      ? "bảo tàng"
      : tags.historic
        ? "di tích lịch sử"
        : tags.leisure === "park"
          ? "công viên"
          : "địa điểm tham quan";
  const district =
    tags["addr:district"] ||
    tags["addr:suburb"] ||
    tags["addr:city"] ||
    "Gần bạn";

  // Thong tin OSM KHONG PHAI bai thuyet minh duoc kiem chung.
  const description = translated(
    `${title.trim()} là ${kind} được cộng đồng OpenStreetMap ghi nhận tại ${district}. Nội dung thuyết minh chính thức chưa có.`,
    `${title.trim()} is mapped on OpenStreetMap near ${district}. No verified audio guide is available yet.`,
    `${title.trim()} est référencé sur OpenStreetMap près de ${district}. Aucun audioguide vérifié pour le moment.`,
    `${title.trim()}はOpenStreetMapに登録された${district}付近のスポットです。正式な音声ガイドはまだありません。`,
  );

  const narration: Place['narration'] = {};
  for (const language of ['vi', 'en', 'fr', 'ja'] as const) {
    const text = tags[`description:${language}`];
    if (typeof text === 'string' && text.trim().length >= 30) narration[language] = {
      text: text.trim(), language, source: 'description',
      sourceUrl: `https://www.openstreetmap.org/${item.type}/${item.id}`,
      attribution: 'Mô tả cộng đồng OpenStreetMap; chưa được Admin duyệt.',
      licenseUrl: 'https://www.openstreetmap.org/copyright',
    };
  }
  const wikiTag = typeof tags.wikipedia === 'string' ? /^(vi|en|fr|ja):(.+)$/.exec(tags.wikipedia) : null;

  return {
    id: `osm-${item.type}-${item.id}`,
    title: title.trim(),
    subtitle: translated(
      "Địa điểm từ OpenStreetMap · Chưa có thuyết minh chính thức",
      "OpenStreetMap · No official audio guide",
      "OpenStreetMap · Audioguide non disponible",
      "OpenStreetMap · 公式音声ガイドなし",
    ),
    description,
    category: osmCategory(tags),
    district,
    latitude,
    longitude,
    image:
      typeof tags.image === "string" && tags.image.startsWith("https://")
        ? tags.image
        : PHOTO_FALLBACK,
    duration: 0,
    rating: 0,
    source: "osm",
    sourceUrl: `https://www.openstreetmap.org/${item.type}/${item.id}`,
    narration,
    ...(wikiTag ? { wikipedia: { language: wikiTag[1] as Language, title: wikiTag[2].trim() } } : {}),
  };
}

export function validateBackendPlace(value: unknown): Place | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const title = v.title ?? v.name;
  const rawLat = v.latitude ?? v.lat;
  const rawLon = v.longitude ?? v.lon ?? v.lng;
  if (rawLat == null || rawLon == null) return null;
  const latitude = Number(rawLat);
  const longitude = Number(rawLon);
  if (
    typeof title !== "string" ||
    !title.trim() ||
    !checkCoords({ latitude, longitude })
  )
    return null;
  const id = Number(v.id);
  if (!Number.isInteger(id) || id <= 0) return null;

  const desc = v.description;
  const localized = (
    typeof desc === "string" ? translated(desc, desc, desc, desc) : desc
  ) as Partial<Translated> | undefined;
  const description = translated(
    localized?.vi ?? "Chưa có bài thuyết minh.",
    localized?.en ?? "Audio guide pending.",
    localized?.fr ?? "Commentaire à venir.",
    localized?.ja ?? "音声ガイド準備中。",
  );
  const sub = v.subtitle as Partial<Translated> | undefined;
  return {
    id: `db-${id}`,
    title,
    latitude,
    longitude,
    district: String(v.address ?? v.district ?? "Chưa có địa chỉ"),
    category: (["Lịch sử", "Kiến trúc", "Văn hóa", "Khám phá"].includes(
      String(v.category),
    )
      ? v.category
      : "Khám phá") as Category,
    subtitle: translated(
      sub?.vi ?? "Thông tin từ hệ thống",
      sub?.en ?? "From the guide system",
      sub?.fr ?? "Depuis le système",
      sub?.ja ?? "システム掲載",
    ),
    description,
    image:
      typeof v.image_url === "string" && v.image_url.trim()
        ? v.image_url.trim()
        : typeof v.image === "string"
          ? v.image
          : PHOTO_FALLBACK,
    duration: Number(v.duration) || 0,
    rating: Number(v.rating) || 0,
    source: "backend",
  };
}

/** Browser/mobile clients only contact our public FastAPI endpoint, never Overpass. */
async function queryOsmBackend(location: Coordinates, radiusKm: number, options: NearbyRequestOptions): Promise<OsmExploreResult> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  // The backend has up to 36 seconds of bounded provider attempts; ordinary APIs keep their 12s timeout.
  const timer = setTimeout(cancel, 40_000);
  const query = new URLSearchParams({
    latitude: String(location.latitude), longitude: String(location.longitude), radius_km: String(radiusKm),
    ...(options.forceRefresh ? { force_refresh: "true" } : {}),
  });
  try {
    const response = await fetch(`${API_BASE_URL}/osm/nearby?${query}`, {
      signal: controller.signal, credentials: "omit", headers: { Accept: "application/json" },
    });
    let body: unknown;
    try { body = await response.json(); } catch { body = null; }
    if (!response.ok) {
      const detail = body && typeof body === "object" && "detail" in body && typeof body.detail === "string" ? body.detail : `FastAPI trả HTTP ${response.status}.`;
      throw new Error(detail.startsWith("Không tải được địa điểm OpenStreetMap") ? detail : `Không tải được địa điểm OpenStreetMap. ${detail}`);
    }
    if (!body || typeof body !== "object" || !("source" in body) || body.source !== "openstreetmap" ||
      !("elements" in body) || !Array.isArray(body.elements) ||
      !("requested_radius_km" in body) || body.requested_radius_km !== radiusKm ||
      !("searched_radius_km" in body) || typeof body.searched_radius_km !== "number" ||
      !Number.isFinite(body.searched_radius_km) || body.searched_radius_km < 1 || body.searched_radius_km > radiusKm)
      throw new Error("API /osm/nearby trả dữ liệu không hợp lệ.");
    const searched = body.searched_radius_km;
    // Optional only for compatibility with a backend that has not reloaded yet.
    const stale = "stale" in body ? body.stale : false;
    const age = "cache_age_seconds" in body ? body.cache_age_seconds : 0;
    const retry = "retry_after_seconds" in body ? body.retry_after_seconds : null;
    if (typeof stale !== "boolean" || typeof age !== "number" || !Number.isInteger(age) || age < 0 ||
      (retry !== null && (typeof retry !== "number" || !Number.isInteger(retry) || retry < 1)) ||
      (stale && age * 1000 >= STALE_CACHE_MS))
      throw new Error("API /osm/nearby trả thông tin cache không hợp lệ.");
    const warning = "warning" in body && typeof body.warning === "string" ? body.warning.trim() : "";
    const coverage = searched < radiusKm ? `Chưa hoàn tất tìm OpenStreetMap trong ${radiusKm} km. Tạm hiển thị dữ liệu trong ${searched} km gần bạn; hãy thử lại sau để tìm đủ bán kính.` : "";
    const savedWarning = stale ? `Chưa cập nhật được OpenStreetMap. Đang dùng dữ liệu đã lưu cách đây ${age} giây; thử lại sau ${retry ?? 30} giây.` : "";
    return { places: cleanOsmItems(body.elements, location, searched), requestedRadiusKm: radiusKm, searchedRadiusKm: searched,
      stale, cacheAgeSeconds: age, retryAfterSeconds: retry,
      warning: warning || [savedWarning, coverage].filter(Boolean).join(" ") };
  } catch (error) {
    if (options.signal?.aborted) throw abortError();
    if (controller.signal.aborted) throw new Error("FastAPI chưa trả kết quả OpenStreetMap sau 40 giây. Hãy thử lại.");
    if (error instanceof TypeError) throw new Error("Không kết nối được FastAPI để tìm OpenStreetMap. Hãy kiểm tra backend và kết nối mạng.");
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}

function cleanOsmItems(
  items: unknown[],
  location: Coordinates,
  requestedRadiusKm: number,
): Place[] {
  const seen = new Set<string>();
  return items
    .map(osmToPlace)
    .filter((p): p is Place => Boolean(p))
    .filter((p) => distanceKm(location, p) <= requestedRadiusKm + 0.03)
    .filter((p) => {
      const dedupeKey = `${normalizeSearch(p.title).trim()}:${Math.round(p.latitude * 1000)}:${Math.round(p.longitude * 1000)}`;
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      return true;
    })
    .sort((a, b) => distanceKm(location, a) - distanceKm(location, b))
    .slice(0, MAX_OSM_ITEMS);
}

/**
 * One request to FastAPI. The server reports any reduction from the requested radius.
 */
export async function fetchOsmExploreResult(
  location: Coordinates,
  radiusKm: number,
  options: NearbyRequestOptions = {},
): Promise<OsmExploreResult> {
  if (options.signal?.aborted) throw abortError();
  const distance = checkedRadius(location, radiusKm);
  if (!API_BASE_URL) throw new Error("Chưa cấu hình EXPO_PUBLIC_API_URL. Hãy kết nối FastAPI để tìm địa điểm OpenStreetMap.");
  const key = osmExploreKey(location, distance);
  const cached = osmCache.get(key);
  if (cached && !options.forceRefresh) {
    if (Date.now() < cached.expiresAt) return cached.result;
    osmCache.delete(key);
  }
  // Requests with a caller-owned signal must not cancel another caller's request.
  const pending = options.signal ? undefined : osmInFlight.get(key);
  if (pending) return pending;

  const work = (async (): Promise<OsmExploreResult> => {
    options.onProgress?.({ radiusKm: distance, attempt: 1, totalAttempts: 1 });
    const result = await queryOsmBackend(location, distance, options);
    if (options.signal?.aborted) throw abortError();
    const ageMs = result.cacheAgeSeconds * 1000;
    // Do not restart the backend's freshness window in each browser. Stale
    // data may only be reused until its retry/retention deadline, never 5 min.
    const life = result.stale
      ? Math.min((result.retryAfterSeconds ?? 30) * 1000, STALE_CACHE_MS - ageMs)
      : (result.searchedRadiusKm < distance ? 45_000 : CACHE_MS) - ageMs;
    osmCache.set(key, { expiresAt: Date.now() + Math.max(0, life), result });
    if (osmCache.size > 25) osmCache.delete(osmCache.keys().next().value!);
    return result;
  })();
  if (!options.signal) osmInFlight.set(key, work);
  try {
    return await work;
  } finally {
    if (osmInFlight.get(key) === work) osmInFlight.delete(key);
  }
}

/** Backward-compatible: giu chu ky cu cho AppContext va cac noi goi khac. */
export async function fetchOsmExplorePlaces(
  location: Coordinates,
  radiusKm: number,
  options?: NearbyRequestOptions,
): Promise<Place[]> {
  const result = await fetchOsmExploreResult(location, radiusKm, options);
  return result.places;
}

/**
 * AppContext only receives PostgreSQL POI. Community POI are merged in MapScreen.web.tsx.
 */
export async function fetchNearbyPlaces(
  location: Coordinates,
  radiusKm: number,
  options: { signal?: AbortSignal } = {},
): Promise<NearbyResult> {
  const distance = checkedRadius(location, radiusKm);
  if (!API_BASE_URL) throw new Error("Chưa cấu hình EXPO_PUBLIC_API_URL. Hãy kết nối FastAPI để tìm địa điểm chính thức.");
  const rows = await apiFetch<unknown[]>(
    `/places/nearby?latitude=${location.latitude.toFixed(3)}&longitude=${location.longitude.toFixed(3)}&radius_km=${distance}&limit=100`,
    options,
  );
  if (!Array.isArray(rows)) throw new Error("API /places/nearby không trả về danh sách.");
  const places = rows.map(validateBackendPlace).filter((p): p is Place => Boolean(p));
  return {
    places,
    source: "live",
    warning: places.length ? "" : "Chưa có POI chính thức trong bán kính đã chọn.",
  };
}
