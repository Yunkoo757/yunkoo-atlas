import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { Store, summary } = createRequire(import.meta.url)('../model.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-trainer-cache-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  let now = new Date('2026-09-01T04:00:00Z');
  return { root, store:new Store(root, () => now), set:value => { now = new Date(value); } };
}
test('unchanged polls return only revision and cache per-training daily summaries', t => {
  const f = fixture(t), one = f.store.create({name:'第一项',target:10,daily:3});
  f.store.create({name:'第二项',target:10,daily:3});
  const initial = f.store.snapshot();
  assert.deepEqual(f.store.snapshot(initial.revision), { revision:initial.revision, unchanged:true });
  assert.equal(f.store.list(), initial.trainings);
  const blocked = path.join(f.root, '0000000003.json');
  fs.mkdirSync(blocked);
  assert.throws(() => f.store.complete(one));
  assert.deepEqual(f.store.snapshot(initial.revision), { revision:initial.revision, unchanged:true }, '未成功发布的写入不能使缓存或版本前进');
  fs.rmdirSync(blocked);
  f.set('2026-09-01T04:00:01Z');
  assert.deepEqual(f.store.snapshot(initial.revision), { revision:initial.revision, unchanged:true });
  f.store.complete(one);
  const next = f.store.snapshot(initial.revision);
  assert.notEqual(next.revision, initial.revision);
  assert.equal(next.trainings[0].total, 1);
  assert.equal(next.trainings[1], initial.trainings[1], '另一项训练无事件、无换日时不应重算历史');
  assert.deepEqual(next.trainings, f.store.trainings.map(training => summary(training, '2026-09-01T04:00:01.000Z')));
  f.store.create({name:'第三项',target:10,daily:1});
  assert.equal(f.store.snapshot(next.revision).trainings.length, 3);
});
test('revision and summary invalidation follow each training timezone midnight', t => {
  const f = fixture(t);
  f.store.trainings = ['UTC','Asia/Hong_Kong'].map((zone,i) => ({id:String(i),name:zone,zone,target:100,daily:3,start:'2026-09-01',records:[]}));
  f.set('2026-09-01T15:59:59Z');
  const before = f.store.snapshot();
  f.set('2026-09-01T16:00:00Z');
  const after = f.store.snapshot(before.revision);
  assert.notEqual(after.revision, before.revision);
  assert.equal(after.trainings[0], before.trainings[0], 'UTC尚未换日，不重算该训练');
  assert.deepEqual(after.trainings[1].days.map(d => [d.day,d.status]), [['2026-09-01','MISSED'],['2026-09-02','进行中']]);
  f.set('2026-09-02T00:00:00Z');
  assert.equal(f.store.snapshot(after.revision).trainings[0].days.length, 2);
});
test('completion immediately settles final remainder and still refreshes today after midnight', t => {
  const f = fixture(t), id = f.store.create({name:'完成结算',target:2,daily:2});
  const initial = f.store.snapshot();
  f.store.complete(id); f.store.complete(id);
  const completed = f.store.snapshot(initial.revision);
  assert.equal(completed.trainings[0].finished, true);
  assert.equal(completed.trainings[0].today.status, 'DONE');
  assert.equal(completed.trainings[0].settledDays, 1);
  f.set('2026-09-02T12:00:00Z');
  const later = f.store.snapshot(completed.revision);
  assert.equal(later.trainings[0].days.length, 1, '完成后不增生新的未完成日');
  assert.equal(later.trainings[0].today, null);
  assert.equal(later.trainings[0].completedDays, 1);
  assert.deepEqual(new Store(f.root, () => new Date('2026-09-02T12:00:00Z')).list(), later.trainings);
});
test('unchanged revision never bypasses clock rollback checks', t => {
  const f = fixture(t); f.store.create({name:'时钟约束',target:10,daily:1});
  const before = f.store.snapshot();
  f.set('2026-08-31T04:00:00Z');
  assert.throws(() => f.store.snapshot(before.revision), /系统时间/);
});
