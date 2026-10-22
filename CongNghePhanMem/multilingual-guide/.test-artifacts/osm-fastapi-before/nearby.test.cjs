const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const here = { latitude: 10.7764, longitude: 106.6993 };
const item = (id, name, latitude = here.latitude, longitude = here.longitude) => ({ type: 'node', id, lat: latitude, lon: longitude, tags: { name, tourism: 'museum' } });
const response = elements => ({ ok: true, json: async () => ({ elements }) });
function service({ fetch, api = '', apiFetch, Date: clock = Date, timers = false } = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('src/services/nearby.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, {
    exports, require: () => ({ API_BASE_URL: api, apiFetch }), fetch, AbortController, Error, TypeError, URL, Date: clock,
    setTimeout: timers ? (fn, ms) => setTimeout(fn, Math.min(ms, 5)) : setTimeout, clearTimeout,
  });
  return exports;
}

test('actual named exports return the result object and legacy places array', async () => {
  const api = service({ fetch: async () => response([item(1, 'Museum')]) });
  for (const name of ['fetchOsmExploreResult', 'fetchOsmExplorePlaces', 'fetchNearbyPlaces']) assert.equal(typeof api[name], 'function', name);
  const result = await api.fetchOsmExploreResult(here, 3);
  assert.equal(result.places[0].id, 'osm-node-1');
  assert.equal(result.requestedRadiusKm, 3); assert.equal(result.searchedRadiusKm, 3); assert.equal(result.warning, '');
  assert.equal((await api.fetchOsmExplorePlaces(here, 3))[0].id, 'osm-node-1');
  assert.equal((await api.fetchNearbyPlaces(here, 3)).source, 'live');
});

test('malformed elements are skipped, real items deduplicated, radius filtered and distance sorted', async () => {
  const api = service({ fetch: async () => response([
    null, 7, {}, item(0, 'Invalid ID'), item(1, 'Farther', 10.79), item(2, 'Nearest'),
    item(3, 'Nearest'), item(4, 'Outside', 11), item(5, 'Invalid latitude', 91), { ...item(6, 'NaN'), lat: 'bad' },
  ]) });
  const result = await api.fetchOsmExploreResult(here, 3);
  assert.deepEqual(Array.from(result.places, p => p.title), ['Nearest', 'Farther']);
});

test('HTTP 500/504 and invalid JSON trigger the bounded backup endpoint', async () => {
  for (const first of [
    { ok: false, status: 500 }, { ok: false, status: 504 },
    { ok: true, json: async () => ({ invalid: true }) },
    { ok: true, json: async () => { throw new SyntaxError('bad JSON'); } },
    { ok: true, json: async () => ({ elements: [], remark: 'runtime error: Query timed out' }) },
  ]) {
    const urls = [];
    const api = service({ fetch: async url => { urls.push(url); return urls.length === 1 ? first : response([item(1, 'Backup Museum')]); } });
    assert.equal((await api.fetchOsmExploreResult(here, 3)).places.length, 1);
    assert.equal(urls.length, 2); assert.match(urls[1], /overpass-api\.de/);
  }
});

test('both failed sources reject clearly instead of returning fabricated empty success', async () => {
  let calls = 0;
  const api = service({ fetch: async () => { calls++; throw new TypeError('offline'); } });
  await assert.rejects(api.fetchOsmExploreResult(here, 3), /Không tải được địa điểm OpenStreetMap/);
  assert.equal(calls, 2);
});

test('network timeouts are bounded and fallback radius is reported accurately', async () => {
  const api = service({ timers: true, fetch: async (_, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) });
  await assert.rejects(api.fetchOsmExploreResult(here, 3), /phản hồi quá/);
  let calls = 0;
  const reduced = service({ fetch: async () => ++calls === 1 ? { ok: false, status: 504 } : response([item(1, 'Near'), item(2, 'Outside reduced radius', 10.85)]) });
  const result = await reduced.fetchOsmExploreResult(here, 20);
  assert.equal(result.requestedRadiusKm, 20); assert.equal(result.searchedRadiusKm, 5);
  assert.match(result.warning, /5 km/); assert.equal(result.places.length, 1);
});

test('cache matches exact GPS, radius, expiry and explicit retry', async () => {
  let now = 1000; let calls = 0;
  class Clock extends Date { static now() { return now; } }
  const api = service({ Date: Clock, fetch: async () => { calls++; return response([]); } });
  await api.fetchOsmExploreResult(here, 3); await api.fetchOsmExploreResult(here, 3);
  assert.equal(calls, 1);
  await api.fetchOsmExploreResult({ ...here, latitude: here.latitude + 0.0001 }, 3);
  await api.fetchOsmExploreResult(here, 5); assert.equal(calls, 3);
  now += 300001; await api.fetchOsmExploreResult(here, 3); assert.equal(calls, 4);
  await api.fetchOsmExploreResult(here, 3, { forceRefresh: true }); assert.equal(calls, 5);
});

