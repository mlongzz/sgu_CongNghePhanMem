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

test('saved backend data stays labeled stale, uses short retry cache and can recover without forced refresh', async () => {
  let now = 0; const requests = [];
  const api = service({ Date: { now: () => now }, fetch: async url => {
    requests.push(url);
    return response(requests.length === 1
      ? { ...payload([item(1, 'Saved Museum')]), stale: true, cache_age_seconds: 620, retry_after_seconds: 30 }
      : payload([item(2, 'Updated Museum')]));
  } });
  const saved = await api.fetchOsmExploreResult(here, 3);
  assert.equal(saved.stale, true); assert.equal(saved.cacheAgeSeconds, 620); assert.equal(saved.retryAfterSeconds, 30);
  assert.equal(saved.places[0].title, 'Saved Museum'); assert.match(saved.warning, /Đang dùng dữ liệu đã lưu/);
  now = 29999;
  assert.equal((await api.fetchOsmExploreResult(here, 3)).stale, true); assert.equal(requests.length, 1);
  now = 30001;
  const fresh = await api.fetchOsmExploreResult(here, 3);
  assert.equal(fresh.stale, false); assert.equal(fresh.cacheAgeSeconds, 0); assert.equal(fresh.places[0].title, 'Updated Museum');
  assert.equal(requests.length, 2);
  for (const url of requests) assert.equal(new URL(url).searchParams.has('force_refresh'), false);
});

test('browser cache subtracts backend age from both full and reduced freshness windows', async () => {
  for (const [radius, searched, age] of [[3, 3, 290], [20, 5, 35]]) {
    let now = 0; let calls = 0;
    const api = service({ Date: { now: () => now }, fetch: async () => { calls++; return response({ ...payload([], radius, searched), cache_age_seconds: age }); } });
    await api.fetchOsmExploreResult(here, radius);
    now = 9999; await api.fetchOsmExploreResult(here, radius); assert.equal(calls, 1);
    now = 10001; await api.fetchOsmExploreResult(here, radius); assert.equal(calls, 2);
  }
});

test('stale retry cache cannot extend retention beyond 24h and reduced coverage warning is retained', async () => {
  let now = 0; let calls = 0;
  const api = service({ Date: { now: () => now }, fetch: async () => {
    calls++; return response({ ...payload([item(1, 'Saved Reduced')], 20, 5), stale: true, cache_age_seconds: 86399, retry_after_seconds: 30 });
  } });
  const saved = await api.fetchOsmExploreResult(here, 20);
  assert.equal(saved.searchedRadiusKm, 5); assert.match(saved.warning, /trong 5 km/); assert.equal(saved.stale, true);
  now = 999; await api.fetchOsmExploreResult(here, 20); assert.equal(calls, 1);
  now = 1001; await api.fetchOsmExploreResult(here, 20); assert.equal(calls, 2);
});

test('invalid freshness metadata is rejected instead of treating old POI as fresh', async () => {
  for (const fields of [{ stale: 'true' }, { cache_age_seconds: -1 }, { cache_age_seconds: '600' },
    { cache_age_seconds: 1.5 }, { cache_age_seconds: Infinity }, { retry_after_seconds: 0 },
    { retry_after_seconds: '30' }, { retry_after_seconds: 1.5 }, { stale: true, cache_age_seconds: 86400 }]) {
    await assert.rejects(service({ fetch: async () => response({ ...payload(), ...fields }) }).fetchOsmExploreResult(here, 3), /thông tin cache không hợp lệ/);
  }
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
  const coordinates = new URL(path, 'http://backend.invalid').searchParams;
  assert.equal(coordinates.get('latitude'), String(here.latitude));
  assert.equal(coordinates.get('longitude'), String(here.longitude));
  assert.equal((await api.fetchOsmExploreResult(here, 3)).places[0].id, 'osm-node-1');
  await assert.rejects(service({ apiFetch: async () => ({ unexpected: true }) }).fetchNearbyPlaces(here, 3), /không trả về danh sách/);
});

