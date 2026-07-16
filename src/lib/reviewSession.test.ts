import type { Trade } from '@/data/trades'
import { resolveTradeDetailReturn } from '@/lib/tradeRoute'
import {
  DEFAULT_REVIEW_SESSION_FILTERS,
  buildReviewSessionPool,
  clearReviewSessionStorage,
  loadReviewSession,
  reconcileReviewSession,
  reviewSessionKeyAction,
  reviewSessionStorageKey,
  saveReviewSession,
  shuffleReviewSessionIds,
  type ReviewSessionSnapshot,
} from '@/lib/reviewSession'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const baseTrade: Trade = {
  id: 'live-1',
  ref: 'TRD-1',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId: 'strategy-1',
  tradeKind: 'live',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'reviewed',
  reviewCategory: 'normal',
  entry: 100,
  exit: 110,
  size: 1,
  pnl: 100,
  rMultiple: 2,
  openedAt: '2026-07-01',
  closedAt: '2026-07-02',
  note: '',
}

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

function keyEvent(
  key: string,
  overrides: Partial<KeyboardEvent> = {},
): KeyboardEvent {
  return {
    key,
    keyCode: 0,
    target: null,
    defaultPrevented: false,
    repeat: false,
    isComposing: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent
}

export function testReviewSessionDefaultPoolIncludesCasesAndAccountTradesOnly(): void {
  const trades: Trade[] = [
    baseTrade,
    { ...baseTrade, id: 'paper-1', ref: 'TRD-2', tradeKind: 'paper' },
    { ...baseTrade, id: 'case-1', ref: 'CAS-1', tradeKind: 'case' },
    {
      ...baseTrade,
      id: 'deleted-1',
      ref: 'TRD-3',
      deletedAt: '2026-07-16T00:00:00.000Z',
    },
  ]

  const pool = buildReviewSessionPool(
    trades,
    DEFAULT_REVIEW_SESSION_FILTERS,
    new Set(),
  )

  assert(pool.map((trade) => trade.id).join(',') === 'live-1,paper-1,case-1',
    '默认池应包含未删除的案例、实盘和模拟交易')
}

export function testReviewSessionContentFilterKeepsTextAndImageNotes(): void {
  const filters = {
    ...DEFAULT_REVIEW_SESSION_FILTERS,
    requireContent: true,
  }
  const trades: Trade[] = [
    { ...baseTrade, id: 'empty', note: '<p> &nbsp; </p>' },
    { ...baseTrade, id: 'text', note: '<p>假突破后没有追单</p>' },
    { ...baseTrade, id: 'image', note: '<p></p><img src="journal-asset://chart-1">' },
  ]

  const pool = buildReviewSessionPool(trades, filters, new Set())

  assert(pool.map((trade) => trade.id).join(',') === 'text,image',
    '仅含有效图文应保留正文笔记和纯图片笔记')
}

export function testReviewSessionCaseScopeUsesSharedStarredFocusRule(): void {
  const cases: Trade[] = [
    { ...baseTrade, id: 'starred-case', ref: 'CAS-1', tradeKind: 'case' },
    {
      ...baseTrade,
      id: 'ordinary-case',
      ref: 'CAS-2',
      tradeKind: 'case',
      reviewCategory: 'normal',
    },
  ]
  const pool = buildReviewSessionPool(cases, {
    ...DEFAULT_REVIEW_SESSION_FILTERS,
    includeAccountTrades: false,
    caseScope: 'focus',
  }, new Set(['starred-case']))

  assert(pool.map((trade) => trade.id).join(',') === 'starred-case',
    '重点 scope 应与案例页一致地包含星标案例')
}

export function testReviewSessionShufflePreservesUniqueMembershipAndInput(): void {
  const input = ['a', 'b', 'c', 'd']
  const shuffled = shuffleReviewSessionIds(input, () => 0)

  assert(input.join(',') === 'a,b,c,d', '洗牌不得修改输入数组')
  assert(shuffled.join(',') === 'b,c,d,a', 'Fisher–Yates 应按注入的随机数移动成员')
  assert(new Set(shuffled).size === input.length, '单轮队列不得出现重复 id')
}

export function testReviewSessionStorageIsVersionedAndIsolatedByLibrary(): void {
  const storage = new MemoryStorage()
  const snapshot: ReviewSessionSnapshot = {
    ids: ['case-1', 'live-1'],
    cursor: 1,
    filters: DEFAULT_REVIEW_SESSION_FILTERS,
    flipped: true,
  }

  const runtimeSnapshot = Object.assign({}, snapshot, { transientTrade: baseTrade })
  assert(saveReviewSession('library-a', runtimeSnapshot, storage), '可用 sessionStorage 应保存成功')
  assert(loadReviewSession('library-a', storage)?.cursor === 1, '同一资料库应恢复当前进度')
  assert(loadReviewSession('library-b', storage) === null, '其他资料库不得读取当前队列')
  assert(reviewSessionStorageKey('library-a').includes(':v1:'), '会话存储键必须包含版本')

  const raw = storage.getItem(reviewSessionStorageKey('library-a')) ?? ''
  assert(Object.keys(JSON.parse(raw)).sort().join(',') === 'cursor,filters,flipped,ids',
    '会话只应保存 ids、cursor、filters 与 flipped')
}

export function testReviewSessionStorageFailuresDegradeSafely(): void {
  const corrupt = new MemoryStorage()
  corrupt.setItem(reviewSessionStorageKey('library-a'), '{bad json')
  assert(loadReviewSession('library-a', corrupt) === null, '损坏数据应忽略并回到开始面板')
  assert(corrupt.getItem(reviewSessionStorageKey('library-a')) === null, '损坏数据应安全清除')

  const unavailable = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('quota') },
    removeItem: () => { throw new Error('blocked') },
  }
  const snapshot: ReviewSessionSnapshot = {
    ids: ['live-1'],
    cursor: 0,
    filters: DEFAULT_REVIEW_SESSION_FILTERS,
    flipped: false,
  }
  assert(!saveReviewSession('library-a', snapshot, unavailable), '配额失败不得中断会话')
  assert(loadReviewSession('library-a', unavailable) === null, '不可用存储应降级为无恢复能力')
  assert(!clearReviewSessionStorage('library-a', unavailable), '清理失败不得向整库恢复流程抛错')
}

