const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const here = { latitude: 10.7764, longitude: 106.6993 };

function clock() {
  let now = 0; let sequence = 0; const pending = new Map();
  return {
    setTimeout(fn, ms) { const id = ++sequence; pending.set(id, { fn, due: now + ms }); return id; },
    clearTimeout(id) { pending.delete(id); },
    count: () => pending.size,
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const next = [...pending].filter(([, task]) => task.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        now = next[1].due; pending.delete(next[0]); next[1].fn(); await Promise.resolve();
      }
      now = target; await Promise.resolve();
    },
  };
}
function permission(initial) {
  const listeners = new Set();
  return { state: initial, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn),
    change(state) { this.state = state; for (const fn of [...listeners]) fn(); }, listeners };
}
function loadWeb({ geolocation, secure = true, timers, browser = true, permissions } = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('src/services/location.web.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: () => ({}), Error,
    ...(browser ? { window: { isSecureContext: secure }, navigator: { geolocation, permissions } } : {}),
    setTimeout: timers?.setTimeout ?? setTimeout, clearTimeout: timers?.clearTimeout ?? clearTimeout });
  return exports;
}
function loadNative({ provider = {}, timers } = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('src/services/location.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, Error, require: () => ({ Accuracy: { Balanced: 3 },
    hasServicesEnabledAsync: async () => true,
    requestForegroundPermissionsAsync: async () => ({ granted: true }),
    getCurrentPositionAsync: async () => ({ coords: here }), ...provider }),
    setTimeout: timers?.setTimeout ?? setTimeout, clearTimeout: timers?.clearTimeout ?? clearTimeout });
  return exports;
}
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

test('native cancellation settles immediately even if the OS position provider never responds', async () => {
  const timers = clock(); let finishPosition; const outcomes = [];
  const api = loadNative({ timers, provider: { getCurrentPositionAsync: () => new Promise(resolve => { finishPosition = resolve; }) } });
  const controller = new AbortController();
  api.getCurrentCoordinates({ signal: controller.signal }).then(value => outcomes.push(value), error => outcomes.push(error));
  await flush(); assert.equal(typeof finishPosition, 'function'); controller.abort(); await flush();
  assert.equal(outcomes.length, 1, 'cancel must not wait for the native provider');
  assert.equal(outcomes[0].code, 'ABORT_ERR'); assert.equal(timers.count(), 0);
  finishPosition({ coords: { latitude: 1, longitude: 2 } }); await flush(); assert.equal(outcomes.length, 1);
});

test('native cancellation during the permission dialog never starts acquisition later', async () => {
  const timers = clock(); let finishPermission; let requests = 0; const outcomes = [];
  const api = loadNative({ timers, provider: {
    requestForegroundPermissionsAsync: () => new Promise(resolve => { finishPermission = resolve; }),
    getCurrentPositionAsync: async () => { requests++; return { coords: here }; },
  } });
  const controller = new AbortController();
  api.getCurrentCoordinates({ signal: controller.signal }).then(value => outcomes.push(value), error => outcomes.push(error));
  await flush(); controller.abort(); await flush();
  assert.equal(outcomes[0].code, 'ABORT_ERR'); assert.equal(timers.count(), 0);
  finishPermission({ granted: true }); await flush(); assert.equal(requests, 0); assert.equal(outcomes.length, 1);
});

test('Web retains real accuracy/time and rejects a fix older than the permitted cache age', async () => {
  const timestamp = Date.now();
  const position = { coords: { ...here, accuracy: 250 }, timestamp };
  const result = await loadWeb({ geolocation: { getCurrentPosition: success => success(position) } }).getCurrentCoordinates();
  assert.equal(result.accuracy, 250); assert.equal(result.timestamp, timestamp);
  position.timestamp = timestamp - 120000;
  await assert.rejects(loadWeb({ geolocation: { getCurrentPosition: success => success(position) } }).getCurrentCoordinates(), /vị trí đã cũ/);
});

