const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const here = { latitude: 10.7764, longitude: 106.6993 };
const item = (id, name, latitude = here.latitude, longitude = here.longitude) => ({ type: 'node', id, lat: latitude, lon: longitude, tags: { name, tourism: 'museum' } });
const payload = (elements = [], radius = 3, searched = radius) => ({ source: 'openstreetmap', elements, requested_radius_km: radius, searched_radius_km: searched, warning: '' });
const response = body => ({ ok: true, json: async () => body });
function service({ fetch, api = 'http://backend.invalid', apiFetch, Date: clock = Date, timers = false } = {}) {
  const exports = {}; const delays = [];
  const source = ts.transpileModule(fs.readFileSync('src/services/nearby.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, {
    exports, require: () => ({ API_BASE_URL: api, apiFetch }), fetch, AbortController, Error, TypeError, URL, URLSearchParams, Date: clock,
    setTimeout: (fn, ms) => { delays.push(ms); return setTimeout(fn, timers ? Math.min(ms, 5) : ms); }, clearTimeout,
  });
  return { ...exports, delays };
}

test('actual named exports use the separate FastAPI OSM endpoint and keep legacy array adapter', async () => {
  let request; const api = service({ fetch: async (url, options) => { request = { url, options }; return response(payload([item(1, 'Museum')])); } });
  for (const name of ['fetchOsmExploreResult', 'fetchOsmExplorePlaces', 'fetchNearbyPlaces']) assert.equal(typeof api[name], 'function');
  const result = await api.fetchOsmExploreResult(here, 3);
  assert.equal(result.places[0].id, 'osm-node-1'); assert.equal(result.places[0].source, 'osm');
  assert.equal(result.requestedRadiusKm, 3); assert.equal(result.searchedRadiusKm, 3);
  const url = new URL(request.url);
  assert.equal(url.origin, 'http://backend.invalid'); assert.equal(url.pathname, '/osm/nearby');
  assert.equal(url.searchParams.get('latitude'), String(here.latitude)); assert.equal(url.searchParams.get('radius_km'), '3');
  assert.equal(request.options.credentials, 'omit'); assert.equal(request.options.headers.Authorization, undefined);
  assert.equal(request.options.body, undefined);
  assert.equal((await api.fetchOsmExplorePlaces(here, 3))[0].id, 'osm-node-1');
});

test('malformed elements are skipped, real items deduplicated, radius filtered and distance sorted', async () => {
  const api = service({ fetch: async () => response(payload([
    null, 7, {}, item(0, 'Invalid ID'), item(1, 'Farther', 10.79), item(2, 'Nearest'),
    item(3, 'Nearest'), item(4, 'Outside', 11), item(5, 'Invalid latitude', 91), { ...item(6, 'NaN'), lat: 'bad' },
  ])) });
  assert.deepEqual(Array.from((await api.fetchOsmExploreResult(here, 3)).places, p => p.title), ['Nearest', 'Farther']);
});

test('server HTTP failures preserve OSM detail and make only one request instead of browser provider retries', async () => {
  for (const status of [429, 502, 503, 504]) {
    let calls = 0;
    const api = service({ fetch: async () => { calls++; return { ok: false, status, json: async () => ({ detail: 'Máy chủ đang giới hạn truy cập' }) }; } });
    await assert.rejects(api.fetchOsmExploreResult(here, 3), /đang giới hạn truy cập/); assert.equal(calls, 1);
  }
});

test('invalid JSON, missing source, and inconsistent radius metadata are errors instead of empty success', async () => {
  for (const body of [{}, { ...payload(), source: 'backend' }, { ...payload(), elements: null },
    payload([], 20), payload([], 3, 5), payload([], 3, NaN), payload([], 3, 0)]) {
    await assert.rejects(service({ fetch: async () => response(body) }).fetchOsmExploreResult(here, 3), /không hợp lệ/);
  }
  await assert.rejects(service({ fetch: async () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } }) }).fetchOsmExploreResult(here, 3), /không hợp lệ/);
});

test('reduced server radius is disclosed and filters the data to the actual five km search', async () => {
  const api = service({ fetch: async () => response(payload([item(1, 'Within five'), item(2, 'Outside five', 10.84)], 20, 5)) });
  const result = await api.fetchOsmExploreResult(here, 20);
  assert.equal(result.requestedRadiusKm, 20); assert.equal(result.searchedRadiusKm, 5);
  assert.match(result.warning, /Tạm hiển thị dữ liệu trong 5 km/); assert.equal(result.places.length, 1);
});