test('public backend adapter excludes draft/deleted records and retains publication and source credits', () => {
  const { validateBackendPlace } = service();
  const base = { id: 7, name: 'Published landmark', ...here };
  for (const changes of [{ publication_status: 'draft' }, { publication_status: 'unpublished' }, { publication_status: 'bad' }, { deleted_at: '2026-10-20' }, { is_deleted: true }]) {
    assert.equal(validateBackendPlace({ ...base, ...changes }), null);
  }
  const place = validateBackendPlace({ ...base, publication_status: 'published', source_url: 'https://example.org/landmark', source_license: 'ODbL',
    image_source_url: 'https://example.org/image', image_attribution: 'Verified photographer', image_license: 'CC BY-SA 4.0' });
  assert.equal(place.publicationStatus, 'published'); assert.equal(place.sourceUrl, 'https://example.org/landmark');
  assert.equal(place.sourceLicense, 'ODbL'); assert.equal(place.imageSourceUrl, 'https://example.org/image');
  assert.equal(place.imageAttribution, 'Verified photographer'); assert.equal(place.imageLicense, 'CC BY-SA 4.0');
  assert.ok(validateBackendPlace(base), 'legacy public response without lifecycle fields remains readable');
});

test('invalid coordinates/radius or missing FastAPI configuration never contact Overpass directly', async () => {
  const fetch = async () => assert.fail('must not query');
  const api = service({ fetch });
  await assert.rejects(api.fetchOsmExploreResult({ latitude: 91, longitude: 106 }, 3), /Tọa độ/);
  await assert.rejects(api.fetchOsmExploreResult(here, NaN), /Bán kính/);
  await assert.rejects(api.fetchNearbyPlaces(here, Infinity), /Bán kính/);
  await assert.rejects(service({ api: '', fetch }).fetchOsmExploreResult(here, 3), /EXPO_PUBLIC_API_URL/);
});

test('backend adapter rejects coerced Boolean, empty, array or object coordinates and unsafe IDs', () => {
  const { validateBackendPlace } = service();
  const valid = { id: 5, name: 'Địa danh chính thức', ...here };
  for (const latitude of [true, false, '', ' ', [], [10.77], {}, null, undefined, '0x10', NaN, Infinity, 91]) {
    assert.equal(validateBackendPlace({ ...valid, latitude }), null, `invalid latitude ${String(latitude)}`);
  }
  for (const id of [true, false, '', ' ', [], [5], {}, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '9007199254740993', '0x10', '5e0']) {
    assert.equal(validateBackendPlace({ ...valid, id }), null, `invalid ID ${String(id)}`);
  }
  const accepted = validateBackendPlace({ ...valid, id: '5', latitude: '10.7764', longitude: '106.6993' });
  assert.equal(accepted.id, 'db-5'); assert.equal(accepted.latitude, here.latitude); assert.equal(accepted.longitude, here.longitude);
});

test('backend adapter turns malformed translated values into safe strings rather than React Text objects', () => {
  const { validateBackendPlace } = service();
  const result = validateBackendPlace({ id: 9, name: 'Official', ...here,
    description: { vi: { corrupt: true }, en: ['invalid'], fr: false, ja: '正しい説明です。' },
    subtitle: { vi: { corrupt: true }, en: 5, fr: null, ja: '有効な副題' },
    address: { corrupt: true }, district: ['invalid'], category: ['Văn hóa'], image_url: { corrupt: true }, image: 5,
    duration: Infinity, rating: { corrupt: true },
  });
  for (const language of ['vi', 'en', 'fr', 'ja']) {
    assert.equal(typeof result.description[language], 'string'); assert.equal(typeof result.subtitle[language], 'string');
  }
  assert.equal(result.description.vi, 'Chưa có bài thuyết minh.'); assert.equal(result.description.ja, '正しい説明です。');
  assert.equal(result.subtitle.en, 'From the guide system'); assert.equal(result.subtitle.ja, '有効な副題');
  assert.equal(result.district, 'Chưa có địa chỉ'); assert.equal(result.category, 'Khám phá');
  assert.equal(result.image, ''); assert.equal(result.duration, 0); assert.equal(result.rating, 0);
  for (const malformed of [true, 5, [], ['invalid'], null]) {
    const place = validateBackendPlace({ id: 1, name: 'Official', ...here, description: malformed, subtitle: malformed });
    assert.equal(typeof place.description.vi, 'string'); assert.equal(typeof place.subtitle.vi, 'string');
  }
});

