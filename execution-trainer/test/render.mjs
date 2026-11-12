import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const { summary } = createRequire(import.meta.url)('../model.cjs');

test('history is lazy, bounded, fully reachable, and unchanged refresh preserves controls', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const raw = { id:'isolated-history', name:'隔离长历史', target:1000, daily:3, zone:'UTC', start:'2020-01-01', records:Array.from({ length:205 }, (_,i) => ({ at:new Date(Date.UTC(2020,0,1,0,0,i)).toISOString(), day:'2020-01-01' })) };
  let revision = 0;
  const requests = [];
  const snapshot = () => ({ revision:String(revision), trainings:[summary(raw, '2026-11-10T12:00:00Z')] });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion:'reduce' });
  await page.exposeFunction('__list', known => {
    requests.push(known);
    return known === String(revision) ? { revision:String(revision), unchanged:true } : snapshot();
  });
  await page.exposeFunction('__complete', () => {
    raw.records.push({ at:'2026-11-10T12:00:00Z', day:'2026-11-10' }); revision++;
    return snapshot();
  });
  try {
    await page.setContent('<button id="minimize"></button><button id="close-window"></button><div id="error" hidden></div><main id="app"></main>');
    await page.evaluate(() => { window.trainer = { list:window.__list, complete:window.__complete, windowAction:() => {} }; });
    await page.addScriptTag({ type:'module', content:await fs.readFile(new URL('../renderer.js', import.meta.url), 'utf8') });
    await page.locator('#complete').waitFor();
    assert.equal(await page.locator('.day,.record').count(), 0, '折叠历史不应生成任何日期或时间记录节点');
    await page.locator('#history > summary').click();
    await page.waitForFunction(() => document.querySelectorAll('.day').length === 100);
    assert.equal(await page.locator('.record').count(), 0, '只展开日期时不能预先格式化全部完成时间');
    await page.locator('[data-more-days]').click();
    assert.equal(await page.locator('.day').count(), 200);
    await page.locator('#timestamps > summary').click();
    await page.waitForFunction(() => document.querySelectorAll('.record').length === 100);
    assert.equal(await page.locator('.record').first().textContent().then(v => v.includes('#205')), true);
    await page.locator('[data-more-times]').click();
    assert.equal(await page.locator('.record').count(), 200);
    await page.locator('[data-more-times]').click();
    assert.equal(await page.locator('.record').count(), 205, '分页须能访问全部时间记录，不截断历史');
    assert.equal(await page.locator('[data-more-times]').count(), 0);
    await page.evaluate(() => { window.control = document.querySelector('#complete'); window.historyNode = document.querySelector('#history'); window.dispatchEvent(new Event('focus')); });
    await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false');
    assert.equal(await page.evaluate(() => window.control === document.querySelector('#complete') && window.historyNode === document.querySelector('#history')), true, '未变化轮询不应重建DOM');
    assert(requests.includes('0'), '轮询必须携带已知revision以省去完整IPC负载');
    await page.locator('#complete').click();
    await page.waitForFunction(() => document.querySelector('.count-value').textContent === '206');
    assert.equal(await page.locator('#history').getAttribute('open'), '');
    assert.equal(await page.locator('#timestamps').getAttribute('open'), '');
    assert.equal(await page.locator('.record').count(), 206, '完成一次后保留已展开范围并更新实际记录');
    assert.equal(await page.evaluate(() => window.control === document.querySelector('#complete')), true, '连续点击的按钮节点必须稳定');
    await page.locator('#history > summary').click();
    await page.waitForFunction(() => document.querySelectorAll('.day,.record').length === 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
