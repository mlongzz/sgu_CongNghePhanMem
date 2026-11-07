const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(path, dependencies = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: name => dependencies[name] ?? {} });
  return exports;
}
const nearby = load('src/services/nearby.ts');
const { mergeNearbyPlaces } = load('src/services/nearbyMerge.ts', { './nearby': nearby });
const origin = { latitude: 10, longitude: 106 };
const place = (id, latitude, source = 'backend', title = id) => ({ id, title, latitude, longitude: origin.longitude, source });

test('native radius changes actually filter the selected/listed landmarks and preserve nearest order', () => {
  const data = [place('db-far', 10.025), place('db-near', 10.002), place('db-mid', 10.01)];
  assert.deepEqual(Array.from(mergeNearbyPlaces([data], origin, 1), p => p.id), ['db-near']);
  assert.deepEqual(Array.from(mergeNearbyPlaces([data], origin, 5), p => p.id), ['db-near', 'db-mid', 'db-far']);
  assert.deepEqual(data.map(p => p.id), ['db-far', 'db-near', 'db-mid']);
});

test('source merging preserves the official record and drops duplicate community identities nearby', () => {
  const official = place('db-1', 10.002, 'backend', 'Chợ Bình Tây');
  const wiki = place('wiki-vi-3', 10.0021, 'wikipedia', 'Cho Binh Tay');
  const osm = place('osm-node-4', 10.005, 'osm', 'Công viên');
  const result = mergeNearbyPlaces([[official], [osm, osm], [wiki]], origin, 3);
  assert.deepEqual(Array.from(result, p => p.id), ['db-1', 'osm-node-4']);
  assert.equal(result[0], official); assert.equal(official.source, 'backend'); assert.equal(wiki.source, 'wikipedia');
});

test('one unavailable source does not remove PostgreSQL or another community provider', () => {
  const official = place('db-1', 10.002); const wiki = place('wiki-vi-2', 10.003, 'wikipedia');
  assert.deepEqual(Array.from(mergeNearbyPlaces([[official], [], [wiki]], origin, 3), p => p.id), ['db-1', 'wiki-vi-2']);
});

test('same-name proximity does not assign a Wikipedia identity to an official landmark lacking verified provenance', () => {
  const official = place('db-1', 10.002, 'backend', 'Chợ Bình Tây');
  const wiki = { ...place('wiki-vi-3', 10.0021, 'wikipedia', 'Cho Binh Tay'), wikipedia: { language: 'vi', pageId: 3 } };
  const result = mergeNearbyPlaces([[official], [wiki]], origin, 3);
  assert.equal(result.length, 1); assert.equal(result[0].id, 'db-1'); assert.equal(result[0].source, 'backend');
  assert.equal(result[0].wikipedia, undefined);
  assert.equal(official.wikipedia, undefined);
});

test('invalid provider coordinates are excluded before native map markers are built', () => {
  const invalid = [place('bad-nan', NaN), place('bad-range', 91), { ...place('bad-lon', 10), longitude: 181 }];
  assert.deepEqual(Array.from(mergeNearbyPlaces([invalid, [place('db-valid', 10.002)]], origin, 3), p => p.id), ['db-valid']);
});

test('similarly named landmarks far apart and distinct nearby landmarks retain their own IDs', () => {
  const groups = [[place('db-1', 10.002, 'backend', 'Chùa')], [place('wiki-vi-2', 10.02, 'wikipedia', 'Chùa'), place('osm-node-3', 10.002, 'osm', 'Bảo tàng')]];
  assert.equal(mergeNearbyPlaces(groups, origin, 5).length, 3);
});

test('official landmarks absorb Wikipedia entries for the same building under a different name', () => {
  const at = (id, title, latitude, longitude, source = 'wikipedia', extra = {}) => ({ id, title, latitude, longitude, source, ...extra });
  const center = { latitude: 10.7752, longitude: 106.6984 };
  const official = [
    at('db-33', 'Nhà thờ Đức Bà Sài Gòn', 10.779722, 106.699167, 'backend'),
    at('db-9', 'Bưu điện Trung tâm Sài Gòn', 10.7799, 106.7000, 'backend'),
    at('db-19', 'Tòa tháp Bitexco Financial', 10.771667, 106.704444, 'backend'),
    at('db-38', 'Đền Bà Mariamman', 10.7723, 106.6956, 'backend'),
    at('db-25', 'Nhà hát Thành phố Hồ Chí Minh', 10.776752, 106.703282, 'backend', { wikipedia: { language: 'vi', pageId: 77 } }),
  ];
  const wiki = [
    at('wiki-vi-1', 'Nhà thờ chính tòa Đức Bà Sài Gòn', 10.779722, 106.699167),
    at('wiki-vi-2', 'Bưu điện Sài Gòn', 10.7800, 106.6999),
    at('wiki-vi-3', 'Bitexco Financial Tower', 10.77166, 106.70444),
    at('wiki-vi-4', 'Đền Bà Ấn (Thành phố Hồ Chí Minh)', 10.7723, 106.6956),
    at('wiki-vi-77', 'Nhà hát Lớn', 10.7768, 106.7033, 'wikipedia', { wikipedia: { language: 'vi', pageId: 77 } }),
    // Distinct neighbours stay: the square in front of the cathedral and another theatre.
    at('wiki-vi-5', 'Công trường Công xã Paris', 10.7795, 106.6994),
    at('wiki-vi-6', 'Nhà hát Bến Thành', 10.7712, 106.6979),
    at('wiki-vi-7', 'Công viên Chi Lăng', 10.7740, 106.6950),
  ];
  const ids = Array.from(mergeNearbyPlaces([official, wiki], center, 3), p => p.id).sort();
  assert.deepEqual(ids, ['db-19', 'db-25', 'db-33', 'db-38', 'db-9', 'wiki-vi-5', 'wiki-vi-6', 'wiki-vi-7'].sort());
});

test('unrelated places on the same spot stay separate even when one word matches', () => {
  const at = (id, title, source) => ({ id, title, latitude: 10.7764, longitude: 106.6993, source });
  const ids = Array.from(mergeNearbyPlaces([[at('db-1', 'Browser Test Museum', 'backend')], [at('osm-node-9', 'Backend OSM Test Park', 'osm')]], { latitude: 10.7764, longitude: 106.6993 }, 3), p => p.id);
  assert.deepEqual(ids.sort(), ['db-1', 'osm-node-9']);
});

test('unrelated places on the same spot stay separate even when one word matches', () => {
  const at = (id, title, source) => ({ id, title, latitude: 10.7764, longitude: 106.6993, source });
  const ids = Array.from(mergeNearbyPlaces([[at('db-1', 'Browser Test Museum', 'backend')], [at('osm-node-9', 'Backend OSM Test Park', 'osm')]], { latitude: 10.7764, longitude: 106.6993 }, 3), p => p.id);
  assert.deepEqual(ids.sort(), ['db-1', 'osm-node-9']);
});
