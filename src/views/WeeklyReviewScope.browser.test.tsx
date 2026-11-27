import { MemoryAppRouter } from '@/test/fixtures/MemoryAppRouter'
import { createRoot } from 'react-dom/client'
import { useLocation } from 'react-router-dom'
import { createWeeklyReview, weekStartFor } from '@/data/weeklyReviews'
import type { Trade } from '@/data/trades'
import { getTradingDayKey, parseLocalDate, formatYmd } from '@/lib/periods'
import { TradeWorkspaceContext } from '@/components/TradeWorkspaceContext'
import { useStore } from '@/store/useStore'
import { submitWeeklyReview } from '@/lib/submitWeeklyReview'
import { useShortcutHost } from '@/shortcuts/ShortcutHost'
import { WeeklyReviewView } from './WeeklyReviewView'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global { interface Window { __weeklyReviewScopeTest?: Promise<void> } }
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message) }
async function waitFor(check: () => boolean, message: string) { const end = performance.now()+8000; while(performance.now()<end){if(check())return;await new Promise<void>(r=>requestAnimationFrame(()=>r()))}throw Error(message) }
function Fixture(){useShortcutHost({onToggleCmdk:()=>{}});const location=useLocation();return <><WeeklyReviewView header={<TradeWorkspaceContext page="review"/>}/><output hidden data-scope-route>{location.search}</output></>}
async function run(){
  const before=useStore.getState(), root=createRoot(document.getElementById('root')!), current=before.currentLiveStageId, old='scope-old'
  const week=weekStartFor(parseLocalDate(getTradingDayKey(new Date(),before.display.tradingDayStartHour))), date=parseLocalDate(week);date.setDate(date.getDate()-7);const previousWeek=formatYmd(date)
  const row=(stage:string,w=week)=>document.querySelector<HTMLButtonElement>(`.wr-history [data-review-stage-id="${stage}"][data-review-week="${w}"]`)
  const owner=()=>document.querySelector('.wr-main')?.getAttribute('data-review-stage-id')
  const snapshot=()=>JSON.stringify({reviews:useStore.getState().weeklyReviews,trades:useStore.getState().trades})
  const pendingTrade:Trade={id:'scope-pending-trade',ref:'SCOPE',symbol:'ETHUSDT',tradeKind:'live',liveStageId:old,side:'long',status:'win',conviction:'medium',strategyId:'',tags:[],mistakeTags:[],reviewStatus:'unreviewed',reviewCategory:'normal',openedAt:previousWeek,closedAt:previousWeek,pnl:77,cashCurrency:'USD',rMultiple:1,resultSource:'pnl',entry:1,exit:2,size:1,note:'<p>原图与正文保留</p>'}
  try{
    useStore.setState({trades:[],weeklyReviews:[],scheduledStageRollover:null,liveStages:[...before.liveStages.map(stage=>stage.id===current?{...stage,startsOn:week}:stage),{id:old,sequence:0,name:'隔离历史阶段',status:'archived',startsOn:'2020-01-06',endsOn:formatYmd(new Date(parseLocalDate(week).getTime()-86400000)),createdAt:'2020-01-06T00:00:00.000Z',archivedAt:week}]})
    root.render(<MemoryAppRouter initialEntries={['/weekly-review?liveStage=all']}><Fixture/></MemoryAppRouter>)
    await waitFor(()=>Boolean(row(current)),'空资料库应显示当前周入口')
    const shell=document.querySelector('.wr-shell')!, rail=document.querySelector('.wr-history')!, left=document.querySelector('.wr-main')!.getBoundingClientRect().left, columns=getComputedStyle(shell).gridTemplateColumns
    assert(!document.querySelector<HTMLDetailsElement>('.wr-record-picker')!.open,'记录默认收起，正文保持完整阅读轨道')
    const currentReview={...createWeeklyReview(week,current),executionScore:4,riskScore:4,emotionScore:4,contentHtml:'<p>当前阶段完成快照</p>',commitmentText:'保持等待',commitmentCriteria:'遵循确认条件'}
    useStore.setState({weeklyReviews:[currentReview]})
    await submitWeeklyReview(currentReview,useStore.getState().librarySession)
    const frozen=JSON.stringify(useStore.getState().weeklyReviews[0])
    const oldReview={...createWeeklyReview(week,old),contentHtml:'<p>历史阶段独立草稿</p>'}
    useStore.setState(state=>({weeklyReviews:[...state.weeklyReviews,oldReview],trades:[pendingTrade]}))
    await waitFor(()=>Boolean(row(old))&&Boolean(row(old,previousWeek)),'全部阶段须列出同周记录及其他阶段活动周')
    const saved=snapshot()
    const picker = document.querySelector<HTMLDetailsElement>('.wr-record-picker')!
    const summary = picker.querySelector('summary')!
    const press = (key: string) => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    summary.focus()
    press('ArrowDown')
    assert(picker.open && document.activeElement === row(current), '从记录选择器按方向键应打开并定位当前记录')
    assert(row(current)?.innerText.includes('已完成') && row(old)?.innerText.includes('草稿') && row(old, previousWeek)?.innerText.includes('待补做'), '状态无需区分颜色即可读出')
    press('ArrowDown')
    assert(document.activeElement === row(old) && owner() === current, '上下移动浏览记录应只移动焦点')
    press('End')
    assert(document.activeElement === row(old, previousWeek), 'End 应定位末条历史记录')
    press('Home')
    assert(document.activeElement === row(current), 'Home 应定位首条历史记录')
    press('Escape')
    assert(!picker.open && document.activeElement === summary, 'Esc 应收起选择器并返回触发控件')
    row(old)!.click();await waitFor(()=>owner()===old&&document.body.textContent?.includes('历史阶段独立草稿')===true,'选中历史阶段后正文归属错误')
    assert(document.querySelector('[aria-label^="选择交易阶段"]')?.textContent?.trim()==='全部阶段','查看历史记录不得改变全部阶段范围')
    assert(row(old)?.getAttribute('aria-current')==='page','当前行必须唯一表达选中身份')
    assert(!document.querySelector('.wr-document-status:has(svg)'),'草稿不得显示其他阶段的完成状态')
    row(current)!.click();await waitFor(()=>owner()===current&&Boolean(document.querySelector('.wr-document-status:has(svg)')),'当前阶段完成快照没有恢复')
    row(old,previousWeek)!.click();await waitFor(()=>owner()===old&&document.body.textContent?.includes('+$77')===true,'待补做活动周未按其原阶段读取交易')
    assert(snapshot()===saved,'浏览或切换待补做记录不得创建或修改复盘与交易')
    const pendingSearch=document.querySelector('[data-scope-route]')?.textContent ?? ''
    assert(new URLSearchParams(pendingSearch).get('liveStage')==='all'&&new URLSearchParams(pendingSearch).get('review')===createWeeklyReview(previousWeek,old).id,'待补做记录必须保持可刷新阶段身份与全部范围')
    const previousShell=document.querySelector('.wr-shell')
    root.render(<MemoryAppRouter key="refresh" initialEntries={['/weekly-review'+pendingSearch]}><Fixture/></MemoryAppRouter>)
    await waitFor(()=>document.querySelector('.wr-shell')!==previousShell&&owner()===old&&document.body.textContent?.includes('+$77')===true,'刷新待补做深链后阶段发生漂移')
    const score=document.querySelector<HTMLButtonElement>('[data-weekly-field="score-execution"] button')!;score.click();await waitFor(()=>Boolean(document.querySelector('[role="option"][data-value="4"]')),'评分菜单未打开');document.querySelector<HTMLButtonElement>('[role="option"][data-value="4"]')!.click()
    await waitFor(()=>useStore.getState().weeklyReviews.some(r=>r.liveStageId===old&&r.weekStart===previousWeek),'首次编辑没有保存到正确阶段和周')
    assert(JSON.stringify(useStore.getState().weeklyReviews.find(r=>r.id===currentReview.id))===frozen,'其他阶段的完成快照被修改')
    const select=document.querySelector<HTMLButtonElement>('[aria-label^="选择交易阶段"]')!;select.click();await waitFor(()=>Boolean(document.querySelector('[role="option"][data-value="current"]')),'范围菜单未打开');document.querySelector<HTMLButtonElement>('[role="option"][data-value="current"]')!.click()
    await waitFor(()=>owner()===current&&Boolean(document.querySelector('.wr-document-status:has(svg)')),'切换范围后不得残留历史记录选择')
    useStore.setState({weeklyReviews:[JSON.parse(frozen)],trades:[]});await waitFor(()=>document.querySelectorAll('.wr-history button').length===1,'仅剩一条记录时列表不正确')
    assert(document.querySelector('.wr-history')&&getComputedStyle(document.querySelector('.wr-shell')!).gridTemplateColumns===columns,'空、单条、多条记录不得改变栏位结构')
    assert(Math.abs(document.querySelector('.wr-main')!.getBoundingClientRect().left-left)<1,'历史栏不得自动隐藏导致正文跳位')
    assert(document.documentElement.scrollWidth<=innerWidth,'小窗口不得横向溢出')
  }finally{root.unmount();useStore.setState(before,true)}
}
window.__weeklyReviewScopeTest=run()
