import type { CaseRecord, DisputeType } from '@/data/case'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { DEFAULT_DISPLAY, filterTrades } from '@/lib/tradeFilters'
import { mergeImportPayload, parseImportJson } from '@/lib/importExport'
import { computeStrategyStats } from '@/lib/strategies'
import { isAccountTrade, isReviewCaseTrade, normalizeTradeKind } from '@/lib/tradeKind'
import { buildReviewCaseFromTrade, getNextReviewCaseRef } from '@/lib/reviewCases'
import { buildTradeTableRow } from '@/lib/tradeTable'
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

export function testReviewCaseTradeKindIsPreservedAndExcludedFromAccountTrades(): void {
  const reviewCase = { ...trade, id: 'case-trade', tradeKind: 'case' as Trade['tradeKind'] }

  assert(normalizeTradeKind('case') === 'case', 'case trade kind is preserved')
  assert(isReviewCaseTrade(reviewCase), 'case trade is recognized as review case')
  assert(!isAccountTrade(reviewCase), 'case trade is excluded from account trades')
  assert(isAccountTrade(trade), 'live trade remains an account trade')
}

export function testImportJsonAcceptsReviewCaseTrades(): void {
  const payload = {
    version: 5,
    trades: [{ ...trade, id: 'case-import', tradeKind: 'case' }],
    strategies: [strategy],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
  }

  const result = parseImportJson(JSON.stringify(payload))

  assert(result.ok, 'import accepts review case trade kind')
}

export function testDefaultSmartTradeFiltersExcludeReviewCases(): void {
  const paperTrade: Trade = { ...trade, id: 'paper-trade', tradeKind: 'paper' }
  const reviewCase: Trade = { ...trade, id: 'review-case', tradeKind: 'case' }

  const starred = filterTrades(
    [trade, paperTrade, reviewCase],
    { type: 'starred' },
    [trade.id, paperTrade.id, reviewCase.id],
  )
  const casesOnly = filterTrades(
    [trade, paperTrade, reviewCase],
    { type: 'all', tradeKind: 'case' },
    [],
  )

  assert(starred.some((t) => t.id === trade.id), 'starred keeps live trades')
  assert(starred.some((t) => t.id === paperTrade.id), 'starred keeps paper trades')
  assert(!starred.some((t) => t.id === reviewCase.id), 'starred excludes review cases')
  assert(casesOnly.length === 1 && casesOnly[0]?.id === reviewCase.id, 'case view only shows cases')
}

export function testReviewCaseScopesFilterCaseRecords(): void {
  const focusCase: Trade = { ...trade, id: 'focus-case', tradeKind: 'case', reviewStatus: 'focus' }
  const mistakeCase: Trade = {
    ...trade,
    id: 'mistake-case',
    tradeKind: 'case',
    mistakeTags: ['追单'],
  }
  const reviewedCase: Trade = {
    ...trade,
    id: 'reviewed-case',
    tradeKind: 'case',
    reviewStatus: 'reviewed',
  }

  const focus = filterTrades(
    [focusCase, mistakeCase, reviewedCase],
    { type: 'all', tradeKind: 'case', reviewCaseScope: 'focus' },
    [],
  )
  const mistakes = filterTrades(
    [focusCase, mistakeCase, reviewedCase],
    { type: 'all', tradeKind: 'case', reviewCaseScope: 'mistakes' },
    [],
  )
  const reviewed = filterTrades(
    [focusCase, mistakeCase, reviewedCase],
    { type: 'all', tradeKind: 'case', reviewCaseScope: 'reviewed' },
    [],
  )

  assert(focus.length === 1 && focus[0]?.id === focusCase.id, 'focus scope only keeps focus cases')
  assert(mistakes.length === 1 && mistakes[0]?.id === mistakeCase.id, 'mistakes scope only keeps mistake cases')
  assert(reviewed.length === 1 && reviewed[0]?.id === reviewedCase.id, 'reviewed scope only keeps reviewed cases')
}

