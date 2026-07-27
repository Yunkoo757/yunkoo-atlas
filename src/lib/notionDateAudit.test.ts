function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export async function testNotionIsoDateDoesNotShiftAcrossTimezones(): Promise<void> {
  const module = await import('@/lib/notionImport') as Record<string, unknown>
  const parseNotionDate = module.parseNotionDate as ((raw: string) => string | null) | undefined
  if (typeof parseNotionDate !== 'function') {
    throw new Error('Notion 日期解析器必须可独立验证')
  }

  assert(parseNotionDate('2026-07-27') === '2026-07-27', 'ISO 日期必须保持原日历日期')
  assert(parseNotionDate('2026-01-01') === '2026-01-01', 'ISO 元旦不得在负时区回退到上一年')
}
