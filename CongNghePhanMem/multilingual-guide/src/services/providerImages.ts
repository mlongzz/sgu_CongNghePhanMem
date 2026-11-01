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
/** Article pageimage -> exact Commons file -> free license/author. Never guesses a photograph. */
export async function fetchWikipediaPhotos(
  places: readonly Place[],
  signal?: AbortSignal,
): Promise<Record<string, ProviderPhoto>> {
  const photos: Record<string, ProviderPhoto> = {};
  const candidates = places
    .filter(
      (p) =>
        p.source === "wikipedia" &&
        p.wikipedia?.pageId &&
        ["vi", "en", "fr", "ja"].includes(p.wikipedia.language),
    )
    .slice(0, 20);
  for (const language of ["vi", "en", "fr", "ja"]) {
    const rows = candidates.filter((p) => p.wikipedia!.language === language);
    const missing = rows.filter((p) => {
      const saved = cache.get(`${language}:${p.wikipedia!.pageId}`);
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
          prop: "pageimages",
          piprop: "name",
        },
        signal,
      );
      const files = new Map<string, string>();
      for (const page of pages) {
        const place = missing.find((p) => p.wikipedia!.pageId === page.pageid);
        if (
          place &&
          page.ns === 0 &&
          typeof page.pageimage === "string" &&
          page.pageimage.length <= 512 &&
          !/[\x00-\x1f|]/.test(page.pageimage)
        )
          files.set(place.id, fileKey(page.pageimage));
      }
      const names = [...new Set(files.values())];
      const commons = names.length
        ? await query(
            "https://commons.wikimedia.org/w/api.php",
            {
              titles: names.map((name) => "File:" + name).join("|"),
              prop: "imageinfo",
              iiprop: "url|extmetadata|mime",
              iiurlwidth: "640",
            },
            signal,
          )
        : [];
      for (const place of missing) {
        let photo: ProviderPhoto | null = null;
        const filename = files.get(place.id);
        const page = commons.find(
          (row) =>
            typeof row.title === "string" && fileKey(row.title) === filename,
        );
        const info = (
          page?.imageinfo as
            | {
                thumburl?: unknown;
                url?: unknown;
                mime?: unknown;
                extmetadata?: Record<string, { value?: unknown }>;
              }[]
            | undefined
        )?.[0];
        if (info) {
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
            safe &&
            (info.mime === undefined || ["image/jpeg","image/png","image/webp"].includes(String(info.mime))) &&
            author &&
            /^(CC BY(?:-SA)?(?: [1234](?:\.\d)?)?|CC0(?: 1\.0)?|Public domain)$/i.test(
              license,
            )
          )
            photo = {
              image: value,
              imageAttribution: author,
              imageLicense: license,
              imageSourceUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(filename!.replace(/ /g, "_"))}`,
            };
        }
        if (signal?.aborted) return {};
        cache.set(`${language}:${place.wikipedia!.pageId}`, {
          at: Date.now(),
          photo,
        });
        if (photo) photos[place.id] = photo;
      }
      while (cache.size > 400) cache.delete(cache.keys().next().value!);
    } catch {
      /* Keep POI/GPS and their honest image placeholders available. */
    }
  }
  return signal?.aborted ? {} : photos;
}
