function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export async function testMutedTextAndGroupChevronsRemainReadable(): Promise<void> {
  const fs = await import('node:fs/promises')
  const tokens = await fs.readFile('src/styles/tokens.css', 'utf8')

  assert(/--color-text-quaternary:\s*lch\((5[0-9]|6[0-9])(?:\.\d+)?%/.test(tokens), '可见弱文字必须使用可读亮度')
  assert(tokens.includes('--color-text-disabled: lch(36.308%'), '禁用态应保留独立的低强调颜色')
  assert(tokens.includes('--text-disabled: var(--color-text-disabled)'), '禁用态不得借用可见弱文字颜色')
  for (const role of ['started', 'todo', 'backlog', 'done']) {
    assert(
      new RegExp(`--group-chevron-${role}:\\s*lch\\((4[5-9]|[5-9][0-9])`).test(tokens),
      `分组折叠图标 ${role} 必须达到非文字可见对比度`,
    )
  }
}

export async function testEditorPlaceholderDoesNotUndoTheReadableTextToken(): Promise<void> {
  const fs = await import('node:fs/promises')
  const css = await fs.readFile('src/views/DetailView.css', 'utf8')
  const placeholder = css.match(/\.dv-document \.editor \.ProseMirror p\.is-editor-empty:first-child::before\s*\{[^}]*\}/)?.[0] ?? ''
  assert(!placeholder.includes('opacity: 0.38'), '编辑器占位提示不得把可读颜色再次压暗到不可见')
  assert(placeholder.includes('opacity: 0.72'), '编辑器占位提示应保持清晰但低于正文')
}

export async function testWeeklyReviewScoreActionsUseInteractiveContrast(): Promise<void> {
  const fs = await import('node:fs/promises')
  const css = await fs.readFile('src/views/WeeklyReviewView.css', 'utf8')
  const scoreRule = css.match(/\.wr-score-row button\s*\{[^}]*\}/)?.[0] ?? ''
  assert(scoreRule.includes('color: var(--text-secondary)'), '周复盘评分数字必须比辅助说明更醒目')
}

export async function testCustomOverlaysCaptureAndRestoreFocus(): Promise<void> {
  const fs = await import('node:fs/promises')
  const sources = await Promise.all([
    fs.readFile('src/components/TradeComposer.tsx', 'utf8'),
    fs.readFile('src/components/StrategyFormModal.tsx', 'utf8'),
    fs.readFile('src/components/ImageLightbox.tsx', 'utf8'),
  ])

  for (const [index, source] of sources.entries()) {
    assert(source.includes('previousFocusRef'), `自建浮层 ${index + 1} 必须记录打开前焦点`)
    assert(source.includes('document.activeElement'), `自建浮层 ${index + 1} 必须从真实活动元素捕获焦点`)
    assert(source.includes('previousFocusRef.current?.focus()'), `自建浮层 ${index + 1} 关闭后必须归还焦点`)
  }
  assert(
    sources[0].includes('dialogRef.current?.querySelector<HTMLElement>') &&
      sources[0].includes('initialFocus?.focus()'),
    '新建交易打开后必须把焦点送入弹窗，才能启用现有焦点陷阱',
  )
  assert(sources[2].includes("if (event.key !== 'Tab') return"), '图片预览必须把 Tab 限制在模态浮层内')
}

export async function testLiveArchiveRangeAndPendingCountAreAnnounced(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/views/LiveArchiveView.tsx', 'utf8')
  assert(source.includes('role="status" aria-live="polite"'), '历史归档范围变化必须通过 polite live region 反馈')
  assert(source.includes('aria-label={`查看待整理记录，共 ${pendingCount} 条`}'), '待整理数量必须有完整文字标签，不能只依赖颜色')
  assert(source.includes('data-archive-detail-link'), '归档详情入口必须保留原生可聚焦链接')
}
