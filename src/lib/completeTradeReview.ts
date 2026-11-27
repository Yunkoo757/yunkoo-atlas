import { evaluateReviewCompletion } from './reviewCompletion'
import { isPendingReviewTrade } from './tradeWorkflow'
import { flushNoteDraftToStore, noteDraftKey } from '@/storage/noteDrafts'
import { useStore } from '@/store/useStore'

/** 同库内翻到另一条记录仍可完成原复盘；整库被替换后，旧请求不能修改同 ID 的新记录。 */
export async function completeTradeReview(tradeId: string, librarySession: number) {
  if (useStore.getState().librarySession !== librarySession) return 'superseded'
  const saved = await flushNoteDraftToStore(noteDraftKey('trade', tradeId))
  const state = useStore.getState()
  if (state.librarySession !== librarySession) return 'superseded'
  if (!saved) return 'draft-failed'
  const trade = state.trades.find(item => item.id === tradeId)
  if (!trade || !isPendingReviewTrade(trade)) return 'superseded'
  const readiness = evaluateReviewCompletion(trade.note)
  if (!readiness.ready) return readiness.reason
  state.updateTradeData(trade.id, { reviewStatus: 'reviewed' })
  return 'completed'
}
