import type { Place } from "../data/places";
export type ProviderPhoto = Pick<
  Place,
  "image" | "imageSourceUrl" | "imageAttribution" | "imageLicense"
>;
const cache = new Map<string, { at: number; photo: ProviderPhoto | null }>();
const clean = (value: unknown) =>
  typeof value === "string"
    ? value
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .trim()
        .slice(0, 500)
    : "";
const fileKey = (value: string) =>
  value
    .replace(/^File:/i, "")
    .replace(/_/g, " ")
    .normalize("NFC")
    .trim();
async function query(
  endpoint: string,
  params: Record<string, string>,
  signal?: AbortSignal,
) {
  const controller = new AbortController(),
    cancel = () => controller.abort();
  if (signal?.aborted) throw new Error("Cancelled");
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, 6000);
  try {
    const response = await fetch(
      `${endpoint}?${new URLSearchParams({ action: "query", format: "json", formatversion: "2", origin: "*", ...params })}`,
      { credentials: "omit", signal: controller.signal },
    );
    if (!response.ok) throw new Error("Image metadata unavailable");
    const raw = await response.text();
    if (raw.length > 1_000_000) throw new Error("Image metadata too large");
    const result = JSON.parse(raw);
    if (result.error || !Array.isArray(result.query?.pages))
      throw new Error("Invalid image metadata");
    return result.query.pages as Record<string, unknown>[];
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

type CommonsInfo = {
  thumburl?: unknown;
  url?: unknown;
  mime?: unknown;
  extmetadata?: Record<string, { value?: unknown }>;
};

/** Accept only an https Wikimedia Commons bitmap with a named author and a free licence. */
function photoFromInfo(info: CommonsInfo | undefined, filename: string): ProviderPhoto | null {
  if (!info) return null;
  const license = clean(info.extmetadata?.LicenseShortName?.value),
    author = clean(info.extmetadata?.Artist?.value);
  const value =
    typeof info.thumburl === "string"
      ? info.thumburl
      : typeof info.url === "string"
        ? info.url
        : "";
  let safe = false;
  try {
    const url = new URL(value);
    safe =
      url.protocol === "https:" &&
      ["upload.wikimedia.org", "thumb.wikimedia.org"].includes(url.hostname) &&
      !url.port &&
      !url.username && !url.password && !url.hash &&
      url.pathname.startsWith("/wikipedia/commons/");
  } catch {}
  if (
    !safe ||
    !(info.mime === undefined || ["image/jpeg", "image/png", "image/webp"].includes(String(info.mime))) ||
    !author ||
    !/^(CC BY(?:-SA)?(?: [1234](?:\.\d)?)?|CC0(?: 1\.0)?|Public domain)$/i.test(license)
  )
    return null;
  return {
    image: value,
    imageAttribution: author,
    imageLicense: license,
    imageSourceUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(filename.replace(/ /g, "_"))}`,
  };
}

const COMMONS = "https://commons.wikimedia.org/w/api.php";
// Maps, logos, flags and diagrams are not photographs of the place.
const NOT_A_PHOTO = /(\bmap\b|locator|location|ban do|bản đồ|sơ đồ|so do|diagram|logo|flag|\bcờ\b|coat of arms|huy hiệu|seal|icon|symbol|\.svg$|\.gif$|\.tiff?$)/i;
const usableFile = (name: string) => name.length <= 512 && !/[\x00-\x1f|]/.test(name) && !NOT_A_PHOTO.test(name);

/** Licence metadata for exact Commons filenames (max 50 per request). */
async function commonsPhotos(names: string[], signal?: AbortSignal): Promise<Map<string, ProviderPhoto>> {
  const found = new Map<string, ProviderPhoto>();
  for (let i = 0; i < names.length; i += 50) {
    const batch = names.slice(i, i + 50);
    const pages = await query(COMMONS, { titles: batch.map((name) => "File:" + name).join("|"), prop: "imageinfo", iiprop: "url|extmetadata|mime", iiurlwidth: "640" }, signal);
    for (const name of batch) {
      const page = pages.find((row) => typeof row.title === "string" && fileKey(row.title) === name);
      const photo = photoFromInfo((page?.imageinfo as CommonsInfo[] | undefined)?.[0], name);
      if (photo) found.set(name, photo);
    }
  }
  return found;
}

/** Wikidata "image" (P18) is a curated Commons photo of the item itself. */
async function wikidataImages(ids: string[], signal?: AbortSignal): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const controller = new AbortController(),
    cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, 6000);
  try {
    for (let i = 0; i < ids.length; i += 50) {
      const params = new URLSearchParams({ action: "wbgetentities", format: "json", origin: "*", props: "claims", ids: ids.slice(i, i + 50).join("|") });
      const response = await fetch(`https://www.wikidata.org/w/api.php?${params}`, { credentials: "omit", signal: controller.signal });
      if (!response.ok) break;
      const raw = await response.text();
      if (raw.length > 4_000_000) break;
      const entities = (JSON.parse(raw)?.entities ?? {}) as Record<string, { claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]> }>;
      for (const [id, entity] of Object.entries(entities)) {
        const value = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
        if (typeof value === "string" && usableFile(fileKey(value))) files.set(id, fileKey(value));
      }
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
  return files;
}

