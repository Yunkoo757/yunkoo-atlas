import type { CaseRecord, DisputeType } from '@/data/case'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import { mergeImportPayload } from '@/lib/importExport'
import {
  attachImagesToPreviewsBySourceId,
  executeNotionImport,
  getImportableNotionPreviews,
  type ImageFile,
  type NotionTradePreview,
  parseNotionZip,
  parseNotionCsv,
} from '@/lib/notionImport'
import { cleanExpiredTradeTrash } from '@/lib/trashCleanup'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const strategy: Strategy = {
  id: 'breakout',
  name: 'Breakout',
  icon: 'trending-up',
  color: '#5e6ad2',
}

const trade: Trade = {
  id: 't-1',
  ref: 'TRD-1',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'planned',
  conviction: 'medium',
  strategyId: strategy.id,
  tags: [],
  mistakeTags: [],
  reviewStatus: 'unreviewed',
  tradeKind: 'live',
  entry: 0,
  exit: null,
  stopLoss: null,
  size: 0,
  pnl: 0,
  rMultiple: 0,
  openedAt: '2026-06-01',
  closedAt: null,
  note: '',
}

const caseRecord: CaseRecord = {
  id: 'case-1',
  disputeTypeId: 'dt_custom',
  initialVerdict: '是',
  confidence: 70,
  images: [],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
}

const disputeType: DisputeType = {
  id: 'dt_custom',
  name: '自定义',
  options: ['是', '否'],
  positiveOption: '是',
  builtin: false,
}

function preview(rowIndex: number, errors: string[] = [], sourceId?: string): NotionTradePreview {
  return {
    rowIndex,
    sourceId,
    trade: {
      symbol: `SYM${rowIndex}`,
      side: 'long',
      status: 'planned',
      conviction: 'medium',
      strategyId: strategy.id,
      openedAt: '2026-06-01',
      tags: [],
      mistakeTags: [],
      entry: 0,
      pnl: 0,
      rMultiple: 0,
    },
    collectedTags: [],
    mistakeTags: [],
    noteHtml: '',
    images: [],
    imageCount: 0,
    errors,
    warnings: [],
  }
}

function image(name: string): ImageFile {
  return {
    zipPath: name,
    name,
    data: new Uint8Array(),
    mime: 'image/png',
    size: 0,
  }
}

export function testMergeImportPayloadKeepsCaseAndPresetData(): void {
  const merged = mergeImportPayload(
    {
      trades: [],
      strategies: [strategy],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: DEFAULT_DISPLAY,
      tagPresets: ['本地标签'],
      mistakeTagPresets: ['本地错误'],
      cases: [],
      disputeTypes: [],
    },
    {
      version: 5,
      trades: [trade],
      strategies: [strategy],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: DEFAULT_DISPLAY,
      tagPresets: ['导入标签'],
      mistakeTagPresets: ['导入错误'],
      cases: [caseRecord],
      disputeTypes: [disputeType],
    },
  )

  assert(merged.cases?.some((c) => c.id === caseRecord.id), 'imports cases into state')
  assert(
    merged.disputeTypes?.some((d) => d.id === disputeType.id),
    'imports dispute types into state',
  )
  assert(merged.tagPresets?.includes('导入标签'), 'imports tag presets')
  assert(merged.mistakeTagPresets?.includes('导入错误'), 'imports mistake tag presets')
}

export function testNotionImportUsesSameValidPreviewListForTradesAndImages(): void {
  const previews = [preview(0, ['bad row']), preview(1), preview(2)]
  const validPreviews = getImportableNotionPreviews(previews)
  const result = executeNotionImport(previews, [strategy], [])

  assert(result.trades.length === 2, 'invalid preview rows are not imported')
  assert(validPreviews[0]?.rowIndex === 1, 'first imported trade maps to first valid preview')
  assert(validPreviews[1]?.rowIndex === 2, 'second imported trade maps to second valid preview')
}

export function testNotionCsvFallbackMatchesImagesByNotionIdNotFolderOrder(): void {
  const previews = [
    { ...preview(0, [], '1'), trade: { ...preview(0).trade, symbol: 'BTCUSDT' } },
    { ...preview(1, [], '2'), trade: { ...preview(1).trade, symbol: 'EURUSD' } },
  ]
  const attached = attachImagesToPreviewsBySourceId(previews, [
    { sourceId: '2', images: [image('eur.png')] },
    { sourceId: '1', images: [image('btc.png')] },
  ])

  assert(attached[0]?.trade.symbol === 'BTCUSDT', 'keeps BTC preview first')
  assert(attached[0]?.images[0]?.name === 'btc.png', 'BTC gets images with ID 1')
  assert(attached[1]?.trade.symbol === 'EURUSD', 'keeps EUR preview second')
  assert(attached[1]?.images[0]?.name === 'eur.png', 'EUR gets images with ID 2')
}

export async function testSampleNotionZipKeepsImagesAttachedToTrades(): Promise<void> {
  const fs = await import('node:fs/promises')
  const zip = await fs.readFile('Notion/ExportBlock-53a72011-14a6-46a0-8a93-5b5cdc4301a7-Part-1.zip')
  const result = await parseNotionZip(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength), [
    strategy,
  ])
  const withImages = result.previews.filter((p) => p.imageCount > 0)

  assert(result.previews.length >= 3, 'sample Notion zip produces trade previews')
  assert(withImages.length >= 3, 'sample Notion zip keeps images attached to trades')
  assert(
    withImages.every((p) => p.trade.symbol),
    'image-bearing previews still have symbols',
  )
}

export function testNotionMultiSelectTagsStripEveryEmbeddedUrl(): void {
  const csv = [
    'Trade,Date,Symbol,Model,Session,Time Frame,Confluences,Entry Signal,Position,Status,S/L Pips,Net PnL,Max R/R,Weight,Profit/Loss,Mistakes',
    'Trade #,2026/06/28,BTCUSDT,导航1,London Open,15 minutes,MTF ORA,LTF ChoCh,Buy,Closed by T/P,100,US$20.00,2,A,🟢 Profit,"技术分析错误 (https://app.notion.com/p/a?pvs=21), 情绪化交易 (https://app.notion.com/p/b?pvs=21)"',
  ].join('\n')

  const result = parseNotionCsv(csv, [strategy])
  const tags = result.previews[0]?.mistakeTags ?? []

  assert(tags.includes('技术分析错误'), 'keeps first mistake tag text')
  assert(tags.includes('情绪化交易'), 'keeps second mistake tag text')
  assert(!tags.some((tag) => tag.includes('http')), 'removes embedded Notion URLs')
}

export async function testCleanExpiredTradeTrashPurgesExpiredTradesOnly(): Promise<void> {
  const expired: Trade = {
    ...trade,
    id: 'expired',
    deletedAt: '2026-05-01T00:00:00.000Z',
  }
  const recent: Trade = {
    ...trade,
    id: 'recent',
    deletedAt: new Date().toISOString(),
  }
  const purged: string[] = []

  const count = await cleanExpiredTradeTrash([expired, recent], (id) => {
    purged.push(id)
  })

  assert(count === 1, 'only expired deleted trades are cleaned')
  assert(purged.length === 1 && purged[0] === 'expired', 'purges the expired trade id')
}
