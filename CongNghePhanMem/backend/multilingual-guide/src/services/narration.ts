import type { Language, NarrationContent, Place } from '../data/places';
import { ApiError, getGuideContent } from './api';
import { distanceKm, normalizeSearch } from './nearby';
import { cleanNarrationText, fetchWikipediaContent } from './wikipediaContent';

export const NO_NARRATION = 'Địa danh này chưa có nội dung thuyết minh. Vui lòng thử lại sau.';
export type NarrationOptions = { signal?: AbortSignal; forceRefresh?: boolean; officialPlaces?: Place[] };

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) { const error = new Error('Đã hủy tải thuyết minh.'); error.name = 'AbortError'; throw error; }
}

function officialId(id: string): boolean {
  return /^db-[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id.slice(3)));
}

function permitted(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return row.is_published !== false && row.published !== false && row.is_draft !== true
    && (typeof row.publication_status !== 'string' || ['published', 'approved'].includes(row.publication_status))
    && (typeof row.status !== 'string' || ['published', 'approved', 'saved'].includes(row.status));
}

function meaningful(value: unknown, minimum = 20): string {
  const text = typeof value === 'string' ? cleanNarrationText(value) : '';
  return text.length >= minimum && /[\p{L}]/u.test(text) ? text : '';
}

function cachedWikipedia(value: NarrationContent | undefined, language: Language): NarrationContent | null {
  if (!value || !permitted(value) || value.source !== 'wikipedia' || value.language !== language
    || !value.attribution?.trim() || !value.sourceUrl || !value.licenseUrl) return null;
  try {
    const source = new URL(value.sourceUrl);
    const license = new URL(value.licenseUrl);
    const pageId = Number(source.searchParams.get('curid'));
    const article = (Number.isSafeInteger(pageId) && pageId > 0)
      || (source.pathname.startsWith('/wiki/') && !!decodeURIComponent(source.pathname.slice(6)).trim());
    if (source.protocol !== 'https:' || source.username || source.password || source.port
      || ![`${language}.wikipedia.org`, `${language}.m.wikipedia.org`].includes(source.hostname) || !article
      || license.protocol !== 'https:' || license.hostname !== 'creativecommons.org'
      || license.username || license.password || license.port || !/^\/licenses\/by-sa\/(?:3\.0|4\.0)\/?$/.test(license.pathname)) return null;
    const text = meaningful(value.text);
    return text ? { ...value, text } : null;
  } catch { return null; }
}

function withNotice(content: NarrationContent, notice: string): NarrationContent {
  return { ...content, attribution: [content.attribution, notice].filter(Boolean).join(' ') };
}

/** Resolve only the selected language; metadata placeholders and Admin drafts are never spoken. */
export async function resolveNarration(place: Place, language: Language, options: NarrationOptions = {}): Promise<NarrationContent | null> {
  checkAbort(options.signal);
  const official = officialId(place.id) ? place : options.officialPlaces?.find(candidate =>
    officialId(candidate.id) && normalizeSearch(candidate.title).trim() === normalizeSearch(place.title).trim() && distanceKm(candidate, place) < 0.15);
  let publicationError: unknown;
  if (official) {
    try {
      const guide = await getGuideContent(official.id.slice(3), language, { signal: options.signal });
      checkAbort(options.signal);
      if ((guide.language_code ?? guide.language ?? language) !== language) throw new Error('Máy chủ trả nội dung khác ngôn ngữ đã chọn.');
      const text = permitted(guide) ? meaningful(guide.content) : '';
      if (text) return { text, language, source: 'published', attribution: 'Bài thuyết minh do hệ thống xuất bản.' };
    } catch (error) {
      checkAbort(options.signal);
      // Keep a real source failure visible, while allowing usable independent content to play.
      if (!(error instanceof ApiError) || error.status !== 404) publicationError = error;
    }
  }
  const saved = place.narration?.[language];
  if (saved && permitted(saved) && saved.language === language && ['published', 'saved'].includes(saved.source)) {
    const text = meaningful(saved.text);
    if (text) return publicationError ? withNotice({ ...saved, text },
      'Đang đọc nội dung đã lưu; không cập nhật được bài thuyết minh từ hệ thống. Hãy thử lại sau.') : { ...saved, text };
  }
  // Adapters explicitly mark factual descriptions. Generic metadata or untranslated copies never become a guide.
  const description = saved && permitted(saved) && saved.language === language && saved.source === 'description' ? meaningful(saved.text, 30) : '';
  const cached = cachedWikipedia(saved, language);
  try {
    const wikipedia = await fetchWikipediaContent(place, language, options);
    checkAbort(options.signal);
    if (wikipedia && wikipedia.language !== language) throw new Error('Wikipedia trả nội dung khác ngôn ngữ đã chọn.');
    if (wikipedia && permitted(wikipedia)) {
      const text = meaningful(wikipedia.text);
      if (text) return publicationError ? withNotice({ ...wikipedia, text },
        'Không cập nhật được bài thuyết minh hệ thống; đang đọc nội dung Wikipedia. Hãy thử lại sau.') : { ...wikipedia, text };
    }
  } catch (error) {
    checkAbort(options.signal);
    if (cached) return withNotice(cached,
      'Đang đọc nội dung Wikipedia đã lưu; chưa cập nhật được bài viết. Hãy thử lại khi có kết nối.');
    if (!description) throw publicationError ?? error;
    return { ...saved!, text: description, attribution: [saved?.attribution,
      'Đang đọc mô tả ngắn; không tải được nội dung Wikipedia. Bạn có thể thử lại sau.'].filter(Boolean).join(' ') };
  }
  if (description) return publicationError ? withNotice({ ...saved!, text: description },
    'Không cập nhật được bài thuyết minh hệ thống; đang đọc mô tả ngắn. Hãy thử lại sau.') : { ...saved!, text: description };
  if (publicationError) throw publicationError;
  return null;
}
