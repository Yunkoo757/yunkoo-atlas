import type { Trade } from '@/data/trades'
import type { Strategy } from '@/data/strategies'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import { createWeeklyReview } from '@/data/weeklyReviews'
import { createQuickNote } from '@/data/quickNotes'
import { PERSISTED_SNAPSHOT_FIELDS } from '@/storage/persistedKeys'
import {
  createFullPersistedSnapshotFixture,
  FULL_SNAPSHOT_ASSET_IDS,
  canonicalContractJson,
} from '@/storage/fixtures/fullPersistedSnapshot'
import {
  buildExportPayloadFromState,
  buildWebConflictRecoveryPayload,
  buildPortableSnapshotFromState,
  loadReferencedAssetsForExport,
  mergeImportPayload,
  parseImportJson,
  prepareImportPayloadForCommit,
} from '@/lib/importExport'
import {
  applyNoteDraftsToSnapshot,
  resetNoteDraftsForTests,
  setNoteDraft,
} from '@/storage/noteDrafts'

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

export async function testWeeklyReviewTextAndImagesRoundTripThroughJsonBackup(): Promise<void> {
  const review = {
    ...createWeeklyReview('2026-07-13', new Date('2026-07-17T00:00:00.000Z')),
    contentHtml: '<p>本周证据</p><img src="journal-asset://weekly-asset">',
    commitmentText: '等待确认',
    commitmentCriteria: '每笔都有确认截图',
  }
  const payload = await buildExportPayloadFromState(
    {
      trades: [{ ...trade, note: '' }],
      weeklyReviews: [review],
      strategies: [strategy],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: DEFAULT_DISPLAY,
    },
    async (id) => id === 'weekly-asset'
      ? { id, mime: 'image/png', data: 'd2Vla2x5' }
      : null,
  )
  assert(payload.assets?.[0]?.id === 'weekly-asset', '周复盘截图必须进入 JSON 备份附件闭包')
  const parsed = parseImportJson(JSON.stringify(payload))
  assert(parsed.ok, '包含周复盘的当前 JSON 备份必须能够重新导入')
  if (!parsed.ok) return
  assert(parsed.data.weeklyReviews?.[0]?.commitmentText === '等待确认', '周复盘结构化内容必须往返保留')

  const prepared = prepareImportPayloadForCommit(parsed.data, () => 'weekly-asset-fresh')
  assert(
    prepared.payload.weeklyReviews?.[0]?.contentHtml.includes('journal-asset://weekly-asset-fresh'),
    '导入时周复盘截图引用也必须安全重编号',
  )
}

export async function testConflictRecoveryCombinesAvailableAssetsAndListsEveryMissingReference(): Promise<void> {
  const secondTrade = {
    ...trade,
    id: 't-img-2',
    ref: 'TRD-IMG-2',
    note: '<p><img src="journal-asset://prepared"><img src="journal-asset://missing"></p>',
  }
  const { payload, missingAssetIds } = await buildWebConflictRecoveryPayload(
    {
      trades: [trade, secondTrade],
      strategies: [strategy],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: DEFAULT_DISPLAY,
    },
    async (id) => id === 'missing' ? null : { id, mime: 'image/png', data: `bytes-${id}` },
  )

  assert(payload.assets.map((asset) => asset.id).sort().join(',') === 'asset-1,prepared', '抢救副本必须合并已提交与本地 prepared 附件')
  assert(missingAssetIds.join(',') === 'missing', '缺失引用必须逐项列出')
  assert(payload.recovery.complete === false, '存在缺失附件时不得宣称副本完整')
  assert(payload.recovery.warning.includes('不能视为完整备份'), '不完整副本必须携带明确警告')
}

export async function testConflictRecoveryExportsRealEditorPreparedImageReference(): Promise<void> {
  resetNoteDraftsForTests()
  try {
    setNoteDraft(
      trade.id,
      '<p>未保存图片<img src="blob:http://localhost/editor-preview" data-asset-id="prepared-editor"></p>',
    )
    const snapshot = applyNoteDraftsToSnapshot({
      trades: [trade],
      strategies: [strategy],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: DEFAULT_DISPLAY,
    })
    const { payload } = await buildWebConflictRecoveryPayload(
      snapshot,
      async (id) => id === 'prepared-editor'
        ? { id, mime: 'image/png', data: 'cHJlcGFyZWQ=' }
        : null,
    )
    assert(payload.trades[0]?.note.includes('journal-asset://prepared-editor'), '真实 Editor blob 引用必须转为持久附件引用')
    assert(payload.assets[0]?.id === 'prepared-editor', '仅由草稿引用的 prepared asset 必须进入恢复副本')
    assert(payload.recovery.complete, 'prepared asset 可读取时恢复副本才可标记完整')
  } finally {
    resetNoteDraftsForTests()
  }
}

