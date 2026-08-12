function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function read(path: string): Promise<string> {
  const fs = await import('node:fs/promises')
  return fs.readFile(path, 'utf8')
}

export async function testWeeklyPatternTagsExposeDifferentSemanticTones(): Promise<void> {
  const source = await read('src/views/WeeklyReviewView.tsx')
  const css = await read('src/views/WeeklyReviewView.css')
  assert(source.includes('tone="strength"') && source.includes('tone="correction"'), '正向做法与待纠正模式必须传入不同语义色调')
  assert(source.includes('wr-tag-group is-${tone}'), '标签组必须把语义色调暴露给样式层')
  assert(css.includes('.wr-tag-group.is-strength') && css.includes('.wr-tag-group.is-correction'), '两类标签必须有可辨认的视觉语义')
}

export async function testWeeklyTrendFallbackIsAnInformativeSkeleton(): Promise<void> {
  const source = await read('src/views/WeeklyReviewView.tsx')
  const css = await read('src/views/WeeklyReviewView.css')
  assert(source.includes('role="status"') && source.includes('wr-chart-skeleton-line'), '图表加载态必须包含可读状态与图形骨架')
  assert(css.includes('.wr-chart-skeleton-line') && css.includes('.wr-chart-skeleton-grid'), '图表骨架必须呈现坐标网格与趋势形状')
}

export async function testWeeklyHeaderSharesTheContentLeftRail(): Promise<void> {
  const css = await read('src/views/WeeklyReviewView.css')
  assert(/\.wr-page-head-inner\s*\{[^}]*width:\s*min\(876px, calc\(100% - 92px\)\)/s.test(css), '周复盘页头应与带内边距的内容卡片共用左轨')
}

export async function testDashboardExplainsWeekEmptyAgainstHistoricalScope(): Promise<void> {
  const source = await read('src/views/Dashboard.tsx')
  assert(source.includes('本周暂无已平仓交易 · 当前范围仍保留上方历史统计'), '本周为空但筛选范围有历史数据时必须解释两个统计口径')
}

export async function testFieldOverridesUseTheSharedFieldHeight(): Promise<void> {
  const sources = await Promise.all([
    read('src/components/StrategyFormModal.css'),
    read('src/components/TagEditor.css'),
    read('src/components/trades/TradeFilters.css'),
  ])
  assert(sources[0].includes('.sfm-input') && sources[0].includes('height: var(--field-height-md)'), '策略表单字段必须复用共享高度')
  assert(sources[1].includes('.tag-input') && sources[1].includes('height: var(--field-height-md)'), '标签输入字段必须复用共享高度')
  assert(sources[2].includes('.trade-filter-field .ui-select-trigger') && sources[2].includes('height: var(--field-height-md)'), '筛选选择器必须复用共享高度')
}

export async function testStylesDoNotIntroduceNumericZIndexLadders(): Promise<void> {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const files: string[] = []
  async function collect(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) await collect(target)
      else if (entry.name.endsWith('.css')) files.push(target)
    }
  }
  await collect('src')
  for (const file of files) {
    const css = await fs.readFile(file, 'utf8')
    assert(!/z-index:\s*-?\d+/.test(css), `${file} 仍使用裸数字 z-index`)
  }
}
