import type { Trade } from '@/data/trades'
import type { Strategy } from '@/data/strategies'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import {
  buildExportPayloadFromState,
  buildPortableSnapshotFromState,
  loadReferencedAssetsForExport,
  mergeImportPayload,
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

export async function testExportRejectsMissingReferencedAssetsInsteadOfCreatingPartialBackup(): Promise<void> {
  let message = ''
  try {
    await loadReferencedAssetsForExport(
      ['asset-1', 'missing-asset'],
      async (id) => id === 'asset-1'
        ? { id, mime: 'image/png', data: 'abc123' }
        : null,
    )
  } catch (error) {
    message = error instanceof Error ? error.message : ''
  }
  assert(message.includes('1 个笔记附件缺失'), '缺图时必须拒绝导出并说明缺失数量')
  assert(message.includes('存储健康'), '缺图错误必须告诉用户下一步如何处理')
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
    async (id: string) => ({
      id,
      mime: 'image/png',
      data: id === 'asset-1' ? 'YXNzZXQtMQ==' : 'YXNzZXQtMg==',
    }),
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
    trades: [{ ...trade, note: '', resultSource: 'pnl' }],
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
    trades: [{ ...trade, note: '', resultSource: 'imported' }],
  }))
  assert(importedPair.ok, 'a declared imported pair must remain valid')

  const legacyPair = parseImportJson(JSON.stringify({
    ...payload,
    trades: [{ ...trade, note: '', resultSource: undefined }],
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
    note: '',
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

export function testLegacyJsonWithoutStrategiesCannotCreateDanglingTradeReferences(): void {
  const parsed = parseImportJson(JSON.stringify({
    version: 6,
    trades: [{ ...trade, note: '', strategyId: 'missing-strategy' }],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
  }))
  assert(parsed.ok, '缺少 strategies 的旧 JSON 仍应兼容导入')
  if (!parsed.ok) return

  const merged = mergeImportPayload({
    trades: [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
    tagPresets: [],
    mistakeTagPresets: [],
    savedTradeViews: [],
    symbolIcons: {},
    symbolCatalog: [],
  }, parsed.data)

  assert(merged.strategies.length === 1, '有交易的旧 JSON 必须补中性策略')
  assert(
    merged.strategies.some((item) => item.id === merged.trades[0]?.strategyId),
    '旧 JSON 导入后的交易不得形成悬空策略引用',
  )
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

export function testJsonImportReusesSharedTradeValidationAndKeepsLegacyCompatibility(): void {
  const plainTrade = { ...trade, note: '' }
  for (const malformed of [
    { comments: [{ id: 'comment-1', text: 42, createdAt: '2026-07-16' }] },
    { activities: [{ id: 'activity-1', kind: 'unknown', timestamp: '2026-07-16' }] },
    { caseType: 'unknown' },
    { masteryState: 'learning' },
  ]) {
    const parsed = parseImportJson(JSON.stringify({
      version: 6,
      trades: [{ ...plainTrade, ...malformed }],
      strategies: [strategy],
    }))
    assert(!parsed.ok, '普通 JSON 导入必须复用共享 Trade 边界并拒绝畸形工作流字段')
  }

  const { strategyId: _strategyId, ...legacyTrade } = plainTrade
  const parsed = parseImportJson(JSON.stringify({
    version: 6,
    trades: [{ ...legacyTrade, strategy: strategy.id, tradeKind: 'practice' }],
    strategies: [strategy],
  }))
  assert(parsed.ok, '旧 strategy 字段与 practice 类型仍应可导入')
  if (!parsed.ok) return
  assert(parsed.data.trades[0]?.strategyId === strategy.id, '旧 strategy 字段应迁移为 strategyId')
  assert(parsed.data.trades[0]?.tradeKind === 'paper', '旧 practice 类型应迁移为 paper')
}

export function testJsonImportRejectsDuplicateEntityAndAttachmentIds(): void {
  const plainTrade = { ...trade, note: '' }
  const duplicateTrade = parseImportJson(JSON.stringify({
    version: 6,
    trades: [plainTrade, { ...plainTrade, ref: 'TRD-DUPLICATE' }],
    strategies: [strategy],
  }))
  assert(!duplicateTrade.ok, '重复交易 ID 必须在合并前拒绝')

  const duplicateStrategy = parseImportJson(JSON.stringify({
    version: 6,
    trades: [plainTrade],
    strategies: [strategy, { ...strategy, name: 'Duplicate' }],
  }))
  assert(!duplicateStrategy.ok, '重复策略 ID 必须在合并前拒绝')

  const duplicateAsset = parseImportJson(JSON.stringify({
    version: 6,
    trades: [{ ...plainTrade, note: '<img src="journal-asset://asset-1">' }],
    strategies: [strategy],
    assets: [
      { id: 'asset-1', mime: 'image/png', data: 'aW1hZ2U=' },
      { id: 'asset-1', mime: 'image/png', data: 'aW1hZ2U=' },
    ],
  }))
  assert(!duplicateAsset.ok, '重复附件 ID 必须在重编号前拒绝')
}

export function testJsonImportValidatesImageMimeBase64AndReferenceClosure(): void {
  const plainTrade = { ...trade, note: '' }
  const valid = parseImportJson(JSON.stringify({
    version: 6,
    trades: [{ ...plainTrade, note: '<img src="journal-asset://asset-1">' }],
    strategies: [strategy],
    assets: [{ id: 'asset-1', mime: 'IMAGE/X-LINEAR-CAPTURE', data: 'aW1hZ2U=' }],
  }))
  assert(valid.ok, '合法 image/* MIME 与规范 Base64 应可导入')
  if (valid.ok) {
    assert(valid.data.assets?.[0]?.mime === 'image/x-linear-capture', '附件 MIME 应规范化')
  }

  for (const payload of [
    {
      trades: [{ ...plainTrade, note: '<img src="journal-asset://asset-1">' }],
      assets: [{ id: 'asset-1', mime: 'text/html', data: 'aW1hZ2U=' }],
    },
    {
      trades: [{ ...plainTrade, note: '<img src="journal-asset://asset-1">' }],
      assets: [{ id: 'asset-1', mime: 'image/png', data: 'Zh==' }],
    },
    {
      trades: [{ ...plainTrade, note: '<img src="journal-asset://missing">' }],
      assets: [],
    },
    {
      trades: [plainTrade],
      assets: [{ id: 'orphan', mime: 'image/png', data: 'aW1hZ2U=' }],
    },
    {
      trades: [{ ...plainTrade, note: '<img src="journal-asset://../outside">' }],
      assets: [],
    },
    {
      trades: [{ ...plainTrade, note: '<img src="data:text/html;base64,aW1hZ2U=">' }],
      assets: [],
    },
    {
      trades: [{ ...plainTrade, note: '<img src="data:image/png;base64,Zh==">' }],
      assets: [],
    },
  ]) {
    const parsed = parseImportJson(JSON.stringify({
      version: 6,
      strategies: [strategy],
      ...payload,
    }))
    assert(!parsed.ok, '损坏 MIME、Base64 或不闭合的附件引用必须在提交前拒绝')
  }
}

export function testJsonImportRejectsDuplicateGeneratedAssetIds(): void {
  let rejected = false
  try {
    prepareImportPayloadForCommit({
      version: 6,
      trades: [{
        ...trade,
        note: '<img src="journal-asset://asset-1"><img src="data:image/png;base64,aW1hZ2U=">',
      }],
      strategies: [strategy],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: DEFAULT_DISPLAY,
      assets: [{ id: 'asset-1', mime: 'image/png', data: 'aW1hZ2U=' }],
    }, () => 'same-generated-id')
  } catch {
    rejected = true
  }
  assert(rejected, '重编号器生成重复附件 ID 时必须中止整个导入')
}
