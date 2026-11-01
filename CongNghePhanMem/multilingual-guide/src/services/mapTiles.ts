export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
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