export function testStrategyStatsExcludeReviewCasesByDefault(): void {
  const closedLive: Trade = {
    ...trade,
    id: 'live-win',
    status: 'win',
    pnl: 100,
    rMultiple: 2,
    closedAt: '2026-06-02',
  }
  const reviewCase: Trade = {
    ...closedLive,
    id: 'case-win',
    tradeKind: 'case',
    pnl: 10000,
    rMultiple: 100,
  }

  const stats = computeStrategyStats([closedLive, reviewCase], strategy.id)

  assert(stats.tradeCount === 1, 'strategy trade count excludes review cases')
  assert(stats.totalPnl === 100, 'strategy pnl excludes review cases')
  assert(stats.totalR === 2, 'strategy R excludes review cases')
}

export function testBuildReviewCaseFromTradeCopiesReviewFieldsWithoutMutatingSource(): void {
  const source: Trade = {
    ...trade,
    id: 'source-trade',
    ref: 'TRD-9',
    tags: ['好形态'],
    mistakeTags: ['追单'],
    note: '<p>原始复盘</p>',
    deletedAt: '2026-06-01T00:00:00.000Z',
  }

  const copy = buildReviewCaseFromTrade(source, { id: 'case-copy', ref: 'CAS-2' })

  assert(copy.id === 'case-copy', 'copy gets a new id')
  assert(copy.ref === 'CAS-2', 'copy gets a case ref')
  assert(copy.tradeKind === 'case', 'copy is a review case')
  assert(copy.symbol === source.symbol, 'copy keeps symbol')
  assert(copy.strategyId === source.strategyId, 'copy keeps strategy')
  assert(copy.tags.includes('好形态'), 'copy keeps tags')
  assert(copy.mistakeTags.includes('追单'), 'copy keeps mistake tags')
  assert(copy.note.includes('来源交易：TRD-9'), 'copy records source trade')
  assert(copy.note.includes('原始复盘'), 'copy keeps note content')
  assert(!copy.deletedAt, 'copy is not deleted')
  assert(source.tradeKind === 'live', 'source trade kind is unchanged')
  assert(source.deletedAt === '2026-06-01T00:00:00.000Z', 'source deletion metadata is unchanged')
}

export function testGetNextReviewCaseRefUsesExistingCaseRefsOnly(): void {
  const next = getNextReviewCaseRef([
    { ...trade, ref: 'TRD-99' },
    { ...trade, id: 'case-1', ref: 'CAS-1', tradeKind: 'case' },
    { ...trade, id: 'case-7', ref: 'CAS-7', tradeKind: 'case' },
  ])

  assert(next === 'CAS-8', 'next review case ref increments highest case ref')
}

export function testTradeTableRowFormatsDenseRecordFields(): void {
  const row = buildTradeTableRow(
    {
      ...trade,
      ref: 'TRD-42',
      symbol: 'BTCUSDT',
      status: 'win',
      side: 'long',
      pnl: 260,
      rMultiple: 2.4,
      tags: ['MTF ORA', 'LTF ChoCh'],
      mistakeTags: ['追单'],
      openedAt: '2026-07-03',
    },
    [strategy],
  )

  assert(row.ref === 'TRD-42', 'table row keeps ref')
  assert(row.date === '2026/07/03', 'table row formats date compactly')
  assert(row.symbol === 'BTCUSDT', 'table row keeps symbol')
  assert(row.model === 'Breakout', 'table row resolves strategy name')
  assert(row.position === 'Buy', 'table row maps long to Buy')
  assert(row.status === 'Closed by T/P', 'table row maps winning status to close reason')
  assert(row.pnl === 'US$260.00', 'table row formats positive pnl')
  assert(row.rMultiple === '2.4', 'table row formats R multiple')
  assert(row.result === 'Profit', 'table row maps winning trade to Profit result')
  assert(row.confluences.join(',') === 'MTF ORA,LTF ChoCh', 'table row exposes tags as confluences')
  assert(row.mistakes.join(',') === '追单', 'table row exposes mistake tags')
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
