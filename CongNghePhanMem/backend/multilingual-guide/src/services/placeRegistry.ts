import type { Category, Language, NarrationContent, Place, Translated } from '../data/places';

const LANGUAGES: readonly Language[] = ['vi', 'en', 'fr', 'ja'];
const CATEGORIES: readonly Category[] = ['Lịch sử', 'Kiến trúc', 'Văn hóa', 'Khám phá'];
const MAX_PLACES = 20;
const MAX_CANDIDATES = 200;
const MAX_CACHE_LENGTH = 2 * 1024 * 1024;
const language = (value: unknown): value is Language => LANGUAGES.includes(value as Language);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positiveId = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value > 0;
const text = (value: unknown, max: number, nonempty = false): value is string => typeof value === 'string'
  && value.length <= max && (!nonempty || !!value.trim()) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);

function translated(value: unknown, max: number): Translated | null {
  if (!record(value) || !LANGUAGES.every(key => text(value[key], max))) return null;
  return { vi: value.vi as string, en: value.en as string, fr: value.fr as string, ja: value.ja as string };
}

function httpsUrl(value: unknown): string | undefined {
  if (!text(value, 2048, true) || /[\s\\]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url.href : undefined;
  } catch { return undefined; }
}

function wikipediaUrl(value: unknown): string | undefined {
  const safe = httpsUrl(value);
  if (!safe) return undefined;
  const url = new URL(safe);
  if (!/^(vi|en|fr|ja)(?:\.m)?\.wikipedia\.org$/.test(url.hostname)) return undefined;
  const pageId = url.searchParams.get('curid');
  if (pageId && /^[1-9]\d*$/.test(pageId) && positiveId(Number(pageId))) return safe;
  let title: string | null = null;
  try {
    title = url.pathname.startsWith('/wiki/') ? decodeURIComponent(url.pathname.slice(6)).replace(/_/g, ' ')
      : url.pathname === '/w/index.php' ? url.searchParams.get('title') : null;
  } catch { return undefined; }
  return text(title, 512, true) && !/[|\u0000-\u001f]/.test(title) ? safe : undefined;
}

function identity(id: unknown): { source: Place['source']; wiki?: { language: Language; pageId: number } } | null {
  if (typeof id !== 'string' || id.length > 64) return null;
  const match = /^(?:db-([1-9]\d*)|wiki-(vi|en|fr|ja)-([1-9]\d*)|osm-(node|way|relation)-([1-9]\d*)|wikidata-Q([1-9]\d*))$/.exec(id);
  if (!match || !positiveId(Number(match[1] ?? match[3] ?? match[5] ?? match[6]))) return null;
  if (match[1]) return { source: 'backend' };
  if (match[2] && language(match[2])) return { source: 'wikipedia', wiki: { language: match[2], pageId: Number(match[3]) } };
  return { source: match[4] ? 'osm' : 'wikidata' };
}

