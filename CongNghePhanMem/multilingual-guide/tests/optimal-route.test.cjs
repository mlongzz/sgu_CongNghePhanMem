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
const r = load('src/services/optimalRoute.ts', name => name === './nearby' ? nearby : {});

const place = (id, latitude, longitude) => ({ id, title: id, latitude, longitude });
const start = { latitude: 10.7752, longitude: 106.6984 };
// Deterministic pseudo-random points spread over District 1.
function points(count, seed) {
  let x = seed;
  const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: count }, (_, i) => place(`p${i}`, 10.762 + rnd() * 0.03, 106.688 + rnd() * 0.02));
}
function pathLength(order) {
  let previous = start, total = 0;
  for (const p of order) { total += nearby.distanceKm(previous, p); previous = p; }
  return total * r.WALKING_DETOUR;
}
function bruteForce(candidates, k) {
  let best = Infinity;
  const recurse = (path, used) => {
    if (path.length === k) { best = Math.min(best, pathLength(path)); return; }
    candidates.forEach((p, i) => { if (!used.has(i)) { used.add(i); recurse([...path, p], used); used.delete(i); } });
  };
  recurse([], new Set());
  return best;
}

test('exact planner matches brute force for every subset size', () => {
  for (const seed of [1, 7, 42]) {
    const candidates = points(7, seed);
    for (let k = 1; k <= 7; k++) {
      const route = r.planOptimalRoute(start, candidates, k);
      assert.equal(route.legs.length, k);
      assert.equal(new Set(route.legs.map(l => l.place.id)).size, k);
      assert.ok(Math.abs(route.walkingKm - bruteForce(candidates, k)) < 1e-9, `seed ${seed}, k ${k}`);
      assert.ok(route.exact);
    }
  }
});

test('legs accumulate distance and the time estimate follows walking speed', () => {
  const route = r.planOptimalRoute(start, points(15, 3), 6);
  let sum = 0;
  for (const leg of route.legs) { sum += leg.legKm; assert.ok(Math.abs(leg.cumulativeKm - sum) < 1e-9); }
  assert.ok(Math.abs(route.walkingKm - sum) < 1e-9);
  assert.equal(route.walkingMinutes, Math.round(sum / r.WALKING_SPEED_KMH * 60));
});

test('the first stop of a one-stop route is simply the nearest place', () => {
  const candidates = [place('far', 10.79, 106.70), place('near', 10.7755, 106.6985), place('mid', 10.78, 106.70)];
  assert.equal(r.planOptimalRoute(start, candidates, 1).legs[0].place.id, 'near');
});

test('large candidate sets use the heuristic and still visit distinct places', () => {
  const route = r.planOptimalRoute(start, points(20, 9), 20);
  assert.equal(route.exact, false);
  assert.equal(new Set(route.legs.map(l => l.place.id)).size, 20);
});

test('invalid input returns no route and counts are clamped', () => {
  assert.equal(r.planOptimalRoute(start, [], 3), null);
  assert.equal(r.planOptimalRoute({ latitude: NaN, longitude: 1 }, points(3, 1), 2), null);
  assert.equal(r.planOptimalRoute(start, points(3, 1), 10).legs.length, 3);
});

test('Google Maps link walks from the GPS position through the ordered stops', () => {
  const route = r.planOptimalRoute(start, points(4, 5), 4);
  const url = new URL(r.googleMapsRouteUrl(route));
  assert.equal(url.hostname, 'www.google.com');
  assert.equal(url.searchParams.get('travelmode'), 'walking');
  assert.equal(url.searchParams.get('origin'), `${start.latitude},${start.longitude}`);
  const last = route.legs.at(-1).place;
  assert.equal(url.searchParams.get('destination'), `${last.latitude},${last.longitude}`);
  assert.equal(url.searchParams.get('waypoints').split('|').length, 3);
});

test('removing a stop keeps the order and recomputes every leg', () => {
  const planned = r.planOptimalRoute(start, points(6, 11), 6);
  const remaining = planned.legs.map(l => l.place).filter((_, i) => i !== 2);
  const rebuilt = r.routeThrough(start, remaining);
  assert.deepEqual(rebuilt.legs.map(l => l.place.id), remaining.map(p => p.id));
  assert.ok(Math.abs(rebuilt.walkingKm - pathLength(remaining)) < 1e-9);
  assert.equal(r.routeThrough(start, []), null);
});

test('a typed stop count must be a whole number between 1 and the maximum', () => {
  assert.deepEqual(r.parseStopCount('5', 15), { value: 5, error: '' });
  assert.deepEqual(r.parseStopCount(' 15 ', 15), { value: 15, error: '' });
  assert.equal(r.parseStopCount('0', 15).error, 'Số điểm phải lớn hơn 0.');
  assert.equal(r.parseStopCount('-3', 15).error, 'Số điểm phải lớn hơn 0.');
  assert.equal(r.parseStopCount('16', 15).error, 'Tối đa 15 điểm.');
  assert.equal(r.parseStopCount('2.5', 15).error, 'Số điểm phải là số nguyên.');
  assert.equal(r.parseStopCount('', 15).error, 'Nhập số điểm muốn tham quan.');
});
