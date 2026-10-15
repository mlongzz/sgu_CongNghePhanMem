import type { Place } from '../data/places';

type SearchablePlace = Pick<Place, 'title' | 'district' | 'category'>;
export type SavedSort = 'saved' | 'name-asc' | 'name-desc';

export function normalizeSavedSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLocaleLowerCase('vi').trim();
}

export function filterSavedPlaces<T extends SearchablePlace>(places: T[], query: string): T[] {
  const terms = normalizeSavedSearch(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return places;
  return places.filter(place => {
    const text = normalizeSavedSearch(`${place.title} ${place.district} ${place.category}`);
    return terms.every(term => text.includes(term));
  });
}

export function sortSavedPlaces<T extends Pick<Place, 'title'>>(places: T[], order: SavedSort, language = 'vi'): T[] {
  if (order === 'saved') return places;
  const collator = new Intl.Collator(language, { sensitivity: 'base', numeric: true });
  const direction = order === 'name-asc' ? 1 : -1;
  return places.slice().sort((a, b) => direction * collator.compare(a.title, b.title));
}
