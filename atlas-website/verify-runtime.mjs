import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

const base = process.env.ATLAS_WEBSITE_BASE_URL || 'http://localhost:4175';
const output = path.resolve('test-results/website-runtime');
await fs.mkdir(output,{recursive:true});
const browser = await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
const report = {cases:[],screens:[],errors:[]};
const resources = page => page.evaluate(() => performance.getEntriesByType('resource').filter(resource=>resource.name.includes('/vendor/')).map(resource=>({name:resource.name.split('/').at(-1),bytes:resource.decodedBodySize,start:resource.startTime})));
try {
  for (const [name,options,url] of [['normal',{},'/'],['footer',{},'/#download'],['coarse',{hasTouch:true},'/'],['reduced',{reducedMotion:'reduce'},'/']]) {
    const context=await browser.newContext({viewport:{width:1440,height:1000},...options});
    const page=await context.newPage();
    page.on('pageerror',error=>report.errors.push(error.message));
    await page.goto(base+url,{waitUntil:'networkidle'});
    const initialResources=await resources(page);
    if(name==='normal') {
      await page.locator('.ambient-fluid canvas').waitFor();
      const timing=await page.evaluate(()=>({fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime}));
      const initial=await resources(page);
      assert.equal(initial.length,3);
      assert.ok(initial.every(resource=>resource.start>=timing.fcp),'Decorative modules must start after content paint');
      await page.screenshot({path:path.join(output,'home-motion-1440.png')});
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.locator('.ambient-fluid canvas').waitFor({state:'detached'});
      await page.emulateMedia({reducedMotion:'no-preference'});
      await page.locator('.ambient-fluid canvas').waitFor();
      assert.equal((await resources(page)).length,3,'Re-enabling motion must reuse the module cache');
    } else {
      assert.equal((await resources(page)).length,0,name+' must not download the decorative module graph');
      assert.equal(await page.locator('.ambient-fluid canvas').count(),0);
      if(name==='footer') {
        await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
        await page.locator('.ambient-fluid canvas').waitFor();
        assert.equal((await resources(page)).length,3,'Returning from a deep link must still enable the hero effect');
      }
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    report.cases.push({name,initialVendorRequests:initialResources.length,initialVendorBytes:initialResources.reduce((total,resource)=>total+resource.bytes,0),afterInteractionResources:await resources(page)});
    await context.close();
  }
  for(const width of [1440,1100]) {
    const context=await browser.newContext({viewport:{width,height:1000},deviceScaleFactor:2,reducedMotion:'reduce'});
    const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));
    await page.goto(base+'/',{waitUntil:'networkidle'});
    let height;
    for(const name of ['案例库','案例看板','单笔复盘','随记','统计分析','周期复盘','随机复盘']) {
      await page.getByRole('tab',{name,exact:true}).click();
      await page.waitForFunction(()=>{const image=document.querySelector('#preview-demo').shadowRoot.querySelector('img');return image.complete&&image.naturalWidth===4320});
      const geometry=await page.evaluate(()=>({height:document.querySelector('#preview-demo').clientHeight,overflow:document.documentElement.scrollWidth>innerWidth}));
      assert.equal(geometry.overflow,false);
      if(height!==undefined)assert.equal(geometry.height,height);height=geometry.height;
    }
    await page.screenshot({path:path.join(output,`gallery-${width}.png`)});
    report.screens.push({width,galleryViews:7,overflow:false});
    await context.close();
  }
  assert.deepEqual(report.errors,[]);
  report.result='passed';
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n','utf8');
  console.log('PASS website fluid eligibility/paint/cache, 7 gallery views at two widths.');
} finally {await browser.close()}
