const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const here = { latitude: 10.7764, longitude: 106.6993 };
function loadWeb({ geolocation, secure = true, timers = false, browser = true } = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('src/services/location.web.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: () => ({}), Error,
    ...(browser ? { window: { isSecureContext: secure }, navigator: { geolocation } } : {}),
    setTimeout: timers ? (fn, ms) => setTimeout(fn, Math.min(ms, 5)) : setTimeout, clearTimeout });
  return exports;
}

test('Web requests position once without requiring Permissions API, with bounded timeout and cache age', async () => {
  let calls = 0; let options;
  const api = loadWeb({ geolocation: { getCurrentPosition: (success, _, value) => { calls++; options = value; success({ coords: here }); } } });
  const result = await api.getCurrentCoordinates();
  assert.deepEqual({ ...result }, here); assert.equal(calls, 1);
  assert.equal(options.timeout, 15000); assert.equal(options.maximumAge, 60000); assert.equal(options.enableHighAccuracy, false);
});

test('denied, unavailable and browser timeout produce actionable GPS errors', async () => {
  for (const [code, pattern] of [[1, /Bạn chưa cấp quyền vị trí/], [2, /bật dịch vụ vị trí/], [3, /15 giây/]]) {
    const api = loadWeb({ geolocation: { getCurrentPosition: (_, error) => error({ code }) } });
    await assert.rejects(api.getCurrentCoordinates(), pattern);
  }
});

test('an unresponsive browser still times out, ignores a late callback and allows a new attempt', async () => {
  let late; let calls = 0;
  const api = loadWeb({ timers: true, geolocation: { getCurrentPosition: success => {
    calls++;
    if (calls === 1) late = success; else success({ coords: here });
  } } });
  await assert.rejects(api.getCurrentCoordinates(), /15 giây/);
  late({ coords: { latitude: 1, longitude: 2 } });
  assert.deepEqual({ ...await api.getCurrentCoordinates() }, here);
});

test('insecure origin, unsupported browser and server execution fail before requesting GPS', async () => {
  const geolocation = { getCurrentPosition: () => assert.fail('must not request GPS') };
  await assert.rejects(loadWeb({ secure: false, geolocation }).getCurrentCoordinates(), /localhost hoặc dùng HTTPS/);
  await assert.rejects(loadWeb().getCurrentCoordinates(), /không hỗ trợ lấy vị trí/);
  await assert.rejects(loadWeb({ browser: false }).getCurrentCoordinates(), /trong trình duyệt/);
});

test('invalid coordinates and a synchronous browser exception remain errors, with no invented fallback', async () => {
  for (const coords of [{ latitude: NaN, longitude: 0 }, { latitude: 91, longitude: 0 }, { latitude: 10, longitude: 181 }, { latitude: '10', longitude: 106 }]) {
    await assert.rejects(loadWeb({ geolocation: { getCurrentPosition: success => success({ coords }) } }).getCurrentCoordinates(), /không hợp lệ/);
  }
  await assert.rejects(loadWeb({ geolocation: { getCurrentPosition: () => { throw new Error('blocked'); } } }).getCurrentCoordinates(), /Không gọi được GPS/);
});

test('native helper retains Expo permission and Balanced accuracy, and denies before reading position', async () => {
  let allowed = true; let calls = 0; let options;
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('src/services/location.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, Error, require: () => ({ Accuracy: { Balanced: 3 },
    requestForegroundPermissionsAsync: async () => ({ granted: allowed }),
    getCurrentPositionAsync: async value => { calls++; options = value; return { coords: here }; } }) });
  assert.deepEqual({ ...await exports.getCurrentCoordinates() }, here);
  assert.equal(options.accuracy, 3); assert.equal(calls, 1);
  allowed = false; await assert.rejects(exports.getCurrentCoordinates(), /chưa cấp quyền/); assert.equal(calls, 1);
});
