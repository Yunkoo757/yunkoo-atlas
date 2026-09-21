const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

function dayAt(iso, zone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
const nextDay = day => new Date(Date.parse(day + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
function validate(input) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80) throw new Error('训练名称需要 1–80 个字符。');
  if (!Number.isSafeInteger(input.target) || input.target < 1 || input.target > 100000) throw new Error('总次数需要是 1–100000 的整数。');
  if (!Number.isSafeInteger(input.daily) || input.daily < 1 || input.daily > input.target) throw new Error('每日最低量需要是 1 到总次数之间的整数。');
}
function summary(training, now) {
  const counts = new Map();
  for (const event of training.records) counts.set(event.day, (counts.get(event.day) || 0) + 1);
  const total = training.records.length;
  const finished = total === training.target;
  const today = dayAt(now, training.zone);
  const end = finished ? training.records.at(-1).day : today;
  const days = [];
  let before = 0;
  for (let day = training.start; day <= end; day = nextDay(day)) {
    const actual = counts.get(day) || 0;
    const minimum = Math.min(training.daily, training.target - before);
    const settled = day < today || finished;
    days.push({ day, actual, minimum, settled, status: actual >= minimum ? 'DONE' : settled ? 'MISSED' : '进行中' });
    before += actual;
  }
  const settled = days.filter(d => d.settled);
  return { ...training, total, finished, remaining: training.target - total, days,
    today: days.find(d => d.day === today) || null,
    completedDays: settled.filter(d => d.status === 'DONE').length, settledDays: settled.length };
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
class Store {
  constructor(root, clock = () => new Date()) {
    this.root = root; this.clock = clock; this.events = []; this.trainings = [];
    fs.mkdirSync(root, { recursive: true });
    const files = fs.readdirSync(root).filter(n => /^\d{10}\.json$/.test(n)).sort();
    for (const [i, file] of files.entries()) {
      const event = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
      const { hash, ...body } = event;
      if (file !== `${String(i + 1).padStart(10, '0')}.json` || body.previous !== (this.events.at(-1)?.hash || '') || digest(body) !== hash) throw new Error('记录校验失败。请保留数据目录，从完整备份恢复后重试。');
      this.apply(event); this.events.push(event);
    }
  }
  now() {
    const now = this.clock().toISOString();
    if (this.events.length && now < this.events.at(-1).at) throw new Error('系统时间早于最近记录，请校正系统时间后重试。');
    return now;
  }
  apply(event) {
    if (event.type === 'create') {
      validate(event);
      if (this.trainings.some(t => t.id === event.id)) throw new Error('训练记录重复。');
      this.trainings.push({ id: event.id, name: event.name, target: event.target, daily: event.daily, zone: event.zone, start: dayAt(event.at, event.zone), records: [] });
    } else if (event.type === 'complete') {
      const training = this.trainings.find(t => t.id === event.id);
      if (!training || training.records.length >= training.target) throw new Error('完成记录无效。');
      training.records.push({ at: event.at, day: dayAt(event.at, training.zone) });
    } else throw new Error('未知记录格式。');
  }
  append(data) {
    const body = { ...data, at: this.now(), previous: this.events.at(-1)?.hash || '' };
    const event = { ...body, hash: digest(body) };
    const destination = path.join(this.root, `${String(this.events.length + 1).padStart(10, '0')}.json`);
    const temporary = path.join(this.root, `${randomUUID()}.tmp`);
    const fd = fs.openSync(temporary, 'wx');
    try { fs.writeFileSync(fd, JSON.stringify(event) + '\n', 'utf8'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    // Link publishes a complete record without overwriting an existing record.
    fs.linkSync(temporary, destination);
    try { fs.unlinkSync(temporary); } catch { /* A leftover temp file is harmless. */ }
    this.apply(event); this.events.push(event);
    return event;
  }
  create(input) {
    validate(input);
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const event = this.append({ type: 'create', id: randomUUID(), name: input.name.trim(), target: input.target, daily: input.daily, zone });
    return event.id;
  }
  complete(id) {
    const training = this.trainings.find(t => t.id === id);
    if (!training) throw new Error('找不到训练，请重新打开。');
    if (training.records.length >= training.target) throw new Error('这个训练已经完成。');
    this.append({ type: 'complete', id });
  }
  list() { const now = this.now(); return this.trainings.map(t => summary(t, now)); }
}
module.exports = { Store, dayAt, summary, validate };
