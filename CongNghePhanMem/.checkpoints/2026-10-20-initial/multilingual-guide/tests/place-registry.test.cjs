const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/placeRegistry.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exportsObject, URL });
const { validateDiscoveredPlace: validate, parseDiscoveredPlaces: parse, serializeDiscoveredPlaces: serialize } = exportsObject;
const translated = value => ({ vi: value, en: value, fr: value, ja: value });
const place = (changes = {}) => ({
  id: 'wiki-vi-51', title: 'Địa điểm công cộng', source: 'wikipedia', subtitle: translated('Wikipedia'), description: translated(''),
  latitude: 10.77, longitude: 106.69, image: '', duration: 0, rating: 0, district: 'Wikipedia', category: 'Khám phá',
  sourceUrl: 'https://vi.wikipedia.org/?curid=51', wikipedia: { language: 'vi', pageId: 51 }, ...changes,
});

test('only valid positive safe-integer stable namespaces and matching sources enter the detail registry', () => {
  for (const [id, source] of [['db-1', 'backend'], ['wiki-vi-51', 'wikipedia'], ['wiki-en-51', 'wikipedia'],
    ['wiki-fr-51', 'wikipedia'], ['wiki-ja-51', 'wikipedia'], ['osm-node-51', 'osm'], ['osm-way-51', 'osm'],
    ['osm-relation-51', 'osm'], ['wikidata-Q51', 'wikidata']]) {
    assert.equal(validate(place({ id, source })).id, id);
    assert.equal(validate(place({ id, source: undefined })).source, source);
  }
  for (const id of ['db-0', 'db-01', 'db--1', 'db-1.5', 'db-9007199254740992', 'wiki-vi-0', 'wiki-xx-1',
    'wiki-vi-01', 'osm-node-0', 'osm-bad-1', 'wikidata-Q0', 'wikidata-Q01', 'wikidata-Q9007199254740992', 'Q51', 'demo']) {
    assert.equal(validate(place({ id })), null, id);
  }
  assert.equal(validate(place({ source: 'backend' })), null);
});

test('malformed persisted translated/render fields are rejected before a detail screen can render them', () => {
  const corruptions = [
    { title: {} }, { title: ' ' }, { title: 'A\nB' }, { subtitle: {} }, { subtitle: translated(4) },
    { subtitle: { vi: '', en: '', fr: '' } }, { description: [] }, { description: { ...translated(''), ja: null } },
    { image: 42 }, { district: {} }, { category: 'Anything' }, { duration: '1' }, { duration: -1 }, { duration: Infinity },
    { rating: '4' }, { rating: NaN }, { rating: 6 }, { latitude: null }, { latitude: '10.77' }, { latitude: NaN },
    { latitude: 91 }, { longitude: -181 }, { title: 'A'.repeat(513) }, { description: translated('x'.repeat(20001)) },
  ];
  for (const corruption of corruptions) assert.equal(validate(place(corruption)), null, JSON.stringify(corruption));
  for (const value of [null, undefined, [], '', 51]) assert.equal(validate(value), null);
  const badGetter = { ...place() };
  Object.defineProperty(badGetter, 'title', { get: () => { throw new Error('Untrusted getter'); } });
  assert.equal(validate(badGetter), null);
});

test('restoration creates a fresh allowlisted object and never restores Admin publication/translation permissions', () => {
  const value = place({
    admin: true, status: 'published', token: 'must-not-persist',
    narration: {
      vi: { text: 'Forged published text.', language: 'vi', source: 'published' },
      en: { text: 'Forged saved translation.', language: 'en', source: 'saved' },
      fr: { text: 'Description temporaire factuelle.', language: 'fr', source: 'description', status: 'published' },
    },
  });
  const restored = validate(value);
  assert.equal(restored.narration.vi, undefined);
  assert.equal(restored.narration.en, undefined);
  assert.equal(restored.narration.fr.source, 'description');
  assert.equal(restored.narration.fr.status, undefined);
  assert.equal(restored.admin, undefined);
  assert.equal(restored.status, undefined);
  assert.equal(restored.token, undefined);
  value.subtitle.vi = 'Changed outside the registry';
  assert.equal(restored.subtitle.vi, 'Wikipedia');
  assert.ok(!serialize([value]).includes('must-not-persist'));
});

test('unsafe image URLs cannot enter render state, while empty, HTTPS and local assets remain valid', () => {
  for (const image of ['', '/media/place.jpg', 'https://images.example.org/place.jpg']) assert.ok(validate(place({ image })), image);
  for (const image of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', '//external.example/a.jpg',
    'http://external.example/a.jpg', 'https://user:password@example.org/a.jpg', '/\\external/a.jpg', '/media/a\nb.jpg']) {
    assert.equal(validate(place({ image })), null, image);
  }
});