test('Web uses one real position request without requiring Permissions API and bounds cache age', async () => {
  let calls = 0; let options;
  const api = loadWeb({ geolocation: { getCurrentPosition: (success, _, value) => { calls++; options = value; success({ coords: here }); } } });
  assert.deepEqual({ ...await api.getCurrentCoordinates() }, here); assert.equal(calls, 1);
  assert.equal(options.timeout, 30000); assert.equal(options.maximumAge, 60000); assert.equal(options.enableHighAccuracy, false);
});

test('unavailable/timeout retry once with high accuracy and retain the browser error if both fail', async () => {
  for (const code of [2, 3]) {
    const requests = [];
    const api = loadWeb({ geolocation: { getCurrentPosition: (_, error, options) => { requests.push(options); error({ code, message: 'provider failed' }); } } });
    await assert.rejects(api.getCurrentCoordinates(), error => error.code === code && error.browserMessage === 'provider failed' && /hai lần thử/.test(error.message));
    assert.equal(requests.length, 2); assert.equal(requests[0].enableHighAccuracy, false); assert.equal(requests[1].enableHighAccuracy, true);
  }
});

test('a transient provider failure can recover with a real position from the second request', async () => {
  let calls = 0; const progress = [];
  const api = loadWeb({ geolocation: { getCurrentPosition: (success, error) => {
    if (++calls === 1) error({ code: 2 }); else success({ coords: here });
  } } });
  assert.deepEqual({ ...await api.getCurrentCoordinates({ onProgress: text => progress.push(text) }) }, here);
  assert.equal(calls, 2); assert.ok(progress.some(text => /chính xác cao/.test(text)));
});

test('browser permission denial is actionable and never retried', async () => {
  let calls = 0;
  const api = loadWeb({ geolocation: { getCurrentPosition: (_, error) => { calls++; error({ code: 1, message: 'denied' }); } } });
  await assert.rejects(api.getCurrentCoordinates(), error => error.code === 1 && /Bạn chưa cấp quyền vị trí/.test(error.message));
  assert.equal(calls, 1);
});

test('OS rejection after browser permission is granted points to Windows settings', async () => {
  const status = permission('granted'); let rejectPosition;
  const api = loadWeb({ permissions: { query: async () => status }, geolocation: { getCurrentPosition: (_, error) => { rejectPosition = error; } } });
  const result = api.getCurrentCoordinates(); await Promise.resolve();
  rejectPosition({ code: 1, message: 'User denied Geolocation' });
  await assert.rejects(result, error => error.code === 1 && /Trình duyệt đã cho phép vị trí/.test(error.message) && /Let desktop apps/.test(error.message));
  assert.equal(status.listeners.size, 0);
});

test('slow permission approval does not consume the position deadline or discard a valid late fix', async () => {
  const timers = clock(); const status = permission('prompt'); const progress = []; let success; let calls = 0;
  const api = loadWeb({ timers, permissions: { query: async () => status }, geolocation: { getCurrentPosition: callback => { success = callback; calls++; } } });
  const result = api.getCurrentCoordinates({ onProgress: text => progress.push(text) }); await Promise.resolve();
  await timers.advance(45000); assert.equal(calls, 1);
  assert.ok(progress.some(text => /Thời gian chờ cấp quyền được tính riêng/.test(text)));
  status.change('granted'); await timers.advance(20000);
  success({ coords: here });
  assert.deepEqual({ ...await result }, here); assert.equal(calls, 1); assert.equal(timers.count(), 0); assert.equal(status.listeners.size, 0);
});

test('an unanswered permission prompt ends cleanly and does not repeatedly request position', async () => {
  const timers = clock(); const status = permission('prompt'); let calls = 0;
  const api = loadWeb({ timers, permissions: { query: async () => status }, geolocation: { getCurrentPosition: () => calls++ } });
  const result = api.getCurrentCoordinates(); const rejected = assert.rejects(result, error => error.code === 'PERMISSION_TIMEOUT');
  await Promise.resolve(); await timers.advance(90000); await rejected;
  assert.equal(calls, 1); assert.equal(status.listeners.size, 0); assert.equal(timers.count(), 0);
});

