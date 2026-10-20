const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const point = { latitude: 10.75, longitude: 106.65 };
const text = 'Đây là nội dung thuyết minh có nguồn gốc được ghi rõ cho người nghe.';
const place = (extra = {}) => ({ id: 'wiki-vi-51', title: 'Chợ thử nghiệm', source: 'wikipedia', ...point,
  description: { vi: 'Metadata giới thiệu chưa được duyệt.', en: 'Metadata only.', fr: '', ja: '' }, ...extra });
const content = (source, language = 'vi', value = text) => ({ text: value, source, language });
class ApiError extends Error { constructor(status, message = 'API error') { super(message); this.status = status; } }

function service({ guide = async () => { throw new ApiError(404); }, wiki = async () => null } = {}) {
  const globals = { AbortController, Error, TypeError, SyntaxError, URL, URLSearchParams, setTimeout, clearTimeout };
  const compile = (path, require) => {
    const exports = {};
    const source = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(source, { ...globals, exports, require });
    return exports;
  };
  const nearby = compile('src/services/nearby.ts', () => ({ API_BASE_URL: '' }));
  const cleanup = compile('src/services/wikipediaContent.ts', () => nearby).cleanNarrationText;
  return compile('src/services/narration.ts', module => module === './api' ? { ApiError, getGuideContent: guide }
    : module === './nearby' ? nearby : { cleanNarrationText: cleanup, fetchWikipediaContent: wiki });
}

test('published PostgreSQL guide has priority over saved and Wikipedia content in the selected language', async () => {
  let request;
  const api = service({ guide: async (id, language) => { request = { id, language }; return { content: '<p>Bài chính thức đã được xuất bản.</p>', language_code: 'vi' }; },
    wiki: async () => assert.fail('published content should win before Wikipedia') });
  const result = await api.resolveNarration(place({ id: 'db-12', source: 'backend', narration: { vi: content('saved') } }), 'vi');
  assert.deepEqual(request, { id: '12', language: 'vi' });
  assert.equal(result.source, 'published'); assert.equal(result.text, 'Bài chính thức đã được xuất bản.');
});

test('community landmark prefers matching published title and coordinates, but never guesses an unrelated official place', async () => {
  let calls = 0;
  const api = service({ guide: async id => { calls++; assert.equal(id, '7'); return { content: text, language_code: 'vi' }; } });
  const catalog = [place({ id: 'db-7', source: 'backend', title: 'Cho thu nghiem' })];
  assert.equal((await api.resolveNarration(place(), 'vi', { officialPlaces: catalog })).source, 'published');
  assert.equal(calls, 1);
  for (const official of [
    place({ id: 'db-7', title: 'Một địa danh khác' }), place({ id: 'db-7', latitude: 11 }), place({ id: 'osm-node-7', title: 'Chợ thử nghiệm' }),
  ]) assert.equal(await api.resolveNarration(place(), 'vi', { officialPlaces: [official] }), null);
  assert.equal(calls, 1);
});

test('a missing published language falls through to permitted exact-language saved content before Wikipedia', async () => {
  const api = service({ wiki: async () => assert.fail('saved content should win') });
  const result = await api.resolveNarration(place({ id: 'db-1', source: 'backend', narration: { vi: content('saved') } }), 'vi');
  assert.equal(result.source, 'saved'); assert.equal(result.language, 'vi'); assert.equal(result.text, text);
});

