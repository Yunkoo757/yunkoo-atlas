import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { Store, summary, dayAt } = createRequire(import.meta.url)('../model.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-trainer-test-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  let now = new Date('2026-09-01T04:00:00Z');
  const clock = () => now;
  return { root, clock, store:new Store(root, clock), set: value => { now = new Date(value); } };
}
test('records survive reopen, target capped, no edit/delete API', t => {
  const f = fixture(t); const id = f.store.create({name:'复盘', target:2, daily:1});
  f.store.complete(id); f.store.complete(id);
  assert.throws(() => f.store.complete(id), /已经完成/);
  const reopened = new Store(f.root, f.clock);
  assert.equal(reopened.list()[0].total, 2);
  assert.equal(reopened.list()[0].finished, true);
  assert.equal(reopened.delete, undefined);
});
test('offline days become MISSED; current day stays unsettled; final remainder qualifies', () => {
  const base = { target:5, daily:3, zone:'Asia/Hong_Kong', start:'2026-09-01', records:[{at:'2026-09-01T04:00:00Z', day:'2026-09-01'}] };
  const result = summary(base, '2026-09-04T04:00:00Z');
  assert.deepEqual(result.days.map(d => d.status), ['MISSED','MISSED','MISSED','进行中']);
  assert.equal(result.settledDays, 3);
  const complete = summary({...base, records:[...Array.from({length:3}, () => ({day:'2026-09-01'})), ...Array.from({length:2}, () => ({day:'2026-09-02'}))]}, '2026-09-20T04:00:00Z');
  assert.equal(complete.days.length, 2);
  assert.equal(complete.days[1].minimum, 2);
  assert.equal(complete.completedDays, 2);
});
test('timezone midnight and daylight saving use calendar dates', () => {
  assert.equal(dayAt('2026-09-01T16:00:00Z','Asia/Hong_Kong'), '2026-09-02');
  const result = summary({target:100,daily:3,zone:'America/New_York',start:'2026-03-07',records:[]}, '2026-03-10T04:01:00Z');
  assert.deepEqual(result.days.map(d => d.day), ['2026-03-07','2026-03-08','2026-03-09','2026-03-10']);
});
test('invalid inputs and clock rollback cannot write', t => {
  const f = fixture(t);
  assert.throws(() => f.store.create({name:' ', target:100,daily:3}));
  assert.throws(() => f.store.create({name:'test', target:1,daily:3}));
  const id = f.store.create({name:'test',target:10,daily:3});
  f.set('2026-08-31T04:00:00Z');
  assert.throws(() => f.store.complete(id), /系统时间/);
  assert.equal(f.store.trainings[0].records.length,0);
});
test('interrupted unpublished temp does not change count; corruption is refused', t => {
  const f = fixture(t); f.store.create({name:'test',target:10,daily:3});
  fs.writeFileSync(path.join(f.root,'interrupted.tmp'), '{');
  assert.equal(new Store(f.root,f.clock).list()[0].total,0);
  const file = path.join(f.root,'0000000001.json');
  const event = JSON.parse(fs.readFileSync(file,'utf8')); event.target = 999;
  fs.writeFileSync(file,JSON.stringify(event));
  assert.throws(() => new Store(f.root,f.clock), /校验失败/);
});
test('failed publication cannot increment progress or overwrite another event', t => {
  const f = fixture(t); const id = f.store.create({name:'test',target:10,daily:3});
  const blocked = path.join(f.root,'0000000002.json'); fs.writeFileSync(blocked,'existing');
  assert.throws(() => f.store.complete(id));
  assert.equal(f.store.trainings[0].records.length,0);
  assert.equal(fs.readFileSync(blocked,'utf8'),'existing');
});
