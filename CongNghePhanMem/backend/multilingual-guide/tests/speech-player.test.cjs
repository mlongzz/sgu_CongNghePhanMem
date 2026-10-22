const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function service(globals = {}) {
  const cached = new Map();
  const load = file => {
    if (cached.has(file)) return cached.get(file);
    const exports = {};
    cached.set(file, exports);
    const source = ts.transpileModule(fs.readFileSync(`src/services/${file}.ts`, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, {
      exports, process: { env: {} }, setTimeout, clearTimeout, Error, ...globals,
      require: path => load(path.replace('./', '')),
    });
    return exports;
  };
  return { ...load('speechPlayer'), ...load('speechText') };
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const voices = [{ identifier: 'vi', language: 'vi-VN' }, { identifier: 'en', language: 'en-US' },
  { identifier: 'fr', language: 'fr-FR' }, { identifier: 'ja', language: 'ja-JP' }];
function harness({ platform = 'web', driver: overrides = {}, options = {}, globals } = {}) {
  const calls = [];
  const states = [];
  const progress = [];
  const driver = {
    maxSpeechInputLength: 750,
    getAvailableVoicesAsync: async () => voices,
    stop: async () => { calls.push({ type: 'stop' }); },
    pause: async () => { calls.push({ type: 'pause' }); },
    resume: async () => { calls.push({ type: 'resume' }); },
    speak: (text, options) => { calls.push({ type: 'speak', text, options }); options.onStart(); },
    ...overrides,
  };
  const player = service(globals).createSpeechPlayer(driver, platform, state => states.push(state), {
    onProgress: (id, value) => progress.push({ id, value }), voiceRetryDelayMs: 1, ...options,
  });
  return { calls, states, progress, player, driver, spoken: () => calls.filter(call => call.type === 'speak'), state: () => states.at(-1) };
}

test('all four installed language voices and all requested rates are passed without silent language fallback', async () => {
  const h = harness();
  for (const [index, language] of ['vi', 'en', 'fr', 'ja'].entries()) {
    await h.player.play('Meaningful narration.', language, [.75, 1, 1.25, 1.5][index], `wiki-${language}-1`);
    const call = h.spoken().at(-1);
    assert.equal(call.options.voice, language);
    assert.equal(call.options.language, voices[index].language);
    assert.equal(call.options.rate, [.75, 1, 1.25, 1.5][index]);
    assert.equal(h.state().status, 'playing');
  }
  h.player.dispose();
});

test('long multilingual narration queues one chunk at a time, preserves Unicode and reports exact completion', async () => {
  const h = harness({ driver: { maxSpeechInputLength: 31 } });
  const text = 'Thuyết minh tiếng Việt. 日本語。 Café! 🏛️ '.repeat(10);
  await h.player.play(text, 'vi', 1, 'wiki-vi-10');
  assert.equal(h.spoken().length, 1);
  for (let index = 0; index < h.spoken().length; index++) {
    const chunk = h.spoken()[index];
    assert.ok(chunk.text.length <= 31);
    assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(chunk.text));
    chunk.options.onDone();
    chunk.options.onDone(); // Duplicate/late platform callbacks cannot enqueue twice.
  }
  assert.equal(h.spoken().map(call => call.text).join(''), text);
  assert.equal(h.progress.at(-1).value, 1);
  assert.equal(h.state().status, 'idle');
  h.player.dispose();
});

test('surrogate pairs count toward the actual device input limit', () => {
  const { splitSpeechText } = service();
  const text = '🏛'.repeat(20);
  const chunks = splitSpeechText(text, 7);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every(chunk => chunk.length <= 7 && !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(chunk)));
  assert.throws(() => splitSpeechText('🏛', 1), /Unicode/);
});

test('stop while installed voices are still loading prevents future speech and late callbacks', async () => {
  const lookup = deferred();
  const h = harness({ driver: { getAvailableVoicesAsync: () => lookup.promise } });
  const playing = h.player.play('Never read this stale place.', 'vi', 1, 'wiki-vi-1');
  await tick();
  assert.equal(h.state().status, 'loading');
  h.player.stop();
  lookup.resolve(voices);
  await playing;
  assert.equal(h.spoken().length, 0);
  assert.equal(h.state().id, null);
  h.player.dispose();
});

test('rapid taps for another place, language and speed never overlap or accept old lookup results', async () => {
  const first = deferred();
  let lookups = 0;
  const h = harness({ driver: { getAvailableVoicesAsync: () => ++lookups === 1 ? first.promise : Promise.resolve(voices) } });
  const old = h.player.play('Old place in Vietnamese.', 'vi', .75, 'db-1');
  await tick();
  await h.player.play('New French article.', 'fr', 1.5, 'wiki-fr-2');
  first.resolve(voices);
  await old;
  assert.equal(h.spoken().length, 1);
  assert.equal(h.spoken()[0].text, 'New French article.');
  const stale = h.spoken()[0].options;
  await h.player.play('Replacement English.', 'en', 1.25, 'osm-node-3');
  stale.onDone(); stale.onError(); stale.onStopped();
  assert.equal(h.spoken().length, 2);
  assert.equal(h.state().id, 'osm-node-3');
  assert.equal(h.state().error, '');
  h.player.dispose();
});

