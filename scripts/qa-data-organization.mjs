import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'

// Read-only real-library input; every commit/restore targets an isolated copy.
const source=process.env.ATLAS_QA_LIBRARY ?? 'D:/YunkooTradelog'
const root=path.resolve('test-results',`data-organization-${Date.now()}`)
await fs.mkdir(root,{recursive:true})
const modules={organization:'src/lib/dataOrganization.ts',storage:'electron/library/storage.ts',backup:'electron/library/backup.ts'}
for(const [name,entry]of Object.entries(modules))await build({configFile:false,logLevel:'error',resolve:{alias:{'@':path.resolve('src')}},build:{ssr:path.resolve(entry),outDir:path.join(root,name),rollupOptions:{output:{entryFileNames:'index.mjs'}}}})
const {prepareDataOrganization}=await import(pathToFileURL(path.join(root,'organization/index.mjs')))
const {LibraryStorage}=await import(pathToFileURL(path.join(root,'storage/index.mjs')))
const {createBackupAtPath,verifyBackupAtPath,restoreBackupAtPath}=await import(pathToFileURL(path.join(root,'backup/index.mjs')))
const copy=path.join(root,'library');await fs.mkdir(copy)
const sourceBytes=await fs.readFile(path.join(source,'journal.db'))
for(const name of ['journal.db','manifest.json'])await fs.copyFile(path.join(source,name),path.join(copy,name))
await fs.cp(path.join(source,'attachments'),path.join(copy,'attachments'),{recursive:true})
const digest=async dir=>Object.fromEntries(await Promise.all((await fs.readdir(dir)).map(async name=>[name,createHash('sha256').update(await fs.readFile(path.join(dir,name))).digest('hex')])))
const hashes=await digest(path.join(copy,'attachments'))
let store=new LibraryStorage(copy,{allowCreate:false});await store.open()
const before=store.loadSnapshot()
const backup=createBackupAtPath(store,copy);assert(backup)
assert.equal((await verifyBackupAtPath(copy,backup)).status,'verified')
for(const removeWeekly of [false,true]){
  const next=prepareDataOrganization(before,{migrateLive:true,resetStages:true,deleteWeeklyIds:removeWeekly?(before.weeklyReviews??[]).map(r=>r.id):[]},'2026-09-07','2026-09-07T00:00:00.000Z','fresh')
  await store.commitImport(next,[],{pruneUnreferenced:false,expectedSnapshotRevision:store.getSnapshotRevision()})
  store.close();store=new LibraryStorage(copy,{allowCreate:false});await store.open()
  assert.equal(store.loadSnapshot().trades.filter(t=>t.tradeKind==='live').length,0)
  assert.equal(store.loadSnapshot().trades.filter(t=>t.tradeKind==='case').length,before.trades.filter(t=>t.tradeKind==='case').length)
  assert.equal(store.loadSnapshot().weeklyReviews.length,removeWeekly?0:before.weeklyReviews.length)
}
assert.deepEqual(await digest(path.join(copy,'attachments')),hashes)
store.close();assert.equal(restoreBackupAtPath(copy,backup),true)
store=new LibraryStorage(copy,{allowCreate:false});await store.open()
assert.deepEqual(store.loadSnapshot(),before);store.close()
assert.deepEqual(await digest(path.join(copy,'attachments')),hashes)
assert.deepEqual(await fs.readFile(path.join(source,'journal.db')),sourceBytes)
console.log(`PASS: verified backup, combined reset with retained/deleted reviews, reopen, ${Object.keys(hashes).length} attachment hashes, full backup restoration, source unchanged. Evidence: ${root}`)