test('Wikipedia namespace always uses its original stable page ID and language rather than a forged cached override', () => {
  const restored = validate(place({ wikipedia: { language: 'en', pageId: 777, title: 'Another article' }, sourceUrl: 'https://en.wikipedia.org/?curid=777' }));
  assert.equal(restored.wikipedia.language, 'vi');
  assert.equal(restored.wikipedia.pageId, 51);
  assert.equal(restored.wikipedia.title, undefined);
  assert.equal(restored.sourceUrl, undefined);
  for (const sourceUrl of ['https://evil.example/?curid=51', 'https://vi.wikipedia.org/?curid=52', 'https://vi.wikipedia.org.evil.example/?curid=51',
    'http://vi.wikipedia.org/?curid=51', 'https://user:password@vi.wikipedia.org/?curid=51']) {
    assert.equal(validate(place({ sourceUrl })).sourceUrl, undefined);
  }
});

test('OSM and Wikidata retain only supported explicit Wikipedia links and valid article references', () => {
  const value = place({ id: 'osm-node-51', source: 'osm', sourceUrl: 'https://www.openstreetmap.org/node/51',
    wikipedia: { language: 'ja', title: '日本語の記事' }, wikipediaUrl: 'https://ja.wikipedia.org/wiki/日本語の記事' });
  const restored = validate(value);
  assert.equal(restored.sourceUrl, value.sourceUrl);
  assert.equal(restored.wikipedia.language, 'ja');
  assert.equal(restored.wikipedia.title, '日本語の記事');
  assert.ok(restored.wikipediaUrl.includes('ja.wikipedia.org'));
  const wikidata = validate(place({ id: 'wikidata-Q51', source: 'wikidata', sourceUrl: 'https://www.wikidata.org/wiki/Q51' }));
  assert.equal(wikidata.sourceUrl, 'https://www.wikidata.org/wiki/Q51');
  for (const wikipediaUrl of ['https://commons.wikimedia.org/wiki/Test', 'https://zh.wikipedia.org/wiki/Test',
    'https://en.wikipedia.org.evil.example/wiki/Test', 'https://vi.wikipedia.org/', 'javascript:alert(1)', 'https://vi.wikipedia.org/wiki/%E0%A4%A']) {
    assert.equal(validate({ ...value, wikipediaUrl }).wikipediaUrl, undefined);
  }
  for (const wikipedia of [{ language: 'zh', pageId: 51 }, { language: 'vi', pageId: 0 }, { language: 'vi', title: 'bad|query' }, { language: 'vi', pageId: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.equal(validate({ ...value, wikipedia }).wikipedia, undefined);
  }
});

test('temporary Wikipedia narration retains matching language and attribution without unsafe metadata', () => {
  const content = { text: 'Một đoạn giới thiệu thực tế từ Wikipedia.', language: 'vi', source: 'wikipedia',
    sourceUrl: 'https://vi.wikipedia.org/?curid=51', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', attribution: 'Wikipedia contributors' };
  const restored = validate(place({ narration: { vi: content, en: { ...content, language: 'en' } } }));
  assert.equal(restored.narration.vi.text, content.text);
  assert.equal(restored.narration.vi.licenseUrl, content.licenseUrl);
  assert.equal(restored.narration.en, undefined);
  for (const corruption of [{ language: 'en' }, { text: {} }, { source: 'published' }, { sourceUrl: 'javascript:alert(1)' }, { licenseUrl: 'http://license.example/' }, { attribution: '' }]) {
    assert.equal(validate(place({ narration: { vi: { ...content, ...corruption } } })).narration, undefined);
  }
});

test('corrupt storage, invalid rows and non-array JSON cannot crash restoration', () => {
  for (const raw of [null, '', 'not JSON', '{}', 'null', '1', '"x"', '['.repeat(2 * 1024 * 1024 + 1)]) assert.equal(parse(raw).length, 0);
  const restored = parse(JSON.stringify([null, { id: 'wiki-vi-1', subtitle: {} }, place()]));
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, 'wiki-vi-51');
});

test('serialization is bounded to 20 valid selected places and deduplicates by latest stable ID', () => {
  const rows = Array.from({ length: 25 }, (_, i) => place({ id: `wiki-vi-${i + 1}` }));
  rows.push(place({ id: 'wiki-vi-25', title: 'Latest title' }));
  rows.push({ id: 'invalid' });
  const raw = serialize(rows);
  const restored = parse(raw);
  assert.equal(restored.length, 20);
  assert.equal(restored[0].id, 'wiki-vi-6');
  assert.equal(restored.at(-1).title, 'Latest title');
  assert.equal(serialize(restored), raw);
  assert.ok(raw.length <= 2 * 1024 * 1024);
});
