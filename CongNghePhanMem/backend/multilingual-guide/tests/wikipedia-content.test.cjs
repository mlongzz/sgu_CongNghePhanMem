const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const coordinates = { latitude: 10.75, longitude: 106.65 };
const makePlace = (extra = {}) => ({
  id: 'wiki-vi-51', title: 'Địa danh thử nghiệm', ...coordinates, source: 'wikipedia', ...extra,
});
const makePage = (extra = {}) => ({
  pageid: 51, ns: 0, title: 'Địa danh thử nghiệm',
  extract: 'Đây là một địa danh lịch sử có bài viết giới thiệu trên Wikipedia.',
  coordinates: [{ lat: coordinates.latitude, lon: coordinates.longitude, globe: 'earth' }], ...extra,
});
const response = page => ({ ok: true, json: async () => ({ query: { pages: [page] } }) });

function service({ fetch = async () => response(makePage()), Date: clock = Date, timers = false } = {}) {
  const globals = { fetch, AbortController, Error, TypeError, SyntaxError, URL, URLSearchParams, Date: clock,
    setTimeout: timers ? (fn, ms) => setTimeout(fn, Math.min(ms, 5)) : setTimeout, clearTimeout };
  const compile = (path, require) => {
    const exports = {};
    const source = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(source, { ...globals, exports, require });
    return exports;
  };
  const nearby = compile('src/services/nearby.ts', () => ({ API_BASE_URL: '' }));
  return compile('src/services/wikipediaContent.ts', () => nearby);
}

test('Wikipedia narration reads the exact article as clean attributed text without sending GPS or credentials', async () => {
  let request;
  const api = service({ fetch: async (url, options) => {
    request = { url: new URL(url), options };
    return response(makePage({ extract: '<b>Địa danh</b> là công trình lịch sử.[1] Xem https://example.com/ref để biết thêm.' }));
  } });
  const content = await api.fetchWikipediaContent(makePlace(), 'vi');
  assert.equal(request.url.origin, 'https://vi.wikipedia.org');
  assert.equal(request.url.searchParams.get('pageids'), '51');
  assert.equal(request.url.searchParams.get('explaintext'), '1');
  assert.equal(request.url.searchParams.get('exintro'), '1');
  assert.equal(request.url.searchParams.get('redirects'), '1');
  assert.equal(request.url.searchParams.get('origin'), '*');
  assert.equal(request.url.searchParams.has('gscoord'), false);
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.headers, undefined);
  assert.equal(content.language, 'vi');
  assert.equal(content.source, 'wikipedia');
  assert.equal(content.text, 'Địa danh là công trình lịch sử. Xem để biết thêm.');
  assert.equal(content.sourceUrl, 'https://vi.wikipedia.org/?curid=51');
  assert.equal(content.licenseUrl, 'https://creativecommons.org/licenses/by-sa/4.0/');
  assert.match(content.attribution, /Wikipedia.*CC BY-SA 4\.0/);
});

test('English, French and Japanese use exact linked language pages rather than relabelling Vietnamese text', async () => {
  for (const [language, title, text] of [
    ['en', 'Historic landmark', 'This historic landmark has a documented architectural heritage.'],
    ['fr', 'Monument historique', 'Ce monument historique présente un patrimoine architectural documenté.'],
    ['ja', '歴史的な建物', 'この歴史的な建物には、文献に記録されている建築の歴史があります。'],
  ]) {
    const calls = [];
    const api = service({ fetch: async url => {
      const parsed = new URL(url); calls.push(parsed);
      return calls.length === 1 ? response(makePage({ langlinks: [{ lang: language, title }] }))
        : response(makePage({ pageid: 92, title, extract: text }));
    } });
    const content = await api.fetchWikipediaContent(makePlace(), language);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].origin, `https://${language}.wikipedia.org`);
    assert.equal(calls[1].searchParams.get('titles'), title);
    assert.equal(content.language, language); assert.equal(content.text, text);
    assert.equal(content.sourceUrl, `https://${language}.wikipedia.org/?curid=92`);
  }
});