function validate(value: unknown): Place | null {
  if (!record(value)) return null;
  const id = identity(value.id);
  if (!id || (value.source !== undefined && value.source !== id.source)
    || !text(value.title, 512, true) || /[\r\n\t]/.test(value.title)
    || !finite(value.latitude) || Math.abs(value.latitude) > 90
    || !finite(value.longitude) || Math.abs(value.longitude) > 180
    || !text(value.district, 512) || !CATEGORIES.includes(value.category as Category)
    || !finite(value.duration) || value.duration < 0 || value.duration > 24 * 60
    || !finite(value.rating) || value.rating < 0 || value.rating > 5
    || !text(value.image, 2048)) return null;
  const subtitle = translated(value.subtitle, 2000);
  const description = translated(value.description, 20_000);
  if (!subtitle || !description) return null;
  const image = value.image;
  if (image && !httpsUrl(image) && !(/^\/(?!\/)/.test(image) && !/[\s\\]/.test(image))) return null;
  const place: Place = {
    id: value.id as string, title: value.title.trim(), subtitle, description,
    latitude: value.latitude, longitude: value.longitude, image,
    district: value.district.trim(), category: value.category as Category,
    duration: value.duration, rating: value.rating, source: id.source,
  };
  const sourceUrl = httpsUrl(value.sourceUrl);
  if (sourceUrl) {
    const url = new URL(sourceUrl);
    const sourceMatches = id.source === 'backend'
      || (id.source === 'osm' && /^(www\.)?openstreetmap\.org$/.test(url.hostname) && url.pathname === `/${place.id.slice(4).replace('-', '/')}`)
      || (id.source === 'wikidata' && /^(www\.)?wikidata\.org$/.test(url.hostname) && url.pathname === `/wiki/${place.id.slice(9)}`)
      || (id.wiki && wikipediaUrl(sourceUrl) && url.hostname.startsWith(`${id.wiki.language}.`)
        && (!url.searchParams.has('curid') || Number(url.searchParams.get('curid')) === id.wiki.pageId));
    if (sourceMatches) place.sourceUrl = sourceUrl;
  }
  const linkedArticle = wikipediaUrl(value.wikipediaUrl);
  if (linkedArticle) place.wikipediaUrl = linkedArticle;
  if (id.wiki) {
    // A local entry cannot override the language/page ID encoded in its stable ID.
    place.wikipedia = { ...id.wiki };
    if (record(value.wikipedia) && text(value.wikipedia.title, 512, true) && !/[|\u0000-\u001f]/.test(value.wikipedia.title)
      && value.wikipedia.language === id.wiki.language && (value.wikipedia.pageId === undefined || value.wikipedia.pageId === id.wiki.pageId)) {
      place.wikipedia.title = value.wikipedia.title.trim();
    }
  } else if (record(value.wikipedia) && language(value.wikipedia.language)) {
    const reference: NonNullable<Place['wikipedia']> = { language: value.wikipedia.language };
    if (positiveId(value.wikipedia.pageId)) reference.pageId = value.wikipedia.pageId;
    if (text(value.wikipedia.title, 512, true) && !/[|\u0000-\u001f]/.test(value.wikipedia.title)) reference.title = value.wikipedia.title.trim();
    if (reference.pageId || reference.title) place.wikipedia = reference;
  }
  if (record(value.narration)) {
    const narration: NonNullable<Place['narration']> = {};
    for (const key of LANGUAGES) {
      const raw = value.narration[key];
      // Local storage does not establish Admin publication or permission for saved translations.
      if (!record(raw) || !['description', 'wikipedia'].includes(String(raw.source)) || raw.language !== key || !text(raw.text, 20_000, true)) continue;
      const content: NarrationContent = { text: raw.text.trim(), language: key, source: raw.source as 'description' | 'wikipedia' };
      if (text(raw.title, 512, true)) content.title = raw.title.trim();
      if (text(raw.attribution, 2000, true)) content.attribution = raw.attribution.trim();
      const contentUrl = raw.source === 'wikipedia' ? wikipediaUrl(raw.sourceUrl) : httpsUrl(raw.sourceUrl);
      const licenseUrl = httpsUrl(raw.licenseUrl);
      if (contentUrl) content.sourceUrl = contentUrl;
      if (licenseUrl) content.licenseUrl = licenseUrl;
      // Wikipedia excerpts must retain a real article link and attribution when persisted.
      if (raw.source === 'wikipedia' && (!content.sourceUrl || !content.attribution || !content.licenseUrl
        || new URL(content.sourceUrl).hostname.split('.')[0] !== key)) continue;
      narration[key] = content;
    }
    if (Object.keys(narration).length) place.narration = narration;
  }
  return place;
}

/** Treat both persisted selections and adapter data as untrusted before rendering details. */
export function validateDiscoveredPlace(value: unknown): Place | null {
  try { return validate(value); } catch { return null; }
}

function validatedList(rows: readonly unknown[]): Place[] {
  const places = new Map<string, Place>();
  for (const row of rows.slice(-MAX_CANDIDATES)) {
    const place = validateDiscoveredPlace(row);
    if (!place) continue;
    places.delete(place.id);
    places.set(place.id, place);
  }
  return [...places.values()].slice(-MAX_PLACES);
}

/** Malformed storage never propagates into map/detail render state. */
export function parseDiscoveredPlaces(raw: string | null): Place[] {
  if (typeof raw !== 'string' || raw.length > MAX_CACHE_LENGTH) return [];
  try {
    const rows: unknown = JSON.parse(raw);
    return Array.isArray(rows) ? validatedList(rows) : [];
  } catch { return []; }
}

/** Keep only validated, bounded selections; never persist publication claims or unknown fields. */
export function serializeDiscoveredPlaces(rows: readonly unknown[]): string {
  const places = validatedList(rows);
  let serialized = JSON.stringify(places);
  while (serialized.length > MAX_CACHE_LENGTH && places.length) {
    places.shift();
    serialized = JSON.stringify(places);
  }
  return serialized;
}
