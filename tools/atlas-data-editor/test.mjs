import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import initSqlJs from 'sql.js'
import { chromium } from 'playwright'
import { buildDataEditor } from './build.mjs'
await fs.mkdir(path.resolve('test-results/atlas-data-editor'),{recursive:true})
const out=await fs.mkdtemp(path.resolve('test-results/atlas-data-editor/run-'))
const editorOutput=await buildDataEditor(path.join(out,'editor'))
await build({configFile:false,resolve:{alias:{'@':path.resolve('src')}},build:{outDir:out,emptyOutDir:false,lib:{entry:path.resolve('tools/atlas-data-editor/core.ts'),formats:['es'],fileName:()=> 'core.mjs'}}})
const {decode,validate,migrateToPaper,resetLive,SCHEMA_VERSION}=await import(pathToFileURL(path.join(out,'core.mjs')))
const SQL=await initSqlJs()
// Default input is generated from the canonical contract fixture; external input is explicit and read-only.
const explicitSource=process.env.ATLAS_EDITOR_TEST_LIBRARY?.trim() || null
const syntheticSource=explicitSource?null:await fs.mkdtemp(path.join(os.tmpdir(),'atlas-editor-contract-'))
const sourcePath=explicitSource??syntheticSource
try {
if(syntheticSource){
 const entry=path.join(out,'source-fixture.ts')
 await fs.writeFile(entry,`export {createFullPersistedSnapshotFixture} from ${JSON.stringify(path.resolve('src/storage/fixtures/fullPersistedSnapshot.ts'))};`, 'utf8')
 await build({configFile:false,resolve:{alias:{'@':path.resolve('src')}},build:{ssr:entry,outDir:path.join(out,'source-module'),rolldownOptions:{output:{entryFileNames:'fixture.mjs'}}}})
 const {createFullPersistedSnapshotFixture}=await import(pathToFileURL(path.join(out,'source-module/fixture.mjs')))
 const seed=createFullPersistedSnapshotFixture(),base=seed.trades[0]
 const paper={...base,id:'editor-paper',ref:'PAPER-EDITOR',tradeKind:'paper'};delete paper.liveStageId
 seed.trades.push(paper,{...base,id:'editor-case',ref:'CASE-EDITOR',tradeKind:'case',caseType:'exemplar',masteryState:'new',liveStageId:null})
 validate(seed)
 const database=new SQL.Database()
 try{
  database.run('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT)')
  for(const [key,value]of Object.entries({snapshot:JSON.stringify(seed),schemaVersion:String(SCHEMA_VERSION)}))database.run('INSERT INTO meta VALUES (?,?)',[key,value])
  await fs.writeFile(path.join(sourcePath,'journal.db'),database.export())
 }finally{database.close()}
}
const original=await fs.readFile(path.join(sourcePath,'journal.db'))
const db=new SQL.Database(original)
const meta=Object.fromEntries(db.exec('SELECT key,value FROM meta')[0].values)
const snapshot=decode(JSON.parse(meta.snapshot),Number(meta.schemaVersion))
validate(snapshot)
assert.throws(()=>decode(snapshot,SCHEMA_VERSION+1))
const withRetired=decode({...snapshot,judgmentDesk:{invalid:true},reviewComposer:'old',retainedExtension:{keep:true}},SCHEMA_VERSION)
assert(!('judgmentDesk' in withRetired) && !('reviewComposer' in withRetired))
assert.deepEqual(withRetired.trades,snapshot.trades)
assert.deepEqual(withRetired.retainedExtension,{keep:true})
const legacy = { ...snapshot, liveStatsStartTradingDayKey: '2025-01-06', livePerformanceCycles: [], extraRecords: [{ id: 'extra', value: '旧库扩展' }] }
const upgraded = decode(legacy, 11)
assert.deepEqual(upgraded.extraRecords, legacy.extraRecords)
assert(!('livePerformanceCycles' in upgraded) && !('liveStatsStartTradingDayKey' in upgraded))
assert.deepEqual(legacy.livePerformanceCycles, [])
assert.throws(() => decode(legacy, SCHEMA_VERSION), /旧实盘周期字段/)
assert.throws(() => validate({ ...upgraded, extraRecords: [{ id: 'dup' }, { id: 'dup' }] }), /重复 ID/)
const selected=new Set(snapshot.trades.filter(t=>t.tradeKind!=='paper').map(t=>t.id))
const migrated=migrateToPaper(snapshot,selected)
assert.equal(migrated.trades.filter(t=>t.tradeKind!=='paper').length,0)
assert.deepEqual(migrated.trades.map(t=>t.note),snapshot.trades.map(t=>t.note))
assert.deepEqual(migrated.tagPresets,snapshot.tagPresets)
assert(migrated.trades.every(t=>!('liveStageId' in t)))
const reset=resetLive(migrated);validate(reset)
assert.equal(reset.weeklyReviews.length,0);assert.equal(reset.liveStages.length,1)
assert.throws(()=>resetLive(snapshot))
const liveOnlyMigrated=migrateToPaper(snapshot,new Set(snapshot.trades.filter(t=>t.tradeKind==='live').map(t=>t.id)))
const casePreservingReset=resetLive(liveOnlyMigrated)
validate(casePreservingReset)
assert.deepEqual(casePreservingReset.trades.filter(t=>t.tradeKind==='case'), snapshot.trades.filter(t=>t.tradeKind==='case').map(t=>({...t,liveStageId:null})))
assert.deepEqual(casePreservingReset.trades.filter(t=>t.tradeKind==='paper'), liveOnlyMigrated.trades.filter(t=>t.tradeKind==='paper'))
assert.deepEqual(casePreservingReset.tagPresets,snapshot.tagPresets)
assert.deepEqual(casePreservingReset.quickNotes,snapshot.quickNotes)
assert.deepEqual(casePreservingReset.strategies,snapshot.strategies)
assert.throws(()=>validate({...snapshot,currentLiveStageId:'missing'}))
db.close()
// Synthetic export fixture, retaining actual field shapes but replacing image bytes.
const fixture=JSON.parse(JSON.stringify(snapshot).replace(/journal-asset:\/\/[^"'\s<>\\]+/g,'journal-asset://fixture'))
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=','base64')
const fdb=new SQL.Database();fdb.run('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE assets(id TEXT PRIMARY KEY,mime TEXT,file_name TEXT,byte_size INTEGER,created_at TEXT);')
for(const [k,v]of Object.entries({schemaVersion:String(SCHEMA_VERSION),snapshot:JSON.stringify(fixture)}))fdb.run('INSERT INTO meta VALUES (?,?)',[k,v])
fdb.run('INSERT INTO assets VALUES (?,?,?,?,?)',['fixture','image/png','fixture.png',png.length,new Date().toISOString()])
const files={'journal.db':Array.from(fdb.export()),'manifest.json':Array.from(Buffer.from(JSON.stringify({schemaVersion:SCHEMA_VERSION}))), 'attachments/fixture.png':Array.from(png)};fdb.close()
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage({viewport:{width:1500,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(({files})=>{
  const sourceFiles=new Map(Object.entries(files).map(([k,v])=>[k,new Uint8Array(v)])),output=new Map();window.testOutput=output;window.testSource=sourceFiles
  function handle(map, prefix = '', readOnly = false) {
    return {
      name: readOnly ? '测试源资料库' : '测试输出',
      kind: 'directory',
      _map: map,
      _prefix: prefix,
      async isSameEntry(other) { return other._map === map && other._prefix === prefix },
      async resolve(other) { return other._map === map && other._prefix.startsWith(prefix) ? [] : null },
      async *values() { for (const key of map.keys()) if (key.startsWith(prefix)) yield { name: key } },
      async getDirectoryHandle(name) {
        if (!readOnly && name === 'attachments' && window.testForeignAttachment) {
          map.set('attachments/fixture.png', new Uint8Array([3, 1, 4]))
        }
        return handle(map, prefix + name + '/', readOnly)
      },
      async getFileHandle(name, { create = false } = {}) {
        const key = prefix + name
        if (create && readOnly) throw Error('Forbidden source write')
        if (!map.has(key)) {
          if (!create) throw new DOMException('Missing ' + key, 'NotFoundError')
          map.set(key, new Uint8Array())
        }
        return {
          async getFile() { return new File([map.get(key)], name) },
          async createWritable() {
            if (readOnly) throw Error('Forbidden source write')
            let bytes
            return {
              async write(value) {
                if (window.testFailCopy && key.startsWith('attachments/')) throw Error('模拟附件写入失败')
                if (value instanceof Blob) bytes = new Uint8Array(await value.arrayBuffer())
                else if (typeof value === 'string') bytes = new TextEncoder().encode(value)
                else bytes = new Uint8Array(value)
              },
              async close() {
                map.set(key, key === 'journal.db' && window.testSubstituteDb ? window.testSubstituteDb : bytes)
              },
              async abort() {},
            }
          },
        }
      },
    }
  }
  window.showDirectoryPicker=async({mode})=>mode==='read'&&!window.testReadOutput?handle(sourceFiles,'',true):handle(output)
 },{files})
 await page.goto(pathToFileURL(path.join(editorOutput,'index.html')).href)
 await page.locator('#open').click();await page.waitForFunction(()=>document.querySelector('#source').textContent.includes('测试源'))
 await page.locator('#check').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('校验通过'))
 // A copy that Desktop cannot open must never be advertised as a completed library.
 for (const [id, name] of [['Fixture','Fixture.jpg'], ['second','second.图片']]) {
   const invalid = new SQL.Database(files['journal.db'])
   invalid.run('INSERT INTO assets VALUES (?,?,?,?,?)',[id,'image/png',name,png.length,new Date().toISOString()])
   const bytes = Array.from(invalid.export())
   invalid.close()
   await page.evaluate(({bytes,name}) => {
     window.testSource.set('journal.db',new Uint8Array(bytes))
     window.testSource.set('attachments/'+name,window.testSource.get('attachments/fixture.png'))
   },{bytes,name})
   await page.locator('#open').click()
   await page.waitForFunction(()=>!document.querySelector('#open').disabled)
   await page.locator('#export').click()
   await page.waitForFunction(()=>!document.querySelector('#export').disabled)
   assert.match(await page.locator('#message').innerText(),/不可移植/, 'export must apply desktop attachment index rules')
   assert.equal(await page.evaluate(()=>window.testOutput.size),0)
 }
 await page.evaluate(bytes=>window.testSource.set('journal.db',new Uint8Array(bytes)),files['journal.db'])
 await page.locator('#open').click()
 await page.waitForFunction(()=>!document.querySelector('#open').disabled)
 await page.evaluate(()=>{window.testAsset=window.testSource.get('attachments/fixture.png');window.testSource.delete('attachments/fixture.png')})
 await page.locator('#check').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('Missing attachments/fixture.png'))
 await page.evaluate(()=>window.testSource.set('attachments/fixture.png',window.testAsset))
 await page.getByRole('button',{name:'全选',exact:true}).click()
 assert.equal(await page.locator('tbody input:checked').count(),fixture.trades.filter(t=>t.tradeKind==='live').length)
 await page.getByRole('button',{name:'取消全选',exact:true}).click();assert.equal(await page.locator('tbody input:checked').count(),0)
 await page.getByLabel('按策略筛选').selectOption(fixture.trades.find(t=>t.tradeKind==='live').strategyId)
 const filteredCount=await page.locator('tbody tr').count()
 await page.getByLabel('全选当前结果',{exact:true}).check();assert.equal(await page.locator('tbody input:checked').count(),filteredCount)
 await page.getByLabel('全选当前结果',{exact:true}).uncheck();assert.equal(await page.locator('tbody input:checked').count(),0)
 await page.getByLabel('按策略筛选').selectOption('')
 await page.getByRole('button',{name:'全选',exact:true}).click()
 const targetStrategy=fixture.strategies.at(-1).id
 await page.getByLabel('批量设置策略',{exact:true}).selectOption(targetStrategy)
 await page.getByRole('button',{name:'批量设置策略',exact:true}).click()
 await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('条记录设置策略'))
 await page.locator('tbody tr').first().click();assert.equal(await page.getByLabel('交易策略',{exact:true}).inputValue(),targetStrategy)
 await page.locator('#undo').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('已撤销'))
 await page.getByRole('button',{name:'全选',exact:true}).click();await page.getByRole('button',{name:'迁入模拟盘',exact:true}).click();await page.locator('#confirm').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('已迁入模拟盘'))
 await page.locator('#undo').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('已撤销'))
 await page.locator('tbody tr').first().click();await page.locator('textarea').fill('{bad json');await page.getByRole('button',{name:'应用编辑',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#open').disabled);assert.equal(await page.locator('textarea').inputValue(),'{bad json')
 await page.locator('#nav button').filter({hasText:'随记'}).click();await page.locator('#confirm').click()
 for(const label of ['标签预置','错误标签预置']){
   await page.locator('#nav button').filter({hasText:new RegExp('^'+label)}).click()
   await page.getByLabel('新增标签名称').fill('编辑器新增测试，编辑器新增测试')
   await page.getByRole('button',{name:'新增标签',exact:true}).click()
   await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('已新增标签预置'))
   assert.equal(await page.locator('tbody tr').filter({hasText:'编辑器新增测试'}).count(),1)
   await page.getByLabel('新增标签名称').fill('编辑器新增测试')
   await page.getByRole('button',{name:'新增标签',exact:true}).click()
   await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('已经存在'))
 }
 await page.locator('#nav button').filter({hasText:/^实盘日志/}).click()
 await page.getByRole('button',{name:'全选',exact:true}).click()
 await page.getByRole('button',{name:'迁入模拟盘',exact:true}).click();await page.locator('#confirm').click()
 await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('已迁入模拟盘'))
 await page.locator('#nav button').filter({hasText:/^实盘阶段/}).click()
 await page.getByRole('button',{name:'重新开始实盘',exact:true}).click();await page.locator('#confirm').click()
 await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('已重置实盘阶段'))
 await page.screenshot({path:path.join(out,'editor.png'),fullPage:true})
 await page.evaluate(()=>{const bytes=window.testSource.get('journal.db').slice();bytes[24]^=1;window.testSource.set('journal.db',bytes)})
 await page.evaluate(bytes=>{window.testSubstituteDb=new Uint8Array(bytes)},files['journal.db'])
 await page.locator('#export').click()
 await page.waitForFunction(()=>!document.querySelector('#export').disabled)
 assert.match(await page.locator('#message').innerText(),/数据库回读与本次导出不一致/)
 assert.equal(await page.evaluate(()=>window.testOutput.has('manifest.json')),false)
 await page.evaluate(()=>{window.testSubstituteDb=null;window.testOutput.clear()})
 await page.locator('#export').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('导出完成：'))
 await page.locator('#export').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('导出目录必须为空'))
 const result=await page.evaluate(()=>Object.fromEntries([...window.testOutput].map(([k,v])=>[k,Array.from(v)])))
 for(const [key,bytes]of Object.entries(result)){const target=path.join(out,'export',key);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,new Uint8Array(bytes))}
 const reopened=new SQL.Database(new Uint8Array(result['journal.db']));validate(decode(JSON.parse(reopened.exec("SELECT value FROM meta WHERE key='snapshot'")[0].values[0][0]),SCHEMA_VERSION));reopened.close()
 assert.deepEqual(Buffer.from(result['attachments/fixture.png']),png)
 await build({configFile:false,resolve:{alias:{'@':path.resolve('src')}},build:{ssr:path.resolve('electron/library/storage.ts'),outDir:path.join(out,'desktop-reader'),emptyOutDir:false,rollupOptions:{output:{entryFileNames:'storage.mjs'}}}})
 const {LibraryStorage}=await import(pathToFileURL(path.join(out,'desktop-reader/storage.mjs')))
 const desktop=new LibraryStorage(path.join(out,'export'),{allowCreate:false})
 try{
   await desktop.open();const loaded=desktop.loadSnapshot()
   assert.equal(loaded.trades.length,snapshot.trades.length)
   assert.equal(loaded.trades.filter(t=>t.tradeKind==='live').length,0)
   assert.deepEqual(JSON.parse(JSON.stringify(loaded.trades.filter(t=>t.tradeKind==='case'))),fixture.trades.filter(t=>t.tradeKind==='case').map(t=>({...t,liveStageId:null})))
 }finally{desktop.close()}
 // A target file can appear after the initial empty-directory check.
 await page.evaluate(()=>{window.testOutput.clear();window.testForeignAttachment=true})
 await page.locator('#export').click()
 await page.waitForFunction(()=>!document.querySelector('#export').disabled)
 assert.match(await page.locator('#message').innerText(),/导出目标已存在/)
 assert.deepEqual(await page.evaluate(()=>Array.from(window.testOutput.get('attachments/fixture.png'))),[3,1,4])
 assert.equal(await page.evaluate(()=>window.testOutput.has('manifest.json')),false)
 await page.evaluate(()=>{window.testForeignAttachment=false})
 await page.evaluate(()=>{window.testOutput.clear();window.testFailCopy=true})
 await page.locator('#export').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('导出未完成'))
 const failed=await page.evaluate(()=>({db:window.testOutput.has('journal.db'),state:window.testOutput.has('editor-export-state.json'),manifest:window.testOutput.has('manifest.json')}))
 assert.deepEqual(failed,{db:true,state:true,manifest:false})
 // A failed copy keeps its edited SQLite snapshot readable through its recovery record.
 await page.evaluate(()=>{window.testReadOutput=true;window.testFailCopy=false})
 await page.locator('#open').click()
 await page.locator('#confirm').click()
 await page.waitForFunction(()=>document.querySelector('#source').textContent.includes('测试输出'))
 await page.locator('#check').click()
 await page.waitForFunction(()=>!document.querySelector('#check').disabled)
 assert.match(await page.locator('#message').innerText(),/附件尺寸不符/)
 await page.evaluate(()=>window.testOutput.set('attachments/fixture.png',window.testSource.get('attachments/fixture.png')))
 await page.locator('#check').click()
 await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('校验通过'))

 // Exercise the shipped picker flow with Chromium's real directory and writable handles.
 const fsPage=await browser.newPage()
 // OPFS requires a non-opaque secure origin; the picker test above uses the shipped file URL.
 await fsPage.route('http://localhost/**', route => {
   const name=path.basename(new URL(route.request().url()).pathname)
   return route.fulfill({path:path.join(editorOutput,name)})
 })
 await fsPage.goto('http://localhost/index.html')
 await fsPage.evaluate(async files=>{
   const root=await navigator.storage.getDirectory()
   const source=await root.getDirectoryHandle('source',{create:true})
   const destination=await root.getDirectoryHandle('copy',{create:true})
   const child=await source.getDirectoryHandle('child',{create:true})
   const attachments=await source.getDirectoryHandle('attachments',{create:true})
   for(const [key,data] of Object.entries(files)){
     const dir=key.startsWith('attachments/')?attachments:source
     const handle=await dir.getFileHandle(key.split('/').at(-1),{create:true})
     const writer=await handle.createWritable()
     await writer.write(new Uint8Array(data))
     await writer.close()
   }
   window.testChoices={source,destination,child,root}
   window.testTarget='destination'
   window.showDirectoryPicker=async({mode})=>mode==='read'?source:window.testChoices[window.testTarget]
 },files)
 await fsPage.locator('#open').click()
 await fsPage.waitForFunction(()=>document.querySelector('#source').textContent.includes('source'))
 for(const target of ['source','child','root']){
   await fsPage.evaluate(key=>{window.testTarget=key},target)
   await fsPage.locator('#export').click()
   await fsPage.waitForFunction(()=>!document.querySelector('#export').disabled)
   assert.match(await fsPage.locator('#message').innerText(),/独立空目录/)
 }
 await fsPage.evaluate(()=>{window.testTarget='destination'})
 await fsPage.locator('#export').click()
 await fsPage.waitForFunction(()=>document.querySelector('#message').textContent.includes('导出完成'))
 const realCopy=await fsPage.evaluate(async()=>{
   const {source,destination}=window.testChoices
   const backup=await destination.getFileHandle('journal.db')
   const attachment=await (await destination.getDirectoryHandle('attachments')).getFileHandle('fixture.png')
   const original=await source.getFileHandle('journal.db')
   const bytes=async handle=>Array.from(new Uint8Array(await (await handle.getFile()).arrayBuffer()))
   return {database:await bytes(backup),png:await bytes(attachment),source:await bytes(original)}
 })
 assert.deepEqual(realCopy.source,files['journal.db'])
 assert.deepEqual(Buffer.from(realCopy.png),png)
 const nativeCopy=new SQL.Database(realCopy.database)
 try {
   const data=JSON.parse(nativeCopy.exec("SELECT value FROM meta WHERE key='snapshot'")[0].values[0][0])
   assert.deepEqual(decode(data,SCHEMA_VERSION),decode(fixture,SCHEMA_VERSION))
 }finally{nativeCopy.close()}
 await fsPage.close()
 assert.equal(errors.length,0,errors.join('\n'))
 assert.deepEqual(await fs.readFile(path.join(sourcePath,'journal.db')),original,'Source remains untouched')
 console.log('PASS: actual schema, paper migration, reset, invalid references, file:// UI, undo, invalid JSON, offline SQLite, export roundtrip, Atlas desktop LibraryStorage.open/loadSnapshot, attachment bytes, source unchanged')
}finally{await browser.close()}

} finally { if(syntheticSource) await fs.rm(syntheticSource,{recursive:true,force:true}) }