test('missing translations, missing pages, namespaces, disambiguation and empty extracts stay unavailable', async () => {
  assert.equal(await service().fetchWikipediaContent(makePlace(), 'en'), null);
  for (const extra of [
    { missing: true }, { invalid: true }, { ns: 6 }, { pageprops: { disambiguation: '' } },
    { extract: '' }, { extract: '<ref>reference only</ref>' }, { pageid: -1 },
  ]) assert.equal(await service({ fetch: async () => response(makePage(extra)) }).fetchWikipediaContent(makePlace(), 'vi'), null);
});

test('provided article coordinates must match and invalid place coordinates never trigger network', async () => {
  for (const point of [null, { lat: 91, lon: 106 }, { lat: 20, lon: 106 }, { lat: 10.75, lon: 106.65, globe: 'mars' }]) {
    const api = service({ fetch: async () => response(makePage({ coordinates: [point] })) });
    assert.equal(await api.fetchWikipediaContent(makePlace(), 'vi'), null);
  }
  const api = service({ fetch: async () => assert.fail('invalid coordinates must not be sent') });
  assert.equal(await api.fetchWikipediaContent(makePlace({ latitude: NaN }), 'vi'), null);
  assert.equal(await api.fetchWikipediaContent(makePlace({ longitude: 181 }), 'vi'), null);
});

test('OSM/Wikidata require explicit trusted Wikipedia identity; names and Commons do not imply an article', async () => {
  let calls = 0;
  const api = service({ fetch: async () => { calls++; return response(makePage()); } });
  for (const sourceUrl of ['https://www.wikidata.org/wiki/Q123', 'https://commons.wikimedia.org/wiki/File:Example.jpg',
    'http://vi.wikipedia.org/wiki/Test', 'https://vi.wikipedia.org.evil.test/wiki/Test', 'https://name:pass@vi.wikipedia.org/wiki/Test']) {
    assert.equal(await api.fetchWikipediaContent(makePlace({ id: 'osm-node-1', source: 'osm', sourceUrl }), 'vi'), null);
  }
  assert.equal(calls, 0);
  const content = await api.fetchWikipediaContent(makePlace({ id: 'osm-node-1', source: 'osm', wikipediaUrl: 'https://vi.wikipedia.org/wiki/Địa_danh' }), 'vi');
  assert.equal(content.source, 'wikipedia'); assert.equal(calls, 1);
  const tagged = await api.fetchWikipediaContent(makePlace({ id: 'wikidata-Q1', source: 'wikidata', wikipedia: { language: 'vi', pageId: 51 } }), 'vi');
  assert.equal(tagged.source, 'wikipedia');
});

test('cache separates language and coordinates, expires, permits explicit retry and never caches failures', async () => {
  let now = 0; let calls = 0; let fail = false;
  class Clock extends Date { static now() { return now; } }
  const api = service({ Date: Clock, fetch: async () => { calls++; if (fail) throw new TypeError('offline'); return response(makePage()); } });
  await api.fetchWikipediaContent(makePlace(), 'vi'); await api.fetchWikipediaContent(makePlace(), 'vi'); assert.equal(calls, 1);
  await api.fetchWikipediaContent(makePlace(), 'en'); assert.equal(calls, 2);
  await api.fetchWikipediaContent(makePlace({ latitude: coordinates.latitude + 0.00001 }), 'vi'); assert.equal(calls, 3);
  now += 30 * 60_000 + 1; await api.fetchWikipediaContent(makePlace(), 'vi'); assert.equal(calls, 4);
  fail = true;
  await assert.rejects(api.fetchWikipediaContent(makePlace(), 'vi', { forceRefresh: true }), /Không kết nối được Wikipedia/);
  fail = false;
  assert.equal((await api.fetchWikipediaContent(makePlace(), 'vi')).language, 'vi');
  assert.equal(calls, 5); // The last successful cached content was preserved across a failed refresh.
});

