import type { Coordinates } from '../services/nearby';

/**
 * Former District 1 (Quận 1), Ho Chi Minh City: OpenStreetMap relation 2587287
 * (© OpenStreetMap contributors, ODbL), simplified from 268 to 47 vertices (~13 m tolerance).
 * Vertices are [latitude, longitude].
 */
export const DISTRICT1_POLYGON: readonly [number, number][] = [
  [10.76543, 106.68169], [10.75598, 106.68546], [10.75352, 106.68727], [10.7576, 106.69161],
  [10.75922, 106.69449], [10.76037, 106.69591], [10.7633, 106.69822], [10.76535, 106.70121],
  [10.76803, 106.70357], [10.76892, 106.70563], [10.76976, 106.7083], [10.77224, 106.70801],
  [10.77518, 106.70814], [10.77729, 106.70854], [10.77934, 106.70926], [10.78151, 106.71038],
  [10.78276, 106.71136], [10.78428, 106.71319], [10.78534, 106.7152], [10.78667, 106.71403],
  [10.78748, 106.71284], [10.78771, 106.71188], [10.78751, 106.70944], [10.78775, 106.70873],
  [10.789, 106.70762], [10.79136, 106.70672], [10.79212, 106.70555], [10.79278, 106.70321],
  [10.79353, 106.69942], [10.79366, 106.69732], [10.79345, 106.69502], [10.79374, 106.6946],
  [10.7949, 106.69436], [10.79488, 106.69261], [10.79578, 106.69096], [10.79559, 106.68915],
  [10.79486, 106.68739], [10.79513, 106.68694], [10.79674, 106.68612], [10.79693, 106.68578],
  [10.79687, 106.68527], [10.79617, 106.68486], [10.79462, 106.68507], [10.79411, 106.68534],
  [10.7932, 106.68635], [10.79251, 106.68615], [10.78288, 106.69813],
];

export const DISTRICT1_NAME = 'Quận 1, TP.HCM';
/** Centre of the district's bounding box; a 3 km radius from here covers the whole district. */
export const DISTRICT1_CENTER: Coordinates = { latitude: 10.77523, longitude: 106.69844 };
export const DISTRICT1_RADII = [1, 2, 3];
export const DISTRICT1_MAX_RADIUS_KM = 3;

/** Ray-casting point-in-polygon test. */
export function isInDistrict1(point: Pick<Coordinates, 'latitude' | 'longitude'> | null | undefined): boolean {
  if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return false;
  const { latitude: y, longitude: x } = point;
  let inside = false;
  for (let i = 0, j = DISTRICT1_POLYGON.length - 1; i < DISTRICT1_POLYGON.length; j = i++) {
    const [yi, xi] = DISTRICT1_POLYGON[i], [yj, xj] = DISTRICT1_POLYGON[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
