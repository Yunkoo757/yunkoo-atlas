function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export async function testTradeListGroupTogglePreservesInteractionContract(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/components/trades/TradeList.tsx', 'utf8')
  const css = await fs.readFile('src/components/trades/TradeList.css', 'utf8')
  const tokens = await fs.readFile('src/styles/tokens.css', 'utf8')
  const statusIcon = await fs.readFile('src/components/StatusIcon.tsx', 'utf8')

  assert(source.includes('aria-expanded={item.openProgress > 0.5}'), '分组头必须暴露 aria-expanded')
  assert(source.includes('animateGroupTo'), '分组开合必须走动画进度，而非瞬间删行')
  assert(source.includes('EASE_OUT_QUART'), '折叠缓动必须使用统一 ease-out-quart')
  assert(source.includes('COLLAPSE_MS'), '折叠时长必须使用统一布局动效')
  assert(source.includes('rowHeight * item.openProgress'), '当前密度行高必须随 openProgress 平滑收展')
  assert(source.includes('default: 52'), '交易日志必须使用统一的 52px 列表行高')
  assert(source.includes('comfortable: 52'), '案例列表必须使用统一的 52px 列表行高')
  assert(source.includes("'--trade-row-height': `${rowHeight}px`"), '虚拟估算与 CSS 行高必须共享同一密度值')
  assert(source.includes('DisclosureChevron'), '分组折叠必须使用语义化 DisclosureChevron')
  assert(source.includes('StatusIndicator'), '复盘分组头应使用语义化状态图标')
  assert(source.includes('rotate(${90 * item.openProgress}deg)'), '展开时箭头应从朝右旋至朝下')
  assert(css.includes('will-change: transform'), '三角旋转应开启合成层以保证流畅')
  assert(css.includes('--trade-group-chevron'), '分组三角应按状态/远近 tint，而非整条换底色')
  assert(
    css.includes('.trade-list-group-toggle:hover .trade-list-group-chevron') &&
      css.includes('color: var(--accent-text)'),
    '分组三角悬停应保持清晰的纯白高亮',
  )
  assert(tokens.includes('--group-chevron-started:'), '当前状态三角色必须使用专用色值')
  assert(tokens.includes('--status-completed: var(--status-win);'), '盈利完成态应使用降噪后的状态绿')
  assert(tokens.includes('--neg:'), '必须保留盈亏红色令牌')
  assert(statusIcon.includes("win: 'var(--status-win)'"), '盈利状态图标必须弱于最终结果绿')
  assert(statusIcon.includes("loss: 'var(--status-loss)'"), '亏损状态图标必须弱于最终结果红')

  for (const forbidden of [
    '.trade-row.is-selected::after',
    '.trade-row.is-focused::after',
    '.trade-row:has(.trade-row-open:focus-visible)',
  ]) {
    if (css.includes(forbidden)) throw new Error(`不得恢复整行高亮：${forbidden}`)
  }
  assert(
    css.includes("html[data-keyboard-navigation='true'] .trade-row:focus-within::after") &&
      css.includes('box-shadow: inset 0 0 0 1px'),
    '只有真实键盘导航才可使用完整的行内焦点框，程序返回定位不得留下短线',
  )
}

