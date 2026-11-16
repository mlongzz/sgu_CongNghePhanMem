export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
// Independent host for the public, non-commercial guide when the main OSM host is unreachable.
export const HOT_TILES = 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png';
export const HOT_ATTRIBUTION = OSM_ATTRIBUTION + ' · Tiles <a href="https://www.hotosm.org/">HOT</a>, hosted by <a href="https://www.openstreetmap.fr/">OpenStreetMap France</a>';
export function mapTiles(key?: string, style?: string) {
  const validKey = key?.trim();
  const enabled = !!validKey && /^[a-zA-Z0-9_-]{8,128}$/.test(validKey) && !/^(YOUR|REPLACE|EXAMPLE)/i.test(validKey);
  const mapStyle = style && /^[a-z0-9_-]{1,64}$/.test(style) ? style : 'streets-v4';
  return enabled ? {
    provider: 'maptiler' as const,
    url: `https://api.maptiler.com/maps/${mapStyle}/256/{z}/{x}/{y}.png?key=${encodeURIComponent(validKey)}`,
    attribution: '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> ' + OSM_ATTRIBUTION,
  } : {provider: 'osm' as const, url: OSM_TILES, attribution: OSM_ATTRIBUTION};
}

export function mapTileSources(key?: string, style?: string) {
  const primary = mapTiles(key, style);
  return [primary, ...(primary.provider === 'maptiler' ? [mapTiles()] : []),
    { provider: 'hot' as const, url: HOT_TILES, attribution: HOT_ATTRIBUTION }];
}
