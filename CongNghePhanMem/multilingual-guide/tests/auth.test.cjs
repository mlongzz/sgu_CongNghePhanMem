const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, process: { env: { EXPO_PUBLIC_API_URL: 'http://test.invalid' } }, AbortController, setTimeout, clearTimeout, Error, TypeError, ...globals });
  return exports;
}
const { validateAuth } = load('src/services/authValidation.ts');
const valid = { register: true, name: 'Nguyễn An', email: 'an@example.com', password: 'Password123!', confirm: 'Password123!' };
test('required fields, email format, mismatch and backend password boundaries', () => {
  const empty = validateAuth({ register: true, name: '', email: '', password: '', confirm: '' });
  for (const field of ['name', 'email', 'password', 'confirm']) assert.ok(empty[field]);
  assert.ok(validateAuth({ ...valid, email: 'invalid' }).email);
  assert.ok(validateAuth({ ...valid, confirm: 'different' }).confirm);
  assert.ok(validateAuth({ ...valid, password: '1234567' }).password);
  assert.ok(validateAuth({ ...valid, password: 'a'.repeat(129) }).password);
  assert.equal(Object.keys(validateAuth(valid)).length, 0);
  assert.equal(Object.keys(validateAuth({ ...valid, register: false, password: 'old' })).length, 0);
});
test('registration sends the exact backend schema', async () => {
  let body;
  const api = load('src/services/api.ts', { fetch: async (url, options) => { assert.equal(url, 'http://test.invalid/users'); body = JSON.parse(options.body); return { ok: true, json: async () => ({ id: 1 }) }; } });
  await api.registerUser('An', 'an@example.com', 'Password123!', 'ja');
  assert.deepEqual(body, { full_name: 'An', email: 'an@example.com', password: 'Password123!', language: 'ja' });
});
test('wrong password and duplicate email become readable errors', async () => {
  for (const [status, detail, expected] of [[401, 'Invalid email or password', /không đúng/], [409, 'Email already registered', /đã được đăng ký/]]) {
    const api = load('src/services/api.ts', { fetch: async () => ({ ok: false, status, json: async () => ({ detail }) }) });
    await assert.rejects(api.signIn('an@example.com', 'bad'), e => e.status === status && expected.test(e.message));
  }
});
test('expired access token is refreshed and original request retried once', async () => {
  const sent = [];
  const api = load('src/services/api.ts', { fetch: async (_, options) => { sent.push(options.headers.Authorization); return sent.length === 1 ? { ok: false, status: 401, json: async () => ({}) } : { ok: true, json: async () => ({ id: 1 }) }; } });
  api.setSessionRecovery(async old => { assert.equal(old, 'expired'); return 'renewed'; });
  await api.getUserProfile('expired');
  assert.deepEqual(sent, ['Bearer expired', 'Bearer renewed']);
});
test('invalid renewed token cannot cause an infinite retry', async () => {
  let count = 0;
  const api = load('src/services/api.ts', { fetch: async () => { count++; return { ok: false, status: 401, json: async () => ({}) }; } });
  api.setSessionRecovery(async () => 'invalid');
  await assert.rejects(api.getUserProfile('expired'));
  assert.equal(count, 2);
});
test('offline and timeout return user-facing errors', async () => {
  for (const error of [new TypeError('fetch failed'), Object.assign(new Error('aborted'), { name: 'AbortError' })]) {
    const api = load('src/services/api.ts', { fetch: async () => { throw error; } });
    await assert.rejects(api.signIn('a@example.com', 'secret'), /kiểm tra mạng|thời gian chờ/);
  }
});

test('speech chunks preserve long multilingual scripts including emoji', () => {
  const { splitSpeechText } = load('src/services/speechText.ts');
  for (const text of ['', 'こんにちは。 Xin chào! 🌍 '.repeat(300), 'a'.repeat(2200)]) {
    const chunks = splitSpeechText(text);
    assert.equal(chunks.join(''), text);
    assert.ok(chunks.every(chunk => Array.from(chunk).length <= 750));
  }
});

test('auto guide requires accurate GPS, chooses nearest, and rearms after leaving', () => {
  const nearby = load('src/services/nearby.ts', { require: () => ({ API_BASE_URL: '', apiFetch: async () => [] }) });
  const { chooseAutoGuide } = load('src/services/autoGuide.ts', { require: () => nearby });
  const here = { latitude: 10, longitude: 106 };
  const place = { ...here, id: 'db-1', source: 'backend' };
  const heard = new Set();
  assert.equal(chooseAutoGuide(here, 100, [place], heard), null);
  assert.equal(chooseAutoGuide(here, null, [place], heard), null);
  assert.equal(chooseAutoGuide(here, 5, [place], heard).id, 'db-1');
  heard.add('db-1');
  assert.equal(chooseAutoGuide(here, 5, [place], heard), null);
  assert.equal(chooseAutoGuide({ latitude: 11, longitude: 106 }, 5, [place], heard), null);
  assert.equal(heard.size, 0);
  assert.equal(chooseAutoGuide(here, 5, [{ ...place, source: 'osm' }], heard), null);
});

test('backend place adapter rejects invalid locations and keeps real address and image URL', () => {
  const { validateBackendPlace } = load('src/services/nearby.ts', { require: () => ({ API_BASE_URL: '' }) });
  const place = { id: 1, name: 'Museum', latitude: 10, longitude: 106, address: 'Real address', image_url: '/media/test.jpg' };
  assert.equal(validateBackendPlace({ ...place, latitude: 91 }), null);
  assert.equal(validateBackendPlace({ ...place, id: undefined }), null);
  const adapted = validateBackendPlace(place);
  assert.equal(adapted.district, 'Real address');
  assert.equal(adapted.image, '/media/test.jpg');
});
