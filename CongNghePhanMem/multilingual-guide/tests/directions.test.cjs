const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness(platform, { popup = {}, nativeReject = false } = {}) {
  const exports = {}, calls = [], alerts = [];
  const native = {
    Platform: { OS: platform },
    Alert: { alert: (title, message) => alerts.push([title, message]) },
    Linking: { openURL: async url => { calls.push(url); if (nativeReject) throw new Error('blocked'); } },
  };
  const window = {
    open: (url, target) => { calls.push([url, target]); return popup; },
    alert: message => alerts.push(message),
  };
  const source = ts.transpileModule(fs.readFileSync('src/services/directions.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, require: name => name === 'react-native' ? native : {}, window });
  return { ...exports, calls, alerts, popup };
}

test('directions use selected coordinates without sending a user origin', async () => {
  const h = harness('web');
  assert.equal(await h.openDirections({ latitude: 10.772521, longitude: 106.698019 }, x => x), true);
  const url = new URL(h.calls[0][0]);
  assert.equal(url.searchParams.get('destination'), '10.772521,106.698019');
  assert.equal(url.searchParams.get('travelmode'), 'walking');
  assert.equal(url.searchParams.has('origin'), false);
  assert.equal(h.popup.opener, null);
  assert.equal(h.alerts.length, 0);
});

test('blocked browser, native failure, and invalid coordinates give feedback', async () => {
  const browser = harness('web', { popup: null });
  assert.equal(await browser.openDirections({ latitude: 10, longitude: 106 }, x => x), false);
  assert.match(browser.alerts[0], /cửa sổ mới/);
  const native = harness('ios', { nativeReject: true });
  assert.equal(await native.openDirections({ latitude: 10, longitude: 106 }, x => x), false);
  assert.match(native.alerts[0][1], /ứng dụng bản đồ/);
  const invalid = harness('android');
  assert.equal(await invalid.openDirections({ latitude: NaN, longitude: 106 }, x => x), false);
  assert.equal(invalid.calls.length, 0);
  assert.equal(invalid.alerts.length, 1);
});
