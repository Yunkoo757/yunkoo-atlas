import type { SavedTradeView } from '@/lib/savedTradeViews'
import { getJournalViewState, journalBuiltinTarget, resolveJournalView } from './journalQuickViews'

const saved: SavedTradeView = {
  id: 'xau', name: '黄金', pathname: '/list', search: { symbol: 'XAUUSD' },
  pinned: false, order: 0, createdAt: '', updatedAt: '',
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

export function testJournalResolvesExplicitViewsAndAdditionalFilters(): void {
  const copies = [saved, { ...saved, id: 'second' }]
  const state = { journalView: { type: 'saved', id: 'second' } }
  const active = (query: string, selection?: unknown) =>
    resolveJournalView('trade', '/board', query, undefined, copies, selection)
  assert(getJournalViewState({ journalView: 'xau' }) === undefined, '无效历史状态必须回退')
  assert(active('symbol=XAUUSD&status=loss', state)?.id === 'second', '同条件的保存视图不能抢走用户明确选中的名称')
  assert(active('symbol=EURUSD&status=loss', state)?.id === 'loss', '覆盖保存条件后应回到真实筛选范围')
  assert(active('symbol=XAUUSD&liveStage=archive', state)?.saved === undefined, '切换阶段后不应保留原阶段视图身份')
  assert(active('symbol=XAUUSD&status=loss')?.id === 'loss', '没有显式选择时不应推断子集属于已保存视图')
  assert(active('symbol=XAUUSD')?.saved?.id === saved.id, '旧书签完全匹配时仍应识别原保存视图')
  assert(active('view=starred&status=loss')?.id === 'starred', '旧链接应优先识别实际星标集合')
  assert(active('symbol=EURUSD')?.id === 'all', '附加品种筛选仍应显示所在的基础视图')
}

export function testUnifiedPaperJournalSupportsBothGenerationsOfSavedViews(): void {
  const views: SavedTradeView[] = [
    { ...saved, id: 'legacy', pathname: '/sim', search: { session: 'asia' } },
    { ...saved, id: 'current', search: { kind: 'paper', session: 'london', liveStage: 'archive' } },
  ]
  const resolve = (query: string) => resolveJournalView('paper', '/board', query, undefined, views)
  assert(resolve('kind=paper&session=asia')?.id === 'legacy', '统一模拟看板应识别旧路径保存视图')
  assert(resolve('kind=paper&session=london&liveStage=archive')?.id === 'current', '统一模拟日志保存的新视图保留阶段')
  assert(resolveJournalView('trade', '/list', 'session=asia', undefined, views)?.saved === undefined, '模拟保存视图不得抢实盘选中态')
  const target = journalBuiltinTarget({ id: 'today', label: '今日', pathname: '/today-record' })
  assert(target.pathname === '/list' && new URLSearchParams(target.search).get('period') === 'today', '今日视图应筛选今日交易')
}

export function testJournalMatchesImplicitAndExplicitDefaultScope(): void {
  const explicit = { ...saved, search: { symbol: 'XAUUSD', kind: 'live', liveStage: 'current' } }
  const state = { journalView: { type: 'saved', id: saved.id } }
  const resolve = (view: SavedTradeView, query: string, locationState?: unknown) =>
    resolveJournalView('trade', '/board', query, undefined, [view], locationState)?.saved?.id
  assert(resolve(explicit, 'symbol=XAUUSD') === saved.id, '省略默认范围的旧链接应认出显式范围的保存视图')
  assert(resolve(saved, 'symbol=XAUUSD&kind=live&liveStage=current') === saved.id, '显式默认范围的旧链接应认出省略范围的保存视图')
  assert(resolve(explicit, 'symbol=XAUUSD&side=long', state) === saved.id, '已选择的显式默认视图可在默认范围内增加条件')
  assert(resolve(saved, 'symbol=XAUUSD&kind=live&liveStage=current&side=long', state) === saved.id, '显式默认范围可叠加条件')
  assert(resolve(explicit, 'symbol=XAUUSD&kind=all', state) === undefined, '所有记录类型不能误认为实盘')
}