export function testReviewSessionStorageClearIsScopedToCurrentLibrary(): void {
  const storage = new MemoryStorage()
  const snapshot: ReviewSessionSnapshot = {
    ids: ['live-1'],
    cursor: 0,
    filters: DEFAULT_REVIEW_SESSION_FILTERS,
    flipped: false,
  }
  saveReviewSession('library-a', snapshot, storage)
  saveReviewSession('library-b', snapshot, storage)

  assert(clearReviewSessionStorage('library-a', storage), '当前资料库会话应可安全清理')
  assert(loadReviewSession('library-a', storage) === null, '整库恢复后不得恢复旧队列')
  assert(loadReviewSession('library-b', storage) !== null, '清理不得影响其他资料库的隔离会话')
}

export function testReviewSessionKeyboardActionsExcludeEditingAndModifiedInput(): void {
  assert(reviewSessionKeyAction(keyEvent(' ')) === 'flip', 'Space 应翻面')
  assert(reviewSessionKeyAction(keyEvent('n')) === 'next', 'N 应进入下一张')
  assert(reviewSessionKeyAction(keyEvent('ArrowRight')) === 'next', '右方向键应进入下一张')
  assert(reviewSessionKeyAction(keyEvent('n', { repeat: true })) === null, '长按重复事件应忽略')
  assert(reviewSessionKeyAction(keyEvent('n', { isComposing: true })) === null, '输入法组合态应忽略')
  assert(reviewSessionKeyAction(keyEvent('n', { keyCode: 229 })) === null, '输入法 229 事件应忽略')
  assert(reviewSessionKeyAction(keyEvent('n', { ctrlKey: true })) === null, '带修饰键事件应忽略')
  assert(reviewSessionKeyAction(keyEvent('n', {
    target: { tagName: 'INPUT', isContentEditable: false, closest: () => null } as unknown as EventTarget,
  })) === null, '输入框中的 N 不得推进卡片')
  assert(reviewSessionKeyAction(keyEvent(' ', {
    target: {
      tagName: 'BUTTON',
      isContentEditable: false,
      closest: (selector: string) => selector.includes('button') ? {} : null,
    } as unknown as EventTarget,
  })) === null, '按钮获得焦点时 Space 必须保留原生激活行为')
}

export function testReviewSessionRestoreDropsUnavailableRecordsWithoutLosingCurrentCard(): void {
  const snapshot: ReviewSessionSnapshot = {
    ids: ['deleted', 'case-1', 'live-1', 'missing'],
    cursor: 2,
    filters: DEFAULT_REVIEW_SESSION_FILTERS,
    flipped: true,
  }
  const trades: Trade[] = [
    { ...baseTrade, id: 'deleted', deletedAt: '2026-07-16T00:00:00.000Z' },
    { ...baseTrade, id: 'case-1', ref: 'CAS-1', tradeKind: 'case' },
    baseTrade,
  ]

  const restored = reconcileReviewSession(snapshot, trades, new Set())

  assert(restored?.ids.join(',') === 'case-1,live-1', '恢复时应剔除删除或不存在的记录')
  assert(restored?.cursor === 1, '剔除前序记录后仍应停留在同一张卡')
  assert(restored?.flipped === true, '有效当前卡应保留翻转状态')
}

export function testReviewSessionIsAValidDetailReturnForCasesAndTrades(): void {
  for (const tradeKind of ['case', 'live', 'paper'] as const) {
    const target = resolveTradeDetailReturn({
      from: { pathname: '/review-session', search: '' },
      tradeKind,
    })
    assert(target.pathname === '/review-session', `${tradeKind} 详情应返回随机复盘`)
  }
}
