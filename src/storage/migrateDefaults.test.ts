import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import {
  DEFAULT_USER_DISPLAY_NAME,
  createDefaultMistakeTagPresets,
  createDefaultStrategies,
  createDefaultTagPresets,
  createDefaultUserProfile,
} from '@/config/defaultProfile'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import { DEFAULT_SYMBOL_CATALOG } from '@/lib/symbolIcons'
import { snapshotToRuntimeState } from '@/storage/snapshotToRuntimeState'
import type { LibraryImportAsset } from '@/storage/adapter'
import {
  migrateElectronLibraryIfNeeded,
  migrateFromLocalStorageIfNeeded,
} from '@/storage/migrate'
import { LEGACY_LOCAL_STORAGE_KEY } from '@/storage/legacyIdentity'
import type {
  ExportAssetRecord,
  PersistedSnapshot,
} from '@/storage/types'
import { useStore } from '@/store/useStore'
import {
  applySnapshotToStore,
  replaceLibraryInStore,
} from '@/lib/snapshotStore'
import { useShortcutStore } from '@/store/shortcutStore'
import { createEmptyPersistedSnapshot } from '@/storage/emptySnapshot'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function snapshotWithEmptyTrades(
  strategies: Strategy[],
  displayName: string,
): PersistedSnapshot {
  return {
    ...createEmptyPersistedSnapshot(),
    trades: [],
    strategies,
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: strategies.map((strategy) => strategy.id),
    display: { ...DEFAULT_DISPLAY },
    tagPresets: ['既有标签'],
    mistakeTagPresets: ['既有错误'],
    profile: { avatarId: 'monogram-2', displayName, legacyCashCurrencyAssumption: null },
  }
}

class MemoryAdapter {
  opened = 0
  saves = 0

  constructor(public snapshot: PersistedSnapshot | null) {}

  async open(): Promise<void> { this.opened += 1 }
  async loadSnapshot(): Promise<PersistedSnapshot | null> { return this.snapshot }
  async getAssetForExport(_id: string): Promise<ExportAssetRecord | null> { return null }
  async commitImport(snapshot: PersistedSnapshot, _assets: LibraryImportAsset[]): Promise<void> {
    this.saves += 1
    this.snapshot = snapshot
  }
}

export function testNewLibraryDefaultsAreNeutralAndReferenceSafe(): void {
  const strategies = createDefaultStrategies()
  assert(DEFAULT_USER_DISPLAY_NAME === '交易者', '默认显示名称必须保持中性')
  assert(
    strategies.length === 1 && strategies[0]?.id === 'uncategorized' && strategies[0]?.name === '未分类',
    '新资料库必须至少有一个中性的未分类策略',
  )
  assert(createDefaultTagPresets().length === 0, '新资料库不得预置个人化普通标签')
  assert(
    createDefaultMistakeTagPresets().join(',') === '缺乏耐心,仓位大小错误,修改止损,情绪化交易',
    '新资料库只应保留少量通用错误标签',
  )
  assert(createDefaultUserProfile().displayName === '交易者', '用户资料工厂必须复用默认名称常量')
}

export async function testFreshBrowserLibraryIncludesDefaultSymbolCatalog(): Promise<void> {
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  if (previousDescriptor && !previousDescriptor.configurable) return
  const localStorageStub: Storage = {
    get length() { return 0 },
    clear: () => {},
    getItem: () => null,
    key: () => null,
    removeItem: () => {},
    setItem: () => {},
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: localStorageStub,
  })

  const target = new MemoryAdapter(null)
  try {
    await migrateFromLocalStorageIfNeeded(target)
    assert(
      target.snapshot?.symbolCatalog?.join(',') === DEFAULT_SYMBOL_CATALOG.join(','),
      '全新资料库必须带默认品种目录，避免新建交易没有可选品种',
    )
  } finally {
    if (previousDescriptor) Object.defineProperty(globalThis, 'localStorage', previousDescriptor)
    else delete (globalThis as { localStorage?: Storage }).localStorage
  }
}

