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

export async function testNotionDateRejectsImpossibleCalendarDates(): Promise<void> {
  const module = await import('@/lib/notionImport') as Record<string, unknown>
  const parseNotionDate = module.parseNotionDate as ((raw: string) => string | null) | undefined
  if (typeof parseNotionDate !== 'function') {
    throw new Error('Notion 日期解析器必须可独立验证')
  }

  for (const invalid of [
    '2026-02-30',
    '2026-13-01',
    '2026/04/31',
    '2026/02/30 08:00',
    '2026年00月10日',
    '2026年2月30日 08:00',
    '2026-02-30T08:00:00.000Z',
    '02/30/2026',
    '2026-07-27Tgarbage',
    'July 27, 2026',
  ]) {
    assert(parseNotionDate(invalid) === null, `不存在的日历日期必须拒绝：${invalid}`)
  }
}

export async function testNotionDateAcceptsValidLeapSlashAndChineseCalendarDates(): Promise<void> {
  const module = await import('@/lib/notionImport') as Record<string, unknown>
  const parseNotionDate = module.parseNotionDate as ((raw: string) => string | null) | undefined
  if (typeof parseNotionDate !== 'function') {
    throw new Error('Notion 日期解析器必须可独立验证')
  }

  assert(parseNotionDate('2024-02-29') === '2024-02-29', '闰年 2 月 29 日必须有效')
  assert(parseNotionDate('2026/7/27') === '2026-07-27', '合法斜杠日期必须规范化')
  assert(parseNotionDate('7/27/2026') === '2026-07-27', '合法月日年日期必须规范化')
  assert(parseNotionDate('2026-07-27T08:15:00+08:00') === '2026-07-27', '合法 ISO 时间戳必须保留来源日历日期')
  assert(parseNotionDate('2026年7月27日') === '2026-07-27', '合法中文日期必须规范化')
}