test('backend adapter preserves valid aliases, URL, address, category and multilingual metadata', () => {
  const { validateBackendPlace } = service();
  const result = validateBackendPlace({ id: '12', title: '  Địa danh  ', lat: '10.7764', lng: '106.6993',
    address: '12 Đường thử nghiệm', district: 'Quận tham khảo', category: 'Lịch sử',
    image_url: ' https://example.com/photo.jpg ', duration: '4', rating: '4.8',
    description: { vi: 'Mô tả Việt', en: 'English description', fr: 'Description française', ja: '日本語の説明' },
    subtitle: { vi: 'Phụ đề Việt', en: 'English subtitle', fr: 'Sous-titre français', ja: '日本語の副題' },
  });
  assert.equal(result.id, 'db-12'); assert.equal(result.title, 'Địa danh'); assert.equal(result.source, 'backend');
  assert.equal(result.latitude, here.latitude); assert.equal(result.longitude, here.longitude);
  assert.equal(result.district, '12 Đường thử nghiệm'); assert.equal(result.category, 'Lịch sử');
  assert.equal(result.image, 'https://example.com/photo.jpg'); assert.equal(result.duration, 4); assert.equal(result.rating, 4.8);
  assert.equal(result.description.fr, 'Description française'); assert.equal(result.subtitle.en, 'English subtitle');
  const description = validateBackendPlace({ id: 1, name: 'Official', ...here, description: 'A plain description' });
  for (const language of ['vi', 'en', 'fr', 'ja']) assert.equal(description.description[language], 'A plain description');
});

test('nearby backend response skips malformed records while retaining valid POI; a non-array remains an error', async () => {
  const api = service({ apiFetch: async () => [null, {}, { id: true, name: 'Wrong ID', ...here },
    { id: 2, name: 'Invalid GPS', latitude: '', longitude: here.longitude }, { id: 3, name: 'Valid POI', ...here }] });
  const result = await api.fetchNearbyPlaces(here, 3);
  assert.deepEqual(Array.from(result.places, p => p.id), ['db-3']);
  await assert.rejects(service({ apiFetch: async () => ({ places: [] }) }).fetchNearbyPlaces(here, 3), /không trả về danh sách/);
});

function importedNarrationServices(fetch, guideRequests) {
  class ApiError extends Error { constructor(status) { super('Guide not found'); this.status = status; } }
  const compile = (path, require) => {
    const exports = {};
    const source = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, { exports, require, fetch, AbortController, URL, URLSearchParams, Error, TypeError, SyntaxError, setTimeout, clearTimeout });
    return exports;
  };
  const nearby = service();
  const wikipedia = compile('src/services/wikipediaContent.ts', () => nearby);
  const narration = compile('src/services/narration.ts', name => name === './nearby' ? nearby : name === './wikipediaContent' ? wikipedia : {
    ApiError, getGuideContent: async (id, language) => { guideRequests.push({ id, language }); throw new ApiError(404); },
  });
  return { ...nearby, ...narration };
}