export function testProfileFallbacksUseTheNeutralDisplayNameConstant(): void {
  const previous = useStore.getState().profile
  try {
    useStore.getState().setDisplayName('   ')
    assert(useStore.getState().profile.displayName === DEFAULT_USER_DISPLAY_NAME, '空名称保存必须回退中性名称')
    const snapshot = snapshotWithEmptyTrades([], '')
    assert(snapshotToRuntimeState(snapshot).profile.displayName === DEFAULT_USER_DISPLAY_NAME, '空快照名称必须回退中性名称')
    delete snapshot.profile
    assert(snapshotToRuntimeState(snapshot, previous).profile === previous, '启动加载缺少资料的旧快照时保留当前资料')
  } finally {
    useStore.setState({ profile: previous })
  }
}

export function testRefreshAndReplacementPublishProfileWithItsLibrary(): void {
  const previousStore = useStore.getState()
  const previousShortcuts = useShortcutStore.getState()
  const source = snapshotWithEmptyTrades([], '当前资料')
  source.profile!.legacyCashCurrencyAssumption = { currency: 'USD', confirmedAt: '2026-11-27' }
  const restored = snapshotWithEmptyTrades([], '恢复资料')
  restored.tagPresets = ['恢复标签']
  const samples: string[] = []
  try {
    for (const publish of [applySnapshotToStore, replaceLibraryInStore]) {
      applySnapshotToStore(source)
      samples.length = 0
      const unsubscribe = useStore.subscribe(({ profile, tagPresets }) => {
        if (tagPresets.includes('恢复标签')) {
          samples.push(profile.displayName + '/' + (profile.legacyCashCurrencyAssumption?.currency ?? '无'))
        }
      })
      try {
        publish(restored)
      } finally {
        unsubscribe()
      }
      assert(samples.join(',') === '恢复资料/无', `恢复标签与用户资料必须一次发布，实际读取 ${samples.join(',')}`)
    }
  } finally {
    useStore.setState(previousStore)
    useShortcutStore.setState(previousShortcuts)
  }
}

export function testLegacyFullRestoreWithoutProfileResetsToNeutralIdentity(): void {
  const previousStore = useStore.getState()
  const previousShortcutStore = useShortcutStore.getState()
  const legacy = snapshotWithEmptyTrades([], '临时名称')
  delete legacy.profile
  try {
    useStore.getState().setDisplayName('旧资料库用户')
    applySnapshotToStore(legacy)
    assert(
      useStore.getState().profile.displayName === DEFAULT_USER_DISPLAY_NAME,
      '旧格式整库快照缺少 profile 时必须重置为中性身份，不能沿用被替换资料库的用户',
    )
  } finally {
    useStore.setState(previousStore)
    useShortcutStore.setState(previousShortcutStore)
  }
}

export function testLibraryRestoreClearsEphemeralEditingAndNavigationState(): void {
  const previousStore = useStore.getState()
  const previousShortcutStore = useShortcutStore.getState()
  try {
    useStore.setState({
      selectedId: 'old-trade',
      composerOpen: true,
      composerKind: 'live',
      closeTradeRequest: { tradeId: 'old-trade' },
    })
    useShortcutStore.setState({
      lightbox: { images: ['blob:old-library'], index: 0 },
      listContext: {
        filter: { type: 'all' },
        listPath: '/list',
        listSearch: '?status=open',
        orderedIds: ['old-trade'],
      },
    })

    const session = useStore.getState().librarySession
    const snapshot = createEmptyPersistedSnapshot()
    applySnapshotToStore(snapshot)
    assert(useStore.getState().librarySession === session, '同库刷新应保留会话身份')
    replaceLibraryInStore(snapshot)

    const state = useStore.getState()
    const shortcuts = useShortcutStore.getState()
    assert(state.librarySession !== session, '整库恢复必须在发布数据时移交会话身份')
    assert(state.selectedId === null, '整库恢复后不得保留旧记录选择')
    assert(!state.composerOpen && state.composerKind === null, '整库恢复后必须关闭旧编辑器')
    assert(state.closeTradeRequest === null, '整库恢复后必须清除旧平仓请求')
    assert(shortcuts.lightbox === null, '整库恢复后必须清除旧附件预览')
    assert(shortcuts.listContext === null, '整库恢复后必须清除旧列表导航上下文')
  } finally {
    useStore.setState(previousStore)
    useShortcutStore.setState(previousShortcutStore)
  }
}

