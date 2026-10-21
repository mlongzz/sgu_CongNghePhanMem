const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const subject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/historyEntries.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: subject });
const visit = (id, place = id) => ({ id, place_id: place, visited_at: '2026-11-22T05:00:00Z' });

test('one failed lookup does not discard valid visits and a 404 stays distinct from offline', async () => {
  const rows = await subject.resolveHistoryEntries([visit(1), visit(2), visit(3)], async id => {
    if (id === 2) throw { status: 404 };
    if (id === 3) throw new Error('offline');
    return 'Bảo tàng';
  }, error => error.status === 404);
  assert.deepEqual(Array.from(rows, row => row.state), ['available', 'deleted', 'unavailable']);
  assert.deepEqual(Array.from(rows, row => row.id), [1, 2, 3]);
  assert.equal(rows[0].name, 'Bảo tàng');
});

test('repeated visits fetch a place once without combining or reordering visit records', async () => {
  const calls = [];
  const rows = await subject.resolveHistoryEntries([visit(7, 1), visit(8, 1), visit(9, 2)], async id => {
    calls.push(id); return `Place ${id}`;
  }, () => false);
  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(Array.from(rows, row => row.id), [7, 8, 9]);
});

test('cancelled requests propagate cancellation instead of reporting a deleted place', async () => {
  const aborted = Object.assign(new Error('cancelled'), { name: 'AbortError' });
  await assert.rejects(subject.resolveHistoryEntries([visit(1)], async () => { throw aborted; }, () => true), error => error === aborted);
});

test('empty or malformed names are retryable and an empty history performs no lookup', async () => {
  for (const name of ['', '  ', undefined]) {
    const rows = await subject.resolveHistoryEntries([visit(1)], async () => name, () => false);
    assert.equal(rows[0].state, 'unavailable');
  }
  const rows = await subject.resolveHistoryEntries([], async () => { throw new Error('must not run'); }, () => false);
  assert.equal(rows.length, 0);
});
