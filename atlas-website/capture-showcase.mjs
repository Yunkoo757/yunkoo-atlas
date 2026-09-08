import { _electron as electron } from 'playwright';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createShowcaseSnapshot} from './showcase-fixture.mjs';
const require=createRequire(import.meta.url);
const isolation=resolve('test-results/website-showcase-'+Date.now());
const library=join(isolation,'library'),profile=join(isolation,'profile');
mkdirSync(library,{recursive:true});
const app=await electron.launch({executablePath:require('electron'),args:['.',`--user-data-dir=${profile}`,'--force-device-scale-factor=3'],cwd:resolve('.'),env:{...process.env,TRADER_ATLAS_LIBRARY:library,VITE_DEV_SERVER_URL:'',ELECTRON_DISABLE_SECURITY_WARNINGS:'true'}});
try{
 const page=await app.firstWindow();
 const actual=await app.evaluate(({app})=>app.getPath('userData'));
 if(resolve(actual)!==profile)throw Error('Isolation mismatch: '+actual);
 await page.waitForFunction(()=>!!window.journalBridge);
 const made=await page.evaluate(p=>window.journalBridge.createNewLibrary(p),library);
 if(!made.ok)throw Error(JSON.stringify(made));
 const actualLibrary=await page.evaluate(()=>window.journalBridge.getLibraryPath());
 if(resolve(actualLibrary)!==library)throw Error('Library isolation mismatch');
 const appUrl=page.url();
 await page.goto("about:blank");
 await page.evaluate(async()=>{await window.journalBridge.storageOpen();await window.journalBridge.loadSnapshot()});
 const imported=await page.evaluate(s=>window.journalBridge.commitImport(s,[],{pruneUnreferenced:true}),createShowcaseSnapshot());
 if(!imported)throw Error('Showcase import failed');
 await app.evaluate(({BrowserWindow})=>{let w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setContentSize(1440,960)});
 await page.goto(appUrl);
 const captures=[];const out=resolve('atlas-docs-site/assets/product/showcase');mkdirSync(out,{recursive:true});
 for(const [key,path,ready] of [['journal','/list','.trade-list'],['cases','/review-cases','.trade-list'],['board','/review-cases/board','.board-scroll'],['detail','/trade/TRD-101','.trade-detail-layout'],['notes','/notes','.quick-notes-page'],['stats','/dashboard','.db-scroll'],['period','/weekly-review','.wr-shell'],['random','/review-session','.review-session-view']]){
  await page.evaluate(p=>location.hash='#'+p,path);await page.locator(ready).waitFor({timeout:15000}).catch(async e=>{await page.screenshot({path:resolve('test-results/showcase-error.png')});console.log((await page.locator('body').innerText()).slice(0,4500));throw e});
  if(key==='notes')await page.getByText('本周复盘：把等待写进计划',{exact:true}).first().click();
  await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(900);
  await page.screenshot({path:join(out,key+'.png'),animations:'disabled'});
  captures.push({key,path,width:await page.evaluate(()=>innerWidth*devicePixelRatio),height:await page.evaluate(()=>innerHeight*devicePixelRatio)});
  console.log('CAPTURE',JSON.stringify(captures.at(-1)));
 }
 writeFileSync(join(out,'manifest.json'),JSON.stringify({capturedAt:new Date().toISOString(),source:'Latest Electron build; isolated Yunkoo demonstration library',captures},null,2));
 console.log('SHOWCASE COMPLETE');
}finally{await app.close()}
