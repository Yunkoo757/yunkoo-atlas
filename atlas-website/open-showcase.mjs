import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {resolve,join,relative} from 'node:path';
import {existsSync} from 'node:fs';
const require=createRequire(import.meta.url);
const root=resolve(process.argv[2]||'');
const allowed=resolve('test-results');
if(!relative(allowed,root).startsWith('website-showcase-')||relative(allowed,root).includes('..'))throw Error('Invalid showcase root');
const library=join(root,'library'),profile=join(root,'profile');
if(!existsSync(library)||!existsSync(profile))throw Error('Existing showcase required');
const app=await electron.launch({executablePath:require('electron'),args:['.',`--user-data-dir=${profile}`],cwd:resolve('.'),env:{...process.env,TRADER_ATLAS_LIBRARY:library,VITE_DEV_SERVER_URL:''}});
const page=await app.firstWindow();
if(resolve(await app.evaluate(({app})=>app.getPath('userData')))!==profile){await app.close();throw Error('Profile mismatch')}
await page.waitForFunction(()=>!!window.journalBridge);
if(resolve(await page.evaluate(()=>window.journalBridge.getLibraryPath()))!==library){await app.close();throw Error('Library mismatch')}
await page.evaluate(()=>location.hash='#/notes');
await page.locator('.quick-notes-page').waitFor();
await page.getByText('本周复盘：把等待写进计划',{exact:true}).first().click();
console.log('OPEN: latest Electron build, isolated Yunkoo showcase, notes page.');
await new Promise(resolve=>app.on('close',resolve));
