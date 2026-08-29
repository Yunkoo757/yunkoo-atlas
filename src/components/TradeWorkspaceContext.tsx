import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, ChevronDown } from '@/icons/appIcons'
import { ICON_SM } from '@/icons/iconSize'
import { PopoverSurface } from '@/components/ui/PopoverSurface'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Select } from '@/components/ui/Select'
import {
  mergeSharedTradeWorkspaceSearch,
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

export function TradeWorkspaceContext({
  page,
  compact = false,
}: {
  page: TradeWorkspacePage
  compact?: boolean
}) {
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
  const currentStage = liveStages.find((stage) => stage.id === currentLiveStageId)
  const stageOptions = [
    { value: 'current', label: '当前阶段' },
    { value: 'all', label: '全部阶段' },
    ...archived.map((stage) => ({ value: stage.id, label: stage.name })),
  ]

  const update = (patch: Parameters<typeof writeTradeWorkspaceContext>[1]) => {
    const next = writeTradeWorkspaceContext(location.search, patch)
    const state = useStore.getState()
    const memory = state.display.workspaceMemory?.trade ?? { pathname: '/list', search: '' }
    state.setDisplay({
      workspaceMemory: {
        ...state.display.workspaceMemory,
        trade: {
          ...memory,
          search: mergeSharedTradeWorkspaceSearch(memory.search, next),
        },
      },
    })
    navigate({ pathname: location.pathname, search: next.toString() ? `?${next}` : '' })
  }

  if (compact && page !== 'review') {
    return (
      <TradeWorkspaceScopeMenu
        page={page}
        stage={contextStage}
        kind={query.kind}
        stageOptions={stageOptions}
        onStageChange={(stage) => update({ stage })}
        onKindChange={(kind) => update({ kind })}
      />
    )
  }

  return (
    <div className="trade-workspace-context" data-workspace-page={page} aria-label="交易数据范围">
      <div className="trade-workspace-stage">
        <Select
          value={contextStage}
          onValueChange={(stage) => update({ stage })}
          ariaLabel={currentStage ? `选择交易阶段；当前阶段为${currentStage.name}` : '选择交易阶段'}
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
            onClick={() => update({ kind: option.value })}
          >
            {option.label}
          </button>
        ))}
      </div> : null}
    </div>
  )
}

function TradeWorkspaceScopeMenu({
  page,
  stage,
  kind,
  stageOptions,
  onStageChange,
  onKindChange,
}: {
  page: TradeWorkspacePage
  stage: string
  kind: TradeWorkspaceKind
  stageOptions: Array<{ value: string; label: string }>
  onStageChange: (stage: string) => void
  onKindChange: (kind: TradeWorkspaceKind) => void
}) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const stageLabel = stageOptions.find((option) => option.value === stage)?.label ?? '当前阶段'
  const kindLabel = KIND_OPTIONS.find((option) => option.value === kind)?.label ?? '全部'
  const scopeLabel = `${stageLabel} · ${kindLabel}`

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = 272
    const edge = 8
    setPosition({
      top: rect.bottom + 6,
      left: Math.min(Math.max(edge, rect.right - width), window.innerWidth - width - edge),
    })
  }

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLButtonElement>('[data-workspace-stage]')?.focus()
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      requestAnimationFrame(() => triggerRef.current?.focus())
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  const panelStyle: CSSProperties = {
    top: position.top,
    left: position.left,
    width: 272,
  }

  return (
    <div
      className="trade-workspace-scope"
      data-workspace-page={page}
      data-workspace-compact
    >
      <button
        ref={triggerRef}
        type="button"
        className={`trade-workspace-scope-trigger${open ? ' is-open' : ''}`}
        aria-label={`数据范围：${scopeLabel}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{scopeLabel}</span>
        <ChevronDown size={ICON_SM} />
      </button>
      {open && createPortal(
        <PopoverSurface
          ref={panelRef}
          kind="menu"
          id={id}
          role="dialog"
          aria-label="选择数据范围"
          className="trade-workspace-scope-panel"
          style={panelStyle}
        >
          <section className="trade-workspace-scope-section" aria-labelledby={`${id}-stage`}>
            <div className="trade-workspace-scope-heading" id={`${id}-stage`}>阶段</div>
            <div className="trade-workspace-scope-options">
              {stageOptions.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  className={stage === option.value ? 'is-selected' : ''}
                  data-workspace-stage={option.value}
                  aria-pressed={stage === option.value}
                  onClick={() => onStageChange(option.value)}
                >
                  <span>{option.label}</span>
                  {stage === option.value ? <Check size={ICON_SM} /> : null}
                </button>
              ))}
            </div>
          </section>
          <section className="trade-workspace-scope-section" aria-labelledby={`${id}-kind`}>
            <div className="trade-workspace-scope-heading" id={`${id}-kind`}>记录类型</div>
            <SegmentedControl
              className="trade-workspace-scope-kinds"
              label="记录类型"
              value={kind}
              options={KIND_OPTIONS.map((option) => ({
                ...option,
                content: <span data-workspace-kind={option.value}>{option.label}</span>,
              }))}
              onChange={onKindChange}
              size="md"
            />
          </section>
        </PopoverSurface>,
        document.body,
      )}
    </div>
  )
}