test('cache matches exact GPS, radius and expiry; explicit refresh is passed to FastAPI', async () => {
  let now = 0; const urls = [];
  const api = service({ Date: { now: () => now }, fetch: async url => {
    urls.push(url); return response(payload([], Number(new URL(url).searchParams.get('radius_km'))));
  } });
  await api.fetchOsmExploreResult(here, 3); await api.fetchOsmExploreResult(here, 3); assert.equal(urls.length, 1);
  await api.fetchOsmExploreResult({ ...here, latitude: here.latitude + .000001 }, 3);
  await api.fetchOsmExploreResult(here, 5); assert.equal(urls.length, 3);
  await api.fetchOsmExploreResult(here, 3, { forceRefresh: true });
  assert.equal(new URL(urls.at(-1)).searchParams.get('force_refresh'), 'true');
  now += 300001; await api.fetchOsmExploreResult(here, 3); assert.equal(urls.length, 5);
});

test('reduced-radius cache expires after 45s instead of hiding a full-radius retry for five minutes', async () => {
  let now = 0; let calls = 0;
  const api = service({ Date: { now: () => now }, fetch: async () => { calls++; return response(payload([], 20, 5)); } });
  await api.fetchOsmExploreResult(here, 20); now = 44999; await api.fetchOsmExploreResult(here, 20); assert.equal(calls, 1);
  now = 45001; await api.fetchOsmExploreResult(here, 20); assert.equal(calls, 2);
});

test('concurrent default requests share one FastAPI query', async () => {
  let release; let calls = 0;
  const api = service({ fetch: async () => { calls++; await new Promise(resolve => { release = resolve; }); return response(payload()); } });
  const first = api.fetchOsmExploreResult(here, 3); const second = api.fetchOsmExploreResult(here, 3);
  release(); await Promise.all([first, second]); assert.equal(calls, 1);
});

test('screen cancellation propagates to FastAPI without caching a failed result and retry can recover', async () => {
  let calls = 0;
  const api = service({ fetch: async (_, options) => {
    if (++calls > 1) return response(payload([item(1, 'Recovered')]));
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  const controller = new AbortController(); const pending = api.fetchOsmExploreResult(here, 3, { signal: controller.signal });
  controller.abort(); await assert.rejects(pending, e => e.name === 'AbortError');
  assert.equal((await api.fetchOsmExploreResult(here, 3)).places.length, 1);
});

test('OSM has its own bounded 40s deadline while ordinary API requests retain their existing timeout', async () => {
  const api = service({ timers: true, fetch: async (_, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) });
  await assert.rejects(api.fetchOsmExploreResult(here, 3), /40 giây/); assert.deepEqual(api.delays, [40000]);
});

test('PostgreSQL account POI and OSM remain independent endpoints and ID namespaces', async () => {
  let path;
  const api = service({ apiFetch: async url => { path = url; return [{ id: 9, name: 'Official', ...here }]; }, fetch: async () => response(payload([item(1, 'Community')])) });
  assert.equal((await api.fetchNearbyPlaces(here, 3)).places[0].id, 'db-9'); assert.match(path, /^\/places\/nearby\?/);
  assert.equal((await api.fetchOsmExploreResult(here, 3)).places[0].id, 'osm-node-1');
  await assert.rejects(service({ apiFetch: async () => ({ unexpected: true }) }).fetchNearbyPlaces(here, 3), /không trả về danh sách/);
});

test('invalid coordinates/radius or missing FastAPI configuration never contact Overpass directly', async () => {
  const fetch = async () => assert.fail('must not query');
  const api = service({ fetch });
  await assert.rejects(api.fetchOsmExploreResult({ latitude: 91, longitude: 106 }, 3), /Tọa độ/);
  await assert.rejects(api.fetchOsmExploreResult(here, NaN), /Bán kính/);
  await assert.rejects(api.fetchNearbyPlaces(here, Infinity), /Bán kính/);
  await assert.rejects(service({ api: '', fetch }).fetchOsmExploreResult(here, 3), /EXPO_PUBLIC_API_URL/);
});
