import type { Language, NarrationContent, Place } from "../data/places";
import { distanceKm } from "./nearby";

const LANGUAGES: readonly Language[] = ["vi", "en", "fr", "ja"];
const CACHE_MS = 30 * 60_000;
const MAX_CACHE = 80;
const REQUEST_MS = 8000;
const MAX_TEXT = 20_000;
const LICENSE = "https://creativecommons.org/licenses/by-sa/4.0/";
type Article = { language: Language; pageId?: number; title?: string };
type Options = { signal?: AbortSignal; forceRefresh?: boolean };
type WikiPage = {
  pageid: number; ns: number; title: string; extract?: string;
  pageprops?: Record<string, unknown>;
  coordinates?: { lat?: unknown; lon?: unknown; globe?: unknown }[];
  langlinks?: { lang?: unknown; title?: unknown }[];
};
const cache = new Map<string, { at: number; content: NarrationContent | null }>();

const isLanguage = (value: unknown): value is Language => LANGUAGES.includes(value as Language);
const isPageId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const validTitle = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 512 && !/[\u0000-\u001f|]/.test(value);

function abortError(): Error {
  const error = new Error("Đã hủy tải nội dung Wikipedia.");
  error.name = "AbortError";
  return error;
}

function fromUrl(raw: string | undefined): Article | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = /^(vi|en|fr|ja)(?:\.m)?\.wikipedia\.org$/.exec(url.hostname);
    if (!host || !isLanguage(host[1])) return null;
    const pageId = Number(url.searchParams.get("curid"));
    if (isPageId(pageId)) return { language: host[1], pageId };
    const title = url.pathname.startsWith("/wiki/")
      ? decodeURIComponent(url.pathname.slice(6)).replace(/_/g, " ")
      : url.pathname === "/w/index.php" ? url.searchParams.get("title") : null;
    return validTitle(title) ? { language: host[1], title: title.trim() } : null;
  } catch { return null; }
}

/** A stable article reference is required. Similar place names are never used as a search query. */
function reference(place: Place): Article | null {
  if (place.wikipedia && isLanguage(place.wikipedia.language)) {
    if (isPageId(place.wikipedia.pageId)) return { language: place.wikipedia.language, pageId: place.wikipedia.pageId };
    if (validTitle(place.wikipedia.title)) return { language: place.wikipedia.language, title: place.wikipedia.title.trim() };
  }
  const id = /^wiki-(vi|en|fr|ja)-(\d+)$/.exec(place.id);
  if (id && isLanguage(id[1]) && isPageId(Number(id[2]))) return { language: id[1], pageId: Number(id[2]) };
  return fromUrl(place.wikipediaUrl) ?? (place.source === "wikipedia" ? fromUrl(place.sourceUrl) : null);
}

/** Defensive plain-text cleanup also used for temporary descriptions. No DOM dependency on native. */
export function sanitizeNarrationText(value: string): string {
  if (typeof value !== "string") return "";
  let text = value.slice(0, 100_000)
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<(script|style|ref)\b[^>]*>[^]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => {
      const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
      if (entity[0] !== "#") return named[entity.toLowerCase()] ?? " ";
      const number = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(number) && number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
        ? String.fromCodePoint(number) : " ";
    });
  // Decode before the second tag pass so encoded markup is not spoken either.
  text = text.replace(/<(script|style|ref)\b[^>]*>[^]*?<\/\1\s*>/gi, " ").replace(/<[^>]*>/g, " ");
  for (let index = 0; index < 6 && /\{\{/.test(text); index++) text = text.replace(/\{\{[^{}]*\}\}/g, " ");
  text = text
    .replace(/\[\[(?:File|Image|Category|Tập tin|Hình|Thể loại|Fichier|ファイル|カテゴリ):[^\]]*\]\]/gi, " ")
    .replace(/\[\[([^\]|]*\|)?([^\]]+)\]\]/g, "$2")
    .replace(/\[https?:\/\/[^\s\]]+(?:\s+([^\]]+))?\]/g, "$1")
    .replace(/https?:\/\/[^\s<>\]]+/gi, " ")
    .replace(/\[(?:\d+(?:\s*[,–-]\s*\d+)*|citation needed|cần dẫn nguồn|note \d+|注釈 \d+)\]/gi, " ")
    .replace(/={2,}\s*([^=]+?)\s*={2,}/g, " $1. ")
    .replace(/'{2,}/g, "")
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:。！？、])/g, "$1")
    .trim();
  if (text.length > MAX_TEXT) {
    const cut = text.slice(0, MAX_TEXT);
    const boundary = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("。"), cut.lastIndexOf("！"), cut.lastIndexOf("？"));
    text = cut.slice(0, boundary > MAX_TEXT / 2 ? boundary + 1 : cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : MAX_TEXT).trim();
  }
  return text;
}
export const cleanNarrationText = sanitizeNarrationText;

