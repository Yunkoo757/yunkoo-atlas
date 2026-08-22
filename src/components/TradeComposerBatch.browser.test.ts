import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { TradeComposer } from '@/components/TradeComposer'
import { commitComposerTradeBatch } from '@/lib/tradeComposerCommit'
import { pickPersisted } from '@/storage/persist'
import { StorageRevisionConflictError } from '@/storage/adapter'
import { IndexedDbStorageAdapter } from '@/storage/indexedDbAdapter'
import { getStorage } from '@/storage/provider'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'

declare global {
  interface Window {
    __tradeComposerBatchTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await waitForFrame()
  }
  throw new Error(message)
}

function findButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === label)
}

function candidateTrade(id: string, imageHtml: string, attachCurrentStage = true): Trade {
  const candidate: Trade = {
    id,
    ref: 'TRD-1',
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'planned',
    conviction: 'medium',
    strategyId: useStore.getState().strategies[0]?.id ?? '',
    tradeKind: 'live',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    entry: 0,
    exit: null,
    stopLoss: null,
    size: 0,
    pnl: null,
    rMultiple: null,
    timeframe: '1H',
    session: '',
    openedAt: '2026-07-22',
    closedAt: null,
    note: imageHtml,
  }
  return attachCurrentStage
    ? { ...candidate, liveStageId: useStore.getState().currentLiveStageId }
    : candidate
}