test('Wikipedia content wins over a factual description and retains attribution and community status', async () => {
  const wikipedia = { ...content('wikipedia'), sourceUrl: 'https://vi.wikipedia.org/?curid=51', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' };
  const api = service({ wiki: async () => wikipedia });
  const result = await api.resolveNarration(place({ narration: { vi: content('description', 'vi', 'Thông tin mô tả ngắn được cung cấp trực tiếp bởi địa điểm.') } }), 'vi');
  assert.equal(result.source, 'wikipedia'); assert.equal(result.sourceUrl, wikipedia.sourceUrl); assert.equal(result.licenseUrl, wikipedia.licenseUrl);
});

test('only explicitly adapted meaningful descriptions are read; generic metadata and unreviewed local drafts are ignored', async () => {
  const api = service();
  const result = await api.resolveNarration(place({ source: 'osm', id: 'osm-node-1', narration: { vi: content('description') } }), 'vi');
  assert.equal(result.source, 'description'); assert.equal(result.text, text);
  assert.equal(await api.resolveNarration(place({ drafts: { vi: text }, draft: text, description: { vi: text } }), 'vi'), null);
  assert.equal(await api.resolveNarration(place({ narration: { vi: content('description', 'vi', 'Wikipedia') } }), 'vi'), null);
  assert.equal(await api.resolveNarration(place({ narration: { vi: content('draft') } }), 'vi'), null);
});

test('foreign language saved text and published API fallback are never read with a different voice', async () => {
  const api = service();
  for (const foreign of [content('saved', 'en'), content('description', 'ja')]) {
    assert.equal(await api.resolveNarration(place({ narration: { vi: foreign } }), 'vi'), null);
  }
  const published = service({ guide: async () => ({ content: 'This English text must not be passed to a Japanese voice.', language_code: 'en' }) });
  await assert.rejects(published.resolveNarration(place({ id: 'db-1' }), 'ja'), /khác ngôn ngữ/);
});

test('OSM, Wikipedia and Wikidata IDs are never sent to PostgreSQL guide endpoints', async () => {
  const api = service({ guide: async () => assert.fail('community IDs must not reach official guide API'), wiki: async () => content('wikipedia') });
  for (const id of ['osm-node-12', 'osm-way-12', 'osm-relation-12', 'wiki-vi-12', 'wikidata-Q12']) {
    assert.equal((await api.resolveNarration(place({ id }), 'vi')).source, 'wikipedia');
  }
});

test('network/server errors remain retryable errors rather than being misreported as no narration', async () => {
  for (const failure of [new ApiError(503, 'Backend unavailable'), new TypeError('offline')]) {
    const api = service({ guide: async () => { throw failure; }, wiki: async () => assert.fail('server failure must remain visible') });
    await assert.rejects(api.resolveNarration(place({ id: 'db-1' }), 'vi'), error => error === failure);
  }
  const wikiFailure = new Error('Wikipedia timeout');
  await assert.rejects(service({ wiki: async () => { throw wikiFailure; } }).resolveNarration(place(), 'vi'), error => error === wikiFailure);
});

test('pre-cancellation and late content after cancellation cannot start narration', async () => {
  const controller = new AbortController(); controller.abort();
  const api = service({ guide: async () => assert.fail('already cancelled') });
  await assert.rejects(api.resolveNarration(place({ id: 'db-1' }), 'vi', { signal: controller.signal }), error => error.name === 'AbortError');
  const late = new AbortController();
  const delayed = service({ wiki: async () => { late.abort(); return content('wikipedia'); } });
  await assert.rejects(delayed.resolveNarration(place(), 'vi', { signal: late.signal }), error => error.name === 'AbortError');
});

test('zero, non-canonical and unsafe PostgreSQL IDs cannot be sent as official guide requests', async () => {
  const api = service({ guide: async () => assert.fail('invalid database identity must not reach the API') });
  for (const id of ['db-0', 'db-01', 'db--1', 'db-9007199254740993']) assert.equal(await api.resolveNarration(place({ id }), 'vi'), null);
});

test('explicit draft or unpublished flags and malformed saved text never become published narration', async () => {
  for (const flags of [{ status: 'draft' }, { is_published: false }, { published: false }, { is_draft: true }]) {
    const api = service({ guide: async () => ({ content: text, language_code: 'vi', ...flags }) });
    assert.equal(await api.resolveNarration(place({ id: 'db-1' }), 'vi'), null);
    assert.equal(await service().resolveNarration(place({ narration: { vi: { ...content('saved'), ...flags } } }), 'vi'), null);
  }
  assert.equal(await service().resolveNarration(place({ narration: { vi: content('saved', 'vi', { corrupt: true }) } }), 'vi'), null);
  assert.equal(await service().resolveNarration(place({ narration: { vi: content('saved', 'vi', '123456789012345678901234567890') } }), 'vi'), null);
});

test('Wikipedia failures may keep an explicitly factual description with a visible fallback attribution', async () => {
  const api = service({ wiki: async () => { throw new Error('Wikipedia unavailable'); } });
  const result = await api.resolveNarration(place({ narration: { vi: content('description') } }), 'vi');
  assert.equal(result.source, 'description'); assert.equal(result.text, text);
  assert.match(result.attribution, /không tải được nội dung Wikipedia/);
  assert.match(result.attribution, /thử lại/);
});

test('unexpected Wikipedia language is rejected before narration is returned', async () => {
  const api = service({ wiki: async () => content('wikipedia', 'en') });
  await assert.rejects(api.resolveNarration(place(), 'vi'), /khác ngôn ngữ/);
});
