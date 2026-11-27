import { MemoryAppRouter } from '@/test/fixtures/MemoryAppRouter'
import { createRoot } from 'react-dom/client'
import { useNavigate } from 'react-router-dom'
import { createWeeklyReview, weekStartFor } from '@/data/weeklyReviews'
import { formatYmd, getTradingDayKey, parseLocalDate } from '@/lib/periods'
import { getStorage } from '@/storage/provider'
import { flushNoteDraftToStore, noteDraftKey, resetNoteDraftsForTests, setNoteDraft } from '@/storage/noteDrafts'
import { useStore } from '@/store/useStore'
import { toastStore } from '@/lib/toast'
import { WeeklyReviewView } from './WeeklyReviewView'

declare global { interface Window { __weeklyReviewSubmissionTest?: Promise<void> } }

const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
async function until(condition: () => boolean, message: string) {
  const deadline = performance.now() + 5000
  while (!condition()) {
    if (performance.now() > deadline) throw Error(message)
    await frame()
  }
}

function Fixture({ historyPath }: { historyPath: string }) {
  const navigate = useNavigate()
  return <><button data-history-link onClick={() => navigate(historyPath)}>打开历史周</button><WeeklyReviewView /></>
}

async function run() {
  const state = useStore.getState()
  const week = weekStartFor(parseLocalDate(getTradingDayKey(new Date(), state.display.tradingDayStartHour)))
  const previousMonday = parseLocalDate(week)
  previousMonday.setDate(previousMonday.getDate() - 7)
  const previousWeek = formatYmd(previousMonday)
  const ready = {
    ...createWeeklyReview(week, state.currentLiveStageId), id: 'source-review', contentHtml: '<p>提交来源</p>',
    executionScore: 4, emotionScore: 4, riskScore: 4, commitmentText: '核对计划', commitmentCriteria: '逐笔核对',
  }
  const history = { ...createWeeklyReview(previousWeek, state.currentLiveStageId), contentHtml: '<p>另一周正文</p>' }
  const storage = getStorage()
  const save = storage.saveAsset
  const failures: string[] = []
  const unhandled = (event: PromiseRejectionEvent) => {
    failures.push('出现未处理的提交异常：' + event.reason)
    event.preventDefault()
  }
  window.addEventListener('unhandledrejection', unhandled)
  try {
    for (const scenario of ['replace', 'delete', 'reassign', 'edit', 'leave-invalid', 'leave-valid', 'double'] as const) {
      let started = false
      let finish!: (id: string) => void
      const gate = new Promise<string>(resolve => { finish = resolve })
      storage.saveAsset = async () => { started = true; return gate }
      const source = scenario === 'leave-invalid' ? { ...ready, riskScore: null } : ready
      useStore.setState({ weeklyReviews: [source, history] })
      toastStore.dismiss()
      let completions = 0
      const unsubscribe = useStore.subscribe((next, previous) => {
        if (next.weeklyReviews !== previous.weeklyReviews && next.weeklyReviews.some(r => r.id === source.id && r.status === 'completed')) completions++
      })
      const root = createRoot(document.getElementById('root')!)
      const key = noteDraftKey('weeklyReview', source.id)
      const text = () => document.querySelector('[aria-label="周复盘正文"]')?.textContent
      try {
        const historyPath = '/weekly-review?week=' + previousWeek + '&review=' + encodeURIComponent(history.id)
        root.render(<MemoryAppRouter initialEntries={['/weekly-review']}><Fixture historyPath={historyPath} /></MemoryAppRouter>)
        await until(() => text()?.includes('提交来源') === true, '未载入来源复盘')
        setNoteDraft(key, '<p>提交时的输入</p><img src="data:image/png;base64,AQID">')
        const submit = [...document.querySelectorAll('button')].find(b => b.textContent === '完成本周复盘')!
        submit.click()
        if (scenario === 'double') submit.click()
        await until(() => started, '未等待图片保存')
        const draining = flushNoteDraftToStore(key)
        if (scenario === 'replace') useStore.setState({ weeklyReviews: [{ ...ready, id: 'different-review' }, history] })
        if (scenario === 'delete') useStore.setState({ weeklyReviews: [history] })
        if (scenario === 'reassign') useStore.setState({ weeklyReviews: [{ ...source, liveStageId: null }, history] })
        if (scenario === 'edit') useStore.getState().updateWeeklyReview(source.id, { commitmentCriteria: '  ' })
        if (scenario.startsWith('leave')) {
          document.querySelector<HTMLButtonElement>('[data-history-link]')!.click()
          await until(() => text()?.includes('另一周正文') === true, '未在保存期间切换周次')
        }
        finish('source-asset')
        await draining
        await frame()
        await frame()
        const reviews = useStore.getState().weeklyReviews
        if (scenario === 'replace' && reviews.some(r => r.status === 'completed')) failures.push('替代记录被旧提交冻结')
        if (scenario === 'reassign' && completions) failures.push('已改变阶段归属的记录被旧请求冻结')
        if (scenario === 'edit' && (completions || document.activeElement?.getAttribute('data-weekly-field') !== 'commitment-criteria')) failures.push('保存期间更新的验收标准未参与最终校验')
        if (scenario === 'delete' && reviews.some(r => r.id === source.id)) failures.push('已移除记录被还原')
        if (scenario.startsWith('leave')) {
          if (reviews.find(r => r.id === history.id)?.status !== 'draft') failures.push('历史周状态被修改')
          if (document.querySelector('[data-weekly-section][data-invalid="true"]') || document.activeElement?.closest('[data-weekly-field]')) failures.push('迟到的字段提示或焦点落在另一周')
          if (toastStore.getVisible().some(item => item.message === '本周复盘已完成，指标已冻结')) failures.push('另一周显示了来源周的成功提示')
        }
        if ((scenario === 'double' || scenario === 'leave-valid') && completions !== 1) failures.push(scenario + ' 完成发布次数 ' + completions)
        if (scenario === 'leave-invalid' && completions !== 0) failures.push('不完整复盘被提交')
      } finally {
        finish('source-asset')
        root.unmount()
        unsubscribe()
        resetNoteDraftsForTests()
      }
    }
  } finally {
    window.removeEventListener('unhandledrejection', unhandled)
    storage.saveAsset = save
    toastStore.dismiss()
    useStore.setState(state, true)
  }
  if (failures.length) throw Error(failures.join('、'))
}

window.__weeklyReviewSubmissionTest = run()
