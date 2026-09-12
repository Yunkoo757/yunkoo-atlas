import fs from 'node:fs'
import { engine, generate, readState, checkRulePack, documentFor } from './service'
import { BUILTIN_RULES, emptyComposerData, assertComposerData } from './model'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import { decodeCanonicalSnapshot } from '@/storage/snapshotCodec'
import { SCHEMA_VERSION } from '@/storage/types'
import { migrateShortcutBindings } from '@/shortcuts/migrate'
function assert(x:unknown,m:string):asserts x {if(!x)throw Error(m)}
function rejects(f:()=>unknown){let threw=false;try{f()}catch{threw=true}assert(threw,'invalid input must reject')}
export function testNewShortcutPreservesCustomR(){
  const old=migrateShortcutBindings({'nav.list':{key:'r'}})
  assert(old['nav.reviewComposer']===null && old['nav.list']!==null,'custom R must survive')
  assert(!('nav.reviewComposer' in migrateShortcutBindings({})),'new library should inherit default R')
}
export function testLegacyParity(){
  const fixtures=JSON.parse(fs.readFileSync('scripts/fixtures/review-composer/legacy-output.json','utf8'))
  for(const item of fixtures){assert(engine.generate(item.state).text===item.result,'engine migration changed legacy prose');assert(generate(readState(item.state),BUILTIN_RULES).text===item.result,'adapter changed legacy prose')}
}
export function testRulesAndFrozenDocument(){
  const state={...engine.defaults,symbol:'GU'}
  const doc=documentFor(state,BUILTIN_RULES)
  const before=JSON.stringify(doc)
  const pack=checkRulePack({...BUILTIN_RULES,version:'test-2',phrases:[{from:'GU案例分析',to:'GU复盘'}]})
  assert(generate(state,pack).text.includes('GU复盘'),'phrase update must affect generated output')
  assert(JSON.stringify(doc)===before,'update rewrote stored document')
  rejects(()=>checkRulePack({...pack,engineVersion:999}))
  rejects(()=>checkRulePack({...pack,allowedNavigations:[]}))
  rejects(()=>checkRulePack({...pack,defaults:{period:'bad'}}))
  rejects(()=>checkRulePack({...pack,phrases:[{from:'HTF',to:'删除'}]}))
  rejects(()=>readState({nav:'99'}))
  rejects(()=>assertComposerData({...emptyComposerData(),schemaVersion:999}))
}
export function testSnapshotRoundTripAndLegacyUpgrade(){
  const snapshot=createFullPersistedSnapshotFixture()
  const rules=checkRulePack({...BUILTIN_RULES,version:'test-2'})
  snapshot.reviewComposer={...emptyComposerData(),draft:documentFor(engine.defaults,BUILTIN_RULES),activeRules:rules,previousRules:BUILTIN_RULES}
  const result=decodeCanonicalSnapshot(JSON.parse(JSON.stringify(snapshot)),{version:SCHEMA_VERSION})
  assert(JSON.stringify(result.reviewComposer)===JSON.stringify(snapshot.reviewComposer),'snapshot dropped rules or prose')
  delete snapshot.reviewComposer
  const legacy=decodeCanonicalSnapshot(snapshot,{version:SCHEMA_VERSION})
  assert(legacy.reviewComposer.schemaVersion===1&&legacy.reviewComposer.draft===null,'legacy library must initialize empty')
}
