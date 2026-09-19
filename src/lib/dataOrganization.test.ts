import assert from 'node:assert/strict'
import { createEmptyPersistedSnapshot } from '@/storage/emptySnapshot'
import { createInitialLiveStage } from '@/lib/liveStages'
import { createWeeklyReview } from '@/data/weeklyReviews'
import {
  extraDuplicateWeeklyReviewIds,
  findDuplicateWeeklyReviewWeeks,
  prepareDataOrganization,
  commitDataOrganization,
  type OrganizationBoundary,
} from './dataOrganization'
import type { Trade } from '@/data/trades'
import { listPendingStageOwnership, prepareAutomaticStageOwnership } from '@/lib/stageOwnershipRepair'

function fixture() {
  const s = createEmptyPersistedSnapshot()
  s.liveStages = [createInitialLiveStage('2026-08-01', '2026-08-01T00:00:00.000Z', 'stage')]
  s.currentLiveStageId = 'stage'
  s.strategies = [{ id: 'strategy', name: '导航1', color: '#888888', icon: 'trending-up' }]
  const trade: Trade = { id: 'live', ref: 'TRD-1', tradeKind: 'live', liveStageId: 'stage', symbol: 'EURUSD', side: 'long', status: 'planned', conviction: 'medium', mistakeTags: [], reviewStatus: 'unreviewed', reviewCategory: 'normal', strategyId: 'strategy', tags: ['观察'], note: '<p>原始正文</p><img src="journal-asset://image">', entry: 1, exit: null, size: 0, pnl: null, rMultiple: null, openedAt: '2026-08-03', closedAt: null }
  s.trades = [trade, { ...trade, id: 'case', ref: 'CAS-1', tradeKind: 'case' }]
  s.tagPresets = ['观察']; s.mistakeTagPresets = ['冲动']
  s.weeklyReviews = [{ ...createWeeklyReview('2026-08-03', 'stage'), contentHtml: '<p>周复盘内容</p>', highlightTradeIds: ['live'] }]
  return s
}
const plan = { migrateLive: true, resetStages: true, deleteWeeklyIds: [] }
const prepare = (s: ReturnType<typeof fixture>) => prepareDataOrganization(s, plan, '2026-09-07', '2026-09-07T00:00:00.000Z', 'fresh')

