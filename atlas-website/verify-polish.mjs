import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const browser=await chromium.launch({headless:true});
const out='test-results/website-polish';mkdirSync(out,{recursive:true});
const report=[];
try{
 for(const width of [1440,1100]){
  const context=await browser.newContext({viewport:{width,height:1000},deviceScaleFactor:2,reducedMotion:'reduce'});const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:4175/');await page.locator('product-shot').first().waitFor();
  const clipped=await page.locator('#feature-rail article').evaluateAll(items=>items.filter(e=>e.scrollHeight>e.clientHeight+2).length);
  if(clipped)throw Error('Clipped feature cards '+width);
  let galleryHeight;
  for(const name of ['案例库','案例看板','单笔复盘','随记','统计分析','周期复盘','随机复盘']){
   await page.getByRole('tab',{name,exact:true}).click();
   await page.waitForFunction(()=>{let img=document.querySelector('#preview-demo').shadowRoot.querySelector('img');return img.complete&&img.naturalWidth===4320});
   const measured=await page.evaluate(()=>({h:document.querySelector('#preview-demo').clientHeight,w:document.querySelector('#preview-demo').clientWidth,guide:document.querySelector('#preview-guide').getAttribute('href'),overflow:document.documentElement.scrollWidth>innerWidth}));
   if(measured.overflow)throw Error('Overflow '+width+' '+name);
   if(galleryHeight!==undefined&&galleryHeight!==measured.h)throw Error('Gallery height changed');galleryHeight=measured.h;
   if(!measured.guide.startsWith('/guide/?lesson='))throw Error('Missing lesson link');
   report.push({width,name,...measured});
  }
  await page.getByRole('tab',{name:'随记',exact:true}).click();await page.screenshot({path:`${out}/gallery-${width}.png`});
  await page.goto('http://localhost:4175/guide/?lesson=quick-notes');await page.getByRole('button',{name:'开始练习',exact:false}).click();
  await page.screenshot({path:`${out}/learning-${width}.png`});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Guide overflow '+width);
  if(errors.length)throw Error(errors.join('\n'));await context.close();
 }
 writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log('PASS: 7 gallery views at 2 desktop widths; 4320px images; lesson links; teaching exercise; no overflow or page errors.');
}finally{await browser.close()}
