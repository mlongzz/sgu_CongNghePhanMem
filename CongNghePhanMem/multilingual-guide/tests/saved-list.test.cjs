const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const subject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/savedList.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: subject });

const places = [
  { id: '1', title: 'Bảo tàng Mỹ thuật', district: 'Quận 1', category: 'Văn hóa' },
  { id: '2', title: 'Đường sách', district: 'Nguyễn Văn Bình', category: 'Khám phá' },
  { id: '3', title: 'Nhà hát Thành phố', district: 'Đồng Khởi', category: 'Kiến trúc' },
];

test('saved search matches Vietnamese accents, đ, case and extra spaces', () => {
  assert.deepEqual(subject.filterSavedPlaces(places, '  DUONG   SACH ').map(p => p.id), ['2']);
  assert.deepEqual(subject.filterSavedPlaces(places, 'bảo TÀNG').map(p => p.id), ['1']);
});

test('saved search combines words across name, address and category', () => {
  assert.deepEqual(subject.filterSavedPlaces(places, 'bao tang quan 1 van hoa').map(p => p.id), ['1']);
  assert.deepEqual(subject.filterSavedPlaces(places, 'hat dong khoi').map(p => p.id), ['3']);
  assert.equal(subject.filterSavedPlaces(places, 'bao tang quan 2').length, 0);
});

test('empty searches preserve order and objects; special characters are literal text', () => {
  assert.equal(subject.filterSavedPlaces(places, '  '), places);
  assert.equal(subject.filterSavedPlaces(places, '[').length, 0);
  assert.equal(subject.filterSavedPlaces(places, 'sach')[0], places[1]);
  assert.deepEqual(places.map(p => p.id), ['1', '2', '3']);
  assert.equal(subject.filterSavedPlaces([], 'sach').length, 0);
});

test('name sorting handles numbers, supports reverse order and never changes stored order', () => {
  const rows = [{ id: 1, title: 'Điểm 10' }, { id: 2, title: 'Điểm 2' }, { id: 3, title: 'Điểm 1' }];
  assert.deepEqual(subject.sortSavedPlaces(rows, 'name-asc').map(p => p.id), [3, 2, 1]);
  assert.deepEqual(subject.sortSavedPlaces(rows, 'name-desc').map(p => p.id), [1, 2, 3]);
  assert.deepEqual(rows.map(p => p.id), [1, 2, 3]);
  assert.equal(subject.sortSavedPlaces(rows, 'saved'), rows);
});

test('equal names retain their saved order and sorting composes with searching', () => {
  const rows = [{ id: 1, title: 'Bảo tàng' }, { id: 2, title: 'bảo tàng' }];
  assert.deepEqual(subject.sortSavedPlaces(rows, 'name-desc').map(p => p.id), [1, 2]);
  const filtered = subject.filterSavedPlaces(places, 'quan 1');
  assert.equal(subject.sortSavedPlaces(filtered, 'name-asc', 'en')[0], places[0]);
});