export async function testConflictRecoveryMarksBlobWithoutPermanentAssetIdIncomplete(): Promise<void> {
  resetNoteDraftsForTests()
  try {
    setNoteDraft(trade.id, '<p><img src="blob:http://localhost/not-yet-prepared"></p>')
    const snapshot = applyNoteDraftsToSnapshot({
      trades: [trade],
      strategies: [strategy],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: DEFAULT_DISPLAY,
    })
    const { payload, missingAssetIds } = await buildWebConflictRecoveryPayload(snapshot, async () => null)
    assert(!payload.recovery.complete, '没有永久附件 ID 的 blob 草稿不得宣称恢复完整')
    assert(missingAssetIds[0]?.startsWith('recovery-missing-draft-image-'), '未准备图片必须明确列入缺失引用')
  } finally {
    resetNoteDraftsForTests()
  }
}

export async function testQuickNoteTextAndImagesRoundTripWithoutEnteringTrades(): Promise<void> {
  const note = {
    ...createQuickNote(new Date('2026-07-18T08:00:00.000Z')),
    title: '盘前灵感',
    contentHtml: '<p>观察美元流动性</p><img src="journal-asset://quick-note-asset">',
  }
  const payload = await buildExportPayloadFromState(
    {
      trades: [],
      quickNotes: [note],
      strategies: [strategy],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: DEFAULT_DISPLAY,
    },
    async (id) => id === 'quick-note-asset'
      ? { id, mime: 'image/png', data: 'cXVpY2s=' }
      : null,
  )
  assert(payload.trades.length === 0, '随记不得被写入交易数组或交易统计')
  assert(payload.quickNotes?.[0]?.title === '盘前灵感', '随记标题与正文必须进入备份')
  assert(payload.assets?.[0]?.id === 'quick-note-asset', '随记截图必须进入附件闭包')

  const parsed = parseImportJson(JSON.stringify(payload))
  assert(parsed.ok, '包含随记的 JSON 备份必须能够重新导入')
  if (!parsed.ok) return
  const prepared = prepareImportPayloadForCommit(parsed.data, () => 'quick-note-asset-fresh')
  assert(
    prepared.payload.quickNotes?.[0]?.contentHtml.includes('journal-asset://quick-note-asset-fresh'),
    '导入时随记截图引用必须安全重编号',
  )
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

export async function testJsonBackupRoundTripsProfileAndShortcutOverrides(): Promise<void> {
  const payload = await buildExportPayloadFromState(
    {
      trades: [{ ...trade, note: '' }],
      strategies: [strategy],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: DEFAULT_DISPLAY,
      profile: { avatarId: 'monogram-1', displayName: 'Yunkoo' },
      shortcuts: { 'nav.list': { alt: true, key: 'x' } },
    },
    async () => null,
  )

  assert(
    Object.prototype.hasOwnProperty.call(payload, 'profile'),
    '当前 JSON writer 必须显式写出 profile 字段',
  )
  assert(
    Object.prototype.hasOwnProperty.call(payload, 'shortcuts'),
    '当前 JSON writer 必须显式写出 shortcuts 字段',
  )
  const missingFields = PERSISTED_SNAPSHOT_FIELDS.filter(
    (field) => !Object.prototype.hasOwnProperty.call(payload, field),
  )
  assert(missingFields.length === 0, `当前 JSON writer 漏写字段：${missingFields.join(', ')}`)

  const parsed = parseImportJson(JSON.stringify(payload))
  assert(parsed.ok, '当前 JSON 备份必须能够重新导入')
  if (!parsed.ok) return
  assert(parsed.data.profile?.displayName === 'Yunkoo', 'JSON 往返必须保留 profile')
  assert(
    JSON.stringify(parsed.data.shortcuts?.['nav.list']) === JSON.stringify({ alt: true, key: 'x' }),
    'JSON 往返必须保留快捷键覆盖',
  )
}

export async function testPathAFullSnapshotRoundTripsEveryRegisteredField(): Promise<void> {
  const expected = createFullPersistedSnapshotFixture()
  const assetIds = new Set(Object.values(FULL_SNAPSHOT_ASSET_IDS))
  const payload = await buildExportPayloadFromState(expected, async (id) => assetIds.has(id)
    ? { id, mime: 'image/png', data: 'aW1hZ2U=' }
    : null)

  assert(
    JSON.stringify(Object.keys(payload).filter((key) => key !== 'version' && key !== 'assets').sort()) ===
      JSON.stringify([...PERSISTED_SNAPSHOT_FIELDS].sort()),
    'PATH-A writer 的快照字段集合必须与中央注册表完全相等',
  )

  const parsed = parseImportJson(JSON.stringify(payload))
  assert(parsed.ok, 'PATH-A 全量哨兵 fixture 必须可由 JSON codec 重新读取')
  if (!parsed.ok) return
  for (const field of PERSISTED_SNAPSHOT_FIELDS) {
    assert(
      canonicalContractJson(parsed.data[field]) === canonicalContractJson(expected[field]),
      `PATH-A 字段 ${field} 必须逐字段保真`,
    )
  }
}

export async function testPathAHistoricalMissingFieldMatrixIsExplicit(): Promise<void> {
  const expected = createFullPersistedSnapshotFixture()
  expected.trades[0]!.note = '<p>交易哨兵</p>'
  expected.weeklyReviews![0]!.contentHtml = '<p>周复盘哨兵</p>'
  expected.quickNotes![0]!.contentHtml = '<p>随记正文哨兵</p>'
  const payload = await buildExportPayloadFromState(expected, async () => null)

  for (const field of PERSISTED_SNAPSHOT_FIELDS) {
    const candidate = { ...payload, version: 1 } as Record<string, unknown>
    delete candidate[field]
    const parsed = parseImportJson(JSON.stringify(candidate))
    assert(parsed.ok, `历史输入缺少 ${field} 时必须由中央规范化层补齐`)
    if (parsed.ok) {
      assert(field in parsed.data, `规范化后的 CanonicalSnapshot 必须显式拥有 ${field}`)
    }
  }
}

export async function testPathAWriterSerializesAllFieldsFromSparseRuntimeState(): Promise<void> {
  const fixture = createFullPersistedSnapshotFixture()
  const sparse = {
    ...fixture,
    shortcuts: undefined,
    tagPresets: undefined,
    mistakeTagPresets: undefined,
    profile: undefined,
  }
  const payload = await buildExportPayloadFromState(
    sparse,
    async (id) => ({ id, mime: 'image/png', data: 'aW1hZ2U=' }),
  )
  const serialized = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>
  const actualFields = Object.keys(serialized)
    .filter((key) => key !== 'version' && key !== 'assets')
    .sort()
  assert(
    JSON.stringify(actualFields) === JSON.stringify([...PERSISTED_SNAPSHOT_FIELDS].sort()),
    'PATH-A writer 经过 JSON.stringify 后仍必须显式拥有全部 16 字段',
  )
  assert(JSON.stringify(serialized.shortcuts) === '{}', '空快捷键覆盖必须序列化为空对象')
  assert(JSON.stringify(serialized.tagPresets) === '[]', '缺失标签预设必须序列化为空数组')
  assert(JSON.stringify(serialized.mistakeTagPresets) === '[]', '缺失错误标签预设必须序列化为空数组')
  assert(typeof (serialized.profile as { displayName?: unknown }).displayName === 'string', '缺失 profile 必须序列化为默认身份')

  const portableSerialized = JSON.parse(JSON.stringify(
    buildPortableSnapshotFromState(
      sparse as unknown as Parameters<typeof buildPortableSnapshotFromState>[0],
      {},
    ),
  )) as Record<string, unknown>
  assert(
    JSON.stringify(Object.keys(portableSerialized).sort()) ===
      JSON.stringify([...PERSISTED_SNAPSHOT_FIELDS].sort()),
    'Web ZIP portable writer 序列化后也必须显式拥有全部 16 字段',
  )
}

export async function testPathAWrongTypeMatrixRejectsEveryRegisteredField(): Promise<void> {
  const expected = createFullPersistedSnapshotFixture()
  const payload = await buildExportPayloadFromState(expected, async (id) => ({
    id,
    mime: 'image/png',
    data: 'aW1hZ2U=',
  }))

  for (const field of PERSISTED_SNAPSHOT_FIELDS) {
    const candidate = { ...payload, [field]: '__invalid_type__' }
    const parsed = parseImportJson(JSON.stringify(candidate))
    assert(!parsed.ok, `字段 ${field} 存在但类型错误时必须拒绝，不能静默使用默认值`)
  }
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
// Quality-Scenario: H0-A-16
