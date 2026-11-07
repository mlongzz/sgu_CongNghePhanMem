import type { Language } from '../data/places';

export function selectPhotoStory(stories: Partial<Record<Language, string>> | null | undefined, language: Language): {
  text: string; language: Language; fallback: boolean;
} | null {
  const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
  const requested = text(stories?.[language]);
  if (requested) return { text: requested, language, fallback: false };
  const vietnamese = text(stories?.vi);
  return vietnamese ? { text: vietnamese, language: 'vi', fallback: language !== 'vi' } : null;
}