export async function testElectronMigrationPreservesAnExistingZeroTradeSnapshot(): Promise<void> {
  const existingStrategies: Strategy[] = [{
    id: 'custom-strategy',
    name: '已有策略',
    icon: 'shield',
    color: '#123456',
  }]
  const existing = snapshotWithEmptyTrades(existingStrategies, '已有用户')
  const target = new MemoryAdapter(null)
  const indexedDb = new MemoryAdapter(existing)

  const migrated = await migrateElectronLibraryIfNeeded(target, indexedDb)

  assert(migrated, '目标桌面库缺少快照时应迁入现有浏览器快照')
  assert(target.snapshot?.trades.length === 0, '零交易是有效资料库状态，不得注入种子交易')
  assert(target.snapshot?.strategies === existingStrategies, '既有策略数组必须原样保留')
  assert(target.snapshot?.profile === existing.profile, '既有用户资料必须原样保留')
  assert(target.snapshot?.tagPresets?.[0] === '既有标签', '既有标签不得被默认配置覆盖')
}

export async function testExistingDesktopSnapshotNeverTriggersBootstrap(): Promise<void> {
  const existing = snapshotWithEmptyTrades([{
    id: 'desktop-custom',
    name: '桌面已有策略',
    icon: 'gauge',
    color: '#654321',
  }], '桌面用户')
  const target = new MemoryAdapter(existing)
  const indexedDb = new MemoryAdapter(null)

  const migrated = await migrateElectronLibraryIfNeeded(target, indexedDb)

  assert(!migrated, '桌面快照存在时不得再次 bootstrap')
  assert(target.saves === 0, '既有桌面快照不得被重写')
  assert(indexedDb.opened === 0, '既有桌面快照存在时不应读取旧 IndexedDB')
  assert(target.snapshot === existing, '既有桌面快照引用必须保持不变')
}

export async function testLegacyLocalStorageWithTradesAndEmptyStrategiesRepairsReferences(): Promise<void> {
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  if (previousDescriptor && !previousDescriptor.configurable) return
  const values = new Map<string, string>()
  const localStorageStub: Storage = {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) },
  }
  const legacyTrade: Trade = {
    id: 'legacy-trade',
    ref: 'TRD-LEGACY',
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'planned',
    conviction: 'medium',
    strategyId: 'missing-strategy',
    tradeKind: 'live',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    entry: 100,
    exit: null,
    size: 1,
    pnl: null,
    rMultiple: null,
    openedAt: '2026-07-16',
    closedAt: null,
    note: '',
  }
  localStorageStub.setItem(LEGACY_LOCAL_STORAGE_KEY, JSON.stringify({
    state: {
      trades: [legacyTrade],
      strategies: [],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: DEFAULT_DISPLAY,
    },
  }))
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: localStorageStub,
  })

  const target = new MemoryAdapter(null)
  try {
    await migrateFromLocalStorageIfNeeded(target)
    assert(target.snapshot?.strategies.length === 1, '有交易的旧 localStorage 必须补中性策略')
    assert(
      target.snapshot?.strategies.some(
        (strategy) => strategy.id === target.snapshot?.trades[0]?.strategyId,
      ),
      '旧 localStorage 迁移后的交易不得形成悬空策略引用',
    )
  } finally {
    if (previousDescriptor) Object.defineProperty(globalThis, 'localStorage', previousDescriptor)
    else delete (globalThis as { localStorage?: Storage }).localStorage
  }
}

