import type { Trade } from '@/data/trades'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import { applyTradeUpsertsToSlice, useStore, type TradeUpsertSlice } from '@/store/useStore'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function plannedTrade(id: string, kind: 'live' | 'paper' = 'live'): Trade {
  const fixture = createFullPersistedSnapshotFixture()
  const base = fixture.trades[0]!
  const { liveStageId: _stage, ...fields } = base as Trade & { liveStageId?: string | null }
  return {
    ...fields,
    id,
    tradeKind: kind,
    ...(kind === 'live' ? { liveStageId: fixture.currentLiveStageId } : {}),
    status: 'planned',
    closedAt: null,
    closedTradingDayKey: undefined,
    pnl: null,
    rMultiple: null,
    activities: [],
  } as Trade
}

function slice(trades: Trade[]): TradeUpsertSlice {
  const fixture = createFullPersistedSnapshotFixture()
  return { trades, strategies: fixture.strategies, symbolCatalog: [], tagPresets: [], mistakeTagPresets: [] }
}

function comparable(value: TradeUpsertSlice): string {
  return JSON.stringify({
    ...value,
    trades: value.trades.map((trade) => ({
      ...trade,
      activities: trade.activities?.map(({ id: _id, ...event }) => event),
    })),
  })
}

export function testBatchUpsertMatchesSequentialSingleWritesWithoutMutatingInputs(): void {
  const originalStore = useStore.getState()
  const fixture = createFullPersistedSnapshotFixture()
  const initial = slice(Array.from({ length: 120 }, (_, index) => plannedTrade(`existing-${index}`)))
  const incoming = Array.from({ length: 180 }, (_, index) => {
    const id = index % 3 === 0 ? `existing-${index % 120}` : `new-${index % 45}`
    return { ...plannedTrade(id, index % 11 === 0 ? 'paper' : 'live'), note: `笔记 ${index}`, symbol: index % 2 ? 'EURUSD' : 'BTCUSDT' }
  })
  const originalInput = JSON.stringify({ initial, incoming })
  try {
    useStore.setState({ ...fixture, ...initial })
    for (const trade of incoming) useStore.getState().upsertTrade(trade)
    const state = useStore.getState()
    const sequential: TradeUpsertSlice = {
      trades: state.trades,
      strategies: state.strategies,
      symbolCatalog: state.symbolCatalog,
      tagPresets: state.tagPresets,
      mistakeTagPresets: state.mistakeTagPresets,
    }
    const batch = applyTradeUpsertsToSlice(initial, incoming, state.display.tradingDayStartHour, fixture.currentLiveStageId)
    assert(comparable(batch) === comparable(sequential), '批量更新必须保持单条写入的顺序、重复 ID、类型保护、归一化及阶段语义')
    assert(JSON.stringify({ initial, incoming }) === originalInput, '批量更新不得修改输入交易或初始快照')
  } finally {
    useStore.setState(originalStore)
  }
}

export function testBatchUpsertPreservesNewRecordOrderAndUnchangedReferences(): void {
  const initial = slice([plannedTrade('existing'), plannedTrade('untouched')])
  const batch = applyTradeUpsertsToSlice(initial, [
    plannedTrade('first'),
    plannedTrade('second'),
    { ...plannedTrade('first'), note: '同批次最后一次编辑' },
    { ...plannedTrade('existing'), note: '更新已有记录' },
  ])
  assert(batch.trades.map((trade) => trade.id).join(',') === 'second,first,existing,untouched', '新增记录按首次插入倒序排列，重复更新不得移动位置')
  assert(batch.trades[1]!.note === '同批次最后一次编辑', '重复 ID 必须保留顺序处理后的最新内容')
  assert(batch.trades[3] === initial.trades[1], '未变交易必须保留对象引用')
  assert(applyTradeUpsertsToSlice(initial, []) === initial, '空批次必须保留原始引用')
  assert(applyTradeUpsertsToSlice(initial, [plannedTrade('existing', 'paper')]) === initial, '全部被类型保护拒绝的批次必须保留原始引用')
}

export function testNonInteractiveBatchImportRetainsHistoricalAndPaperOwnership(): void {
  const originalStore = useStore.getState()
  const fixture = createFullPersistedSnapshotFixture()
  const historical = { ...plannedTrade('historical'), liveStageId: null } as Trade
  try {
    useStore.setState({ ...fixture, ...slice([historical]) })
    useStore.getState().upsertTradesFromNonInteractiveImport([
      { ...historical, liveStageId: 'foreign-stage', note: '保留待整理归属' } as Trade,
      { ...plannedTrade('new-live'), liveStageId: 'foreign-stage' } as Trade,
      { ...plannedTrade('new-paper', 'paper'), liveStageId: 'foreign-stage' } as unknown as Trade,
    ])
    const state = useStore.getState()
    const historicalResult = state.getById('historical')
    const newLiveResult = state.getById('new-live')
    assert(historicalResult?.tradeKind === 'live' && historicalResult.liveStageId === null, '已有待整理归属不得被批量导入改写')
    assert(newLiveResult?.tradeKind === 'live' && newLiveResult.liveStageId === fixture.currentLiveStageId, '新增实盘交易必须归属当前阶段')
    assert(!Object.prototype.hasOwnProperty.call(state.getById('new-paper'), 'liveStageId'), '纸面交易必须移除阶段字段')
  } finally {
    useStore.setState(originalStore)
  }
}
