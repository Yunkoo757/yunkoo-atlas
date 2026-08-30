import '@/styles/tokens.css'
import '@/styles/global.css'
import '@/App.css'
import '@/components/RouteState.css'
import '@/components/WelcomeScreen.css'
import './DetailView.css'
import './ReviewSessionView.css'
import './settings/SettingsLayout.css'
import './settings/ProfileSettingsPanel.css'
import './settings/DisplaySettingsPanel.css'
import './TrashView.css'
import './WeeklyReviewView.css'
import './BoardView.css'
import '@/components/ui/FieldTrigger.css'
import '@/components/ui/DatePicker.css'
import '@/components/ui/Button.css'
import '@/components/ui/Chip.css'
import '@/components/ui/IconButton.css'
import '@/components/ui/Select.css'
import '@/components/trades/TradeList.css'
import '@/components/TagEditor.css'
import '@/components/NotionImportModal.css'
import '@/components/Sidebar.css'
import '@/components/sidebar/SidebarWorkspace.css'
import '@/editor/Editor.css'
import './ShortcutsView.css'
import './settings/TagPresetsPanel.css'
import './settings/ReviewTemplatesPanel.css'
import './settings/SymbolsPanel.css'
import '@/components/DataIOContent.css'

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

async function assertFocusReveal(hiddenSelector: string, focusSelector: string, label: string): Promise<void> {
  const hidden = document.querySelector<HTMLElement>(hiddenSelector)
  const focusTarget = document.querySelector<HTMLButtonElement>(focusSelector)
  assert(hidden && focusTarget, `缺少${label}样例`)
  assert(getComputedStyle(hidden).opacity === '0', `${label} 应在未聚焦时隐藏`)
  focusTarget.focus()
  await new Promise<void>((resolve) => window.setTimeout(resolve, 120))
  assert(getComputedStyle(hidden).opacity === '1', `${label} 必须通过键盘焦点显现`)
}

