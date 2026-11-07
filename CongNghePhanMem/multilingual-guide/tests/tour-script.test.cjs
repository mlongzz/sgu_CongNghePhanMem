const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file, require = () => ({})) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', 'URLSearchParams', source)(module, module.exports, require, URLSearchParams);
  return module.exports;
}
const nearby = load('src/services/nearby.ts');
const route = load('src/services/optimalRoute.ts', n => n === './nearby' ? nearby : {});
const s = load('src/services/tourScript.ts', n => n === './nearby' ? nearby : n === './optimalRoute' ? route : {});
const place = (title, latitude, longitude, category) => ({ id: title, title, latitude, longitude, category, description: {}, subtitle: {} });
const market = place('Chợ Bến Thành', 10.7725, 106.6980, 'Văn hóa');
const museum = place('Bảo tàng Thành phố Hồ Chí Minh', 10.7761, 106.6997, 'Lịch sử');
const palace = place('Dinh Độc Lập', 10.7771, 106.6954, 'Lịch sử');

test('compass directions follow the real geography of District 1', () => {
  assert.equal(s.direction(market, museum, 'vi'), 'đông bắc');     // museum lies ~25° from the market
  assert.equal(s.direction(museum, palace, 'en'), 'west');
  assert.equal(s.direction({ latitude: 10, longitude: 106 }, { latitude: 10.01, longitude: 106.01 }, 'ja'), '北東');
});

test('walking estimates use metres below one kilometre and at least one minute', () => {
  const near = s.walk(market, museum, 'vi');
  assert.match(near.distance, /^khoảng \d+ mét$/); assert.ok(near.minutes >= 1);
  assert.match(s.walk(market, { latitude: 10.79, longitude: 106.70 }, 'en').distance, /^about \d\.\d kilometres$/);
});

test('intro, transitions and closing name the places and connect themes in every language', () => {
  for (const language of ['vi', 'en', 'fr', 'ja']) {
    const intro = s.introScript([market, museum, palace], { latitude: 10.772, longitude: 106.697 }, 1.2, 16, language);
    assert.ok(intro.includes(market.title) && intro.includes(palace.title) && intro.includes('3'), language);
    const cross = s.transitionScript(market, museum, 1, 3, language);
    const same = s.transitionScript(museum, palace, 2, 3, language);
    assert.ok(cross.includes(market.title) && cross.includes(museum.title), language);
    assert.notEqual(cross, same);
    assert.ok(s.closingScript(2, 3, language).includes('3'), language);
  }
  assert.match(s.transitionScript(market, museum, 1, 3, 'vi'), /Từ văn hóa, chúng ta chuyển sang chủ đề lịch sử/);
  assert.match(s.transitionScript(museum, palace, 2, 3, 'vi'), /tiếp tục mạch câu chuyện về lịch sử.*Điểm dừng cuối cùng/);
});