test('actual imported Wikipedia POI without guides narrates its exact article after Admin publication', async () => {
  const corpus = JSON.parse(fs.readFileSync('../backend/app/data/hcmc_discovery_review.json', 'utf8')).places;
  for (const sourceId of ['vi:7703', 'en:9821917']) {
    const row = corpus.find(place => place.source_id === sourceId);
    assert.ok(row, 'regression uses a real record from the reviewed import corpus');
    const [language, pageId] = sourceId.split(':');
    const guideRequests = []; const requests = [];
    const api = importedNarrationServices(async url => {
      requests.push(new URL(url));
      return response({ query: { pages: [{ ns: 0, pageid: Number(pageId), title: row.name,
        coordinates: [{ lat: row.latitude, lon: row.longitude, globe: 'earth' }],
        extract: language === 'vi' ? 'Nội dung Wikipedia có nguồn được trả về cho đúng bài viết đã chọn.'
          : 'Wikipedia provides this attributed excerpt for the exact selected article.' }] } });
    }, guideRequests);
    const imported = api.validateBackendPlace({ ...row, id: 7, publication_status: 'published', source_license: row.license });
    assert.equal(imported.source, 'backend', 'the official marker keeps PostgreSQL content priority');
    assert.equal(imported.id, 'db-7');
    assert.equal(imported.wikipedia.language, language); assert.equal(imported.wikipedia.pageId, Number(pageId));
    assert.equal(imported.narration, undefined, 'the importer has not invented a guide');
    const narration = await api.resolveNarration(imported, language);
    assert.deepEqual(guideRequests, [{ id: '7', language }]);
    assert.equal(requests.length, 1); assert.equal(requests[0].hostname, `${language}.wikipedia.org`);
    assert.equal(requests[0].searchParams.get('pageids'), pageId); assert.equal(requests[0].searchParams.has('titles'), false);
    assert.equal(narration.source, 'wikipedia'); assert.equal(narration.sourceUrl, row.source_url);
    assert.equal(narration.language, language); assert.match(narration.attribution, /Wikipedia/);
    assert.equal(narration.licenseUrl, 'https://creativecommons.org/licenses/by-sa/4.0/');
  }
});

test('backend Wikipedia links require matching trusted language, canonical page ID and unambiguous source URL', async () => {
  const api = importedNarrationServices(async () => assert.fail('a forged or ambiguous source must not fetch an article'), []);
  const base = { id: 7, name: 'Imported landmark', ...here, publication_status: 'published',
    source: 'wikipedia', source_id: 'vi:7703', source_url: 'https://vi.wikipedia.org/?curid=7703' };
  for (const changes of [
    { source: 'manual' }, { source: 'osm' }, { source_id: 'de:7703' }, { source_id: 'VI:7703' },
    { source_id: 'vi:0' }, { source_id: 'vi:07703' }, { source_id: 'vi:7e3' }, { source_id: 'vi:9007199254740993' },
    { source_id: 'vi:7703\n' }, { source_id: 7703 }, { source_url: 'http://vi.wikipedia.org/?curid=7703' },
    { source_url: 'https://vi.wikipedia.org.example.com/?curid=7703' }, { source_url: 'https://en.wikipedia.org/?curid=7703' },
    { source_url: 'https://vi.wikipedia.org/?curid=1' }, { source_url: 'https://vi.wikipedia.org/?curid=7703&curid=1' },
    { source_url: 'https://vi.wikipedia.org/?curid=7703&title=Unrelated' },
    { source_url: 'https://user@vi.wikipedia.org/?curid=7703' }, { source_url: 'https://vi.wikipedia.org:444/?curid=7703' },
    { source_url: 'https://vi.wikipedia.org/wiki/Unverified_title' },
    { source_url: 'https://vi.wikipedia.org/wiki/Unverified_title?curid=7703' },
  ]) {
    const place = api.validateBackendPlace({ ...base, ...changes });
    assert.equal(place.wikipedia, undefined, JSON.stringify(changes));
    assert.equal(await api.resolveNarration(place, 'vi'), null, JSON.stringify(changes));
  }
  const canonical = api.validateBackendPlace({ ...base, source_url: 'https://vi.wikipedia.org/w/index.php?curid=7703' });
  assert.equal(canonical.wikipedia.pageId, 7703);
});
