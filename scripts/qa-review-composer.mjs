import {_electron as electron} from 'playwright';import path from 'node:path';import fs from 'node:fs';import assert from 'node:assert/strict';
const dir=path.resolve('qa-screenshots/review-composer', String(Date.now()));fs.mkdirSync(dir,{recursive:true});
const app=await electron.launch({args:['.','--user-data-dir='+path.join(dir,'user-data'),'--remote-debugging-port=9338'],env:{...process.env,TRADER_ATLAS_LIBRARY:path.join(dir,'library'),VITE_DEV_SERVER_URL:'',ELECTRON_DISABLE_SECURITY_WARNINGS:'true'}});
const p=await app.firstWindow();p.on('dialog',d=>d.accept().catch(()=>{}));const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.waitForLoadState();await p.evaluate(async dir=>window.journalBridge.createNewLibrary(dir),path.join(dir,'library'));await p.reload();await p.waitForTimeout(1000);
const checks=[];const snapshots=[];
async function snap(name){await p.waitForTimeout(350);await p.screenshot({path:path.join(dir,name+'.png')});snapshots.push(name)}
async function route(r){await p.evaluate(r=>{location.hash=r},r);await p.waitForTimeout(500)}
async function select(label,option){await p.getByRole('combobox',{name:label,exact:true}).click();await p.getByRole('option',{name:option,exact:true}).click()}
async function tab(label){await p.getByRole('tab',{name:label,exact:true}).click()}
await p.keyboard.press('r');await p.getByRole('heading',{name:'复盘组合器',exact:true}).waitFor();checks.push('R opens composer from workbench');
await snap('default');await p.getByLabel('品种',{exact:true}).fill('GBPUSD');await p.keyboard.type('r');assert.equal(await p.getByLabel('品种',{exact:true}).inputValue(),'GBPUSDr');checks.push('R does not intercept text input');
await p.getByLabel('品种',{exact:true}).fill('GBPUSD');await p.getByRole('combobox',{name:'参与背景',exact:true}).click();await snap('select');await p.keyboard.press('Escape');
await p.getByRole('button',{name:'案例日期',exact:true}).click();await snap('date');await p.keyboard.press('Escape');
for(let i=0;i<10;i++){await p.getByRole('button',{name:'生成模拟',exact:true}).click();assert((await p.locator('.rc-document article').innerText()).includes('TP管理'))}checks.push('10 actual UI simulations include TP');
await snap('simulation');
await tab('补充信息');await p.getByLabel('补充原话').fill('测试长文本：核对进场对象与退出计划。'.repeat(100));await snap('long-text');
await tab('案例与背景');await select('参与背景','导航1 · HTF简单结构顺势');await select('HTF / MTF / LTF','4H/15m/1m');await tab('管理与结果');
await p.getByRole('combobox',{name:'BE 对象',exact:true}).click();await p.keyboard.press('Escape');
await snap('management');
// Reset and build a deterministic invalid form.
await p.getByRole('button',{name:'组合器工具'}).click();await p.getByRole('menuitem',{name:'重置条件'}).click();await tab('管理与结果');
await p.getByRole('combobox',{name:'BE 对象',exact:true}).click();const custom=p.getByRole('option').filter({hasText:'手动指定BE对象'});await custom.click();await p.getByRole('alert').waitFor();assert(await p.getByRole('button',{name:'复制',exact:true}).isDisabled());await snap('validation');checks.push('Invalid BE blocks export and shows correction');
await p.getByLabel('具体 BE 对象',{exact:true}).fill('15m 本次对齐的左上高点');await p.getByRole('button',{name:'复制',exact:true}).waitFor();assert(!(await p.getByRole('button',{name:'复制',exact:true}).isDisabled()));
await p.getByRole('button',{name:'组合器工具'}).click();await p.getByRole('menuitem',{name:'规则设置'}).click();await p.getByRole('dialog').waitFor();await snap('rules');
const before=await p.locator('.rc-document article').innerText();
const pack={formatVersion:1,version:'qa-2',name:'Serein QA',engineVersion:1,allowedNavigations:['1','2','3','4','5'],defaults:{},phrases:[{from:'案例分析',to:'案例复盘'}]};
await p.getByRole('dialog').locator('input[type=file]').setInputFiles({name:'rules.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pack))});await p.getByText('已启用新规则；原正文已保留，后续生成使用新规则。').waitFor();assert.equal(await p.locator('.rc-document article').innerText(),before);checks.push('Rule activation preserves previous prose');
await p.getByRole('dialog').locator('input[type=file]').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...pack,version:'qa-bad',engineVersion:999}))});await p.getByText('规则包版本不兼容，请使用当前引擎的规则包或先升级 Atlas。').waitFor();await snap('rules-rejected');checks.push('Incompatible rule import leaves active rules intact');
await p.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();await p.getByRole('button',{name:'按新规则更新正文'}).click();assert((await p.locator('.rc-document article').innerText()).includes('案例复盘'));checks.push('Explicit update applies new rule wording');
await p.waitForFunction(async()=> (await window.journalBridge.loadSnapshot())?.reviewComposer?.draft?.text.includes('案例复盘'));await p.waitForTimeout(800);
const saved=await p.locator('.rc-document article').innerText();await p.reload();await p.locator('.rc-document article').waitFor();assert.equal(await p.locator('.rc-document article').innerText(),saved);checks.push('SQLite reload preserves rules and draft');
await p.locator('.rc-view > input[type=file]').setInputFiles({name:'bad-options.json',mimeType:'application/json',buffer:Buffer.from('{broken')});await p.getByRole('status').filter({hasText:'JSON'}).waitFor();assert.equal(await p.locator('.rc-document article').innerText(),saved);checks.push('Malformed options preserve draft');
await route('/settings/composer-rules');await snap('settings');await p.getByRole('button',{name:'恢复上一版本'}).click();await p.getByText('已恢复上一规则版本，现有正文保持原样。').waitFor();checks.push('Rule rollback');
await route('/review-composer');await p.getByRole('button',{name:'生成模拟',exact:true}).click();
await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setSize(960,640)});await p.waitForTimeout(600);await snap('small-960');
const geometry=await p.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,overflow:document.documentElement.scrollWidth>innerWidth,railOverflow:document.querySelector('.rc-scroll').scrollWidth>document.querySelector('.rc-scroll').clientWidth,controls:[...document.querySelectorAll('.rc-field input,.rc-field [role=combobox]')].map(el=>({height:el.getBoundingClientRect().height,font:getComputedStyle(el).fontSize,line:getComputedStyle(el).lineHeight})),bodyStyle:{size:getComputedStyle(document.querySelector('.rc-document article')).fontSize,line:getComputedStyle(document.querySelector('.rc-document article')).lineHeight},scrollContainers:[...document.querySelectorAll('.rc-view *')].filter(el=>getComputedStyle(el).overflowY==='auto'&&el.scrollHeight>el.clientHeight).length}));assert(!geometry.overflow&&!geometry.railOverflow);assert(geometry.controls.every(c=>c.height===32&&c.font==='13px'&&c.line==='20px'));checks.push('Actual 960x640 desktop geometry, 32px controls, no horizontal overflow');
await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,860));await p.waitForTimeout(500);await snap('final');
assert.deepEqual(errors,[]);fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify({checks,geometry,snapshots,errors},null,2));console.log('PASS',checks,dir);if(process.argv.includes('--keep-open'))await new Promise(()=>{});else await app.close();