test('missing callbacks retry then end loading; stale success cannot replace the newer attempt', async () => {
  const timers = clock(); const status = permission('granted'); const callbacks = [];
  const api = loadWeb({ timers, permissions: { query: async () => status }, geolocation: { getCurrentPosition: callback => callbacks.push(callback) } });
  const result = api.getCurrentCoordinates(); let settled = false; result.then(() => { settled = true; }, () => { settled = true; });
  await Promise.resolve(); await timers.advance(15000); assert.equal(callbacks.length, 1); assert.equal(settled, false);
  await timers.advance(20000); assert.equal(callbacks.length, 2);
  callbacks[0]({ coords: { latitude: 1, longitude: 2 } }); await Promise.resolve(); assert.equal(settled, false);
  const rejected = assert.rejects(result, error => error.code === 3);
  await timers.advance(35000); await rejected; assert.equal(status.listeners.size, 0); assert.equal(timers.count(), 0);
  callbacks[1]({ coords: here });
});

test('cancel releases timers/listeners, ignores late position and permits a fresh request', async () => {
  const timers = clock(); const status = permission('granted'); const callbacks = [];
  const api = loadWeb({ timers, permissions: { query: async () => status }, geolocation: { getCurrentPosition: callback => callbacks.push(callback) } });
  const controller = new AbortController();
  const result = api.getCurrentCoordinates({ signal: controller.signal }); await Promise.resolve();
  controller.abort(); await assert.rejects(result, error => error.code === 'ABORT_ERR');
  assert.equal(timers.count(), 0); assert.equal(status.listeners.size, 0);
  callbacks[0]({ coords: { latitude: 1, longitude: 2 } });
  const next = api.getCurrentCoordinates(); callbacks[1]({ coords: here }); assert.deepEqual({ ...await next }, here);
  await assert.rejects(api.getCurrentCoordinates({ signal: controller.signal }), error => error.code === 'ABORT_ERR');
  assert.equal(callbacks.length, 2);
});

test('a rejecting, throwing or unresponsive Permissions API cannot prevent reading GPS', async () => {
  for (const query of [() => Promise.reject(new Error('unsupported')), () => { throw new Error('unsupported'); }, () => new Promise(() => {})]) {
    let callback;
    const api = loadWeb({ permissions: { query }, geolocation: { getCurrentPosition: success => { callback = success; } } });
    const result = api.getCurrentCoordinates(); await Promise.resolve(); callback({ coords: here });
    assert.deepEqual({ ...await result }, here);
  }
});

test('insecure origin, unsupported browser and server execution fail before requesting GPS', async () => {
  const geolocation = { getCurrentPosition: () => assert.fail('must not request GPS') };
  await assert.rejects(loadWeb({ secure: false, geolocation }).getCurrentCoordinates(), /localhost hoặc dùng HTTPS/);
  await assert.rejects(loadWeb().getCurrentCoordinates(), /không hỗ trợ lấy vị trí/);
  await assert.rejects(loadWeb({ browser: false }).getCurrentCoordinates(), /trong trình duyệt/);
});

test('invalid coordinates and a synchronous exception remain errors without an invented fallback', async () => {
  for (const position of [null, {}, { coords: null }]) {
    await assert.rejects(loadWeb({ geolocation: { getCurrentPosition: success => success(position) } }).getCurrentCoordinates(), /không hợp lệ/);
  }
  for (const coords of [{ latitude: NaN, longitude: 0 }, { latitude: 91, longitude: 0 }, { latitude: 10, longitude: 181 }, { latitude: '10', longitude: 106 }]) {
    await assert.rejects(loadWeb({ geolocation: { getCurrentPosition: success => success({ coords }) } }).getCurrentCoordinates(), /không hợp lệ/);
  }
  await assert.rejects(loadWeb({ geolocation: { getCurrentPosition: () => { throw new Error('blocked'); } } }).getCurrentCoordinates(), /Không gọi được GPS/);
});

