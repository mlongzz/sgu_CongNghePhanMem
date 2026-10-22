const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const position = { coords: { latitude: 10, longitude: 106, accuracy: 5 }, timestamp: 12345 };

function loadWeb({ geolocation, secure = true, browser = true } = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('src/services/locationWatch.web.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, Error, require: () => assert.fail('web watch must not load Expo runtime'),
    ...(browser ? { window: { isSecureContext: secure }, navigator: { geolocation } } : {}) });
  return exports;
}
function loadNative(provider, timers = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('src/services/locationWatch.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, Error, require: () => ({ Accuracy: { High: 4 }, ...provider }),
    setTimeout: timers.setTimeout ?? setTimeout, clearTimeout: timers.clearTimeout ?? clearTimeout });
  return exports;
}

test('Web watch forwards positions and clears the actual nonmatching browser watch ID 77', async () => {
  const cleared = []; const positions = []; let callback; let options;
  const api = loadWeb({ geolocation: {
    watchPosition(success, error, value) { callback = success; options = value; assert.equal(typeof error, 'function'); return 77; },
    clearWatch: id => cleared.push(id),
  } });
  const watcher = await api.watchCoordinates(value => positions.push(value), () => assert.fail('unexpected error'));
  callback(position); assert.equal(positions.length, 1); assert.equal(positions[0].timestamp, position.timestamp);
  assert.equal(positions[0].coords, position.coords);
  assert.equal(options.enableHighAccuracy, true); assert.equal(options.timeout, 30000); assert.equal(options.maximumAge, 0);
  watcher.remove(); watcher.remove(); callback(position);
  assert.deepEqual(cleared, [77]); assert.equal(positions.length, 1);
});

test('Web forwards permission, unavailable and timeout errors through the supplied callback', async () => {
  for (const [code, expected] of [[1, /từ chối/], [2, /không xác định/], [3, /30 giây/]]) {
    let fail; const messages = [];
    const api = loadWeb({ geolocation: { watchPosition: (_, error) => { fail = error; return 77; }, clearWatch() {} } });
    const watcher = await api.watchCoordinates(() => {}, message => messages.push(message));
    fail({ code }); assert.match(messages[0], expected);
    watcher.remove(); fail({ code }); assert.equal(messages.length, 1);
  }
});

test('Web pre-abort does not create a watch and later abort ignores all callbacks', async () => {
  const controller = new AbortController(); let success; let fail; const cleared = []; const events = [];
  const api = loadWeb({ geolocation: { watchPosition: (value, error) => { success = value; fail = error; return 77; }, clearWatch: id => cleared.push(id) } });
  const watcher = await api.watchCoordinates(value => events.push(value), error => events.push(error), controller.signal);
  controller.abort(); watcher.remove(); success(position); fail({ code: 1 });
  assert.deepEqual(cleared, [77]); assert.deepEqual(events, []);
  await assert.rejects(api.watchCoordinates(() => {}, () => {}, controller.signal), error => error.code === 'ABORT_ERR');
});

test('Web cancellation from a synchronous initial callback clears the watch after receiving its ID', async () => {
  const controller = new AbortController(); const cleared = [];
  const api = loadWeb({ geolocation: { watchPosition(success) { success(position); return 77; }, clearWatch: id => cleared.push(id) } });
  const watcher = await api.watchCoordinates(() => controller.abort(), () => {}, controller.signal);
  watcher.remove(); assert.deepEqual(cleared, [77]);
});

test('Web insecure/unsupported/SSR watch calls fail before requesting a browser watch', async () => {
  const geolocation = { watchPosition: () => assert.fail('must not watch') };
  await assert.rejects(loadWeb({ secure: false, geolocation }).watchCoordinates(() => {}, () => {}), /localhost hoặc HTTPS/);
  await assert.rejects(loadWeb().watchCoordinates(() => {}, () => {}), /không hỗ trợ/);
  await assert.rejects(loadWeb({ browser: false }).watchCoordinates(() => {}, () => {}), /không hỗ trợ/);
});

test('native watch uses Expo High accuracy without asking for permission and removes once', async () => {
  let callback; let errorCallback; let options; let removed = 0; const events = [];
  const api = loadNative({ watchPositionAsync: async (value, success, error) => { options = value; callback = success; errorCallback = error; return { remove: () => removed++ }; },
    requestForegroundPermissionsAsync: () => assert.fail('caller already owns permission') });
  const watcher = await api.watchCoordinates(value => events.push(value), message => events.push(message));
  callback(position); errorCallback('native provider error');
  assert.equal(options.accuracy, 4); assert.equal(options.distanceInterval, 15); assert.equal(options.timeInterval, 5000);
  assert.equal(events[0], position); assert.equal(events[1], 'native provider error');
  watcher.remove(); watcher.remove(); callback(position); errorCallback('ignored');
  assert.equal(removed, 1); assert.equal(events.length, 2);
});

test('native abort rejects a pending creation and removes a subscription that arrives late', async () => {
  const controller = new AbortController(); let create; let callback; let removed = 0; const positions = [];
  const api = loadNative({ watchPositionAsync: (_, success) => { callback = success; return new Promise(resolve => { create = resolve; }); } });
  const pending = api.watchCoordinates(value => positions.push(value), () => {}, controller.signal);
  controller.abort(); await assert.rejects(pending, error => error.code === 'ABORT_ERR');
  callback(position); create({ remove: () => removed++ }); await Promise.resolve();
  assert.equal(removed, 1); assert.deepEqual(positions, []);
  await assert.rejects(api.watchCoordinates(() => {}, () => {}, controller.signal), error => error.code === 'ABORT_ERR');
});

test('native abort after creation removes the watch and ignores late positions and errors', async () => {
  const controller = new AbortController(); let callback; let errorCallback; let removed = 0; const events = [];
  const api = loadNative({ watchPositionAsync: async (_, success, error) => { callback = success; errorCallback = error; return { remove: () => removed++ }; } });
  const watcher = await api.watchCoordinates(value => events.push(value), error => events.push(error), controller.signal);
  controller.abort(); watcher.remove(); callback(position); errorCallback('late error');
  assert.equal(removed, 1); assert.deepEqual(events, []);
});

test('native creation is bounded at 30s and removes a late subscription after timeout', async () => {
  let deadline; let duration; let create; let removed = 0;
  const api = loadNative({ watchPositionAsync: () => new Promise(resolve => { create = resolve; }) }, {
    setTimeout: (callback, ms) => { deadline = callback; duration = ms; return 1; }, clearTimeout() {},
  });
  const pending = api.watchCoordinates(() => assert.fail('no active callbacks'), () => {});
  assert.equal(duration, 30000); const rejected = assert.rejects(pending, error => error.code === 'WATCH_TIMEOUT'); deadline(); await rejected;
  create({ remove: () => removed++ }); await Promise.resolve(); assert.equal(removed, 1);
});

test('native provider rejection does not leave a timer or abort listener active', async () => {
  let cleared = 0; const listeners = new Set();
  const signal = { aborted: false, addEventListener: (_, callback) => listeners.add(callback), removeEventListener: (_, callback) => listeners.delete(callback) };
  const api = loadNative({ watchPositionAsync: async () => { throw new Error('native unavailable'); } }, { setTimeout: () => 1, clearTimeout: () => cleared++ });
  await assert.rejects(api.watchCoordinates(() => {}, () => {}, signal), /native unavailable/); assert.equal(cleared, 1); assert.equal(listeners.size, 0);
});