test('same-tick play calls serialize stop operations and start only the latest request', async () => {
  const stopping = deferred();
  let count = 0;
  const h = harness({ driver: { stop: async () => { if (++count === 1) await stopping.promise; } } });
  const first = h.player.play('Old', 'vi', 1, 'db-1');
  const second = h.player.play('Latest', 'ja', 1, 'wiki-ja-2');
  await tick();
  assert.equal(h.spoken().length, 0);
  stopping.resolve();
  await Promise.all([first, second]);
  assert.equal(count, 2);
  assert.equal(h.spoken().length, 1);
  assert.equal(h.spoken()[0].text, 'Latest');
  h.player.dispose();
});

test('an installed same-language regional voice is allowed, but another language is rejected', async () => {
  const h = harness({ driver: { getAvailableVoicesAsync: async () => [{ identifier: 'gb', language: 'en_GB' }] } });
  await h.player.play('An English guide.', 'en', 1, 'wiki-en-1');
  assert.equal(h.spoken()[0].options.voice, 'gb');
  await h.player.play('Une visite française.', 'fr', 1, 'wiki-fr-2');
  assert.equal(h.spoken().length, 1);
  assert.match(h.state().error, /chưa có giọng đọc tiếng Pháp/);
  assert.equal(h.state().id, null);
  h.player.dispose();
});

test('web retries an initially empty voice list, and missing voices stay an actionable retry error', async () => {
  let calls = 0;
  const h = harness({ driver: { getAvailableVoicesAsync: async () => ++calls < 3 ? [] : voices } });
  await h.player.play('Now available.', 'vi', 1, 'wiki-vi-1');
  assert.equal(calls, 3);
  assert.equal(h.spoken().length, 1);
  h.driver.getAvailableVoicesAsync = async () => [];
  await h.player.play('No installed voices.', 'ja', 1, 'wiki-ja-2');
  assert.match(h.state().error, /cài giọng nói/);
  assert.equal(h.state().status, 'idle');
  h.player.dispose();
});

test('a voice service that never responds times out; a subsequent retry can succeed', async () => {
  const h = harness({ driver: { getAvailableVoicesAsync: () => new Promise(() => {}) }, options: { voiceTimeoutMs: 5 } });
  await h.player.play('Pending forever.', 'vi', 1, 'wiki-vi-1');
  assert.equal(h.state().status, 'idle');
  assert.match(h.state().error, /chưa tải được danh sách/);
  h.driver.getAvailableVoicesAsync = async () => voices;
  await h.player.play('Retry works.', 'vi', 1, 'wiki-vi-1');
  assert.equal(h.spoken().length, 1);
  h.player.dispose();
});

test('silent autoplay denial, thrown speak failures and platform onError each produce a visible retry state', async () => {
  const h = harness({ driver: { speak: () => {} }, options: { startTimeoutMs: 5 } });
  await h.player.play('Autoplay blocked.', 'vi', 1, 'wiki-vi-1');
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.match(h.state().error, /Giọng đọc chưa bắt đầu/);
  h.driver.speak = () => { throw new Error('Engine unavailable'); };
  await h.player.play('Throw.', 'vi', 1, 'wiki-vi-1');
  assert.match(h.state().error, /Engine unavailable/);
  h.driver.speak = (text, options) => options.onError(new Error('Device failure'));
  await h.player.play('Callback error.', 'vi', 1, 'wiki-vi-1');
  assert.match(h.state().error, /Không phát được giọng đọc/);
  h.player.dispose();
});

test('pause and resume keep the utterance and long chunk chain on supported platforms', async () => {
  for (const platform of ['web', 'ios']) {
    const h = harness({ platform, driver: { maxSpeechInputLength: 8 } });
    await h.player.play('First. Second. Third.', 'vi', 1, 'wiki-vi-1');
    await h.player.pause();
    assert.equal(h.state().status, 'paused');
    h.spoken()[0].options.onStopped(); // Defensive: a pause event is not an actual stop.
    assert.equal(h.state().status, 'paused');
    h.spoken()[0].options.onDone(); // A chunk ending during the pause must wait for resume.
    assert.equal(h.spoken().length, 1);
    await h.player.resume();
    assert.equal(h.spoken().length, 2);
    assert.equal(h.state().status, 'playing');
    h.player.dispose();
  }
});

