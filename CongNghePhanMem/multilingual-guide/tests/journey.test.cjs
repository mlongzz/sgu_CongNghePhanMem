const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: name => dependencies[name] ?? {} });
  return exports;
}
const nearby = load('src/services/nearby.ts');
const service = load('src/services/journey.ts', { './nearby': nearby });
const raw = (count = 3) => ({ id: 7, name: 'Explicit journey test fixture', description: '', stops: Array.from({ length: count }, (_, index) => ({ id: index + 1, name: `Fixture stop ${index + 1}`, latitude: 10 + index / 1000, longitude: 106, publication_status: 'published' })) });
const state = count => ({ journey: service.parseJourney(raw(count)), completed: [], skipped: [], status: 'active' });
const fix = { latitude: 10, longitude: 106, timestamp: 100000, accuracy: 5 };
test('journey URL identity rejects malformed, repeated and unsafe IDs', () => {
  assert.equal(service.parseJourneyId('7'), 7);
  for (const value of [null,undefined,'','0','-1',' 2','2.5','1e3','2147483648',['1','2']]) assert.equal(service.parseJourneyId(value),null);
});
for (const count of [3, 10, 20, 25]) test(`journey preserves ${count} ordered stops, skips once and completes each stop only once`, () => {
  let progress = state(count);
  assert.equal(service.advanceJourney(progress, 'db-999'), progress);
  for (let index = 1; index <= count; index++) {
    assert.equal(service.currentJourneyStop(progress).id, `db-${index}`);
    progress = service.advanceJourney(progress, `db-${index}`, index === 2);
  }
  assert.equal(progress.status, 'completed'); assert.equal(progress.completed.length, count - 1); assert.equal(progress.skipped.length, 1);
  assert.equal(service.currentJourneyStop(progress), null);
});
test('no journey, opt-out, paused journey and other audio never trigger automatic narration', () => {
  for (const [progress, enabled, busy] of [[null, true, false], [state(3), false, false], [{ ...state(3), status: 'paused' }, true, false], [state(3), true, true]]) {
    assert.equal(service.journeyAutoDecision(progress, enabled, fix, busy, 100000).place, null);
  }
});
test('nearby unfinished stops use flexible route order and exclude outside-route POIs', () => {
  const progress = state(3);
  assert.equal(service.journeyAutoDecision(progress, true, fix, false, 100000).place.id, 'db-1');
  assert.equal(service.journeyAutoDecision(progress, true, { ...fix, latitude: 10.002 }, false, 100000).place.id, 'db-3');
  assert.equal(service.journeyAutoDecision(progress, true, { ...fix, latitude: 10.0005 }, false, 100000).place.id, 'db-1');
  const completed = service.advanceJourney(progress, 'db-3');
  assert.equal(service.advanceJourney(completed, 'db-3'), completed);
  assert.equal(service.journeyAutoDecision(completed, true, { ...fix, latitude: 10.002 }, false, 100000).place, null);
});
test('stale, future, invalid and inaccurate GPS explain manual playback instead of triggering', () => {
  for (const changed of [{ accuracy: 102 }, { accuracy: null }, { accuracy: NaN }, { timestamp: 0 }, { timestamp: 106000 }, { latitude: 91 }, { longitude: NaN }]) {
    const result = service.journeyAutoDecision(state(3), true, { ...fix, ...changed }, false, 100000);
    assert.equal(result.place, null); assert.ok(result.reason);
  }
});
test('reload preserves order/progress but always restores active route paused', () => {
  const saved = service.advanceJourney(state(25), 'db-1');
  const restored = service.restoreJourney(service.serializeJourney(saved));
  assert.equal(restored.status, 'paused'); assert.equal(service.currentJourneyStop(restored).id, 'db-2'); assert.equal(restored.journey.stops.length, 25);
  assert.equal(service.journeyAutoDecision(restored, true, fix, false, 100000).place, null);
});
test('unavailable and duplicate stops are omitted without breaking remaining stops; corrupted cache is rejected', () => {
  const draft = raw(); draft.stops[1].publication_status = 'draft'; assert.equal(service.parseJourney(draft).stops.length, 2);
  const duplicate = raw(); duplicate.stops[1].id = 1; assert.equal(service.parseJourney(duplicate).stops.length, 2);
  const invalid = raw(); invalid.stops[1] = { id: 2 }; assert.equal(service.parseJourney(invalid).unavailable, 1);
  for (const value of [null, '{', 'x'.repeat(1000001), '{}']) assert.equal(service.restoreJourney(value), null);
});

test('large route snapshots preserve 200 stops without persisting full guide descriptions', () => {
  const input = raw(200); for (const stop of input.stops) stop.description = 'A'.repeat(5000);
  const saved = {journey:service.parseJourney(input),completed:['db-1'],skipped:[],status:'active'};
  const encoded = service.serializeJourney(saved); assert.ok(encoded.length < 1000000);
  const restored = service.restoreJourney(encoded); assert.equal(restored.journey.stops.length,200); assert.equal(service.currentJourneyStop(restored).id,'db-2'); assert.equal(restored.status,'paused');
});