async function run(): Promise<void> {
  const databaseName = `composer-cas-${crypto.randomUUID()}`
  const staleComposer = new IndexedDbStorageAdapter(databaseName)
  const winner = new IndexedDbStorageAdapter(databaseName)
  const composerStorage = getStorage()
  await staleComposer.open()
  await winner.open()
  await composerStorage.open()
  const originalState = useStore.getState()
  let root: Root | null = null
  let rootElement: HTMLDivElement | null = null
  try {
    useStore.setState({ trades: [] })
    const initial = pickPersisted(useStore.getState(), useShortcutStore.getState().bindings)
    await winner.saveSnapshot(initial)
    assert((await staleComposer.loadSnapshotEnvelope()).revision === 1, 'Composer 必须先持有旧 revision')
    await winner.saveSnapshot({
      ...initial,
      profile: {
        avatarId: initial.profile?.avatarId ?? null,
        customAvatarDataUrl: initial.profile?.customAvatarDataUrl ?? null,
        displayName: '并发赢家',
        legacyCashCurrencyAssumption: initial.profile?.legacyCashCurrencyAssumption ?? null,
      },
    })

    let error: unknown
    try {
      await commitComposerTradeBatch({
        targetTradeId: 'composer-stale-trade',
        images: [{ file: new Blob(['composer-image'], { type: 'image/png' }), mime: 'image/png' }],
        storage: staleComposer,
        createAssetId: () => 'composer-stale-asset',
        buildTrade: (_state, imageHtml) => {
          const candidate = candidateTrade('composer-stale-trade', imageHtml, false)
          assert(!Object.prototype.hasOwnProperty.call(candidate, 'liveStageId'), 'stale 候选不得预填阶段')
          return candidate
        },
      })
    } catch (caught) {
      error = caught
    }

    assert(
      error instanceof StorageRevisionConflictError,
      `Composer stale commit 必须返回 typed CAS conflict；实际为 ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
    )
    const observed = await winner.loadSnapshotEnvelope()
    assert(observed.revision === 2, 'Composer 冲突不得推进赢家 revision')
    assert(observed.snapshot?.profile?.displayName === '并发赢家', 'Composer 冲突不得覆盖赢家快照')
    assert(observed.snapshot?.trades.length === 0, 'Composer 冲突不得部分新增交易')
    assert(await winner.getAssetForExport('composer-stale-asset') === null, 'Composer 冲突不得留下新孤儿附件')
    assert(useStore.getState().trades.length === 0, 'Composer 冲突不得发布候选交易到 Store')

    const recheckCase: Trade = {
      ...candidateTrade('composer-recheck-case', ''),
      ref: 'CAS-1',
      status: 'win',
      tradeKind: 'case',
      caseType: 'mistake',
      masteryState: 'recheck',
      nextReviewAt: '2026-08-18',
      reviewCategory: 'recheck',
    }
    useStore.setState({
      trades: [recheckCase],
      symbolCatalog: ['BTCUSDT'],
      composerOpen: true,
      composerTrade: recheckCase,
      composerKind: 'case',
    })
    rootElement = document.createElement('div')
    document.body.append(rootElement)
    root = createRoot(rootElement)
    root.render(createElement(MemoryRouter, null, createElement(TradeComposer)))
    await waitFor(() => Boolean(findButton('保存')), '案例 Composer 未就绪')
    findButton('保存')?.click()
    await waitFor(() => !useStore.getState().composerOpen, '案例 Composer 未完成保存')
    const saved = useStore.getState().trades.find((trade) => trade.id === recheckCase.id)!
    assert(saved.masteryState === 'recheck', 'Composer 保存不得改写原掌握状态')
    assert(saved.reviewCategory === 'recheck', 'Composer 普通保存必须原样保留兼容分类')
    assert(saved.reviewStatus === 'unreviewed', 'Composer 普通保存必须原样保留兼容状态')

    const legacyFocusCase: Trade = {
      ...recheckCase,
      id: 'composer-legacy-focus-case',
      ref: 'CAS-2',
      masteryState: 'new',
      reviewCategory: 'focus',
      reviewStatus: 'focus',
    }
    useStore.setState({
      trades: [legacyFocusCase],
      starredIds: [],
      composerOpen: true,
      composerTrade: legacyFocusCase,
      composerKind: 'case',
    })
    await waitFor(() => Boolean(findButton('保存')), 'legacy focus 案例 Composer 未就绪')
    findButton('保存')?.click()
    await waitFor(() => !useStore.getState().composerOpen, 'legacy focus 案例 Composer 未完成普通保存')
    const preservedState = useStore.getState()
    const preserved = preservedState.trades.find((trade) => trade.id === legacyFocusCase.id)!
    assert(preserved.reviewCategory === 'focus', 'legacy focus 普通保存不得洗掉兼容分类')
    assert(preserved.reviewStatus === 'focus', 'legacy focus 普通保存不得洗掉兼容状态')
    assert(!preservedState.starredIds.includes(legacyFocusCase.id), 'legacy focus 普通保存不得误升星')

    useStore.setState({
      composerOpen: true,
      composerTrade: preserved,
      composerKind: 'case',
    })
    const notifications: Array<{ category: Trade['reviewCategory']; starred: boolean }> = []
    const unsubscribe = useStore.subscribe((state) => {
      const current = state.trades.find((trade) => trade.id === legacyFocusCase.id)
      if (current) {
        notifications.push({
          category: current.reviewCategory,
          starred: state.starredIds.includes(legacyFocusCase.id),
        })
      }
    })
    try {
      await waitFor(
        () => Boolean(document.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="案例类型"]')),
        'legacy focus 分类编辑 Composer 未就绪',
      )
      document.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="案例类型"]')?.click()
      await waitFor(
        () => Boolean(document.querySelector<HTMLButtonElement>('[role="option"][data-value="ambiguous"]')),
        '案例类型选项未打开',
      )
      document.querySelector<HTMLButtonElement>('[role="option"][data-value="ambiguous"]')?.click()
      await waitFor(
        () => document.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="案例类型"]')?.dataset.value === 'ambiguous',
        '显式案例类型修改没有进入 Composer 状态',
      )
      findButton('保存')?.click()
      await waitFor(() => !useStore.getState().composerOpen, 'legacy focus 分类修改未完成保存')
    } finally {
      unsubscribe()
    }
    const promotedState = useStore.getState()
    const promoted = promotedState.trades.find((trade) => trade.id === legacyFocusCase.id)!
    assert(promoted.caseType === 'ambiguous', '显式案例类型修改必须保存新分类字段')
    assert(promoted.reviewCategory === 'ambiguous', '显式分类修改必须规范化兼容分类')
    assert(promoted.reviewStatus === 'unreviewed', '显式分类修改必须规范化兼容状态')
    assert(promotedState.starredIds.includes(legacyFocusCase.id), '显式分类修改必须同次升星 legacy focus')
    assert(
      !notifications.some((state) => state.category === 'ambiguous' && !state.starred),
      'Composer 不得通知规范化已完成但 focus 未升星的中间状态',
    )
  } finally {
    root?.unmount()
    rootElement?.remove()
    useStore.setState(originalState)
    staleComposer.close()
    winner.close()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}

window.__tradeComposerBatchTest = run()
