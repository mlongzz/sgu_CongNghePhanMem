/**
 * Nguon POI dung chung.
 * - fetchNearbyPlaces(): giu nguyen y nghia cu, tra ve POI backend khi da cau hinh API.
 * - fetchOsmExplorePlaces(): nguon bo sung CHI DE HIEN THI tren MapScreen.web.
 *   Khong dua osm-* vao Favorites/History/AutoGuide hoac API PostgreSQL.
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

export type NearbyRequestOptions = { signal?: AbortSignal; forceRefresh?: boolean };

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

// Dia chi moi cua dich vu Kumi (nay do Private.coffee van hanh).
const OVERPASS_PRIMARY = "https://overpass.private.coffee/api/interpreter";
const OVERPASS_BACKUP = "https://overpass-api.de/api/interpreter";
const PHOTO_FALLBACK = "";
const CACHE_MS = 5 * 60 * 1000;
const MAX_OSM_ITEMS = 250;
export type OsmExploreResult = {
  places: Place[];
  requestedRadiusKm: number;
  searchedRadiusKm: number;
  warning: string;
};
const osmCache = new Map<string, { time: number; result: OsmExploreResult }>();
// Tranh gui trung truy van Overpass khi React Strict Mode mount lai component.
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

/**
 * Query nhe hon: POST form-encoded, timeout ro rang, khong gui GPS ngoai
 * request tim POI. Khong co API key va khong thay doi PostgreSQL.
 */
async function queryOverpassOnce(
  location: Coordinates,
  searchRadiusKm: number,
  endpoint: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown[]> {
  if (signal?.aborted) throw abortError();
  const meters = Math.round(searchRadiusKm * 1000);
  const around = `(around:${meters},${location.latitude.toFixed(6)},${location.longitude.toFixed(6)})`;
  const queryTimeout = Math.max(5, Math.floor(timeoutMs / 1000) - 2);
  const query = `[out:json][timeout:${queryTimeout}];(nwr${around}["name"]["tourism"~"^(attraction|museum|gallery|viewpoint|artwork)$"];nwr${around}["name"]["historic"];nwr${around}["name"]["leisure"="park"];);out center ${MAX_OSM_ITEMS};`;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Overpass chap nhan POST. URL ngan hon GET va khong bi gioi han
    // do dai URL khi truyen Overpass QL.
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} (${endpoint})`);
    }
    const body: unknown = await response.json();
    if (
      !body ||
      typeof body !== "object" ||
      !("elements" in body) ||
      !Array.isArray((body as { elements: unknown }).elements)
    ) {
      throw new Error(`Dữ liệu trả về không hợp lệ (${endpoint}).`);
    }
    if ("remark" in body && typeof body.remark === "string" && body.remark.trim()) {
      throw new Error("OpenStreetMap chưa xử lý xong truy vấn. Vui lòng thử lại.");
    }
    return (body as { elements: unknown[] }).elements;
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (controller.signal.aborted) {
      throw new Error(
        `Máy chủ ${new URL(endpoint).host} phản hồi quá ${Math.round(timeoutMs / 1000)} giây.`,
      );
    }
    if (error instanceof Error) throw error;
    throw new Error("Không thể kết nối đến OpenStreetMap.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
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
 * Tim OSM trong ban kinh yeu cau. Neu ban kinh lon gay timeout, thu
 * 5 km de van co POI that hien len ban do (co hien thi thong bao ro rang).
 */
export async function fetchOsmExploreResult(
  location: Coordinates,
  radiusKm: number,
  options: NearbyRequestOptions = {},
): Promise<OsmExploreResult> {
  if (options.signal?.aborted) throw abortError();
  const distance = checkedRadius(location, radiusKm);
  const key = osmExploreKey(location, distance);
  const cached = osmCache.get(key);
  if (cached && !options.forceRefresh) {
    const life = cached.result.searchedRadiusKm < distance ? 45_000 : CACHE_MS;
    if (Date.now() - cached.time < life) return cached.result;
    osmCache.delete(key);
  }
  // Requests with a caller-owned signal must not cancel another caller's request.
  const pending = options.signal ? undefined : osmInFlight.get(key);
  if (pending) return pending;

  const work = (async (): Promise<OsmExploreResult> => {
    const fallbackRadiusKm = Math.min(5, distance);
    const attempts =
      distance > 6
        ? [
            { endpoint: OVERPASS_PRIMARY, radius: distance, timeoutMs: 14000 },
            {
              endpoint: OVERPASS_PRIMARY,
              radius: fallbackRadiusKm,
              timeoutMs: 10000,
            },
            {
              endpoint: OVERPASS_BACKUP,
              radius: fallbackRadiusKm,
              timeoutMs: 12000,
            },
          ]
        : [
            { endpoint: OVERPASS_PRIMARY, radius: distance, timeoutMs: 14000 },
            { endpoint: OVERPASS_BACKUP, radius: distance, timeoutMs: 12000 },
          ];
    const errors: string[] = [];
    for (const attempt of attempts) {
      try {
        const items = await queryOverpassOnce(
          location,
          attempt.radius,
          attempt.endpoint,
          attempt.timeoutMs,
          options.signal,
        );
        if (options.signal?.aborted) throw abortError();
        const places = cleanOsmItems(items, location, attempt.radius);
        const reduced = attempt.radius < distance;
        const result: OsmExploreResult = {
          places,
          requestedRadiusKm: distance,
          searchedRadiusKm: attempt.radius,
          warning: reduced
            ? `Máy chủ OpenStreetMap quá chậm khi tìm ${distance} km. Tạm hiển thị dữ liệu trong ${attempt.radius} km gần bạn; hãy thử lại sau để tìm đủ bán kính.`
            : "",
        };
        osmCache.set(key, { time: Date.now(), result });
        if (osmCache.size > 25) osmCache.delete(osmCache.keys().next().value!);
        return result;
      } catch (error) {
        if (options.signal?.aborted) throw abortError();
        errors.push(error instanceof Error ? error.message : "Lỗi kết nối");
      }
    }
    throw new Error(
      `Không tải được địa điểm OpenStreetMap. ${errors.join(" | ")}`,
    );
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
 * Duoc AppContext su dung. Khi co API, chi POI backend di vao cac luong
 * tai khoan va thuyet minh; POI OSM bo sung rieng o MapScreen.web.tsx.
 */
export async function fetchNearbyPlaces(
  location: Coordinates,
  radiusKm: number,
): Promise<NearbyResult> {
  const distance = checkedRadius(location, radiusKm);
  if (API_BASE_URL) {
    const rows = await apiFetch<unknown[]>(
      `/places/nearby?latitude=${location.latitude.toFixed(3)}&longitude=${location.longitude.toFixed(3)}&radius_km=${distance}&limit=100`,
    );
    if (!Array.isArray(rows))
      throw new Error("API /places/nearby không trả về danh sách.");
    const places = rows
      .map(validateBackendPlace)
      .filter((p): p is Place => Boolean(p));
    return {
      places,
      source: "live",
      warning: places.length
        ? ""
        : "Chưa có POI chính thức trong bán kính đã chọn.",
    };
  }
  const places = await fetchOsmExplorePlaces(location, distance);
  return {
    places,
    source: "live",
    warning: places.length ? "" : "Chưa có địa điểm trong bán kính đã chọn.",
  };
}
