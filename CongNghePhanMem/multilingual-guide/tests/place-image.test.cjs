const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const React = require('react');
const ts = require('typescript');

// Exercise the actual component, including keyed remounts and effect cleanup.
// Native image/network callbacks are deterministic fixtures, not device requests.
function renderImage(initialProps) {
  const instances = new Map(), types = new Map(), timers = new Map();
  let current, hookIndex, props = initialProps, tree, dirty, now = 0, sequence = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const slot = initial => {
    const owner = current, index = hookIndex++;
    if (!owner.hooks[index]) owner.hooks[index] = initial();
    return [owner.hooks[index], owner];
  };
  const hooks = {
    useState(initial) {
      const [saved, owner] = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
      if (!saved.update) saved.update = value => {
        if (!owner.alive) return;
        const next = typeof value === 'function' ? value(saved.value) : value;
        if (!Object.is(next, saved.value)) { saved.value = next; dirty = true; }
      };
      return [saved.value, saved.update];
    },
    useRef(initial) { return slot(() => ({ current: initial }))[0]; },
    useCallback(callback, dependencies) {
      const [saved] = slot(() => ({}));
      if (!same(saved.dependencies, dependencies)) Object.assign(saved, { value: callback, dependencies });
      return saved.value;
    },
    useEffect(effect, dependencies) {
      const [saved] = slot(() => ({}));
      if (!same(saved.dependencies, dependencies)) Object.assign(saved, { pending: effect, dependencies });
    },
  };
  const modules = {
    react: hooks,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      Image: 'Image', View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator',
      StyleSheet: { absoluteFill: {}, flatten: value => Array.isArray(value) ? Object.assign({}, ...value) : value },
    },
    '@expo/vector-icons': { Ionicons: 'Icon' },
    '../hooks/useI18n': { useI18n: () => ({ t: value => value }) },
    '../services/api': { API_BASE_URL: 'https://api.example.test' },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/PlaceImage.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports,
    require: name => { assert.ok(modules[name], `Unexpected import ${name}`); return modules[name]; },
    setTimeout: (callback, duration) => { const id = ++sequence; timers.set(id, { callback, due: now + duration }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  function resolve(node, path) {
    if (Array.isArray(node)) return node.map((child, index) => resolve(child, `${path}/${index}`));
    if (!React.isValidElement(node)) return node;
    if (node.type === React.Fragment) return resolve(node.props.children, `${path}/fragment`);
    if (typeof node.type === 'function') {
      if (!types.has(node.type)) types.set(node.type, types.size);
      const identity = `${path}/${types.get(node.type)}:${node.key ?? ''}`;
      let instance = instances.get(identity);
      if (!instance) { instance = { hooks: [], alive: true }; instances.set(identity, instance); }
      instance.used = true;
      current = instance; hookIndex = 0;
      return resolve(node.type(node.props), identity);
    }
    return { type: node.type, props: node.props, children: resolve(node.props.children, `${path}/children`) };
  }
  function flush() {
    do {
      dirty = false;
      for (const instance of instances.values()) instance.used = false;
      tree = resolve(React.createElement(exports.default, props), 'root');
      for (const [identity, instance] of instances) if (!instance.used) {
        instance.alive = false;
        for (const hook of instance.hooks) hook.cleanup?.();
        instances.delete(identity);
      }
      for (const instance of instances.values()) for (const hook of instance.hooks) if (hook.pending) {
        hook.cleanup?.(); hook.cleanup = hook.pending(); delete hook.pending;
      }
    } while (dirty);
  }
  function nodes(type, node) {
    if (arguments.length === 1) node = tree;
    if (Array.isArray(node)) return node.flatMap(child => nodes(type, child));
    if (!node || typeof node !== 'object') return [];
    return [...(node.type === type ? [node] : []), ...nodes(type, node.children)];
  }
  flush();
  return {
    nodes,
    get image() { return nodes('Image')[0]; },
    get retry() { return nodes('Pressable')[0]; },
    get text() { return nodes('Text').map(node => node.children).join(' '); },
    get pendingTimers() { return timers.size; },
    flush,
    update(value) { props = value; flush(); },
    event(node, name) { node.props[name]({ stopPropagation() {} }); flush(); },
    advance(duration) {
      const target = now + duration;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        now = next[1].due; timers.delete(next[0]); next[1].callback(); flush();
      }
      now = target;
    },
    dispose() {
      for (const instance of instances.values()) {
        instance.alive = false;
        for (const hook of instance.hooks) hook.cleanup?.();
      }
      instances.clear();
    },
  };
}

const full = 'https://images.example.test/place.jpg';
const thumbnail = 'https://images.example.test/thumbnail.jpg';

test('missing and unsupported URLs show a placeholder without a request, timer, or retry', () => {
  for (const uri of ['', 'javascript:alert(1)', 'ftp://images.example.test/place.jpg', 'blob:preview']) {
    const app = renderImage({ uri });
    assert.equal(app.image, undefined); assert.equal(app.retry, undefined);
    assert.equal(app.pendingTimers, 0); assert.match(app.text, uri ? /Không tải được ảnh địa điểm/ : /Chưa có ảnh địa điểm/);
  }
});

test('a valid image keeps its label and cover layout, ends loading and does not time out after success', () => {
  const app = renderImage({ uri: full, label: 'Museum photograph', style: { width: 320, height: 180 } });
  assert.equal(app.image.props.source.uri, full);
  assert.equal(app.image.props.accessibilityLabel, 'Museum photograph');
  assert.equal(app.image.props.resizeMode, 'cover');
  assert.equal(app.nodes('ActivityIndicator').length, 1);
  app.event(app.image, 'onLoad');
  assert.equal(app.nodes('ActivityIndicator').length, 0);
  app.advance(120000);
  assert.equal(app.image.props.source.uri, full); assert.equal(app.retry, undefined);
  app.dispose(); assert.equal(app.pendingTimers, 0);
});

test('thumbnail failure falls back once to full image, and exhausted failures wait for user retry', () => {
  const app = renderImage({ uri: full, thumbnailUri: thumbnail });
  const oldThumbnail = app.image;
  app.event(oldThumbnail, 'onError');
  assert.equal(app.image.props.source.uri, full);
  app.event(oldThumbnail, 'onError');
  assert.equal(app.image.props.source.uri, full, 'duplicate obsolete callback cannot fail the full image');
  app.event(app.image, 'onError');
  assert.equal(app.image, undefined); assert.match(app.text, /Không tải được ảnh địa điểm/);
  assert.equal(app.retry.props.accessibilityRole, 'button');
  assert.equal(app.retry.props.accessibilityLabel, 'Thử tải ảnh');
  assert.equal(app.pendingTimers, 0);
  app.advance(120000); assert.equal(app.image, undefined);
  app.event(app.retry, 'onPress');
  assert.equal(app.image.props.source.uri, thumbnail); assert.equal(app.pendingTimers, 1);
  app.event(app.image, 'onLoad');
  app.event(oldThumbnail, 'onError');
  assert.equal(app.image.props.source.uri, thumbnail);
  assert.equal(app.nodes('ActivityIndicator').length, 0);
  app.dispose();
});

test('identical thumbnail and full URLs fail once without automatically requesting the same URL again', () => {
  const app = renderImage({ uri: full, thumbnailUri: full });
  app.event(app.image, 'onError');
  assert.equal(app.image, undefined); assert.ok(app.retry);
  assert.equal(app.pendingTimers, 0);
});

test('a source change resets prior failures and ignores stale load/error callbacks', () => {
  const app = renderImage({ uri: full });
  const old = app.image;
  app.event(old, 'onError'); assert.ok(app.retry);
  app.update({ uri: thumbnail, label: 'A different place' });
  assert.equal(app.image.props.source.uri, thumbnail);
  app.event(old, 'onLoad'); app.event(old, 'onError');
  assert.equal(app.nodes('ActivityIndicator').length, 1, 'old load must not hide the new source spinner');
  assert.equal(app.image.props.source.uri, thumbnail);
  app.update({ uri: full });
  assert.ok(app.image, 'a previously failed URL must be attempted after the source pair changes');
  assert.equal(app.image.props.source.uri, full, 'a URL that failed in an earlier source pair can load again');
  app.event(app.image, 'onLoad');
  app.advance(120000); assert.equal(app.image.props.source.uri, full);
  app.dispose();
});

test('request timeouts try each source once and clear timers when exhausted or unmounted', () => {
  const app = renderImage({ uri: full, thumbnailUri: thumbnail });
  const old = app.image;
  app.advance(11999); assert.equal(app.image.props.source.uri, thumbnail);
  app.advance(1); assert.equal(app.image.props.source.uri, full);
  app.event(old, 'onLoad');
  assert.equal(app.nodes('ActivityIndicator').length, 1);
  app.advance(12000); assert.equal(app.image, undefined); assert.ok(app.retry);
  assert.equal(app.pendingTimers, 0);
  app.event(app.retry, 'onPress'); assert.equal(app.pendingTimers, 1);
  app.dispose(); assert.equal(app.pendingTimers, 0);
  app.advance(120000);
});

test('compact images and interactive callout images never render a retry control', () => {
  for (const options of [{ style: { width: 64, height: 64 } }, { retryEnabled: false }]) {
    const app = renderImage({ uri: full, ...options });
    app.event(app.image, 'onError');
    assert.equal(app.image, undefined); assert.equal(app.retry, undefined); assert.equal(app.pendingTimers, 0);
  }
});

test('uploaded media resolves against the API and local previews require explicit opt-in', () => {
  const media = renderImage({ uri: '/media/place.jpg' });
  assert.equal(media.image.props.source.uri, 'https://api.example.test/media/place.jpg'); media.dispose();
  for (const uri of ['blob:preview', 'file:///preview.jpg', 'content://preview', 'data:image/jpeg;base64,ZmFrZQ==']) {
    const app = renderImage({ uri, localPreview: true });
    assert.equal(app.image.props.source.uri, uri); app.dispose();
  }
});


test('load status distinguishes missing, transient failure, and recovery', () => {
  const states = [];
  const callback = state => states.push(state);
  const app = renderImage({ uri: '', onStatusChange: callback });
  assert.equal(states.at(-1), 'missing');
  app.update({ uri: full, thumbnailUri: thumbnail, onStatusChange: callback });
  assert.equal(states.at(-1), 'loading');
  app.event(app.image, 'onError');
  assert.equal(states.at(-1), 'loading', 'thumbnail failure alone is not a failed cover');
  app.event(app.image, 'onError');
  assert.equal(states.at(-1), 'unavailable');
  app.event(app.retry, 'onPress');
  assert.equal(states.at(-1), 'loading');
  app.event(app.image, 'onLoad');
  assert.equal(states.at(-1), 'loaded');
  app.dispose();
});

test('loaded status describes a thumbnail preview without probing the original', () => {
  const states = [];
  const app = renderImage({ uri: full, thumbnailUri: thumbnail, onStatusChange: state => states.push(state) });
  assert.equal(app.image.props.source.uri, thumbnail);
  app.event(app.image, 'onLoad');
  assert.equal(states.at(-1), 'loaded');
  assert.equal(app.image.props.source.uri, thumbnail);
  app.dispose();
});
