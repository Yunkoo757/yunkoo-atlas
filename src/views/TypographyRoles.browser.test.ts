import '@/styles/tokens.css'
import '@/styles/global.css'
import '@/App.css'
import '@/components/RouteState.css'
import '@/components/WelcomeScreen.css'
import './DetailView.css'
import './ReviewSessionView.css'
import './TodayWorkspace.css'
import './TrashView.css'
import './WeeklyReviewView.css'

declare global {
  interface Window {
    __typographyRolesTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertPageTitle(selector: string): void {
  const element = document.querySelector<HTMLElement>(selector)
  assert(element, `缺少 ${selector} 页面标题样例`)
  const style = getComputedStyle(element)
  assert(style.fontSize === '20px', `${selector} 计算后字号必须为 20px`)
  assert(style.lineHeight === '28px', `${selector} 计算后行高必须为 28px`)
  assert(style.fontWeight === '600', `${selector} 计算后字重必须为 600`)
  assert(style.letterSpacing === 'normal' || style.letterSpacing === '0px', `${selector} 计算后字距必须为 0`)
}

async function run(): Promise<void> {
  document.body.innerHTML = `
    <h1 class="dv-title">交易详情</h1>
    <section class="today-focus"><h1>今日工作台</h1></section>
    <section class="review-session-intro"><h1>随机打开一组过去的交易</h1></section>
    <section class="review-session-item-header"><h1>BTCUSDT</h1></section>
    <section class="wr-page-head"><h1>2026 年第 32 周</h1></section>
    <h1 class="welcome-title">欢迎使用 Trader Atlas</h1>
    <section class="app-storage-error-card"><h1>本地资料库未打开</h1></section>
    <section class="app-route-state"><h1>页面异常</h1></section>
    <span class="trash-item-pnl">+123.45</span>
  `
  for (const selector of [
    '.dv-title',
    '.today-focus h1',
    '.review-session-intro h1',
    '.review-session-item-header h1',
    '.wr-page-head h1',
    '.welcome-title',
    '.app-storage-error-card h1',
    '.app-route-state h1',
  ]) assertPageTitle(selector)

  const pnl = document.querySelector<HTMLElement>('.trash-item-pnl')
  assert(pnl, '缺少回收站盈亏样例')
  const pnlStyle = getComputedStyle(pnl)
  assert(pnlStyle.fontSize === '13px' && pnlStyle.lineHeight === '20px', '回收站盈亏必须计算为 Row 13px/20px')
  assert(pnlStyle.fontVariantNumeric === 'tabular-nums', '回收站盈亏必须使用 tabular 数字')

  const rootStyle = getComputedStyle(document.documentElement)
  for (const [token, value] of [
    ['--text-primary', 'lch(92% 0.6 272 / 1)'],
    ['--text-secondary', 'lch(70% 1.1 272 / 1)'],
    ['--text-tertiary', 'lch(56% 1.15 272 / 1)'],
    ['--text-quaternary', 'lch(44% 1.15 272 / 1)'],
    ['--text-disabled', 'lch(34% 1.15 272 / 1)'],
  ]) assert(rootStyle.getPropertyValue(token).trim() === value, `${token} 必须保留精确 LCH 灰阶`)
}

window.__typographyRolesTest = run()