test('throttled large-radius host is skipped, progress reports the actual fallback radius', async () => {
  let now = Date.UTC(2026, 9, 20); const urls = []; const progress = [];
  class Clock extends Date { static now() { return now; } }
  const api = service({ Date: Clock, fetch: async url => {
    urls.push(url);
    return urls.length === 1 ? { ok: false, status: 429, headers: { get: () => '60' } } : response([item(1, 'Live-shaped fallback')]);
  } });
  const result = await api.fetchOsmExploreResult(here, 20, { onProgress: value => progress.push(value) });
  assert.equal(urls.length, 2); assert.match(urls[1], /overpass-api\.de/);
  assert.deepEqual(progress.map(value => [value.radiusKm, value.attempt, value.totalAttempts]), [[20, 1, 3], [5, 3, 3]]);
  assert.equal(result.searchedRadiusKm, 5);
  await api.fetchOsmExploreResult(here, 20, { forceRefresh: true });
  assert.equal(urls.length, 3); assert.match(urls[2], /overpass-api\.de/);
  now += 60_001;
  await api.fetchOsmExploreResult(here, 20, { forceRefresh: true });
  assert.equal(urls.length, 4); assert.match(urls[3], /private\.coffee/);
});

test('429/406 cooldown respects Retry-After seconds or date, with a 30 second minimum', async () => {
  const started = Date.UTC(2026, 9, 20);
  for (const [header, delay] of [[null, 30_000], ['0', 30_000], ['invalid', 30_000], ['60', 60_000], [new Date(started + 90_000).toUTCString(), 90_000]]) {
    for (const status of [429, 406]) {
      let now = started; let calls = 0;
      class Clock extends Date { static now() { return now; } }
      const api = service({ Date: Clock, fetch: async () => { calls++; return { ok: false, status, headers: { get: () => header } }; } });
      await assert.rejects(api.fetchOsmExploreResult(here, 3), /đang giới hạn truy cập/);
      assert.equal(calls, 2);
      now += delay - 1;
      await assert.rejects(api.fetchOsmExploreResult(here, 5, { forceRefresh: true }), /đang giới hạn truy cập/);
      assert.equal(calls, 2, 'explicit retry and a new radius must respect the provider cooldown');
      now += 2;
      await assert.rejects(api.fetchOsmExploreResult(here, 3), /đang giới hạn truy cập/);
      assert.equal(calls, 4);
    }
  }
});

test('concurrent default requests share one Overpass query', async () => {
  let release; let calls = 0;
  const api = service({ fetch: async () => { calls++; await new Promise(resolve => { release = resolve; }); return response([]); } });
  const first = api.fetchOsmExploreResult(here, 3); const second = api.fetchOsmExploreResult(here, 3);
  release(); await Promise.all([first, second]); assert.equal(calls, 1);
});

test('aborted screen request stops without fallback or poisoning the cache', async () => {
  let calls = 0;
  const api = service({ fetch: async (_, options) => {
    calls++; if (calls > 1) return response([item(1, 'Retry')]);
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  const controller = new AbortController();
  const request = api.fetchOsmExploreResult(here, 3, { signal: controller.signal });
  controller.abort(); await assert.rejects(request, e => e.name === 'AbortError'); assert.equal(calls, 1);
  assert.equal((await api.fetchOsmExploreResult(here, 3)).places.length, 1);
});

test('FastAPI remains authoritative for account POI, OSM remains independently available', async () => {
  let backendCalls = 0;
  const api = service({ api: 'http://backend.invalid', apiFetch: async () => { backendCalls++; return [{ id: 9, name: 'Official', ...here }]; }, fetch: async () => response([item(1, 'Community')]) });
  assert.equal((await api.fetchNearbyPlaces(here, 3)).places[0].id, 'db-9');
  assert.equal((await api.fetchOsmExploreResult(here, 3)).places[0].id, 'osm-node-1');
  assert.equal(backendCalls, 1);
  const malformed = service({ api: 'http://backend.invalid', apiFetch: async () => ({ unexpected: true }) });
  await assert.rejects(malformed.fetchNearbyPlaces(here, 3), /không trả về danh sách/);
});

test('invalid coordinates and non-finite radius fail before any network request', async () => {
  const api = service({ fetch: async () => assert.fail('must not query') });
  await assert.rejects(api.fetchOsmExploreResult({ latitude: 91, longitude: 106 }, 3), /Tọa độ/);
  await assert.rejects(api.fetchOsmExploreResult(here, NaN), /Bán kính/);
  await assert.rejects(api.fetchNearbyPlaces(here, Infinity), /Bán kính/);
});
