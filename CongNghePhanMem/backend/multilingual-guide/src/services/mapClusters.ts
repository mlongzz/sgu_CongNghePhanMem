import type { Place } from '../data/places';

export type MapPlaceGroup = { latitude: number; longitude: number; places: Place[] };
/** Grid aggregation is only a view; list entries and nearby/AutoGuide candidates stay intact. */
export function clusterMapPlaces(places: Place[], zoom: number, selectedId: string | null = null): MapPlaceGroup[] {
  const groups = new Map<string, MapPlaceGroup>();
  const cluster = places.length > 40 && zoom < 16;
  const size = 256 * 2 ** Math.max(0, Math.min(20, zoom));
  for (const place of places) {
    if (!Number.isFinite(place.latitude) || Math.abs(place.latitude) > 90 || !Number.isFinite(place.longitude) || Math.abs(place.longitude) > 180) continue;
    const lat = Math.max(-85.0511, Math.min(85.0511, place.latitude)) * Math.PI / 180;
    const x = (place.longitude + 180) / 360 * size;
    const y = (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * size;
    const key = cluster && place.id !== selectedId ? `${Math.floor(x / 54)}:${Math.floor(y / 54)}` : place.id;
    const group = groups.get(key);
    if (group) {
      const count = group.places.length;
      group.latitude = (group.latitude * count + place.latitude) / (count + 1);
      group.longitude = (group.longitude * count + place.longitude) / (count + 1);
      group.places.push(place);
    } else groups.set(key, { latitude: place.latitude, longitude: place.longitude, places: [place] });
  }
  return [...groups.values()];
}