export async function testLegacyLocalStorageTerminalLiveTradeUsesCanonicalV8Migration(): Promise<void> {
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  if (previousDescriptor && !previousDescriptor.configurable) return
  const values = new Map<string, string>()
  const localStorageStub: Storage = {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) },
  }
  const terminalTrade: Trade = {
    id: 'legacy-terminal-live',
    ref: 'TRD-LEGACY-CLOSED',
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'loss',
    conviction: 'medium',
    strategyId: 'strategy-1',
    tradeKind: 'live',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    entry: 100,
    exit: null,
    size: 1,
    pnl: -100,
    rMultiple: null,
    resultSource: 'pnl',
    openedAt: '2026-07-26T08:00:00+08:00',
    closedAt: '2026-07-27T05:30:00+08:00',
    note: '',
  }
  localStorageStub.setItem(LEGACY_LOCAL_STORAGE_KEY, JSON.stringify({
    state: {
      trades: [terminalTrade],
      strategies: [{ id: 'strategy-1', name: '旧策略', icon: 'target', color: '#5e6ad2' }],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: { ...DEFAULT_DISPLAY, tradingDayStartHour: 6 },
    },
  }))
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: localStorageStub,
  })

  const target = new MemoryAdapter(null)
  try {
    await migrateFromLocalStorageIfNeeded(target)
    assert(
      target.snapshot?.trades[0]?.closedTradingDayKey === '2026-07-26',
      'legacy localStorage 必须经 v8 中央 codec 固化终态 live 业务日',
    )
    assert(target.snapshot?.riskPolicyVersions.length === 0, '中央迁移必须补齐 v9 风险数组')
  } finally {
    if (previousDescriptor) Object.defineProperty(globalThis, 'localStorage', previousDescriptor)
    else delete (globalThis as { localStorage?: Storage }).localStorage
  }
}

export async function testDashboardDisclosesTheSingleUsdReportCurrency(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/views/Dashboard.tsx', 'utf8')
  assert(source.includes('报告币种 USD'), '统计页必须明确当前只使用 USD 报告币种')
}

export async function testDesktopLegacyMigrationRetriesOneCompleteAttachmentBatch(): Promise<void> {
  const original = snapshotWithEmptyTrades([], '原资料')
  original.quickNotes = [{
    id: 'legacy-note', title: '旧随记', pinned: false, createdAt: '2026-07-16', updatedAt: '2026-07-16',
    contentHtml: '<img src="journal-asset://shared"><img src="journal-asset://missing"><img src="data:image/GIF;base64,AQID">',
  }]
  const before = JSON.stringify(original)
  const source = new MemoryAdapter(original)
  source.getAssetForExport = async id => id === 'shared' ? { id, mime: 'image/png', data: 'BAUG' } : null
  const target = new MemoryAdapter(null)
  const failure = new Error('isolated commit failure')
  let attempts = 0
  target.commitImport = async (candidate, assets) => {
    attempts++
    assert(assets.length === 2, '旧附件和内嵌图应进入同一批次')
    const [shared, image] = assets
    assert(shared.id === 'shared' && shared.data === 'BAUG' && !shared.inlineImage, '现有附件须保留身份和字节')
    assert(image.inlineImage && image.data === 'AQID' && image.mime === 'image/GIF', '新附件须保留内嵌图片的来源和字节')
    assert(candidate.quickNotes?.[0].contentHtml ===
      `<img src="journal-asset://shared"><img src="journal-asset://missing"><img src="journal-asset://${image.id}">`,
      '正文应引用当次准备的图片并保留历史缺图引用')
    if (attempts === 1) throw failure
    target.snapshot = candidate
  }
  const first = await migrateElectronLibraryIfNeeded(target, source).catch(error => error)
  assert(first === failure && target.snapshot === null && target.saves === 0, '首次失败应保留空目标且不执行额外的快照保存')
  assert(await migrateElectronLibraryIfNeeded(target, source), '应能从完整原库重试')
  assert(Number(attempts) === 2 && JSON.stringify(source.snapshot) === before, '两次尝试均不得修改来源正文')
}
