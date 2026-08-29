function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function testFilterTriggerUsesQuietCountBadge(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/components/ui/FilterBar.tsx', 'utf8')
  const css = await fs.readFile('src/components/ui/FilterBar.css', 'utf8')

  assert(!source.includes('筛选 ·'), '筛选入口不得重复显示“筛选 · 数量”')
  assert(source.includes('className="ui-filter-count"'), '启用筛选时必须使用紧凑数量角标')
  assert(source.includes('aria-label={label}'), '图标化筛选入口必须保留完整无障碍名称')
  assert(css.includes('.ui-filter-count'), '筛选数量角标必须具有独立视觉层级')
}