test('native helper retains Expo permission and Balanced accuracy, and checks cancellation', async () => {
  let allowed = true; let calls = 0; let options;
  const api = loadNative({ provider: {
    requestForegroundPermissionsAsync: async () => ({ granted: allowed }),
    getCurrentPositionAsync: async value => { calls++; options = value; return { coords: here }; } } });
  assert.deepEqual({ ...await api.getCurrentCoordinates() }, here);
  assert.equal(options.accuracy, 3); assert.equal(calls, 1);
  allowed = false; await assert.rejects(api.getCurrentCoordinates(), /chưa cấp quyền/); assert.equal(calls, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(api.getCurrentCoordinates({ signal: controller.signal }), /Đã hủy/); assert.equal(calls, 1);
});

test('native permission and acquisition deadlines settle without retrying a stuck provider', async () => {
  for (const step of ['permission', 'position', 'services']) {
    const timers = clock(); const outcomes = []; let requests = 0;
    const api = loadNative({ timers, provider: {
      ...(step === 'services' ? { hasServicesEnabledAsync: () => new Promise(() => {}) } : {}),
      requestForegroundPermissionsAsync: () => step === 'permission' ? new Promise(() => {}) : Promise.resolve({ granted: true }),
      getCurrentPositionAsync: () => { requests++; return step === 'position' ? new Promise(() => {}) : Promise.resolve({ coords: here }); },
    } });
    api.getCurrentCoordinates().then(value => outcomes.push(value), error => outcomes.push(error)); await flush();
    await timers.advance(step === 'permission' ? 90000 : step === 'position' ? 35000 : 10000); await flush();
    assert.equal(outcomes.length, 1, `${step} must finish at its deadline`);
    assert.equal(outcomes[0].code, step === 'permission' ? 'PERMISSION_TIMEOUT' : step === 'position' ? 3 : 'SERVICES_TIMEOUT');
    assert.equal(requests, step === 'position' ? 1 : 0); assert.equal(timers.count(), 0);
  }
});

test('native reports services off and permanent denial before any position request', async () => {
  for (const [provider, expectedCode, message] of [
    [{ hasServicesEnabledAsync: async () => false }, 'SERVICES_DISABLED', /đang tắt/],
    [{ requestForegroundPermissionsAsync: async () => ({ granted: false, canAskAgain: false }) }, 1, /không thể hỏi lại/],
  ]) {
    const api = loadNative({ provider: { ...provider, getCurrentPositionAsync: async () => assert.fail('must not acquire GPS') } });
    await assert.rejects(api.getCurrentCoordinates(), error => error.code === expectedCode && message.test(error.message));
  }
});

test('native validates actual timestamp and preserves reported low accuracy without fabricating GPS', async () => {
  const timestamp = Date.now();
  const api = loadNative({ provider: { getCurrentPositionAsync: async () => ({ coords: { ...here, accuracy: 700 }, timestamp }) } });
  const result = await api.getCurrentCoordinates(); assert.equal(result.accuracy, 700); assert.equal(result.timestamp, timestamp);
  const stale = loadNative({ provider: { getCurrentPositionAsync: async () => ({ coords: here, timestamp: timestamp - 120000 }) } });
  await assert.rejects(stale.getCurrentCoordinates(), error => error.code === 'STALE_POSITION');
  for (const coords of [{ latitude: NaN, longitude: 0 }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }]) {
    await assert.rejects(loadNative({ provider: { getCurrentPositionAsync: async () => ({ coords }) } }).getCurrentCoordinates(), /không hợp lệ/);
  }
  for (const position of [null, {}, { coords: null }]) {
    await assert.rejects(loadNative({ provider: { getCurrentPositionAsync: async () => position } }).getCurrentCoordinates(), /không hợp lệ/);
  }
});