test('Android never invokes unsupported pause/resume functions', async () => {
  const h = harness({ platform: 'android', driver: { pause: async () => assert.fail('Unsupported'), resume: async () => assert.fail('Unsupported') } });
  await h.player.play('Android narration.', 'vi', 1, 'db-1');
  await h.player.pause();
  await h.player.resume();
  assert.equal(h.state().status, 'playing');
  h.player.dispose();
});

test('unmount disposal cancels loading, ignores all late platform events and never emits again', async () => {
  const h = harness();
  await h.player.play('Dispose this player.', 'vi', 1, 'wiki-vi-1');
  const callbacks = h.spoken()[0].options;
  h.player.dispose();
  const count = h.states.length;
  callbacks.onDone(); callbacks.onError(); callbacks.onStart(); callbacks.onPause(); callbacks.onResume(); callbacks.onStopped();
  await h.player.play('Must never start.', 'fr', 1, 'wiki-fr-2');
  assert.equal(h.states.length, count);
  assert.equal(h.spoken().length, 1);
});

test('browser adapter uses synchronous real voice selection and preserves end callbacks after pause/resume', async () => {
  let utterance;
  let canceled = 0;
  class Utterance { constructor(text) { this.text = text; } }
  const synthesis = {
    getVoices: () => [{ voiceURI: 'vi', lang: 'vi-VN' }],
    speak: value => { utterance = value; value.onstart(); },
    cancel: () => { canceled++; },
    pause: () => utterance.onpause(), resume: () => utterance.onresume(),
  };
  const { createSpeechPlayer, createWebSpeechDriver } = service({ window: { speechSynthesis: synthesis }, SpeechSynthesisUtterance: Utterance });
  const states = [];
  const player = createSpeechPlayer(createWebSpeechDriver(), 'web', value => states.push(value));
  await player.play('Browser article.', 'vi', 1.25, 'wiki-vi-10');
  assert.equal(utterance.voice.voiceURI, 'vi');
  assert.equal(utterance.text, 'Browser article.');
  await player.pause();
  assert.equal(states.at(-1).status, 'paused');
  await player.resume();
  assert.equal(states.at(-1).status, 'playing');
  utterance.onend();
  assert.equal(states.at(-1).status, 'idle');
  player.stop();
  await tick();
  assert.ok(canceled >= 2);
  player.dispose();
});

test('a browser without SpeechSynthesis and invalid/empty input fail clearly without invoking speech', async () => {
  const { createSpeechPlayer, createWebSpeechDriver } = service();
  const states = [];
  const player = createSpeechPlayer(createWebSpeechDriver(), 'web', value => states.push(value));
  await player.play('Unsupported.', 'vi', 1, 'wiki-vi-1');
  assert.match(states.at(-1).error, /chưa hỗ trợ đọc thuyết minh/);
  player.dispose();
  const h = harness();
  await h.player.play('  ', 'vi', 1, 'wiki-vi-1');
  assert.match(h.state().error, /chưa có nội dung thuyết minh/);
  await h.player.play('Invalid rate.', 'vi', NaN, 'wiki-vi-1');
  assert.match(h.state().error, /không hợp lệ/);
  assert.equal(h.spoken().length, 0);
  h.player.dispose();
});

test('explicit installed voice selection is preserved and never silently falls back to a different voice', async () => {
  const h = harness({ driver: { getAvailableVoicesAsync: async () => [
    ...voices, { identifier: 'vi-second', language: 'vi_VN', name: 'Vietnamese second voice' },
  ] } });
  await h.player.play('Bài thuyết minh bằng giọng đã chọn.', 'vi', 1.25, 'wiki-vi-1', 'vi-second');
  assert.equal(h.spoken()[0].options.voice, 'vi-second');
  await h.player.play('Missing voice.', 'vi', 1, 'wiki-vi-1', 'removed-voice');
  assert.match(h.state().error, /không còn khả dụng/);
  await h.player.play('Wrong voice language.', 'vi', 1, 'wiki-vi-1', 'en');
  assert.match(h.state().error, /không còn khả dụng/);
  assert.equal(h.spoken().length, 1);
  h.player.dispose();
});

test('a chunk finishing during a rejected pause request resumes the chain instead of remaining stranded', async () => {
  const paused = deferred();
  const h = harness({ driver: { maxSpeechInputLength: 8, pause: () => paused.promise } });
  await h.player.play('First. Second. Third.', 'vi', 1, 'wiki-vi-1');
  const request = h.player.pause();
  h.spoken()[0].options.onDone();
  assert.equal(h.spoken().length, 1);
  paused.reject(new Error('Pause unavailable'));
  await request;
  assert.equal(h.spoken().length, 2);
  assert.equal(h.state().status, 'playing');
  h.player.dispose();
});
