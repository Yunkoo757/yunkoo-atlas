import type { Trade } from '@/data/trades'
import type { Strategy } from '@/data/strategies'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import {
  buildExportPayloadFromState,
  buildPortableSnapshotFromState,
  parseImportJson,
  prepareImportPayloadForCommit,
} from '@/lib/importExport'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const trade: Trade = {
  id: 't-img',
  ref: 'TRD-IMG',
  symbol: 'NVDA',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId: 'breakout',
  tradeKind: 'live',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'reviewed',
  reviewCategory: 'mastered',
  entry: 100,
  exit: 110,
  size: 1,
  pnl: 10,
  rMultiple: 1,
  openedAt: '2026-06-01',
  closedAt: '2026-06-02',
  note: '<p><img src="journal-asset://asset-1"></p>',
}

const strategy: Strategy = {
  id: 'breakout',
  name: 'Breakout',
  icon: 'trending-up',
  color: '#6b6ee6',
}

export async function testJsonExportIncludesReferencedAssets(): Promise<void> {
  const payload = await buildExportPayloadFromState(
    {
      trades: [trade],
      strategies: [strategy],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: DEFAULT_DISPLAY,
    },
    async (id: string) => (id === 'asset-1' ? { id, mime: 'image/png', data: 'abc123' } : null),
  )
  assert(payload.assets?.length === 1, 'JSON export includes referenced image assets')
  assert(payload.assets?.[0]?.id === 'asset-1', 'export keeps the referenced asset id')
}

export async function testTwoTradesKeepTheirOwnAssetsAcrossJsonNormalization(): Promise<void> {
  const secondTrade: Trade = {
    ...trade,
    id: 't-img-2',
    ref: 'TRD-IMG-2',
    symbol: 'BTCUSDT',
    note: '<p><img src="journal-asset://asset-2"></p>',
  }
  const payload = await buildExportPayloadFromState(
    {
      trades: [trade, secondTrade],
      strategies: [strategy],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: DEFAULT_DISPLAY,
    },
    async (id: string) => ({ id, mime: 'image/png', data: `data-${id}` }),
  )

  assert(payload.assets?.length === 2, 'two referenced assets are exported independently')
  const parsed = parseImportJson(JSON.stringify(payload))
  assert(parsed.ok, 'exported payload can be normalized by the import parser')
  if (!parsed.ok) return
  const first = parsed.data.trades.find((item) => item.id === trade.id)
  const second = parsed.data.trades.find((item) => item.id === secondTrade.id)
  assert(first?.note.includes('journal-asset://asset-1'), 'first trade keeps asset-1 ownership')
  assert(!first?.note.includes('asset-2'), 'first trade does not receive asset-2')
  assert(second?.note.includes('journal-asset://asset-2'), 'second trade keeps asset-2 ownership')
  assert(!second?.note.includes('asset-1'), 'second trade does not receive asset-1')
}

export function testJsonImportRejectsMismatchedDeclaredResultAuthority(): void {
  const payload = {
    version: 6,
    trades: [{ ...trade, resultSource: 'pnl' }],
    strategies: [strategy],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
  }
  const rejected = parseImportJson(JSON.stringify(payload))
  assert(!rejected.ok, 'cash authority with an extra R metric must be rejected')

  const importedPair = parseImportJson(JSON.stringify({
    ...payload,
    trades: [{ ...trade, resultSource: 'imported' }],
  }))
  assert(importedPair.ok, 'a declared imported pair must remain valid')

  const legacyPair = parseImportJson(JSON.stringify({
    ...payload,
    trades: [{ ...trade, resultSource: undefined }],
  }))
  assert(legacyPair.ok, 'a legacy pair without declared authority must remain importable')
}

export function testPortableSnapshotIncludesWorkflowSettingsAndShortcutOverrides(): void {
  const snapshot = buildPortableSnapshotFromState(
    {
      trades: [trade],
      strategies: [strategy],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: DEFAULT_DISPLAY,
      tagPresets: ['MTF ORA'],
      mistakeTagPresets: ['追单'],
      profile: { avatarId: 'monogram-1', displayName: 'Yunkoo' },
      savedTradeViews: [],
      symbolIcons: {},
      symbolCatalog: ['NVDA'],
    },
    { 'nav.list': { alt: true, key: 'x' } },
  )
  assert(snapshot.profile?.displayName === 'Yunkoo', '完整迁移快照应包含个人资料')
  assert(snapshot.mistakeTagPresets?.[0] === '追单', '完整迁移快照应包含错误标签库')
  assert(snapshot.shortcuts?.['nav.list'] != null, '完整迁移快照应包含快捷键覆盖值')
  assert(snapshot.symbolCatalog?.[0] === 'NVDA', '完整迁移快照应包含品种目录')
}

export function testJsonImportAcceptsOpenTradesWithoutResults(): void {
  const openTrade: Trade = {
    ...trade,
    id: 't-open',
    ref: 'TRD-OPEN',
    status: 'open',
    exit: null,
    pnl: null,
    rMultiple: null,
    closedAt: null,
  }
  const parsed = parseImportJson(JSON.stringify({
    version: 6,
    trades: [openTrade],
    strategies: [strategy],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
  }))

  assert(parsed.ok, '包含未结算交易的本软件 JSON 备份必须能够重新导入')
  if (!parsed.ok) return
  assert(parsed.data.trades[0]?.pnl === null, '未填写盈亏应保持 null，而不是伪造为 0')
  assert(parsed.data.trades[0]?.rMultiple === null, '未填写 R 倍数应保持 null')
}

export function testJsonImportRejectsAttachmentPathTraversalIds(): void {
  const parsed = parseImportJson(JSON.stringify({
    version: 6,
    trades: [trade],
    strategies: [strategy],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
    assets: [{ id: '../outside', mime: 'image/png', data: 'abc123' }],
  }))

  assert(!parsed.ok, 'JSON 导入必须在进入 IPC 前拒绝路径穿越附件 ID')
}

export function testJsonImportPreparesFreshAssetIdsBeforeAtomicCommit(): void {
  const ids = ['fresh-exported', 'fresh-inline']
  const prepared = prepareImportPayloadForCommit({
    version: 3,
    trades: [{
      ...trade,
      note: '<p><img src="journal-asset://asset-1"><img src="data:image/png;base64,aW5saW5l"></p>',
    }],
    strategies: [strategy],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
    assets: [{ id: 'asset-1', mime: 'image/png', data: 'ZXhwb3J0ZWQ=' }],
  }, () => ids.shift() ?? 'unexpected')

  const note = prepared.payload.trades[0]?.note ?? ''
  assert(note.includes('journal-asset://fresh-exported'), 'exported attachment references must use a fresh id')
  assert(note.includes('journal-asset://fresh-inline'), 'inline images must be staged instead of written early')
  assert(!note.includes('journal-asset://asset-1'), 'import must never overwrite an existing same-id attachment')
  assert(prepared.assets.length === 2, 'all imported images should enter one commit batch')
}

export function testJsonImportRejectsNotesWhoseReferencedAttachmentIsMissing(): void {
  let rejected = false
  try {
    prepareImportPayloadForCommit({
      version: 6,
      trades: [{ ...trade, note: '<p><img src="journal-asset://missing-asset"></p>' }],
      strategies: [strategy],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: DEFAULT_DISPLAY,
      assets: [],
    })
  } catch {
    rejected = true
  }
  assert(rejected, '导入笔记引用的附件缺失时必须拒绝，不能错链目标库中的同名附件')
}
