import { StageOwnershipAutoRepair } from '@/components/StageOwnershipAutoRepair'
import { createRoot } from 'react-dom/client'
import { DataOrganizationPanel } from './DataOrganizationPanel'
import { useStore } from '@/store/useStore'
import { captureOrganizationSnapshot } from '@/lib/dataOrganizationService'
import { createWeeklyReview } from '@/data/weeklyReviews'
import { createInitialLiveStage } from '@/lib/liveStages'
import type { PersistedSnapshot } from '@/storage/types'
import '@/styles/tokens.css'
import '@/styles/global.css'
import './SettingsLayout.css'

declare global { interface Window { __dataOrganizationTest?: { failBackup: boolean; commits: number; backups: number; completed: number; seedRepair: () => void } } }
const test = { failBackup: true, commits: 0, backups: 0, completed: 0, seedRepair: () => { const current=useStore.getState(); useStore.setState({weeklyReviews:[],liveStages:[createInitialLiveStage('2026-08-01','2026-08-01T00:00:00.000Z','repair-stage')],currentLiveStageId:'repair-stage',trades:current.trades.map(t=>({...t,tradeKind:'live',liveStageId:null}))}) } }
window.__dataOrganizationTest = test
useStore.setState({strategies:[{id:'strategy',name:'导航1',icon:'trending-up',color:'#888888'}],liveStages:[createInitialLiveStage('2026-08-01','2026-08-01T00:00:00.000Z','stage')],currentLiveStageId:'stage',weeklyReviews:[createWeeklyReview('2026-08-03','stage')],trades:[{id:'t',ref:'TRD-1',tradeKind:'live',liveStageId:'stage',symbol:'EURUSD',side:'long',status:'planned',conviction:'medium',mistakeTags:[],reviewStatus:'unreviewed',reviewCategory:'normal',strategyId:'strategy',tags:[],note:'原始正文',entry:1,exit:null,size:0,pnl:null,rMultiple:null,openedAt:'2026-08-03',closedAt:null}]})
let disk:PersistedSnapshot=captureOrganizationSnapshot()
const manifest={libraryId:'test-library',schemaVersion:13,createdAt:'2026-08-01T00:00:00.000Z',platform:'electron' as const}
const bridge: Partial<NonNullable<Window['journalBridge']>> = {
  isElectron:true,
  getManifest:async()=>manifest,
  saveSnapshot:async snapshot=>{disk=snapshot;return true},
  loadSnapshot:async()=>disk,
  createBackup:async()=>{test.backups++;return 'before-organization.db'},
  verifyBackup:async()=>({status:test.failBackup?'invalid':'verified',checkedAt:Date.now(),error:test.failBackup?'模拟备份验证失败':undefined}),
  commitImport:async snapshot=>{test.commits++;disk=structuredClone(snapshot);return true},
}
window.journalBridge = bridge as NonNullable<Window['journalBridge']>
createRoot(document.getElementById('root')!).render(<div className="settings-page settings-page--reading"><h1 className="settings-page-title">数据 · 隔离测试</h1><StageOwnershipAutoRepair /><DataOrganizationPanel day="2026-09-07" onCompleted={()=>{test.completed++}} /></div>)
