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

test('deduplication preserves an exact nearby Wikipedia identity for an official landmark lacking a translation', () => {
  const official = place('db-1', 10.002, 'backend', 'Chợ Bình Tây');
  const wiki = { ...place('wiki-vi-3', 10.0021, 'wikipedia', 'Cho Binh Tay'), wikipedia: { language: 'vi', pageId: 3 } };
  const result = mergeNearbyPlaces([[official], [wiki]], origin, 3);
  assert.equal(result.length, 1); assert.equal(result[0].id, 'db-1'); assert.equal(result[0].source, 'backend');
  assert.deepEqual(result[0].wikipedia, wiki.wikipedia);
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
