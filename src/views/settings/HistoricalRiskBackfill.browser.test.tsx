import { createRoot } from 'react-dom/client'
import { HistoricalRiskBackfillPanel } from './HistoricalRiskBackfillPanel'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import { bootstrapStorage, getStorage } from '@/storage'
import { flushPersistNow } from '@/storage/persist'
import { useStore } from '@/store/useStore'
import { useRiskDataIssues } from '@/hooks/useRiskDataIssues'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global { interface Window { __historicalRiskBackfillTest?: Promise<void> } }
window.__atlasBrowserAllowedErrors = ['Persist failed Error: 测试保存失败']
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function waitFor(predicate: () => boolean, message: string) {
  const end = performance.now() + 7000
  while (!predicate()) { if (performance.now() > end) throw new Error(message); await new Promise(requestAnimationFrame) }
}
function button(text: string) { const item = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text); assert(item, `缺少按钮：${text}`); return item }
function fill(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
function View() { const issues = useRiskDataIssues('2026-07-18'); return <HistoricalRiskBackfillPanel today="2026-07-18" issues={issues} /> }

async function run() {
  await bootstrapStorage()
  const original = useStore.getState()
  const storage = getStorage()
  const originalSave = storage.saveSnapshot.bind(storage)
  const snapshot = createFullPersistedSnapshotFixture()
  snapshot.weeklyReviews = []; snapshot.quickNotes = []; snapshot.riskOverrideEvents = []
  snapshot.starredIds = []; snapshot.subscribedIds = []
  snapshot.liveStages = snapshot.liveStages.map((s) => ({ ...s, startsOn: '2026-07-01' }))
  snapshot.trades = Array.from({ length: 10 }, (_, i) => ({ ...snapshot.trades[0]!, id: `history-${i}`, ref: `TRD-${301 + i}`, note: '', openedAt: '2026-07-11T01:00:00.000Z', closedAt: '2026-07-12T01:00:00.000Z', closedTradingDayKey: '2026-07-12' }))
  useStore.setState(snapshot)
  await flushPersistNow()
  const root = createRoot(document.getElementById('root')!)
  try {
    root.render(<View />)
    await waitFor(() => document.body.textContent?.includes('补录历史风险规则') ?? false, '补录入口未出现')
    button('补录历史风险规则').click()
    await waitFor(() => !!document.querySelector('[role="dialog"]'), '弹窗未打开')
    assert(document.querySelector<HTMLInputElement>('[aria-label="历史起始日期"]')?.value === '2026-07-12', '应预填最早缺口日期')
    assert(document.querySelector<HTMLInputElement>('[aria-label="历史资金基准"]')?.value === '12345.67', '应预填当前规则资金基准')
    button('预览补录结果').click()
    await waitFor(() => document.body.textContent?.includes('可解除 10 项缺口') ?? false, '预览未展示可解除缺口')
    const trades = document.querySelector<HTMLDetailsElement>('.historical-risk-trades')!
    assert(!trades.open, '十笔交易明细应默认折叠')
    trades.querySelector('summary')!.click()
    await new Promise(requestAnimationFrame)
    const confirm = document.querySelector('.historical-risk-confirm')!.getBoundingClientRect()
    const action = button('确认补录并重新核算').getBoundingClientRect()
    assert(confirm.top >= 0 && confirm.bottom <= innerHeight && action.bottom <= innerHeight, '展开明细后确认与操作仍应在窗口内可见')
    const scrolls = [...document.querySelectorAll<HTMLElement>('[role="dialog"] *')].filter((e) => e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY))
    assert(scrolls.length <= 1, '普通弹窗不得出现嵌套滚动容器')
    trades.querySelector('summary')!.click()
    assert(button('确认补录并重新核算').disabled, '不得默认勾选历史事实确认')
    button('取消').click()
    await waitFor(() => !document.querySelector('[role="dialog"]'), '取消应关闭弹窗')
    assert(useStore.getState().riskPolicyVersions.length === 1, '预览取消不得写入')
    button('补录历史风险规则').click()
    await waitFor(() => !!document.querySelector('[aria-label="历史起始日期"]'), '重开失败')
    button('预览补录结果').click()
    await waitFor(() => !!document.querySelector('input[type="checkbox"]'), '缺少确认')
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()
    await waitFor(() => !button('确认补录并重新核算').disabled, '确认后未解锁')
    button('确认补录并重新核算').click()
    await waitFor(() => document.activeElement?.getAttribute('aria-label') === '历史规则依据', '缺少依据应聚焦字段')
    assert(useStore.getState().riskPolicyVersions.length === 1, '缺少依据不得提交')
    fill('历史规则依据', '用户确认当时适用')
    await waitFor(() => !document.querySelector('[role="alert"]'), '修正依据后错误应清除')
    // 只让包含补录的第一次持久化失败；回滚保存可正常完成。
    let injected = false
    storage.saveSnapshot = async (candidate) => {
      if (!injected && candidate.riskPolicyVersions.some((p) => p.historicalBackfill)) { injected = true; throw new Error('测试保存失败') }
      return originalSave(candidate)
    }
    await waitFor(() => !button('确认补录并重新核算').disabled, '确认后未解锁')
    button('确认补录并重新核算').click()
    await waitFor(() => document.querySelector('[role="alert"]')?.textContent?.includes('测试保存失败') ?? false, '保存失败未显示')
    assert(useStore.getState().riskPolicyVersions.length === 1, '保存失败必须撤回内存补录')
    assert((await storage.loadSnapshot())?.riskPolicyVersions.length === 1, '保存失败不得遗留已落盘补录')
    storage.saveSnapshot = originalSave
    button('预览补录结果').click()
    await waitFor(() => !!document.querySelector('input[type="checkbox"]'), '重试缺少确认')
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()
    await waitFor(() => !button('确认补录并重新核算').disabled, '重试未解锁')
    button('确认补录并重新核算').click()
    await waitFor(() => document.body.textContent?.includes('已补录历史规则，解除 10 项缺口') ?? false, '保存未完成')
    const durable = await storage.loadSnapshot()
    assert(durable?.riskPolicyVersions.at(-1)?.historicalBackfill?.note === '用户确认当时适用', '落盘数据必须保留用户依据')
    assert(document.body.textContent?.includes('历史补录记录'), '成功后必须保留补录记录入口')
  } finally { root.unmount(); storage.saveSnapshot = originalSave; useStore.setState(original, true) }
}
window.__historicalRiskBackfillTest = run()
