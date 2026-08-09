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
