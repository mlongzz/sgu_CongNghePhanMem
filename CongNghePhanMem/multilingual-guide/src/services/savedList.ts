import type { Place } from '../data/places';

type SearchablePlace = Pick<Place, 'title' | 'district' | 'category'>;

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
