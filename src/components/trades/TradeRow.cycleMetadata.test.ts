import fs from 'node:fs/promises'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function testRiskCycleMetadataDoesNotOccupyTradeRowTags(): Promise<void> {
  const [source, styles] = await Promise.all([
    fs.readFile('src/components/trades/TradeRow.tsx', 'utf8'),
    fs.readFile('src/components/trades/TradeList.css', 'utf8'),
  ])

  assert(!source.includes('is-pre-cycle'), '规则前元信息不得占用交易行标签位置')
  assert(!styles.includes('.trade-row-tag.is-pre-cycle'), '交易列表不得保留规则前徽标样式')
}
