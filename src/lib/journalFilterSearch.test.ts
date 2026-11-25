import { getJournalFilterResetSearch } from '@/lib/journalFilterSearch'
import type { SavedTradeView } from '@/lib/savedTradeViews'

function checkReset(path: string, search: string, expected: string, saved?: SavedTradeView[], state?: unknown): void {
  const reset = getJournalFilterResetSearch(path, search, undefined, saved, state).toString()
  if (reset !== expected) throw new Error(`清除附加条件应得到 ${expected}，实际为 ${reset}`)
}

export function testJournalResetRetainsNamedViewScopeAndOnlyItsConditions(): void {
  for (const path of ['/list', '/board']) {
    checkReset(path, 'kind=live&liveStage=old&status=loss&symbol=XAUUSD', 'kind=live&liveStage=old&status=loss')
    checkReset(path, 'kind=paper&status=planned&side=long', 'kind=paper&status=planned')
    checkReset(path, 'strategyId=strategy&liveStage=all&symbol=EURUSD', 'liveStage=all')
    checkReset(path, 'session=london&tag=entry', 'session=london')
    checkReset(path, 'view=starred&symbol=BTCUSDT', 'view=starred')
    const goldView: SavedTradeView = {
      id: 'gold', pathname: '/list', search: { symbol: 'XAUUSD' }, name: '黄金',
      pinned: true, order: 0, createdAt: '', updatedAt: '',
    }
    checkReset(path, 'symbol=XAUUSD', 'symbol=XAUUSD', [goldView])
    checkReset(path, 'symbol=XAUUSD&side=short', 'symbol=XAUUSD', [goldView], {
      journalView: { type: 'saved', id: goldView.id },
    })
    checkReset(path, 'symbol=EURUSD&side=short', '', [goldView], {
      journalView: { type: 'saved', id: goldView.id },
    })
    checkReset(path, 'period=this-week&status=loss&symbol=XAUUSD', 'status=loss', [], {
      journalView: { type: 'builtin', id: 'loss' },
    })
    checkReset(path, 'view=starred&status=loss', 'view=starred')
  }
}
