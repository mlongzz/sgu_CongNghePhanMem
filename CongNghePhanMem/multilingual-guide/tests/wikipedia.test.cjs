const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const here = { latitude: 10.7764, longitude: 106.6993 };
const article = (pageid, title, lat = here.latitude, lon = here.longitude) => ({ pageid, title, lat, lon, ns: 0 });
const response = rows => ({ ok: true, json: async () => ({ query: { geosearch: rows } }) });
function service({ fetch, Date: clock = Date, timers = false } = {}) {
  const globals = { fetch, AbortController, Error, TypeError, SyntaxError, URL, URLSearchParams, Date: clock,
    setTimeout: timers ? (fn, ms) => setTimeout(fn, Math.min(ms, 5)) : setTimeout, clearTimeout };
  const compile = (file, require) => {
    const exports = {};
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(source, { ...globals, exports, require });
    return exports;
  };
  const nearby = compile('src/services/nearby.ts', () => ({ API_BASE_URL: '' }));
  return compile('src/services/wikipedia.ts', () => nearby);
}

test('Wikipedia uses a read-only CORS request and labels real-shaped articles separately from official POI', async () => {
  let request;
  const api = service({ fetch: async (url, options) => { request = { url: new URL(url), options }; return response([article(40515, 'Bảo tàng Thành phố Hồ Chí Minh')]); } });
  const result = await api.fetchWikipediaNearby(here, 5);
  assert.equal(request.url.origin, 'https://vi.wikipedia.org');
  assert.equal(request.url.searchParams.get('gscoord'), `${here.latitude}|${here.longitude}`);
  assert.equal(request.url.searchParams.get('origin'), '*');
  assert.equal(request.url.searchParams.get('gsradius'), '5000');
  assert.equal(request.options.credentials, 'omit'); assert.equal(request.options.headers, undefined);
  const place = result.places[0];
  assert.equal(place.id, 'wiki-vi-40515'); assert.equal(place.source, 'wikipedia');
  assert.equal(place.sourceUrl, 'https://vi.wikipedia.org/?curid=40515');
  assert.match(place.subtitle.vi, /Chưa có thuyết minh chính thức/);
  assert.equal(result.requestedRadiusKm, 5); assert.equal(result.searchedRadiusKm, 5);
});

test('malformed, duplicate and out-of-radius articles are skipped and distance comes from coordinates', async () => {
  const api = service({ fetch: async () => response([
    null, {}, article(0, 'Invalid ID'), article(4, 'Farther', 10.79),
    { ...article(1, 'Nearest'), dist: 999999 }, article(1, 'Duplicate'), article(3, 'Outside', 11),
    { ...article(5, 'File namespace'), ns: 6 }, article(6, 'String coordinates', '10.77'), article(7, 'Invalid', 91), article(8, ' '),
  ]) });
  assert.deepEqual(Array.from((await api.fetchWikipediaNearby(here, 3)).places, p => p.title), ['Nearest', 'Farther']);
});

test('20 km requests disclose the 10 km Wikipedia limit and filter to that searched radius', async () => {
  let requested;
  const api = service({ fetch: async url => { requested = new URL(url); return response([article(1, 'Within', 10.85), article(2, 'Beyond 10 km', 10.88)]); } });
  const result = await api.fetchWikipediaNearby(here, 20);
  assert.equal(requested.searchParams.get('gsradius'), '10000');
  assert.equal(result.requestedRadiusKm, 20); assert.equal(result.searchedRadiusKm, 10);
  assert.match(result.warning, /chưa phủ đủ 20 km/);
  assert.deepEqual(Array.from(result.places, p => p.title), ['Within']);
});

test('empty results are successful but HTTP, API errors, malformed JSON and offline remain errors', async () => {
  assert.equal((await service({ fetch: async () => response([]) }).fetchWikipediaNearby(here, 5)).places.length, 0);
  for (const value of [
    { ok: false, status: 503 },
    { ok: true, json: async () => ({ error: { code: 'badvalue' } }) },
    { ok: true, json: async () => ({ query: {} }) },
    { ok: true, json: async () => { throw new SyntaxError('invalid'); } },
  ]) await assert.rejects(service({ fetch: async () => value }).fetchWikipediaNearby(here, 5), /Wikipedia/);
  await assert.rejects(service({ fetch: async () => { throw new TypeError('offline'); } }).fetchWikipediaNearby(here, 5), /Không kết nối được Wikipedia/);
});

test('Wikipedia cache distinguishes exact GPS and radius, expires and allows refresh', async () => {
  let now = 0; let calls = 0;
  class Clock extends Date { static now() { return now; } }
  const api = service({ Date: Clock, fetch: async () => { calls++; return response([]); } });
  await api.fetchWikipediaNearby(here, 5); await api.fetchWikipediaNearby(here, 5); assert.equal(calls, 1);
  await api.fetchWikipediaNearby({ ...here, latitude: here.latitude + 0.0001 }, 5);
  await api.fetchWikipediaNearby(here, 20); assert.equal(calls, 3);
  now += 300001; await api.fetchWikipediaNearby(here, 5); assert.equal(calls, 4);
  await api.fetchWikipediaNearby(here, 5, { forceRefresh: true }); assert.equal(calls, 5);
});

test('caller cancellation and the bounded timeout reject, without caching the failure', async () => {
  let calls = 0;
  const api = service({ fetch: async (_, options) => {
    calls++;
    if (calls > 1) return response([article(1, 'Retry')]);
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  const controller = new AbortController();
  const pending = api.fetchWikipediaNearby(here, 5, { signal: controller.signal });
  controller.abort(); await assert.rejects(pending, e => e.name === 'AbortError');
  assert.equal((await api.fetchWikipediaNearby(here, 5)).places.length, 1);
  const timed = service({ timers: true, fetch: async (_, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
  await assert.rejects(timed.fetchWikipediaNearby(here, 5), /phản hồi quá 8 giây/);
});

test('invalid GPS/radius and pre-cancelled searches make no network request', async () => {
  const api = service({ fetch: async () => assert.fail('must not send') });
  await assert.rejects(api.fetchWikipediaNearby({ latitude: 91, longitude: 106 }, 5), /Tọa độ/);
  await assert.rejects(api.fetchWikipediaNearby(here, NaN), /Bán kính/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.fetchWikipediaNearby(here, 5, { signal: controller.signal }), e => e.name === 'AbortError');
});
