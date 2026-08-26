import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Select } from '@/components/ui/Select'
import {
  parseTradeWorkspaceQuery,
  writeTradeWorkspaceContext,
  type TradeWorkspaceKind,
  type TradeWorkspacePage,
} from '@/lib/tradeWorkspaceQuery'
import { useStore } from '@/store/useStore'
import './TradeWorkspaceContext.css'

const KIND_OPTIONS: Array<{ value: TradeWorkspaceKind; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'live', label: '实盘' },
  { value: 'paper', label: '模拟' },
]

export function TradeWorkspaceContext({ page }: { page: TradeWorkspacePage }) {
  const location = useLocation()
  const navigate = useNavigate()
  const liveStages = useStore((state) => state.liveStages)
  const currentLiveStageId = useStore((state) => state.currentLiveStageId)
  const weeklyReviews = useStore((state) => state.weeklyReviews)
  const query = useMemo(
    () => parseTradeWorkspaceQuery(location.search, liveStages, currentLiveStageId),
    [currentLiveStageId, liveStages, location.search],
  )
  const params = new URLSearchParams(location.search)
  const linkedReviewStageId = page === 'review' && !params.has('liveStage')
    ? weeklyReviews.find((review) => review.id === params.get('review'))?.liveStageId
    : undefined
  const contextStage = linkedReviewStageId ?? query.stage
  const archived = [...liveStages]
    .filter((stage) => stage.status === 'archived')
    .sort((left, right) => right.sequence - left.sequence)
  const stageOptions = [
    { value: 'current', label: '当前阶段' },
    { value: 'all-history', label: '全部阶段' },
    ...archived.map((stage) => ({ value: stage.id, label: stage.name })),
  ]

  const update = (patch: Parameters<typeof writeTradeWorkspaceContext>[1]) => {
    const next = writeTradeWorkspaceContext(location.search, patch)
    navigate({ pathname: location.pathname, search: next.toString() ? `?${next}` : '' })
  }

  return (
    <div className="trade-workspace-context" data-workspace-page={page} aria-label="交易数据范围">
      <div className="trade-workspace-stage">
        <Select
          value={contextStage}
          onValueChange={(stage) => update({
            stage,
            ...(stage === 'current' ? {} : { kind: 'live' }),
          })}
          ariaLabel="选择交易阶段"
          options={stageOptions}
        />
      </div>
      {page !== 'review' ? <div className="trade-workspace-kind" role="group" aria-label="记录类型">
        {KIND_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={query.kind === option.value ? 'is-active' : ''}
            aria-pressed={query.kind === option.value}
            onClick={() => update({
              kind: option.value,
              ...(option.value === 'live' ? {} : { stage: 'current' }),
            })}
          >
            {option.label}
          </button>
        ))}
      </div> : null}
    </div>
  )
}
