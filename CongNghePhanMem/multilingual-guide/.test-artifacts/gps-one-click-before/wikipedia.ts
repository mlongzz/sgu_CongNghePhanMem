import type { Place, Translated } from "../data/places";
import { distanceKm, type Coordinates } from "./nearby";

const ENDPOINT = "https://vi.wikipedia.org/w/api.php";
const CACHE_MS = 5 * 60_000;
export type WikipediaResult = { places: Place[]; requestedRadiusKm: number; searchedRadiusKm: number; warning: string };
type Options = { signal?: AbortSignal; forceRefresh?: boolean };
const cache = new Map<string, { at: number; result: WikipediaResult }>();

function radiusFor(location: Coordinates, radiusKm: number): number {
  if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) || Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180)
    throw new Error("Tọa độ GPS không hợp lệ.");
  if (!Number.isFinite(radiusKm)) throw new Error("Bán kính tìm kiếm không hợp lệ.");
  return Math.min(20, Math.max(1, radiusKm));
}

export function wikipediaNearbyKey(location: Coordinates, radiusKm: number): string {
  return JSON.stringify([location.latitude, location.longitude, radiusFor(location, radiusKm)]);
}

function abortError(): Error {
  const error = new Error("Đã hủy tìm kiếm Wikipedia.");
  error.name = "AbortError";
  return error;
}

const localized = (vi: string, en: string, fr: string, ja: string): Translated => ({ vi, en, fr, ja });

function toPlace(value: unknown): Place | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.ns !== 0 || !Number.isInteger(row.pageid) || Number(row.pageid) <= 0 || typeof row.title !== "string" || !row.title.trim() ||
    typeof row.lat !== "number" || typeof row.lon !== "number" || !Number.isFinite(row.lat) || !Number.isFinite(row.lon) || Math.abs(row.lat) > 90 || Math.abs(row.lon) > 180) return null;
  return {
    id: `wiki-vi-${row.pageid}`,
    title: row.title.trim(),
    latitude: row.lat,
    longitude: row.lon,
    category: "Khám phá",
    district: "Bài viết có tọa độ trên Wikipedia",
    source: "wikipedia",
    sourceUrl: `https://vi.wikipedia.org/?curid=${row.pageid}`,
    subtitle: localized("Wikipedia · Chưa có thuyết minh chính thức", "Wikipedia · No official audio guide", "Wikipedia · Aucun audioguide officiel", "Wikipedia · 公式音声ガイドなし"),
    description: localized("Địa điểm có bài viết trên Wikipedia. Đọc bài viết gốc để tìm hiểu thêm; hệ thống chưa có thuyết minh đã kiểm duyệt cho địa điểm này.", "This location has a Wikipedia article. Read the original article for details; no verified audio guide is available.", "Ce lieu possède un article Wikipédia. Consultez l’article original ; aucun audioguide vérifié n’est disponible.", "この場所にはWikipediaの記事があります。詳細は元の記事をご覧ください。正式な音声ガイドはまだありません。"),
    image: "", duration: 0, rating: 0,
  };
}

/** Only call after the user chooses Wikipedia as a source. Never adds entries to the backend catalog. */
export async function fetchWikipediaNearby(location: Coordinates, radiusKm: number, options: Options = {}): Promise<WikipediaResult> {
  if (options.signal?.aborted) throw abortError();
  const requestedRadiusKm = radiusFor(location, radiusKm);
  const key = wikipediaNearbyKey(location, requestedRadiusKm);
  const hit = cache.get(key);
  if (hit && !options.forceRefresh && Date.now() - hit.at < CACHE_MS) return hit.result;
  // MediaWiki GeoSearch supports at most 10 km per query; never pretend this covers 20 km.
  const searchedRadiusKm = Math.min(10, requestedRadiusKm);
  const params = new URLSearchParams({
    action: "query", list: "geosearch", gscoord: `${location.latitude}|${location.longitude}`,
    gsradius: String(Math.round(searchedRadiusKm * 1000)), gslimit: "50", gsnamespace: "0",
    format: "json", formatversion: "2", origin: "*",
  });
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, 8000);
  try {
    const response = await fetch(`${ENDPOINT}?${params.toString()}`, { signal: controller.signal, credentials: "omit" });
    if (!response.ok) throw new Error(`Wikipedia trả HTTP ${response.status}. Hãy thử lại sau.`);
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || "error" in body || !("query" in body) || !body.query || typeof body.query !== "object" || !("geosearch" in body.query) || !Array.isArray(body.query.geosearch))
      throw new Error("Wikipedia trả dữ liệu không hợp lệ. Hãy thử lại sau.");
    const seen = new Set<string>();
    const places = body.query.geosearch.map(toPlace).filter((p): p is Place => !!p)
      .filter(p => distanceKm(location, p) <= searchedRadiusKm + 0.03)
      .filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
      .sort((a, b) => distanceKm(location, a) - distanceKm(location, b)).slice(0, 50);
    if (options.signal?.aborted) throw abortError();
    const result: WikipediaResult = { places, requestedRadiusKm, searchedRadiusKm, warning: requestedRadiusKm > searchedRadiusKm
      ? `Wikipedia hỗ trợ tối đa 10 km mỗi truy vấn. Đang hiển thị kết quả trong ${searchedRadiusKm} km, chưa phủ đủ ${requestedRadiusKm} km đã chọn.` : "" };
    cache.set(key, { at: Date.now(), result });
    if (cache.size > 25) cache.delete(cache.keys().next().value!);
    return result;
  } catch (error) {
    if (options.signal?.aborted) throw abortError();
    if (controller.signal.aborted) throw new Error("Wikipedia phản hồi quá 8 giây. Hãy thử lại sau.");
    if (error instanceof TypeError) throw new Error("Không kết nối được Wikipedia. Hãy kiểm tra mạng và thử lại.");
    if (error instanceof SyntaxError) throw new Error("Wikipedia trả dữ liệu không hợp lệ. Hãy thử lại sau.");
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}