/** Last resort: the best-ranked free photo on Wikimedia Commons for the place name. */
async function commonsSearchPhoto(title: string, signal?: AbortSignal): Promise<ProviderPhoto | null> {
  const term = title.replace(/\s*\([^)]*\)\s*/g, " ").replace(/,.*$/, "").trim();
  if (term.length < 3) return null;
  const pages = await query(COMMONS, { generator: "search", gsrnamespace: "6", gsrsearch: `${term} filetype:bitmap`, gsrlimit: "6", prop: "imageinfo", iiprop: "url|extmetadata|mime", iiurlwidth: "640" }, signal);
  const ranked = [...pages].sort((a, b) => Number(a.index ?? 99) - Number(b.index ?? 99));
  for (const page of ranked) {
    if (typeof page.title !== "string") continue;
    const name = fileKey(page.title);
    if (!usableFile(name)) continue;
    const photo = photoFromInfo((page.imageinfo as CommonsInfo[] | undefined)?.[0], name);
    if (photo) return photo;
  }
  return null;
}

export type PhotoOptions = { limit?: number; fallback?: boolean };

/**
 * Article pageimage -> exact Commons file -> free license/author.
 * With `fallback`, an article without a usable lead image also tries its Wikidata P18 image,
 * then the best free Commons search result for the place name. Every photo keeps author/licence.
 */
export async function fetchWikipediaPhotos(
  places: readonly Place[],
  signal?: AbortSignal,
  options: PhotoOptions = {},
): Promise<Record<string, ProviderPhoto>> {
  const photos: Record<string, ProviderPhoto> = {};
  const fallback = options.fallback === true;
  const cacheKey = (language: string, place: Place) => `${language}:${place.wikipedia!.pageId}${fallback ? ":f" : ""}`;
  const candidates = places
    .filter(
      (p) =>
        p.source === "wikipedia" &&
        p.wikipedia?.pageId &&
        ["vi", "en", "fr", "ja"].includes(p.wikipedia.language),
    )
    .slice(0, Math.min(50, options.limit ?? 20));
  for (const language of ["vi", "en", "fr", "ja"]) {
    const rows = candidates.filter((p) => p.wikipedia!.language === language);
    const missing = rows.filter((p) => {
      const saved = cache.get(cacheKey(language, p));
      if (saved && Date.now() - saved.at < 6 * 3600_000) {
        if (saved.photo) photos[p.id] = saved.photo;
        return false;
      }
      return true;
    });
    if (!missing.length) continue;
    try {
      const pages = await query(
        `https://${language}.wikipedia.org/w/api.php`,
        {
          pageids: missing.map((p) => p.wikipedia!.pageId).join("|"),
          prop: fallback ? "pageimages|pageprops" : "pageimages",
          piprop: "name",
          ...(fallback ? { ppprop: "wikibase_item" } : {}),
        },
        signal,
      );
      const files = new Map<string, string>();
      const wikidata = new Map<string, string>();
      for (const page of pages) {
        const place = missing.find((p) => p.wikipedia!.pageId === page.pageid);
        if (!place || page.ns !== 0) continue;
        if (
          typeof page.pageimage === "string" &&
          page.pageimage.length <= 512 &&
          !/[\x00-\x1f|]/.test(page.pageimage)
        )
          files.set(place.id, fileKey(page.pageimage));
        const item = (page.pageprops as { wikibase_item?: unknown } | undefined)?.wikibase_item;
        if (typeof item === "string" && /^Q\d+$/.test(item)) wikidata.set(place.id, item);
      }
      const names = [...new Set(files.values())];
      const exact = names.length ? await commonsPhotos(names, signal) : new Map<string, ProviderPhoto>();
      const found = new Map<string, ProviderPhoto>();
      for (const place of missing) {
        const photo = exact.get(files.get(place.id) ?? "");
        if (photo) found.set(place.id, photo);
      }
      if (fallback) {
        try {
          const needP18 = missing.filter((p) => !found.has(p.id) && wikidata.has(p.id));
          if (needP18.length) {
            const p18 = await wikidataImages([...new Set(needP18.map((p) => wikidata.get(p.id)!))], signal);
            const p18Names = [...new Set(needP18.map((p) => p18.get(wikidata.get(p.id)!)).filter((n): n is string => !!n))];
            const p18Photos = p18Names.length ? await commonsPhotos(p18Names, signal) : new Map<string, ProviderPhoto>();
            for (const place of needP18) {
              const photo = p18Photos.get(p18.get(wikidata.get(place.id)!) ?? "");
              if (photo) found.set(place.id, photo);
            }
          }
        } catch { /* Wikidata is optional; continue with Commons search. */ }
        const needSearch = missing.filter((p) => !found.has(p.id)).slice(0, 15);
        const searched = await Promise.all(needSearch.map((p) => commonsSearchPhoto(p.wikipedia?.title || p.title, signal).catch(() => null)));
        needSearch.forEach((place, index) => { const photo = searched[index]; if (photo) found.set(place.id, photo); });
      }
      if (signal?.aborted) return {};
      for (const place of missing) {
        const photo = found.get(place.id) ?? null;
        cache.set(cacheKey(language, place), { at: Date.now(), photo });
        if (photo) photos[place.id] = photo;
      }
      while (cache.size > 400) cache.delete(cache.keys().next().value!);
    } catch {
      /* Keep POI/GPS and their honest image placeholders available. */
    }
  }
  return signal?.aborted ? {} : photos;
}
