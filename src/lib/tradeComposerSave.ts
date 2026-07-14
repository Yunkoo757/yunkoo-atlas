import type { Trade } from '@/data/trades'

export type TradeComposerEditFields = Pick<
  Trade,
  'symbol' | 'side' | 'timeframe' | 'session' | 'strategyId' | 'openedAt'
> & Partial<Pick<Trade, 'caseType' | 'reviewCategory'>>

interface ExistingComposerSaveInput {
  id: string
  fields: TradeComposerEditFields
  saveImages: () => Promise<string>
  getLatest: (id: string) => Trade | undefined
}

/** 图片落盘后重新读取记录，只合并编辑器负责的字段，避免异步等待覆盖并发结果。 */
export async function prepareExistingComposerTrade({
  id,
  fields,
  saveImages,
  getLatest,
}: ExistingComposerSaveInput): Promise<Trade | null> {
  const imageHtml = await saveImages()
  const latest = getLatest(id)
  if (!latest) return null

  return {
    ...latest,
    ...fields,
    note: [latest.note, imageHtml].filter(Boolean).join('\n'),
  }
}
