function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export async function testDashboardPresentsSelectedScopeBeforeWeekContext(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/views/Dashboard.tsx', 'utf8')
  const cards = source.indexOf('className="db-cards"')
  const health = source.indexOf('data-result-health-alert')
  const chart = source.indexOf('className="db-chart"', cards)
  const week = source.indexOf('className="db-week"')
  const strategies = source.indexOf('className="db-strats"')

  assert(cards > 0, '仪表盘必须渲染当前范围 KPI')
  assert(cards < health, '当前范围 KPI 必须先于数据完整度')
  assert(health < chart, '数据完整度必须先于主图表')
  assert(chart < week, '主图表必须先于本周上下文')
  assert(week < strategies, '本周上下文必须先于策略表现')
  assert(source.includes('hasResultHealthIssue ? ('), '数据完整度正常时不得占用页面空间')
  assert(source.includes('!weekCardEmpty ? ('), '本周无数据时不得渲染冗余空区块')
  assert(!source.includes('label="盈利笔数"'), '胜率已表达盈负结果，不得重复展示盈利笔数 KPI')
  assert(!source.includes('查看累计盈亏数据'), '主曲线不得再附加重复的内联数据表')
  assert(!source.includes('db-panel-hint'), '主曲线不得显示可由交互自然发现的冗余提示')
}

export async function testDashboardUsesOneConstrainedAnalysisRailWithoutTintedWeekCard(): Promise<void> {
  const fs = await import('node:fs/promises')
  const css = await fs.readFile('src/views/Dashboard.css', 'utf8')
  assert(/\.db-analysis-rail\s*\{[^}]*max-width:\s*var\(--page-rail-wide\);/s.test(css), '分析内容必须使用宽数据语义轨道')
  assert(/\.db-chart\s*\{[^}]*max-width:\s*1200px;/s.test(css), '主图表必须限制在 1200px 内')
  assert(!/\.db-week\s*\{[^}]*background:\s*color-mix\([^}]*accent/s.test(css), '本周上下文不得使用强调色卡片')
  assert(!/\.db-card\s*\{[^}]*box-shadow:/s.test(css), 'KPI 不得恢复四卡阴影')
}
