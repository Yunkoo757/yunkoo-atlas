function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export async function testSharedButtonsUseTheCanonicalControlSurfaceTokens(): Promise<void> {
  const fs = await import('node:fs/promises')
  const button = await fs.readFile('src/components/ui/Button.css', 'utf8')
  const iconButton = await fs.readFile('src/components/ui/IconButton.css', 'utf8')
  const segmented = await fs.readFile('src/components/ui/SegmentedControl.css', 'utf8')

  for (const [name, css] of [
    ['Button', button],
    ['IconButton', iconButton],
    ['SegmentedControl', segmented],
  ] as const) {
    assert(css.includes('var(--surface-control)'), `${name} 默认表面必须使用 --surface-control`)
    assert(css.includes('var(--surface-control-hover)'), `${name} 悬停表面必须使用 --surface-control-hover`)
  }

  assert(button.includes('var(--surface-control-border)'), 'bordered 按钮必须使用共享控件边框 token')
  assert(button.includes('var(--surface-control-shadow-active)'), 'bordered 按钮必须使用共享激活层级 token')
  assert(segmented.includes('var(--surface-control-active)'), '分段控件选中态必须使用共享激活表面')
  assert(segmented.includes('var(--surface-control-shadow-active)'), '分段控件选中态必须有可辨识的边界')
}

export async function testWorkspaceScopeDoesNotCreateAParallelButtonPalette(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/components/TradeWorkspaceContext.tsx', 'utf8')
  const css = await fs.readFile('src/components/TradeWorkspaceContext.css', 'utf8')

  assert(source.includes('<SegmentedControl'), '记录类型必须复用共享 SegmentedControl')
  assert(!css.includes('.trade-workspace-scope-kinds button'), '记录类型不得覆盖共享按钮视觉状态')
  assert(
    css.includes('border: 1px solid var(--surface-control-border);') &&
      css.includes('box-shadow: var(--surface-control-shadow);'),
    '范围触发按钮必须使用共享控件表面与边框 token',
  )
}

export async function testButtonVisualRulesDoNotUseRawColorsOrTransitionAll(): Promise<void> {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')

  async function filesUnder(directory: string): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    const nested = await Promise.all(entries.map((entry) => {
      const target = path.join(directory, entry.name)
      return entry.isDirectory() ? filesUnder(target) : [target]
    }))
    return nested.flat()
  }

  const cssFiles = (await filesUnder('src')).filter((file) => file.endsWith('.css'))
  const forbiddenColor = /(?:#[\da-f]{3,8}\b|\b(?:rgb|hsl|lch|oklch)a?\(|\b(?:white|black|red|green|blue)\b)/i
  const violations: string[] = []

  for (const file of cssFiles) {
    const css = await fs.readFile(file, 'utf8')
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1] ?? ''
      const declarations = match[2] ?? ''
      if (!/(?:\bbutton\b|\.ui-btn\b|\.ui-icon-btn\b|\.ui-segmented-option\b)/.test(selector)) continue
      const visualValues = [...declarations.matchAll(
        /(?:^|;)\s*(?:color|background(?:-color)?|border-color|box-shadow|fill|stroke)\s*:\s*([^;]+)/gi,
      )].map((item) => item[1] ?? '').join(' ')
      if (forbiddenColor.test(visualValues) || /transition\s*:\s*all\b/i.test(declarations)) {
        violations.push(`${file}: ${selector.replace(/\s+/g, ' ').trim()}`)
      }
    }
  }

  assert(
    violations.length === 0,
    `按钮视觉必须消费设计 token，且不得 transition: all：\n${violations.join('\n')}`,
  )
}

export async function testRiskPopoverKeepsTheCompactThreeTrackContract(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/components/SidebarRiskStatus.tsx', 'utf8')
  const css = await fs.readFile('src/components/Sidebar.css', 'utf8')

  assert(source.includes('className="sb-risk-period-track"'), '风险浮层必须使用进度轨道而不是数值墙')
  assert(!source.includes('sb-risk-period-usage'), '风险浮层不得恢复已用 / 总额数字')
  assert(/\.sb-risk-period\s*\{[^}]*grid-template-columns:\s*44px minmax\(0, 1fr\);/s.test(css), '三条风险进度必须共享紧凑对齐网格')
  assert(/\.sb-risk-period-track\s*\{[^}]*height:\s*var\(--sp-1\);/s.test(css), '风险进度条必须使用 4px 间距 token')
  assert(!/\.sb-risk-period-track\s*>\s*i\s*\{[^}]*box-shadow:/s.test(css), '风险进度条不得使用装饰性发光')
}
