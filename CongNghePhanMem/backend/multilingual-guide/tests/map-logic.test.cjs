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
const { shouldRefreshTrackedPlaces } = load('src/services/gpsTracking.ts', { './nearby': nearby });
const { clusterMapPlaces } = load('src/services/mapClusters.ts');
const now = 1000000;
const fix = { latitude: 10, longitude: 106, accuracy: 5, timestamp: now };
test('tracking rejects stale, invalid and noisy updates before provider requests', () => {
  assert.equal(shouldRefreshTrackedPlaces(fix, null, now), true);
  for (const fields of [{ latitude: 91 }, { longitude: NaN }, { accuracy: 102 }, { accuracy: undefined }, { accuracy: -1 }, { timestamp: now - 60001 }, { timestamp: now + 5001 }]) {
    assert.equal(shouldRefreshTrackedPlaces({ ...fix, ...fields }, null, now), false);
  }
});
test('tracking requires elapsed interval and movement beyond the uncertainty envelope', () => {
  const previous = { ...fix, at: now - 30000 };
  assert.equal(shouldRefreshTrackedPlaces({ ...fix, latitude: 10.0005 }, previous, now), false);
  assert.equal(shouldRefreshTrackedPlaces({ ...fix, latitude: 10.002 }, { ...previous, at: now - 29999 }, now), false);
  assert.equal(shouldRefreshTrackedPlaces({ ...fix, latitude: 10.002 }, previous, now), true);
  assert.equal(shouldRefreshTrackedPlaces({ ...fix, latitude: 10.001, accuracy: 80 }, { ...previous, accuracy: 80 }, now), false);
});
test('dense maps cluster display markers without dropping POI or changing list data', () => {
  const places = Array.from({ length: 80 }, (_, id) => ({ id: `db-${id}`, latitude: 10 + id * .000001, longitude: 106 }));
  const groups = clusterMapPlaces(places, 12);
  assert.ok(groups.length < 10);
  assert.equal(groups.flatMap(group => group.places).length, 80);
  assert.equal(places.length, 80);
  assert.equal(clusterMapPlaces(places, 17).length, 80);
  const selected = clusterMapPlaces(places, 12, 'db-5').find(group => group.places.some(p => p.id === 'db-5'));
  assert.equal(selected.places.length, 1, 'selected landmark stays individually selectable');
});
test('small maps preserve individual markers and exclude invalid coordinates', () => {
  const places = [{ id: 'db-1', latitude: 10, longitude: 106 }, { id: 'db-invalid', latitude: 91, longitude: 106 }];
  assert.equal(clusterMapPlaces(places, 12).length, 1);
});
