function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function testLiveArchivePublishesReadableRangeAndPendingState(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/views/LiveArchiveView.tsx', 'utf8')

  assert(source.includes('aria-live="polite"'), '历史归档范围和待整理数量必须向辅助技术发布可读状态')
  assert(source.includes('aria-label={`查看待整理记录，共 ${pendingCount} 条`}'), '待整理数量必须有不依赖颜色的可读名称')
  assert(source.includes('const archiveEntries = useMemo('), '归档首页的摘要与日志成员必须在同一 memoized 投影中构造')
}

export async function testLiveArchiveNarrowLayoutCannotForceHorizontalOverflow(): Promise<void> {
  const fs = await import('node:fs/promises')
  const css = await fs.readFile('src/views/LiveArchiveView.css', 'utf8')

  assert(css.includes('minmax(min(280px, 100%), 1fr)'), '归档卡片网格必须在窄屏把最小宽度限制为容器宽度')
  assert(css.includes('.la-card, .la-detail-summary { min-width: 0;'), '归档卡片和详情摘要必须允许在窄屏收缩')
  assert(css.includes('overflow-wrap: anywhere'), '长交易编号和链接必须可断行，避免 375px 横向溢出')
}