test('caller cancellation, pre-cancellation and total timeout reject with actionable errors', async () => {
  const waiting = (_, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  const controller = new AbortController();
  const api = service({ fetch: waiting });
  const pending = api.fetchWikipediaContent(makePlace(), 'vi', { signal: controller.signal });
  controller.abort(); await assert.rejects(pending, error => error.name === 'AbortError');
  await assert.rejects(api.fetchWikipediaContent(makePlace(), 'vi', { signal: controller.signal }), error => error.name === 'AbortError');
  await assert.rejects(service({ fetch: waiting, timers: true }).fetchWikipediaContent(makePlace(), 'vi'), /quá 8 giây/);
});

test('deep links resolve exact article IDs and real coordinates after reload, including redirects', async () => {
  let request; let calls = 0;
  const api = service({ fetch: async url => { request = new URL(url); calls++; return response(makePage({ pageid: 71, title: 'Tên đã chuyển hướng' })); } });
  const place = await api.fetchWikipediaPlace('wiki-vi-51');
  assert.equal(request.searchParams.get('pageids'), '51');
  assert.equal(place.id, 'wiki-vi-51'); assert.equal(place.wikipedia.pageId, 71);
  assert.equal(place.latitude, coordinates.latitude); assert.equal(place.longitude, coordinates.longitude);
  assert.equal(place.source, 'wikipedia'); assert.equal(place.narration.vi.source, 'wikipedia');
  assert.equal(place.description.en, ''); assert.equal(place.sourceUrl, 'https://vi.wikipedia.org/?curid=71');
  const content = await api.fetchWikipediaContent(place, 'vi');
  assert.equal(content.text, place.narration.vi.text); assert.equal(calls, 1);
});

test('deep links never invent absent coordinates or resolve arbitrary IDs', async () => {
  const api = service({ fetch: async () => response(makePage({ coordinates: [] })) });
  assert.equal(await api.fetchWikipediaPlace('wiki-vi-51'), null);
  const noFetch = service({ fetch: async () => assert.fail('unrecognized ID must not fetch') });
  for (const id of ['osm-node-51', 'wikidata-Q1', 'wiki-xx-51', 'wiki-vi--1']) assert.equal(await noFetch.fetchWikipediaPlace(id), null);
});

test('plain text cleanup removes scripts, markup, templates, URLs and footnotes without a browser DOM', () => {
  const api = service();
  const dirty = '<script>bad()</script><!-- hidden -->&lt;b&gt;Địa danh&lt;/b&gt; &#x1F3DB; {{cite|x}} [[Địa danh|Công trình]] [https://example.com nguồn] [1] == Lịch sử == Đây là nội dung. <ref>secret</ref>';
  const text = api.cleanNarrationText(dirty);
  assert.match(text, /Địa danh 🏛 Công trình nguồn Lịch sử\. Đây là nội dung\./);
  assert.doesNotMatch(text, /bad|hidden|secret|https|\[|\{|<|>/);
  assert.equal(api.cleanNarrationText('Một &#999999999; công trình &#0; lịch sử.'), 'Một công trình lịch sử.');
  assert.ok(api.cleanNarrationText('Văn bản. '.repeat(5000)).length <= 20_000);
});

test('HTTP/API/malformed payload errors remain errors and can be retried', async () => {
  for (const result of [
    { ok: false, status: 503 }, { ok: true, json: async () => ({ error: { code: 'badvalue' } }) },
    { ok: true, json: async () => ({ query: {} }) }, { ok: true, json: async () => { throw new SyntaxError('bad JSON'); } },
  ]) await assert.rejects(service({ fetch: async () => result }).fetchWikipediaContent(makePlace(), 'vi'), /Wikipedia/);
});
