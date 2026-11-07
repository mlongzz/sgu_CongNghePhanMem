const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function load(file, require = () => ({})) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', source)(module, module.exports, require);
  return module.exports;
}
const district = load('src/data/district1.ts');
const f = load('src/services/touristFilter.ts', name => name === '../data/district1' ? district : {});
const Q1 = { latitude: 10.7771, longitude: 106.6954 };

test('Wikipedia attractions are recognised and get a category', () => {
  const expected = {
    'Dinh Độc Lập': 'Lịch sử',
    'Dinh Norodom': 'Lịch sử',
    'Bảo tàng Thành phố Hồ Chí Minh': 'Lịch sử',
    'Địa đạo Củ Chi': 'Lịch sử',
    'Chùa Ngọc Hoàng': 'Văn hóa',
    'Đền Bà Ấn (Thành phố Hồ Chí Minh)': 'Văn hóa',
    'Đình Minh Hương Gia Thạnh': 'Văn hóa',
    'Hội quán Nghĩa An': 'Văn hóa',
    'Chợ Bến Thành': 'Văn hóa',
    'Nhà hát Thành phố Hồ Chí Minh': 'Văn hóa',
    'Phố đi bộ Nguyễn Huệ': 'Văn hóa',
    'Nhà thờ chính tòa Đức Bà Sài Gòn': 'Kiến trúc',
    'Bưu điện Trung tâm Sài Gòn': 'Kiến trúc',
    'Tòa nhà Bitexco Financial': 'Kiến trúc',
    'Công viên Tao Đàn': 'Khám phá',
    'Công trường Công xã Paris': 'Khám phá',
    'Thảo Cầm Viên Sài Gòn': 'Khám phá',
    'Hồ Con Rùa': 'Khám phá',
    'Bến Nhà Rồng': 'Khám phá',
  };
  for (const [title, category] of Object.entries(expected)) assert.equal(f.classifyTouristTitle(title), category, title);
});

test('administrative units, events, schools and institutions are not attractions', () => {
  for (const title of [
    'Quận 1', 'Bến Thành (phường)', 'Thành phố Hồ Chí Minh', 'Sự kiện 30 tháng 4 năm 1975', 'Vụ hỏa hoạn ITC',
    'Trường Trung học phổ thông Lê Quý Đôn, Thành phố Hồ Chí Minh', 'Trụ sở Tòa án nhân dân Thành phố Hồ Chí Minh',
    'Nhạc viện Thành phố Hồ Chí Minh', 'Thư viện Khoa học Tổng hợp Thành phố Hồ Chí Minh', 'Bệnh viện Chợ Rẫy',
    'Đường Đồng Khởi', 'Ga Sài Gòn', 'Khách sạn Continental', 'Ủy ban nhân dân Thành phố Hồ Chí Minh', 'Hồ Chí Minh',
  ]) assert.equal(f.classifyTouristTitle(title), null, title);
});

test('only Wikipedia results are classified; curated and OSM places always count as attractions', () => {
  assert.equal(f.isTouristPlace({ source: 'backend', title: 'Quận 1' }), true);
  assert.equal(f.isTouristPlace({ source: 'osm', title: 'Anything' }), true);
  assert.equal(f.isTouristPlace({ source: 'wikipedia', title: 'Quận 1' }), false);
  assert.equal(f.withTouristCategory({ source: 'wikipedia', title: 'Chùa Giác Lâm', category: 'Khám phá' }).category, 'Văn hóa');
  const backend = { source: 'backend', title: 'Chùa Giác Lâm', category: 'Lịch sử' };
  assert.equal(f.withTouristCategory(backend), backend);
});

test('filters hide non-attractions and places without an image, and can be turned off', () => {
  const places = [
    { id: 'a', source: 'backend', title: 'Dinh Độc Lập', image: '/media/a.jpg', ...Q1 },
    { id: 'b', source: 'wikipedia', title: 'Quận 1', image: 'https://upload.wikimedia.org/x.jpg', ...Q1 },
    { id: 'c', source: 'wikipedia', title: 'Chùa Ngọc Hoàng', image: '', ...Q1 },
    { id: 'd', source: 'wikipedia', title: 'Chùa Ngọc Hoàng', image: '', imageThumbnail: '/media/t.jpg', ...Q1 },
    { id: 'e', source: 'backend', title: 'Chợ Bình Tây', image: '/media/e.jpg', latitude: 10.7497, longitude: 106.6513 },
  ];
  const off = { touristOnly: false, withImageOnly: false, district1Only: false };
  assert.deepEqual(f.applyPlaceFilters(places, f.DEFAULT_PLACE_FILTERS).map(p => p.id), ['a', 'd']);
  assert.deepEqual(f.applyPlaceFilters(places, { ...f.DEFAULT_PLACE_FILTERS, touristOnly: false }).map(p => p.id), ['a', 'b', 'd']);
  assert.deepEqual(f.applyPlaceFilters(places, { ...f.DEFAULT_PLACE_FILTERS, withImageOnly: false }).map(p => p.id), ['a', 'c', 'd']);
  assert.deepEqual(f.applyPlaceFilters(places, { ...f.DEFAULT_PLACE_FILTERS, district1Only: false }).map(p => p.id), ['a', 'd', 'e']);
  assert.equal(f.applyPlaceFilters(places, off).length, 5);
});

test('District 1 boundary matches real landmarks and excludes neighbouring districts', () => {
  const inside = { 'Dinh Độc Lập': [10.7771, 106.6954], 'Chợ Bến Thành': [10.7725, 106.698], 'Nhà thờ Đức Bà': [10.7798, 106.699], 'Thảo Cầm Viên': [10.7875, 106.7053], 'Chùa Ngọc Hoàng': [10.7922, 106.6981], 'Bitexco': [10.7716, 106.7044] };
  const outside = { 'Bảo tàng Chứng tích Chiến tranh (Q3)': [10.7795, 106.6921], 'Bến Nhà Rồng (Q4)': [10.7681, 106.7068], 'Chợ Bình Tây (Q6)': [10.7497, 106.6513], 'Thủ Thiêm': [10.7769, 106.7215] };
  for (const [name, [latitude, longitude]] of Object.entries(inside)) assert.equal(district.isInDistrict1({ latitude, longitude }), true, name);
  for (const [name, [latitude, longitude]] of Object.entries(outside)) assert.equal(district.isInDistrict1({ latitude, longitude }), false, name);
  assert.equal(district.isInDistrict1(district.DISTRICT1_CENTER), true);
  assert.equal(district.isInDistrict1(null), false);
});
