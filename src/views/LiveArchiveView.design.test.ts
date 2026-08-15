function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function testLiveArchivePublishesReadableRangeAndPendingState(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/views/LiveArchiveView.tsx', 'utf8')

  assert(source.includes('aria-live="polite"'), '历史记录范围和待整理数量必须向辅助技术发布可读状态')
  assert(source.includes('aria-label={`查看待整理记录，共 ${pendingCount} 条`}'), '待整理数量必须有不依赖颜色的可读名称')
  assert(source.includes("resolveLiveArchiveScope(cycles, 'all-archives')"), '历史首页必须使用统一 all-archives 范围')
  assert(source.includes('TradeList'), '历史记录必须复用标准 TradeList')
  assert(source.includes('TradeRow'), '历史记录必须复用标准 TradeRow')
  assert(source.includes('FilterBar'), '历史记录必须复用标准 FilterBar')
  assert(source.includes('list-scroll'), '历史记录必须复用交易日志滚动面')
}

export async function testLiveArchiveNarrowLayoutCannotForceHorizontalOverflow(): Promise<void> {
  const fs = await import('node:fs/promises')
  const css = await fs.readFile('src/views/LiveArchiveView.css', 'utf8')

  assert(css.includes('background: var(--bg-surface)'), '历史记录必须使用 surface 背景 token')
  assert(css.includes('var(--field-bg)'), '筛选输入必须使用 field token')
  assert(css.includes('overflow-wrap: anywhere'), '长交易编号和链接必须可断行，避免横向溢出')
}

export async function testHistoricalLiveUsesCanonicalRouteAndProductName(): Promise<void> {
  const fs = await import('node:fs/promises')
  const [app, sidebar, archive, dashboard, detail, importHealth] = await Promise.all([
    fs.readFile('src/App.tsx', 'utf8'),
    fs.readFile('src/components/Sidebar.tsx', 'utf8'),
    fs.readFile('src/views/LiveArchiveView.tsx', 'utf8'),
    fs.readFile('src/views/Dashboard.tsx', 'utf8'),
    fs.readFile('src/views/DetailView.tsx', 'utf8'),
    fs.readFile('src/views/ImportDataHealthView.tsx', 'utf8'),
  ])

  assert(app.includes('path="/live-history"'), '应用必须注册历史实盘规范路由')
  assert(app.includes('LegacyLiveArchiveRedirect'), '旧历史路由必须有显式兼容跳转')
  assert(sidebar.includes('to="/live-history"'), '侧栏必须使用历史实盘规范路由')
  assert(sidebar.includes('aria-label="历史实盘"'), '侧栏导航语义必须统一为历史实盘')
  assert(archive.includes('title="历史实盘"'), '历史实盘页面必须使用新模块名')
  assert(archive.includes('重置起点前的实盘与关联案例会保留在这里'), '页面副标题必须说明双视图范围')
  assert(dashboard.includes('to="/live-history"'), '仪表盘必须进入历史实盘规范路由')
  assert(detail.includes("from?.pathname === '/live-history'"), '详情必须识别历史实盘返回来源')
  assert(importHealth.includes('to="/live-history"'), '导入日期核对必须返回历史实盘')
}