async function run(): Promise<void> {
  document.body.innerHTML = `
    <h1 class="dv-title">交易详情</h1>
    <section class="review-session-intro"><h1>随机打开一组过去的交易</h1></section>
    <section class="review-session-item-header"><h1>BTCUSDT</h1></section>
    <section class="wr-page-head"><h1>2026 年第 32 周</h1></section>
    <h1 class="welcome-title">欢迎使用 Trader Atlas</h1>
    <section class="app-storage-error-card"><h1>本地资料库未打开</h1></section>
    <section class="app-route-state"><h1>页面异常</h1></section>
    <section class="dv-empty-card"><h1>未找到该交易</h1></section>
    <h1 class="settings-page-title">显示偏好</h1>
    <p class="settings-page-desc">设置页说明</p>
    <h2 class="settings-section-title">设置区块</h2>
    <p class="settings-section-desc">设置区块说明</p>
    <strong class="profile-preview-name">桌面视觉样本</strong>
    <div class="display-section-head"><p>显示设置说明</p></div>
    <p class="tag-section-desc">标签设置说明</p>
    <p class="dio-group-desc">资料库设置说明</p>
    <main class="route-state"><h1 class="route-state-title">范围不存在</h1></main>
    <span class="trash-item-pnl">+123.45</span>
    <button class="ui-field-trigger">筛选条件</button>
    <div class="ui-date-grid"><button class="is-outside">31</button></div>
    <section class="trade-list">
      <div class="trade-list-group-header"><button class="trade-list-group-toggle"><strong>本周交易</strong><span class="trade-list-group-count">15</span></button></div>
      <div class="trade-row" data-typography-row>
        <span class="trade-row-ref">CAS-32</span>
        <span class="trade-row-symbol"><strong>EURUSD</strong><span class="side-tag is-quiet" data-side="long">多</span></span>
        <span class="trade-row-strategy"><span class="strategy-label">导航1</span></span>
        <span class="trade-row-tags"><span class="trade-row-tag">伦敦收盘</span></span>
        <span class="trade-row-timeframe">4H</span>
        <span class="trade-row-date">8月27日</span>
      </div>
    </section>
    <section class="board-scroll">
      <div class="bd-column"><span class="bd-col-count">4</span></div>
      <article class="bd-card"><span class="bd-card-ref">CAS-32</span></article>
    </section>
    <aside class="sidebar" data-typography-sidebar>
      <div class="sb-item" data-nav-state="rest"><span class="sb-item-label">案例库</span></div>
      <div class="sb-item is-active" data-nav-state="active"><span class="sb-item-label">交易日志</span></div>
      <div class="sb-item"><button class="sb-workspace-capability-menu">菜单</button></div>
    </aside>
    <span class="ui-chip ui-chip-md">伦敦开盘</span>
    <div class="dv-feed-item-deletable"><button class="dv-feed-delete">删除</button></div>
    <button class="tag-chip-remove">删除标签</button>
    <div class="nim-import-target-options"><button><strong>交易日志</strong><span>计入实盘统计</span></button></div>
    <div class="editor-review-tools"><button>插入起稿</button></div>
    <button class="settings-tag-chip-remove">删除预设标签</button>
    <button class="review-template-delete">删除起稿</button>
    <button class="review-template-select"><svg aria-hidden="true"></svg><span>选择起稿模板</span></button>
    <button class="review-template-drag-handle">拖拽起稿模板</button>
    <button class="symbols-drag-handle">拖拽品种</button>
    <input disabled value="禁用输入" />
    <button class="ui-select-option" disabled>禁用选项</button>
    <button class="empty-btn" disabled>禁用按钮</button>
    <button class="review-template-drag-handle" disabled>禁用起稿拖拽</button>
    <button class="symbols-drag-handle" disabled>禁用品种拖拽</button>
    <button class="dv-comment-send" disabled>禁用发送</button>
    <button class="welcome-path-btn" disabled>禁用欢迎路径</button>
    <button class="welcome-btn" disabled>禁用欢迎操作</button>
    <button class="shortcuts-reset-all" disabled>禁用快捷键重置</button>
    <div class="dv-review-stage-actions"><button disabled>禁用复盘阶段操作</button></div>
    <button class="ui-icon-btn ui-icon-btn-md" disabled>禁用周复盘导航</button>
    <div class="shortcuts-row"><div class="shortcuts-actions"><button class="shortcuts-action">快捷键操作</button></div></div>
    <div class="trash-item"><div class="trash-item-actions"><button class="trash-btn-purge">删除</button></div></div>
  `
  for (const selector of [
    '.dv-title',
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

  const profileName = getComputedStyle(document.querySelector<HTMLElement>('.profile-preview-name')!)
  assert(profileName.fontSize === '15px', '个人资料预览名称计算后字号必须为 15px')
  assert(profileName.lineHeight === '23px', '个人资料预览名称计算后行高必须为 23px')

  for (const selector of [
    '.settings-page-desc',
    '.settings-section-desc',
    '.display-section-head p',
    '.tag-section-desc',
    '.dio-group-desc',
  ]) {
    const style = getComputedStyle(document.querySelector<HTMLElement>(selector)!)
    assert(style.fontSize === '12px', `${selector} 计算后字号必须为 12px`)
    assert(style.lineHeight === '18px', `${selector} 计算后行高必须为 18px`)
  }

  const settingsSectionTitle = getComputedStyle(document.querySelector<HTMLElement>('.settings-section-title')!)
  assert(settingsSectionTitle.fontSize === '13px', '设置区块标题计算后字号必须为 13px')

  const pnl = document.querySelector<HTMLElement>('.trash-item-pnl')
  assert(pnl, '缺少回收站盈亏样例')
  const pnlStyle = getComputedStyle(pnl)
  assert(pnlStyle.fontSize === '13px' && pnlStyle.lineHeight === '20px', '回收站盈亏必须计算为 Row 13px/20px')
  assert(pnlStyle.fontVariantNumeric === 'lining-nums tabular-nums', '回收站盈亏必须使用 lining + tabular 数字')

  const rootStyle = getComputedStyle(document.documentElement)
  for (const [token, value] of [
    ['--text-primary', 'lch(98% 0.4 272 / 1)'],
    ['--text-secondary', 'lch(70% 1 272 / 1)'],
    ['--text-tertiary', 'lch(56% 1.2 272 / 1)'],
    ['--text-quaternary', 'lch(38% 1.2 272 / 1)'],
    ['--text-disabled', 'lch(34% 1 272 / 1)'],
  ]) assert(rootStyle.getPropertyValue(token).trim() === value, `${token} 必须保留统一的语义文字映射`)

  const bodyStyle = getComputedStyle(document.body)
  assert(bodyStyle.fontFamily.includes('SF Pro Display'), '桌面字体栈必须包含 macOS 系统入口 SF Pro Display')
  assert(bodyStyle.fontFamily.includes('Segoe UI'), '桌面字体栈必须包含 Windows 系统入口 Segoe UI')
  assert(!bodyStyle.fontFamily.includes('Noto Sans SC Variable'), '桌面字体栈不得强制内置 Noto Sans SC')

  const navRest = getComputedStyle(document.querySelector<HTMLElement>('[data-nav-state="rest"]')!)
  assert(navRest.fontSize === '14px' && navRest.lineHeight === '20px', '普通导航必须计算为 14px/20px')
  assert(navRest.fontWeight === '450', '普通导航必须使用真实 450 字重')
  assertComputedTextRole('[data-nav-state="rest"]', '--text-nav-rest')
  const navActive = getComputedStyle(document.querySelector<HTMLElement>('[data-nav-state="active"]')!)
  assert(navActive.fontWeight === '500', '选中导航必须使用清晰克制的 500 字重')
  assertComputedTextRole('[data-nav-state="active"]', '--text-nav-active')

  const tradeSymbol = getComputedStyle(document.querySelector<HTMLElement>('[data-typography-row] .trade-row-symbol strong')!)
  assert(tradeSymbol.fontSize === '13px' && tradeSymbol.lineHeight === '20px', '交易品种必须计算为 13px/20px')
  assert(tradeSymbol.fontWeight === '500', '交易品种必须使用锐利的 500 字重')
  assertComputedTextRole('[data-typography-row] .trade-row-symbol strong', '--text-list-strong')
  const tradeRef = getComputedStyle(document.querySelector<HTMLElement>('[data-typography-row] .trade-row-ref')!)
  assert(tradeRef.fontSize === '13px' && tradeRef.lineHeight === '20px', '交易编号必须计算为 13px/20px')
  assert(tradeRef.fontWeight === '450', '交易编号必须使用 450 字重')
  assertComputedTextRole('[data-typography-row] .trade-row-ref', '--text-list-secondary')
  const chip = getComputedStyle(document.querySelector<HTMLElement>('.ui-chip')!)
  assert(
    chip.fontSize === '12px' && chip.lineHeight === '18px',
    `Chip 必须计算为 12px/18px，实际为 ${chip.fontSize}/${chip.lineHeight}`,
  )
  assert(chip.fontWeight === '450', 'Chip 必须使用低噪声的 450 字重')
  assertComputedTextRole('.ui-chip', '--text-chip')

  assertComputedTextRole('.ui-field-trigger', '--text-secondary')
  assertComputedTextRole('.ui-date-grid button.is-outside', '--text-tertiary')
  assertComputedTextRole('.trade-row', '--text-list-secondary')
  assertComputedTextRole('.trade-list-group-header', '--text-primary')
  for (const selector of [
    '.trade-list-group-count',
    '.trade-row-timeframe',
    '.bd-col-count',
    '.bd-card-ref',
  ]) assertComputedTextRole(selector, '--text-content-metadata')
  assertComputedTextRole('.dv-feed-delete', '--text-tertiary')
  for (const selector of [
    '.tag-chip-remove',
    '.nim-import-target-options button',
    '.nim-import-target-options span',
    '.editor-review-tools button',
    '.settings-tag-chip-remove',
    '.review-template-delete',
    '.review-template-select svg',
    '.review-template-drag-handle',
    '.symbols-drag-handle',
  ]) assertComputedTextRole(selector, '--text-tertiary')
  for (const selector of [
    'input:disabled',
    '.ui-select-option:disabled',
    '.empty-btn:disabled',
    '.review-template-drag-handle:disabled',
    '.symbols-drag-handle:disabled',
    '.dv-comment-send:disabled',
    '.welcome-path-btn:disabled',
    '.welcome-btn:disabled',
    '.shortcuts-reset-all:disabled',
    '.dv-review-stage-actions > button:disabled',
    '.ui-icon-btn:disabled',
  ]) assertComputedTextRole(selector, '--text-disabled')
  assert(getComputedStyle(document.querySelector<HTMLElement>('.tag-chip-remove')!).opacity === '1', '标签移除操作不得常驻弱化')
  await assertFocusReveal('.dv-feed-delete', '.dv-feed-delete', '活动记录删除操作')
  await assertFocusReveal('.sb-workspace-capability-menu', '.sb-workspace-capability-menu', '侧栏能力菜单操作')
  await assertFocusReveal('.shortcuts-actions', '.shortcuts-action', '快捷键行操作')
  await assertFocusReveal('.trash-item-actions', '.trash-btn-purge', '回收站行操作')
}

window.__typographyRolesTest = run()
