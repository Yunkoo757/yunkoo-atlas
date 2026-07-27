function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export async function testShortcutHostReadsTradesOnlyWhenNavigationRuns(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/shortcuts/ShortcutHost.ts', 'utf8')

  assert(!source.includes('useStore((s) => s.trades)'), '快捷键宿主不得订阅整份交易集合')
  assert(
    (source.match(/const trades = useStore\.getState\(\)\.trades/g) ?? []).length >= 3,
    '上一条、下一条和返回列表应在动作触发时读取最新交易集合',
  )
}

export async function testEditorUsesTrackedReviewStateDuringRender(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/editor/Editor.tsx', 'utf8')

  assert(
    !source.includes('hasReviewContextDocument(editor.getJSON())'),
    '编辑器 render 不得为复盘状态重复序列化文档',
  )
  assert(
    !source.includes('hasLeadingReviewParagraphs(editor.getJSON())'),
    '编辑器 render 不得为开头文本重复序列化文档',
  )
  assert(
    source.includes('const reviewContextActive = hasReviewContext') &&
      source.includes('const leadingReviewText = hasLeadingReviewText'),
    'render 应复用 onCreate/onUpdate 已维护的派生状态',
  )
}

export async function testTradeListReceivesStableRowCallbacks(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/views/ListView.tsx', 'utf8')

  for (const callback of ['openTrade', 'toggleSelection', 'toggleRowStar', 'openContextMenu']) {
    assert(
      source.includes(`const ${callback} = useCallback(`),
      `传给 TradeRow 的 ${callback} 必须在无关重渲染之间保持引用稳定`,
    )
  }
  assert(!source.includes('onToggleStar={(trade) =>'), 'TradeList 不得接收每次 render 新建的星标回调')
}

export async function testEmptyAssetPurgePreviewIsExplicitlyCancelled(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/views/settings/DataSettingsPanel.tsx', 'utf8')
  const zeroCandidateBranch = source.match(
    /if \(preview\.candidateIds\.length === 0\) \{[\s\S]*?\n\s*\}/,
  )?.[0] ?? ''

  assert(
    zeroCandidateBranch.includes('cancelAssetPurge') &&
      zeroCandidateBranch.includes('preview.operationId'),
    '零候选附件预览必须释放存储层保存的预览快照',
  )
}
