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
    && (typeof row.status !== 'string' || ['published', 'approved', 'saved'].includes(row.status));
}

function meaningful(value: unknown, minimum = 20): string {
  const text = typeof value === 'string' ? cleanNarrationText(value) : '';
  return text.length >= minimum && /[\p{L}]/u.test(text) ? text : '';
}

/** Resolve only the selected language; metadata placeholders and Admin drafts are never spoken. */
export async function resolveNarration(place: Place, language: Language, options: NarrationOptions = {}): Promise<NarrationContent | null> {
  checkAbort(options.signal);
  const official = officialId(place.id) ? place : options.officialPlaces?.find(candidate =>
    officialId(candidate.id) && normalizeSearch(candidate.title).trim() === normalizeSearch(place.title).trim() && distanceKm(candidate, place) < 0.15);
  if (official) {
    try {
      const guide = await getGuideContent(official.id.slice(3), language, { signal: options.signal });
      checkAbort(options.signal);
      if ((guide.language_code ?? guide.language ?? language) !== language) throw new Error('Máy chủ trả nội dung khác ngôn ngữ đã chọn.');
      const text = permitted(guide) ? meaningful(guide.content) : '';
      if (text) return { text, language, source: 'published', attribution: 'Bài thuyết minh do hệ thống xuất bản.' };
    } catch (error) {
      checkAbort(options.signal);
      // A missing translation can fall through. Network/server errors stay visible rather than being disguised as missing content.
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
    }
  }
  const saved = place.narration?.[language];
  if (saved && permitted(saved) && saved.language === language && ['published', 'saved'].includes(saved.source)) {
    const text = meaningful(saved.text);
    if (text) return { ...saved, text };
  }
  // Adapters explicitly mark factual descriptions. Generic metadata or untranslated copies never become a guide.
  const description = saved && permitted(saved) && saved.language === language && saved.source === 'description' ? meaningful(saved.text, 30) : '';
  try {
    const wikipedia = await fetchWikipediaContent(place, language, options);
    checkAbort(options.signal);
    if (wikipedia && wikipedia.language !== language) throw new Error('Wikipedia trả nội dung khác ngôn ngữ đã chọn.');
    if (wikipedia && permitted(wikipedia)) {
      const text = meaningful(wikipedia.text);
      if (text) return { ...wikipedia, text };
    }
  } catch (error) {
    checkAbort(options.signal);
    if (!description) throw error;
    return { ...saved!, text: description, attribution: [saved?.attribution,
      'Đang đọc mô tả ngắn; không tải được nội dung Wikipedia. Bạn có thể thử lại sau.'].filter(Boolean).join(' ') };
  }
  if (description) return { ...saved!, text: description };
  return null;
}