function articleCoordinates(page: WikiPage): { latitude: number; longitude: number } | null {
  if (!Array.isArray(page.coordinates)) return null;
  const point = page.coordinates.find(value => value && typeof value === "object"
    && typeof value.lat === "number" && typeof value.lon === "number" && Number.isFinite(value.lat) && Number.isFinite(value.lon)
    && Math.abs(value.lat) <= 90 && Math.abs(value.lon) <= 180 && (!value.globe || value.globe === "earth"));
  return point ? { latitude: point.lat as number, longitude: point.lon as number } : null;
}

function matchesCoordinates(page: WikiPage, place: Place): boolean {
  if (!page.coordinates?.length) return true; // Exact page ID/title still identifies pages without a coordinate property.
  const coordinates = articleCoordinates(page);
  return !!coordinates && distanceKm(place, coordinates) <= 1;
}

async function query(article: Article, signal: AbortSignal): Promise<WikiPage | null> {
  const params = new URLSearchParams({ action: "query", format: "json", formatversion: "2", origin: "*", redirects: "1",
    prop: "extracts|coordinates|pageprops|langlinks", exintro: "1", explaintext: "1", exsectionformat: "plain",
    ppprop: "disambiguation", colimit: "max", coprimary: "primary", lllimit: "max" });
  if (article.pageId) params.set("pageids", String(article.pageId));
  else params.set("titles", article.title!);
  const response = await fetch(`https://${article.language}.wikipedia.org/w/api.php?${params}`, { signal, credentials: "omit" });
  if (!response.ok) throw new Error(`Wikipedia trả HTTP ${response.status}. Hãy thử lại sau.`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || "error" in body || !("query" in body) || !body.query || typeof body.query !== "object"
    || !("pages" in body.query) || !Array.isArray(body.query.pages)) throw new Error("Wikipedia trả nội dung không hợp lệ. Hãy thử lại.");
  if (body.query.pages.length !== 1) return null;
  const page: unknown = body.query.pages[0];
  if (!page || typeof page !== "object" || "missing" in page || "invalid" in page || !("ns" in page) || page.ns !== 0
    || !("pageid" in page) || !isPageId(page.pageid) || !("title" in page) || !validTitle(page.title)) return null;
  if ("pageprops" in page && page.pageprops && typeof page.pageprops === "object" && "disambiguation" in page.pageprops) return null;
  if ("coordinates" in page && !Array.isArray(page.coordinates)) return null;
  return page as WikiPage;
}

function contentFor(page: WikiPage | null, language: Language): NarrationContent | null {
  const text = page && typeof page.extract === "string" ? sanitizeNarrationText(page.extract) : "";
  return page && text.length >= 20 && /[\p{L}]/u.test(text) ? {
    text, language, title: page.title, source: "wikipedia",
    sourceUrl: `https://${language}.wikipedia.org/?curid=${page.pageid}`,
    licenseUrl: LICENSE,
    attribution: `Wikipedia — ${page.title}. CC BY-SA 4.0; văn bản trích đoạn đã được làm sạch để đọc.`,
  } : null;
}