export function testOrganizationPreservesContentAndCases() {
  const s=fixture(),before=structuredClone(s),next=prepare(s)
  assert.deepEqual(s,before)
  const {liveStageId: _stage,...fields}=before.trades[0] as Extract<Trade,{tradeKind:'live'}>
  assert.deepEqual(next.trades[0],{...fields,tradeKind:'paper'})
  assert.deepEqual(next.trades[1],{...before.trades[1],liveStageId:null})
  assert.deepEqual(next.tagPresets,before.tagPresets)
  assert.deepEqual(next.strategies,before.strategies)
  assert.equal(next.weeklyReviews![0].contentHtml,before.weeklyReviews![0].contentHtml)
  assert.deepEqual(next.weeklyReviews![0].highlightTradeIds,[])
  assert.equal(next.weeklyReviews![0].liveStageId,null)
  assert.equal(next.currentLiveStageId,'fresh')
  assert.equal(listPendingStageOwnership({...next,weeklyReviews:[]}).length,0, '迁移后案例不应再要求实盘阶段')
}
export function testAutomaticOwnershipOnlyRepairsUniqueExistingStage() {
  const s=fixture();s.trades[0]={...s.trades[0],tradeKind:'live',liveStageId:null};s.weeklyReviews=[]
  const before=structuredClone(s)
  const repaired=prepareAutomaticStageOwnership({...s,weeklyReviews:[]})
  assert.equal(repaired.count,1)
  const repairedTrade=repaired.snapshot.trades[0]
  assert(repairedTrade.tradeKind==='live')
  assert.equal(repairedTrade.liveStageId,'stage')
  assert.equal(repaired.snapshot.trades[0].note,s.trades[0].note)
  assert.deepEqual(s,before)
  s.trades[0].openedAt='2000-01-01'
  assert.equal(prepareAutomaticStageOwnership({...s,weeklyReviews:[]}).count,0)
}
export function testCasesWhoseSourceBecamePaperStayIndependent() {
  const s=fixture()
  s.trades[1]={...s.trades[1],tradeKind:'case',sourceTradeId:'live',liveStageId:null}
  const next=prepare(s)
  assert.equal(listPendingStageOwnership({...next,weeklyReviews:[]}).length,0)
}
export function testOrganizationIndependentOperationsAndNoLiveGateForCases() {
  const s=fixture()
  const deleted=prepareDataOrganization(s,{migrateLive:false,resetStages:false,deleteWeeklyIds:[s.weeklyReviews![0].id]},'2026-09-07','2026-09-07T00:00:00.000Z','fresh')
  assert.deepEqual(deleted.trades,s.trades);assert.equal(deleted.weeklyReviews!.length,0)
  assert.throws(()=>prepareDataOrganization(s,{...plan,migrateLive:false},'2026-09-07','2026-09-07T00:00:00.000Z','fresh'),/仍有实盘/)
  s.trades=s.trades.filter(t=>t.tradeKind==='case');s.weeklyReviews=[]
  assert.equal(prepareDataOrganization(s,{...plan,migrateLive:false},'2026-09-07','2026-09-07T00:00:00.000Z','fresh').trades[0].tradeKind,'case')
}
function boundary() {
  const s=fixture(),events:string[]=[]
  const b:OrganizationBoundary={lock:()=>{events.push('lock');return()=>{events.push('unlock')}},flush:async()=>{events.push('flush')},capture:()=>s,suspend:()=>{events.push('suspend')},resume:()=>{events.push('resume')},backup:async()=>{events.push('backup');return 'verified.zip'},persist:async()=>{events.push('persist')},publish:()=>{events.push('publish')},halt:()=>{events.push('halt')}}
  return {s,events,b}
}
export async function testOrganizationRequiresVerifiedBackupBeforePersistence() {
  const {s,events,b}=boundary()
  await commitDataOrganization(JSON.stringify(s),prepare,b)
  assert.deepEqual(events,['lock','flush','suspend','backup','persist','publish','resume','unlock'])
  const failed=boundary();failed.b.backup=async()=>{throw Error('backup failed')}
  await assert.rejects(commitDataOrganization(JSON.stringify(failed.s),prepare,failed.b),/backup/)
  assert(!failed.events.includes('persist'));assert(!failed.events.includes('publish'));assert(!failed.events.includes('halt'))
  assert.equal(failed.events.at(-1),'unlock')
}
export async function testOrganizationRejectsConcurrentChanges() {
  const {s,events,b}=boundary(),expected=JSON.stringify(s)
  b.backup=async()=>{s.trades[0].note='concurrent';return 'backup'}
  await assert.rejects(commitDataOrganization(expected,prepare,b),/资料已变化/)
  assert(!events.includes('persist'));assert.equal(s.trades[0].note,'concurrent')
  await assert.rejects(commitDataOrganization(expected,prepare,b),/资料已变化/)
}
export async function testOrganizationCommitOrPublishFailureStopsOldAutosave() {
  for(const phase of ['persist','publish'] as const){
    const {s,events,b}=boundary();b[phase]=()=>{throw Error('failed')}
    await assert.rejects(commitDataOrganization(JSON.stringify(s),prepare,b),/failed/)
    assert(events.includes('halt'));assert.equal(events.at(-1),'unlock')
    assert.equal(s.trades[0].tradeKind,'live')
  }
}
export function testDuplicateWeeklyReviewWeeksKeepOnePerWeek(): void {
  const reviews = [
    { id: 'a', weekStart: '2026-08-03' },
    { id: 'b', weekStart: '2026-08-10' },
    { id: 'c', weekStart: '2026-08-03' },
  ]
  assert.deepEqual(findDuplicateWeeklyReviewWeeks(reviews), [
    { weekStart: '2026-08-03', ids: ['a', 'c'] },
  ])
  assert.deepEqual(extraDuplicateWeeklyReviewIds(reviews), ['c'])
}
