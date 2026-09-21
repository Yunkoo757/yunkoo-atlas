import { _electron as electron } from 'playwright';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const { Store }=require('../model.cjs');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'trainer-disclosure-'));
const store=new Store(path.join(data,'records'));
const id=store.create({name:'阿松大',target:100,daily:3});
for(let i=0;i<8;i++)store.complete(id);
const env={...process.env,EXECUTION_TRAINER_DATA:data};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[path.resolve('execution-trainer')],env});
try {
 const page=await app.firstWindow();await page.locator('#complete').waitFor();
 await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});
 const frames=await page.evaluate(async()=>{
  const samples=[];
  const sample=()=>{const r=document.querySelector('#complete').getBoundingClientRect();samples.push({x:r.x,width:r.width,y:r.y,scroll:scrollY});};
  sample();document.querySelector('#history > summary').click();
  const start=performance.now();
  while(performance.now()-start<500){await new Promise(requestAnimationFrame);sample();}
  return samples;
 });
 console.log(JSON.stringify({widthShift:Math.max(...frames.map(f=>f.width))-Math.min(...frames.map(f=>f.width)),xShift:Math.max(...frames.map(f=>f.x))-Math.min(...frames.map(f=>f.x)),sampleCount:frames.length}));
 assert.ok(Math.max(...frames.map(f=>f.width))-Math.min(...frames.map(f=>f.width))<0.5,'opening records must not resize primary controls');
 for(let i=0;i<8;i++) await page.locator('#history > summary').click();
 await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});
 assert.equal(await page.locator('#history').getAttribute('open'),'');
 await page.locator('#timestamps > summary').click();
 await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});
 assert.equal(await page.locator('.record').count(),8);
 await page.locator('.record').last().scrollIntoViewIfNeeded();
 await page.screenshot({path:'execution-trainer/test-results/records-stable.png'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.locator('#history > summary').click();
 await page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));});
 assert.equal(await page.locator('#history').getAttribute('open'),null);
 assert.equal((await page.locator('.counter').textContent()).trim(),'8 / 100');
} finally {await app.close();}
