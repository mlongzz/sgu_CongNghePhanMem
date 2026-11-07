const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const subject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/photoStories.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: subject });

test('a real requested translation keeps its own text and speech language', () => {
  const result = subject.selectPhotoStory({ vi: 'Tiếng Việt', en: ' English story ' }, 'en');
  assert.equal(result.text, 'English story');
  assert.equal(result.language, 'en');
  assert.equal(result.fallback, false);
});

test('a missing or whitespace-only translation uses Vietnamese text and a Vietnamese voice', () => {
  for (const en of [undefined, '', '  ']) {
    const result = subject.selectPhotoStory({ vi: ' Câu chuyện ảnh ', en }, 'en');
    assert.equal(result.text, 'Câu chuyện ảnh');
    assert.equal(result.language, 'vi');
    assert.equal(result.fallback, true);
  }
});

test('unrelated languages and malformed content cannot masquerade as a requested story', () => {
  for (const stories of [null, undefined, {}, { fr: 'Français' }, { en: 42, vi: [] }]) {
    assert.equal(subject.selectPhotoStory(stories, 'en'), null);
  }
});

test('Vietnamese content requested in Vietnamese is not labelled as a fallback', () => {
  assert.equal(subject.selectPhotoStory({ vi: 'Câu chuyện' }, 'vi').fallback, false);
});
