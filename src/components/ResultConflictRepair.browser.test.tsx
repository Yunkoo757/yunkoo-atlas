import { createRoot } from 'react-dom/client'
import { ResultConflictRepair } from './ResultConflictRepair'
import { useStore } from '@/store/useStore'
import '@/styles/tokens.css'
import '@/styles/global.css'
declare global { interface Window { __resultConflictRepairTest: Promise<void> } }
async function waitFor(check: () => boolean) {
  for (let n=0;n<200;n++) { if(check()) return; await new Promise(r=>setTimeout(r,20)) }
  throw new Error('Expected UI state was not rendered')
}
window.__resultConflictRepairTest = (async () => {
  const original = useStore.getState()
  const bridge = window.journalBridge
  const root = createRoot(document.getElementById('root')!)
  let opened = ''
  try {
    window.journalBridge = { isElectron: true, getManifest: async () => ({libraryId: 'isolated'}) } as NonNullable<Window['journalBridge']>
    useStore.setState({ trades: [{ id:'pending',ref:'TRD-9',tradeKind:'paper',symbol:'EURUSD',side:'long',status:'win',conviction:'medium',mistakeTags:[],reviewStatus:'unreviewed',reviewCategory:'normal',strategyId:'s',tags:[],note:'',entry:1,exit:null,size:0,pnl:null,rMultiple:null,openedAt:'2026-08-03',closedAt:'2026-08-04' }] })
    root.render(<ResultConflictRepair ids={['pending']} onOpenTrade={id=>{opened=id}} />)
    await waitFor(()=>!!document.querySelector('button'))
    document.querySelector<HTMLButtonElement>('button')!.click()
    await waitFor(()=>!!document.querySelector('tbody tr'))
    if(!document.body.textContent?.includes('TRD-9') || !document.body.textContent.includes('待补实际结果')) throw new Error('Missing result row not shown')
    if(document.querySelector('input[type="checkbox"]') || document.body.textContent.includes('备份并修正')) throw new Error('Empty batch controls must be hidden')
    const detail = [...document.querySelectorAll('button')].find(b=>b.textContent==='打开详情')
    detail!.click()
    await waitFor(()=>opened==='pending')
  } finally {root.unmount();useStore.setState(original,true);window.journalBridge=bridge}
})()