export async function testTradeListColumnsShareRowGridAndStickyOrder(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/components/trades/TradeList.tsx', 'utf8')
  const columns = await fs.readFile('src/components/trades/TradeListColumns.tsx', 'utf8')
  const css = await fs.readFile('src/components/trades/TradeList.css', 'utf8')

  assert(source.includes('<TradeListColumns'), '交易日志必须提供稳定列标题')
  assert(columns.includes('aria-hidden="true"'), '视觉列标题必须退出无障碍树')
  assert(!columns.includes('role="row"'), 'list 模型不得混入孤立 row 语义')
  assert(!columns.includes('role="columnheader"'), 'list 模型不得混入孤立 columnheader 语义')
  assert(css.includes('grid-template-columns: var(--trade-list-columns)'), '标题和交易行必须共享同一列模板')
  assert(
    /:where\(\.trade-list-columns, \.trade-row\)\s*\{[\s\S]*?--trade-select-column:\s*24px;[\s\S]*?--trade-ref-column:\s*72px;/.test(css),
    '共享列模板必须在标题和行自身作用域内声明列宽，不能依赖仅存在于列表容器的继承变量',
  )
  assert(source.includes('const HEADER_CONTENT_HEIGHT = 36'), '月份条内容高度必须保持 36px')
  assert(source.includes('const HEADER_VERTICAL_GAP = 8'), '月份虚拟项必须在上下方向共保留 8px 间距')
  assert(
    source.includes('const HEADER_HEIGHT = HEADER_CONTENT_HEIGHT + HEADER_VERTICAL_GAP'),
    '月份虚拟项估算高度必须为 44px（36px 内容 + 8px 间距）',
  )
  assert(css.includes('padding-block: var(--sp-1)'), '月份条上下必须各使用 4px 间距令牌')
  assert(
    source.includes("(item.kind === 'header' ? ' is-header' : ' is-row')"),
    '虚拟项必须输出稳定的 is-header 类型 class',
  )
  assert(source.includes("top: isSticky ? 'var(--trade-list-columns-height)'"), '月份标题必须吸附在列标题下方')
}

export async function testTradeAndCaseListsShareComfortableRowHeight(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/views/ListView.tsx', 'utf8')
  assert(
    source.includes("density={filter.tradeKind === 'case' ? 'comfortable' : 'default'}"),
    '交易和案例可以保留密度语义，但必须共享同一行高基线',
  )
  const list = await fs.readFile('src/components/trades/TradeList.tsx', 'utf8')
  assert(list.includes('default: 52') && list.includes('comfortable: 52'), '交易与案例行高必须一致')
}

export async function testTradeSelectionAppearsOnlyOnIntent(): Promise<void> {
  const fs = await import('node:fs/promises')
  const css = await fs.readFile('src/components/trades/TradeList.css', 'utf8')

  assert(css.includes('.trade-row:focus-within .trade-row-check'), '键盘焦点进入行时必须显示选择框')
  assert(css.includes('.trade-list.is-selection-mode .trade-row-check'), '选择模式必须持续显示选择框')
  assert(css.includes('.trade-row-star.is-starred'), '星标状态必须保持可见但不抢夺主信息')
}

export async function testTradeListVisualAlignmentContract(): Promise<void> {
  const fs = await import('node:fs/promises')
  const css = await fs.readFile('src/components/trades/TradeList.css', 'utf8')
  const columns = await fs.readFile('src/components/trades/TradeListColumns.tsx', 'utf8')
  const trash = await fs.readFile('src/views/TrashView.css', 'utf8')
  const sidebar = await fs.readFile('src/components/Sidebar.css', 'utf8')

  assert(
    css.includes('.trade-list-column:is(.is-timeframe, .is-result, .is-date) { text-align: right; }'),
    '周期、结果与日期标题必须和正文统一右对齐',
  )
  assert(columns.includes('className="trade-list-column is-result">结果</span>'), '交易列表必须以 R 为唯一常驻结果列')
  assert(!columns.includes('is-pnl') && !columns.includes('>盈亏</span>'), '现金盈亏不得继续占用交易列表常驻列')
  assert(!css.includes('.trade-row-date,\n  .trade-list-column.is-date {\n    display: none;'), '桌面窄窗口也必须保留完整日期')
  assert(css.includes('grid-template-columns: 11ch 18px'), '品种与多空方向必须使用稳定列宽')
  assert(
    /\.trade-row-strategy\s*\{[\s\S]*?min-height:\s*20px;[\s\S]*?border-radius:\s*var\(--radius-full\);/.test(css),
    '策略与标签必须共享胶囊语义',
  )
  assert(trash.includes('height: var(--trade-row-height, 52px)'), '回收站必须共享 52px 列表行高')
  assert(trash.includes('grid-template-columns: 9ch 18px minmax(0, 1fr)'), '回收站品种与方向也必须固定对齐')
  assert(!trash.includes('.trash-item.is-selected'), '回收站选中态不得额外铺整行底色或左侧强调线')
  assert(
    /\.sb-risk-summary\s*\{[\s\S]*?grid-template-columns:\s*16px minmax\(0, 1fr\);[\s\S]*?gap:\s*9px;[\s\S]*?padding:\s*0 10px;/.test(sidebar),
    '风险入口与设置入口必须共享侧栏基线',
  )
}

export async function testSymbolIconsUseQuietCircularSurface(): Promise<void> {
  const fs = await import('node:fs/promises')
  const css = await fs.readFile('src/components/SymbolIcon.css', 'utf8')
  const panelCss = await fs.readFile('src/views/settings/SymbolsPanel.css', 'utf8')
  const presets = await fs.readFile('src/lib/symbolIcons.ts', 'utf8')
  const component = await fs.readFile('src/components/SymbolIcon.tsx', 'utf8')

  assert(css.includes('border-radius: var(--radius-full)'), '品种图标必须使用统一圆形容器')
  assert(css.includes('currentColor 8%'), '圆章只允许极弱内描边，不得恢复厚重边框')
  assert(panelCss.includes('.symbols-preset-swatch') && panelCss.includes('border-radius: var(--radius-full)'), '设置页预设缩略图必须与正式品种图标同为圆形')
  assert(presets.includes('SYMBOL_ICON_SURFACE_TINT = 12'), '品种圆章色底必须固定为低噪声 12%')
  assert(component.includes("resolved.glyph.length > 1 ? 0.46 : 0.56"), '单双字符必须使用稳定光学比例')
  assert(component.includes('var(--symbol-list-glyph-strength)'), '高密度列表必须降低品种字形色强度')
  assert(component.includes('var(--symbol-list-surface-strength)'), '高密度列表必须进一步降低品种圆章底色')
}
