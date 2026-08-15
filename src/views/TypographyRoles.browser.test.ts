import '@/styles/tokens.css'
import '@/styles/global.css'
import '@/App.css'
import '@/components/RouteState.css'
import '@/components/WelcomeScreen.css'
import './DetailView.css'
import './ReviewSessionView.css'
import './settings/SettingsLayout.css'
import './TodayWorkspace.css'
import './TrashView.css'
import './WeeklyReviewView.css'
import '@/components/ui/FieldTrigger.css'
import '@/components/ui/DatePicker.css'
import '@/components/trades/TradeList.css'

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

function assertComputedTextRole(selector: string, token: string): void {
  const element = document.querySelector<HTMLElement>(selector)
  assert(element, `缺少 ${selector} 文字角色样例`)
  const tokenProbe = document.createElement('span')
  tokenProbe.style.color = `var(${token})`
  document.body.append(tokenProbe)
  const expected = getComputedStyle(tokenProbe).color
  tokenProbe.remove()
  assert(getComputedStyle(element).color === expected, `${selector} 计算后必须使用 ${token}`)
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
    <section class="dv-empty-card"><h1>未找到该交易</h1></section>
    <h1 class="settings-page-title">显示偏好</h1>
    <main class="route-state"><h1 class="route-state-title">范围不存在</h1></main>
    <span class="trash-item-pnl">+123.45</span>
    <button class="ui-field-trigger">筛选条件</button>
    <div class="ui-date-grid"><button class="is-outside">31</button></div>
    <section class="trade-list">
      <div class="trade-list-group-header"><button class="trade-list-group-toggle"><strong>本周交易</strong></button></div>
      <div class="trade-row">交易行辅助信息</div>
    </section>
    <div class="dv-feed-item-deletable"><button class="dv-feed-delete">删除</button></div>
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
    '.dv-empty-card h1',
    '.settings-page-title',
    '.route-state-title',
  ]) assertPageTitle(selector)

  const pnl = document.querySelector<HTMLElement>('.trash-item-pnl')
  assert(pnl, '缺少回收站盈亏样例')
  const pnlStyle = getComputedStyle(pnl)
  assert(pnlStyle.fontSize === '13px' && pnlStyle.lineHeight === '20px', '回收站盈亏必须计算为 Row 13px/20px')
  assert(pnlStyle.fontVariantNumeric === 'tabular-nums', '回收站盈亏必须使用 tabular 数字')

  const rootStyle = getComputedStyle(document.documentElement)
  for (const [token, value] of [
    ['--text-primary', 'lch(92% 0.8 272 / 1)'],
    ['--text-secondary', 'lch(70% 1 272 / 1)'],
    ['--text-tertiary', 'lch(56% 1 272 / 1)'],
    ['--text-quaternary', 'lch(44% 1 272 / 1)'],
    ['--text-disabled', 'lch(34% 1 272 / 1)'],
  ]) assert(rootStyle.getPropertyValue(token).trim() === value, `${token} 必须保留精确 LCH 灰阶`)

  assertComputedTextRole('.ui-field-trigger', '--text-secondary')
  assertComputedTextRole('.ui-date-grid button.is-outside', '--text-tertiary')
  assertComputedTextRole('.trade-row', '--text-tertiary')
  assertComputedTextRole('.trade-list-group-header', '--text-primary')
  assertComputedTextRole('.dv-feed-delete', '--text-tertiary')
  const feedDelete = document.querySelector<HTMLButtonElement>('.dv-feed-delete')
  assert(feedDelete, '缺少活动记录删除操作样例')
  assert(getComputedStyle(feedDelete).opacity === '0', '活动记录删除操作应在未聚焦时保持隐藏')
  feedDelete.focus()
  await new Promise<void>((resolve) => window.setTimeout(resolve, 120))
  assert(getComputedStyle(feedDelete).opacity === '1', '活动记录删除操作必须可通过键盘焦点显现')
}

window.__typographyRolesTest = run()
