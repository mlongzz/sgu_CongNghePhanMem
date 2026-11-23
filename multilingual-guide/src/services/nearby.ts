import type { Category, Language, Place, Translated } from "../data/places";
import { PLACES } from "../data/places";
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
const QUERY_ENDPOINT = "https://overpass-api.de/api/interpreter";
const PHOTO_FALLBACK = "";
let cache:
  | {
      key: string;
      time: number;
      result: NearbyResult;
    }
  | undefined;

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
): Translated => ({ vi, en, fr, ja });
function osmCategory(tags: Record<string, string>): Category {
  if (tags.historic === "building") {
    return "Kiến trúc";
  }

  if (
    tags.tourism === "museum" ||
    tags.tourism === "gallery" ||
    tags.amenity === "arts_centre"
  ) {
    return "Văn hóa";
  }

  if (tags.historic) {
    return "Lịch sử";
  }

  if (tags.building === "yes") {
    return "Kiến trúc";
  }

  return "Khám phá";
}
function osmToPlace(item: OsmItem): Place | null {
  const tags = item.tags ?? {};
  const latitude = item.lat ?? item.center?.lat;
  const longitude = item.lon ?? item.center?.lon;
  const title = tags["name:vi"] || tags.name || tags["name:en"];
  if (
    typeof title !== "string" ||
    !title.trim() ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
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
  // OSM provides geographic metadata, NOT reviewed tour scripts. Never invent historical details.
  const description = translated(
    `${title} là ${kind} được cộng đồng OpenStreetMap ghi nhận tại ${district}. Hãy tham khảo thông tin tại địa điểm trước khi tham quan. Nội dung thuyết minh chi tiết đang được biên tập.`,
    `${title} is a mapped place of interest near ${district}. Detailed verified audio-guide content is not available yet.`,
    `${title} est un lieu d'intérêt cartographié près de ${district}. Le commentaire audio détaillé n'est pas encore disponible.`,
    `${title}は${district}付近の地図に登録された観光スポットです。詳しい音声ガイドは準備中です。`,
  );
  return {
    id: `osm-${item.type}-${item.id}`,
    title: title.trim(),
    subtitle: translated(
      "Được tìm thấy từ OpenStreetMap",
      "Found on OpenStreetMap",
      "Trouvé sur OpenStreetMap",
      "OpenStreetMapの掲載地",
    ),
    description,
    category: osmCategory(tags),
    district,
    latitude: latitude!,
    longitude: longitude!,
    image:
      typeof tags.image === "string" && tags.image.startsWith("https://")
        ? tags.image
        : PHOTO_FALLBACK,
    duration: 1,
    rating: 0,
    source: "osm",
  };
}
function validateBackendPlace(value: unknown): Place | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const title = v.title ?? v.name;
  const latitude = Number(v.latitude ?? v.lat);
  const longitude = Number(v.longitude ?? v.lon ?? v.lng);
  if (
    typeof title !== "string" ||
    !title.trim() ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  )
    return null;
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
    id: `db-${String(v.id)}`,
    title,
    latitude,
    longitude,
    district: String(v.district ?? "Gần bạn"),
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
    duration: Number(v.duration) || 2,
    rating: Number(v.rating) || 0,
    source: "backend",
  };
}
async function queryOverpass(
  location: Coordinates,
  radiusKm: number,
): Promise<Place[]> {
  const meters = Math.round(radiusKm * 1000);
  const around = `(around:${meters},${location.latitude.toFixed(6)},${location.longitude.toFixed(6)})`;
  const q = `[out:json][timeout:22];(nwr${around}["name"]["tourism"~"^(attraction|museum|gallery|viewpoint|artwork)$"];nwr${around}["name"]["historic"];nwr${around}["name"]["leisure"="park"];);out center 350;`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 29000);
  try {
    const response = await fetch(
      `${QUERY_ENDPOINT}?data=${encodeURIComponent(q)}`,
      { signal: controller.signal },
    );
    if (!response.ok)
      throw new Error(`OpenStreetMap/Overpass trả về HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (
      !body ||
      typeof body !== "object" ||
      !("elements" in body) ||
      !Array.isArray((body as { elements: unknown }).elements)
    )
      throw new Error("Dữ liệu OpenStreetMap không hợp lệ.");
    return (body as { elements: OsmItem[] }).elements
      .map(osmToPlace)
      .filter((p): p is Place => Boolean(p));
  } finally {
    clearTimeout(timer);
  }
}
export async function fetchNearbyPlaces(
  location: Coordinates,
  radiusKm: number,
): Promise<NearbyResult> {
  const distance = Math.min(20, Math.max(1, radiusKm));
  const key = `${location.latitude.toFixed(3)}:${location.longitude.toFixed(3)}:${distance}`;
  if (cache?.key === key && Date.now() - cache.time < 5 * 60 * 1000) {
  return cache.result;
}
  const local = PLACES.filter(
    (p) => distanceKm(location, p) <= distance + 0.03,
  );
  const [osm, backend] = await Promise.allSettled([
    queryOverpass(location, distance),
    API_BASE_URL
      ? apiFetch<unknown>(
          `/places/nearby?latitude=${location.latitude}&longitude=${location.longitude}&radius_km=${distance}&limit=100`,
        )
      : Promise.resolve(null),
  ]);
  console.log("API_BASE_URL:", API_BASE_URL);

console.log(
  "Overpass:",
  osm.status,
  osm.status === "rejected" ? String(osm.reason) : "OK"
);

console.log(
  "FastAPI:",
  backend.status,
  backend.status === "rejected" ? String(backend.reason) : backend.value
);
  const external = osm.status === "fulfilled" ? osm.value : [];
  console.log("Số địa danh OpenStreetMap:", external.length);

console.log(
  "Danh sách địa danh OpenStreetMap:",
  external.map((p) => ({
    name: p.title,
    latitude: p.latitude,
    longitude: p.longitude,
  }))
);
  let backendItems: Place[] = [];
  if (backend.status === "fulfilled") {
    const raw = backend.value;
    const list = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && "items" in raw
        ? (raw as { items: unknown }).items
        : [];
    if (Array.isArray(list))
      backendItems = list
        .map(validateBackendPlace)
        .filter((p): p is Place => Boolean(p));
  }
  const candidates = [...backendItems, ...local, ...external].filter(
    (p) => distanceKm(location, p) <= distance + 0.03,
  );
  console.log("Số địa danh sau lọc bán kính:", candidates.length);
  const seen = new Set<string>();
  const deduped = candidates
    .filter((p) => {
      // Keep nearby distinct names, but do not show repeated copies of the same landmark.
      const keyName = `${normalizeSearch(p.title).trim()}:${Math.round(p.latitude * 1000)}:${Math.round(p.longitude * 1000)}`;
      if (seen.has(keyName)) return false;
      seen.add(keyName);
      return true;
    })
    .sort((a, b) => distanceKm(location, a) - distanceKm(location, b));
console.log("Số địa danh sau loại trùng:", deduped.length);
const osmFailed = osm.status === "rejected";
const backendFailed =
  Boolean(API_BASE_URL) && backend.status === "rejected";

const hasRealNearby = deduped.some(
  (p) => p.source === "osm" || p.source === "backend"
);

let warning = "";

if (osmFailed && backendFailed) {
  warning =
    "Không thể kết nối cả OpenStreetMap và FastAPI. " +
    "Đang hiển thị địa danh mẫu nếu có.";
} else if (osmFailed) {
  warning =
    "OpenStreetMap tạm thời không khả dụng. " +
    "Đang sử dụng dữ liệu FastAPI và địa danh mẫu nếu có.";
} else if (backendFailed) {
  warning =
    "FastAPI tạm thời không khả dụng. " +
    "Đang sử dụng dữ liệu OpenStreetMap và địa danh mẫu nếu có.";
} else if (!hasRealNearby) {
  warning =
    "Chưa tìm thấy địa danh từ PostgreSQL hoặc OpenStreetMap " +
    "trong bán kính đã chọn. Đang hiển thị địa danh mẫu nếu có.";
}
const result: NearbyResult = {
  places: deduped,
  source: hasRealNearby ? "live" : "fallback",
  warning,
};
// Chỉ cache kết quả có dữ liệu thật và hai nguồn đều phản hồi thành công.
if (!osmFailed && !backendFailed && hasRealNearby) {
  cache = {
    key,
    time: Date.now(),
    result,
  };
}
return result;
}
