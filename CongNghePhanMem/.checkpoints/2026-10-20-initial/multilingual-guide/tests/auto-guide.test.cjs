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
const { chooseAutoGuide } = load('src/services/autoGuide.ts', { './nearby': nearby });
const origin = { latitude: 10, longitude: 106 };
const place = (id, latitude, source = 'backend', more = {}) => ({ id, title: id, latitude, longitude: origin.longitude, source, ...more });

test('AutoGuide rejects NaN, infinite, negative, unknown and imprecise GPS accuracy', () => {
  for (const accuracy of [NaN, Infinity, -1, null, 51, undefined]) {
    assert.equal(chooseAutoGuide(origin, accuracy, [place('db-1', 10)], new Set()), null);
  }
});

test('AutoGuide rejects invalid GPS coordinates before rearming heard landmarks', () => {
  for (const coordinates of [{ latitude: NaN, longitude: 106 }, { latitude: 91, longitude: 106 }, { latitude: 10, longitude: 181 }]) {
    const heard = new Set(['db-1']);
    assert.equal(chooseAutoGuide(coordinates, 5, [place('db-1', 10)], heard), null);
    assert.equal(heard.has('db-1'), true);
  }
});

test('AutoGuide chooses the nearest Wikipedia or OSM landmark with eligible reading content', () => {
  const wiki = place('wiki-vi-2', 10.0001, 'wikipedia');
  const osm = place('osm-node-3', 10.0003, 'osm', { narration: { vi: { text: 'Bảo tàng trưng bày các hiện vật về lịch sử đô thị.', language: 'vi', source: 'saved' } } });
  const official = place('db-4', 10.0006);
  assert.equal(chooseAutoGuide(origin, 5, [official, osm, wiki], new Set()).id, wiki.id);
  assert.equal(chooseAutoGuide(origin, 5, [official, osm, wiki], new Set([wiki.id])).id, osm.id);
});

test('AutoGuide excludes generic OSM markers without content but permits an article identity', () => {
  const empty = place('osm-node-1', 10, 'osm');
  const blank = place('osm-node-2', 10, 'osm', { narration: { vi: { text: '   ', language: 'vi', source: 'saved' } } });
  assert.equal(chooseAutoGuide(origin, 5, [empty, blank], new Set()), null);
  const linked = place('osm-node-3', 10, 'osm', { wikipediaUrl: 'https://vi.wikipedia.org/wiki/Bảo_tàng' });
  assert.equal(chooseAutoGuide(origin, 5, [linked], new Set()).id, linked.id);
});

test('AutoGuide does not repeat within 200m and rearms after leaving and returning', () => {
  const wiki = place('wiki-vi-7', 10, 'wikipedia'); const heard = new Set();
  assert.equal(chooseAutoGuide(origin, 5, [wiki], heard).id, wiki.id);
  heard.add(wiki.id);
  assert.equal(chooseAutoGuide(origin, 5, [wiki], heard), null);
  assert.equal(chooseAutoGuide({ latitude: 10.001, longitude: 106 }, 5, [wiki], heard), null);
  assert.equal(heard.has(wiki.id), true);
  assert.equal(chooseAutoGuide({ latitude: 10.003, longitude: 106 }, 5, [wiki], heard), null);
  assert.equal(heard.has(wiki.id), false);
  assert.equal(chooseAutoGuide(origin, 5, [wiki], heard).id, wiki.id);
});

test('AutoGuide ignores landmarks outside the entrance radius and invalid provider coordinates', () => {
  const invalid = [place('db-nan', NaN), place('wiki-vi-bad', 91, 'wikipedia')];
  assert.equal(chooseAutoGuide(origin, 5, [...invalid, place('db-outside', 10.001)], new Set()), null);
});