/** Resolve a shared Wikipedia link after reload without inventing a GPS position. */
export async function fetchWikipediaPlace(id: string, options: Options = {}): Promise<Place | null> {
  if (options.signal?.aborted) throw abortError();
  const match = /^wiki-(vi|en|fr|ja)-(\d+)$/.exec(id);
  if (!match || !isLanguage(match[1]) || !isPageId(Number(match[2]))) return null;
  const language = match[1];
  const pageId = Number(match[2]);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, REQUEST_MS);
  try {
    const page = await query({ language, pageId }, controller.signal);
    if (options.signal?.aborted) throw abortError();
    if (controller.signal.aborted) throw new Error("Wikipedia phản hồi quá 8 giây. Hãy thử lại sau.");
    const coordinates = page ? articleCoordinates(page) : null;
    if (!page || !coordinates) return null;
    const content = contentFor(page, language);
    const description = { vi: "", en: "", fr: "", ja: "" };
    if (content) description[language] = content.text;
    const place: Place = {
      id, title: page.title, ...coordinates, source: "wikipedia",
      sourceUrl: `https://${language}.wikipedia.org/?curid=${page.pageid}`,
      wikipedia: { language, pageId: page.pageid, title: page.title },
      subtitle: { vi: "Wikipedia · Nội dung cộng đồng", en: "Wikipedia · Community content", fr: "Wikipédia · Contenu communautaire", ja: "Wikipedia · コミュニティの内容" },
      description, category: "Khám phá", district: "Wikipedia", image: "", duration: 0, rating: 0,
      narration: content ? { [language]: content } : {},
    };
    const key = JSON.stringify([language, page.pageid, language, place.latitude, place.longitude]);
    cache.set(key, { at: Date.now(), content });
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
    return place;
  } catch (error) {
    if (options.signal?.aborted) throw abortError();
    if (controller.signal.aborted) throw new Error("Wikipedia phản hồi quá 8 giây. Hãy thử lại sau.");
    if (error instanceof TypeError) throw new Error("Không kết nối được Wikipedia. Hãy kiểm tra mạng và thử lại.");
    if (error instanceof SyntaxError) throw new Error("Wikipedia trả nội dung không hợp lệ. Hãy thử lại.");
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}

/** Fetch only the chosen article language; never read Vietnamese with an English/Japanese voice. */
export async function fetchWikipediaContent(place: Place, language: Language, options: Options = {}): Promise<NarrationContent | null> {
  if (options.signal?.aborted) throw abortError();
  if (!isLanguage(language) || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)
    || Math.abs(place.latitude) > 90 || Math.abs(place.longitude) > 180) return null;
  const original = reference(place);
  if (!original) return null;
  const key = JSON.stringify([original.language, original.pageId ?? original.title, language, place.latitude, place.longitude]);
  const hit = cache.get(key);
  if (!options.forceRefresh && hit && Date.now() - hit.at < CACHE_MS) return hit.content;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  // One bounded budget includes redirects/language resolution and response bodies.
  const timer = setTimeout(cancel, REQUEST_MS);
  try {
    let article = original;
    let page = await query(article, controller.signal);
    if (page && !matchesCoordinates(page, place)) page = null;
    if (page && article.language !== language) {
      const link = Array.isArray(page.langlinks) ? page.langlinks.find(item => item && item.lang === language && validTitle(item.title)) : null;
      if (link && validTitle(link.title)) {
        article = { language, title: link.title.trim() };
        page = await query(article, controller.signal);
        if (page && !matchesCoordinates(page, place)) page = null;
      } else page = null;
    }
    if (options.signal?.aborted) throw abortError();
    if (controller.signal.aborted) throw new Error("Wikipedia phản hồi quá 8 giây. Hãy thử lại sau.");
    const content = contentFor(page, language);
    cache.set(key, { at: Date.now(), content });
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
    return content;
  } catch (error) {
    if (options.signal?.aborted) throw abortError();
    if (controller.signal.aborted) throw new Error("Wikipedia phản hồi quá 8 giây. Hãy thử lại sau.");
    if (error instanceof TypeError) throw new Error("Không kết nối được Wikipedia. Hãy kiểm tra mạng và thử lại.");
    if (error instanceof SyntaxError) throw new Error("Wikipedia trả nội dung không hợp lệ. Hãy thử lại.");
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}
