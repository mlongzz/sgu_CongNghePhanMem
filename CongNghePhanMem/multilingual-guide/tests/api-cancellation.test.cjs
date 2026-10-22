const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const tick = () => new Promise(resolve => setImmediate(resolve));
const aborted = () => Object.assign(new Error('mock aborted'), { name: 'AbortError' });
function service(fetch, { fastTimeout = false } = {}) {
  const exports = {};
  const delays = [];
  const cleared = [];
  const source = ts.transpileModule(fs.readFileSync('src/services/api.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, fetch, AbortController, Error, TypeError,
    process: { env: { EXPO_PUBLIC_API_URL: 'https://backend.invalid/' } },
    setTimeout: (fn, delay) => { delays.push(delay); return setTimeout(fn, fastTimeout ? 5 : delay); },
    clearTimeout: timer => { cleared.push(timer); clearTimeout(timer); },
  });
  return { ...exports, delays, cleared };
}
const response = (value = {}, status = 200) => ({ ok: status < 400, status, json: async () => value });

test('a pre-aborted caller starts neither fetch nor a timeout', async () => {
  const api = service(() => assert.fail('Network must not start'));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(api.apiFetch('/places', { signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(api.delays.length, 0);
});

test('caller cancellation reaches the merged fetch signal and is distinct from a network timeout', async () => {
  let forwarded;
  const api = service(async (_, options) => {
    forwarded = options.signal;
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(aborted()), { once: true }));
  });
  const controller = new AbortController();
  const pending = api.apiFetch('/places', { signal: controller.signal });
  await tick();
  assert.notEqual(forwarded, controller.signal);
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError' && /hủy/.test(error.message));
  assert.equal(forwarded.aborted, true);
  assert.equal(api.cleared.length, 1);
});

test('the bounded network timeout aborts fetch with a retry message and leaves the caller signal reusable', async () => {
  const controller = new AbortController();
  let forwarded;
  const api = service(async (_, options) => {
    forwarded = options.signal;
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(aborted()), { once: true }));
  }, { fastTimeout: true });
  await assert.rejects(api.apiFetch('/places', { signal: controller.signal }), error => error.name !== 'AbortError' && /quá thời gian chờ/.test(error.message));
  assert.equal(api.delays[0], 12000);
  assert.equal(forwarded.aborted, true);
  assert.equal(controller.signal.aborted, false);
  assert.equal(api.cleared.length, 1);
});

test('success and HTTP errors remove their caller listener and timeout', async () => {
  for (const status of [200, 503]) {
    const controller = new AbortController();
    const originalAdd = controller.signal.addEventListener.bind(controller.signal);
    const originalRemove = controller.signal.removeEventListener.bind(controller.signal);
    let added = 0, removed = 0;
    controller.signal.addEventListener = (...args) => { added++; return originalAdd(...args); };
    controller.signal.removeEventListener = (...args) => { removed++; return originalRemove(...args); };
    const api = service(async () => response({ detail: 'Service unavailable' }, status));
    if (status === 200) await api.apiFetch('/places', { signal: controller.signal });
    else await assert.rejects(api.apiFetch('/places', { signal: controller.signal }), error => error.status === 503);
    assert.equal(added, 1);
    assert.equal(removed, 1);
    assert.equal(api.cleared.length, 1);
  }
});

test('aborting while the response body is loading cannot be swallowed as a successful null response', async () => {
  const controller = new AbortController();
  let bodyStarted;
  const started = new Promise(resolve => { bodyStarted = resolve; });
  const api = service(async (_, options) => ({ ok: true, status: 200, json: () => {
    bodyStarted();
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(aborted()), { once: true }));
  } }));
  const pending = api.apiFetch('/places/1/guide-content', { signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
});

test('a timeout while reading JSON remains a timeout instead of an empty successful guide', async () => {
  const api = service(async (_, options) => ({ ok: true, status: 200, json: () =>
    new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(aborted()), { once: true })),
  }), { fastTimeout: true });
  await assert.rejects(api.apiFetch('/places/1/guide-content'), /quá thời gian chờ/);
});

test('a canceled auth recovery cannot retry the protected request after the caller has left', async () => {
  let finishRecovery;
  const recovery = new Promise(resolve => { finishRecovery = resolve; });
  let calledRecovery;
  const recoveryStarted = new Promise(resolve => { calledRecovery = resolve; });
  let requests = 0;
  const api = service(async () => { requests++; return response({ detail: 'Expired' }, 401); });
  api.setSessionRecovery(async () => { calledRecovery(); return recovery; });
  const controller = new AbortController();
  const pending = api.apiFetch('/users/me', { token: 'test-expired-only', signal: controller.signal });
  await recoveryStarted;
  controller.abort();
  finishRecovery('test-renewed-only');
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(requests, 1);
});

test('public content fetches never inherit authentication from earlier account calls', async () => {
  const requests = [];
  const api = service(async (url, options) => { requests.push({ url, options }); return response({ content: 'A public guide.' }); });
  await api.getUserProfile('test-token-only', false);
  await api.getGuideContent('51', 'vi');
  await api.apiFetch('/places');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-token-only');
  for (const request of requests.slice(1)) {
    assert.equal(request.options.headers.Authorization, undefined);
    assert.equal(request.options.token, undefined);
    assert.equal(new URL(request.url).origin, 'https://backend.invalid');
  }
  assert.equal(requests[1].url, 'https://backend.invalid/places/51/guide-content?language=vi');
});
