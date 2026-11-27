import { completeWeeklyReviewCandidate, type WeeklyReview } from '@/data/weeklyReviews'
import { flushNoteDraftToStore, noteDraftKey } from '@/storage/noteDrafts'
import { useStore } from '@/store/useStore'
import { getWeeklyReviewCompletionIssue } from './weeklyReviewCompletion'

type Submission =
  | { status: 'completed' | 'superseded' }
  | { status: 'blocked'; review: WeeklyReview; draftSaved: boolean }

/** 保存后重读提交来源。切换页面可完成原周，替代记录和已冻结快照不能接受这次提交。 */
export async function submitWeeklyReview(source: WeeklyReview, librarySession: number): Promise<Submission> {
  const initial = useStore.getState()
  if (initial.librarySession !== librarySession) return { status: 'superseded' }
  const matchesSource = (review: WeeklyReview) =>
    review.id === source.id && review.weekStart === source.weekStart && review.liveStageId === source.liveStageId
  const originallyStored = initial.weeklyReviews.some(matchesSource)
  const draftSaved = await flushNoteDraftToStore(noteDraftKey('weeklyReview', source.id))
  const state = useStore.getState()
  if (state.librarySession !== librarySession) return { status: 'superseded' }
  const latest = state.weeklyReviews.find(matchesSource)
  if (originallyStored !== Boolean(latest) || latest?.status === 'completed') return { status: 'superseded' }

  // 未填写的周只有页面上的空文档；点击完成应给出字段提示，不创建记录。
  const review = latest ?? source
  if (getWeeklyReviewCompletionIssue(review, draftSaved)) return { status: 'blocked', review, draftSaved }
  if (!latest) return { status: 'superseded' }
  const { weeklyReviews } = completeWeeklyReviewCandidate(state, latest.id)
  useStore.setState({ weeklyReviews })
  return { status: 'completed' }
}
