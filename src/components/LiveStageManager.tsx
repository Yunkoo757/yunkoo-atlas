import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Archive, CalendarDays, CheckCircle, Pencil } from '@/icons/appIcons'
import { ICON_MD } from '@/icons/iconSize'
import { fmtDate } from '@/lib/format'
import { getCurrentLiveStage, normalizeLiveStageName } from '@/lib/liveStages'
import { notifyStageManagementOpened } from '@/lib/stageRolloverCommit'
import {
  listCurrentStageLiveTrades,
  listStageRolloverAdvisories,
  listStageRolloverBlockers,
  scheduleStageRollover,
} from '@/lib/stageRollover'
import { toast } from '@/lib/toast'
import { flushPersistNow } from '@/storage/persist'
import { useStore } from '@/store/useStore'
import { Button } from '@/components/ui/Button'
import { ModalShell } from '@/components/ui/ModalShell'
import './LiveStageManager.css'

type LiveStageManagerProps = {
  currentTradingDayKey: string
  onClose: () => void
}

type Operation = 'schedule' | 'cancel' | `rename:${string}` | null

export function LiveStageManager({ currentTradingDayKey, onClose }: LiveStageManagerProps) {
  const liveStages = useStore((state) => state.liveStages)
  const currentLiveStageId = useStore((state) => state.currentLiveStageId)
  const scheduledStageRollover = useStore((state) => state.scheduledStageRollover)
  const trades = useStore((state) => state.trades)
  const weeklyReviews = useStore((state) => state.weeklyReviews)
  const weeklyRiskPreparations = useStore((state) => state.weeklyRiskPreparations)
  const riskPolicyVersions = useStore((state) => state.riskPolicyVersions)
  const monthlyRiskLimits = useStore((state) => state.monthlyRiskLimits)
  const riskOverrideEvents = useStore((state) => state.riskOverrideEvents)
  const scheduleLiveStageRollover = useStore((state) => state.scheduleLiveStageRollover)
  const cancelLiveStageRollover = useStore((state) => state.cancelLiveStageRollover)
  const renameLiveStage = useStore((state) => state.renameLiveStage)
  const [operation, setOperation] = useState<Operation>(null)
  const operationRef = useRef<Operation>(null)
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(liveStages.map((stage) => [stage.id, stage.name])),
  )

  useEffect(() => {
    notifyStageManagementOpened()
  }, [])

  useEffect(() => {
    setNameDrafts((drafts) => Object.fromEntries(
      liveStages.map((stage) => [stage.id, drafts[stage.id] ?? stage.name]),
    ))
  }, [liveStages])

  const currentStage = getCurrentLiveStage(liveStages, currentLiveStageId)
  const previewSchedule = useMemo(
    () => scheduleStageRollover(currentTradingDayKey, new Date().toISOString(), 'rollover-preview'),
    [currentTradingDayKey],
  )
  const effectiveWeekStart = scheduledStageRollover?.effectiveWeekStart ?? previewSchedule.effectiveWeekStart
  const blockers = useMemo(() => listStageRolloverBlockers({
    liveStages,
    currentLiveStageId,
    scheduledStageRollover,
    trades,
    weeklyReviews,
    riskPolicyVersions,
  }, effectiveWeekStart), [
    currentLiveStageId,
    effectiveWeekStart,
    liveStages,
    riskPolicyVersions,
    scheduledStageRollover,
    trades,
    weeklyReviews,
  ])
  const advisories = useMemo(() => listStageRolloverAdvisories({
    liveStages,
    currentLiveStageId,
    scheduledStageRollover,
    trades,
    weeklyReviews,
    riskPolicyVersions,
  }, effectiveWeekStart), [
    currentLiveStageId,
    effectiveWeekStart,
    liveStages,
    riskPolicyVersions,
    scheduledStageRollover,
    trades,
    weeklyReviews,
  ])

  const currentTrades = listCurrentStageLiveTrades(trades, currentStage.id)
  const currentCases = trades.filter((trade) =>
    !trade.deletedAt && trade.tradeKind === 'case' && trade.liveStageId === currentStage.id,
  )
  const plannedCount = currentTrades.filter((trade) => trade.status === 'planned').length
  const openCount = currentTrades.filter((trade) => trade.status === 'open').length
  const reviewCount = weeklyReviews.filter((review) => review.liveStageId === currentStage.id).length
  const riskCount = [
    ...weeklyRiskPreparations,
    ...riskPolicyVersions,
    ...monthlyRiskLimits,
    ...riskOverrideEvents,
  ].filter((record) => record.liveStageId === currentStage.id).length
  const blockerCodes = new Set(blockers.map((blocker) => blocker.code))
  const advisoryCodes = new Set(advisories.map((advisory) => advisory.code))

  function startOperation(next: Exclude<Operation, null>): boolean {
    if (operationRef.current) return false
    operationRef.current = next
    setOperation(next)
    return true
  }

  function finishOperation(): void {
    operationRef.current = null
    setOperation(null)
  }

  async function persistSchedule(): Promise<void> {
    if (!startOperation('schedule')) return
    const previous = useStore.getState().scheduledStageRollover
    if (previous) {
      toast('已有阶段切换预约，不能重复创建')
      finishOperation()
      return
    }
    scheduleLiveStageRollover(currentTradingDayKey, new Date().toISOString())
    try {
      await flushPersistNow()
      toast(`已预约 ${fmtDate(useStore.getState().scheduledStageRollover?.effectiveWeekStart ?? effectiveWeekStart)} 开启新实盘阶段`)
    } catch {
      useStore.setState({ scheduledStageRollover: previous })
      try {
        await flushPersistNow()
        toast('阶段预约保存失败，原设置已保留')
      } catch {
        toast('阶段预约保存与回滚均失败，请重新打开应用核对')
      }
    } finally {
      finishOperation()
    }
  }

  async function persistCancellation(): Promise<void> {
    if (!startOperation('cancel')) return
    const previous = useStore.getState().scheduledStageRollover
    if (!previous) {
      finishOperation()
      return
    }
    cancelLiveStageRollover()
    try {
      await flushPersistNow()
      toast('已取消阶段切换预约')
    } catch {
      useStore.setState({ scheduledStageRollover: previous })
      try {
        await flushPersistNow()
        toast('取消预约保存失败，原预约已保留')
      } catch {
        toast('取消预约保存与回滚均失败，请重新打开应用核对')
      }
    } finally {
      finishOperation()
    }
  }

  async function persistRename(stageId: string): Promise<void> {
    if (!startOperation(`rename:${stageId}`)) return
    const previousStages = useStore.getState().liveStages
    const draft = nameDrafts[stageId] ?? ''
    if (!renameLiveStage(stageId, draft)) {
      const stage = previousStages.find((item) => item.id === stageId)
      if (!draft.trim()) toast('阶段名称不能为空')
      else if (stage?.name === draft.trim()) toast('阶段名称没有变化')
      else if (previousStages.some((item) =>
        item.id !== stageId &&
        normalizeLiveStageName(item.name) === normalizeLiveStageName(draft),
      )) toast('阶段名称已存在，请使用其他名称')
      else toast('阶段名称无法保存')
      finishOperation()
      return
    }
    try {
      await flushPersistNow()
      const saved = useStore.getState().liveStages.find((stage) => stage.id === stageId)
      if (saved) setNameDrafts((drafts) => ({ ...drafts, [stageId]: saved.name }))
      toast('阶段名称已保存')
    } catch {
      useStore.setState({ liveStages: previousStages })
      try {
        await flushPersistNow()
        toast('阶段名称保存失败，原名称已保留')
      } catch {
        toast('阶段名称保存与回滚均失败，请重新打开应用核对')
      }
    } finally {
      finishOperation()
    }
  }

  const orderedStages = [...liveStages].sort((left, right) => right.sequence - left.sequence)
  const busy = operation !== null

  return (
    <ModalShell
      title="开启新实盘阶段"
      description="预约下一交易周开启新阶段。"
      size="wide"
      panelClassName="live-stage-manager-shell"
      bodyClassName="live-stage-manager-body"
      busy={busy}
      initialFocusSelector="[data-stage-name-current]"
      onClose={onClose}
      footer={(
        <>
          <Button variant="bordered" disabled={busy} onClick={onClose}>关闭</Button>
          <Button
            variant="primary"
            busy={operation === 'schedule'}
            disabled={busy || scheduledStageRollover !== null}
            onClick={() => void persistSchedule()}
          >
            {scheduledStageRollover ? '已预约' : '确认预约'}
          </Button>
        </>
      )}
    >
      <div className="live-stage-manager" data-live-stage-manager>
        <section className="live-stage-manager-hero">
          <div>
            <span className="live-stage-manager-eyebrow">当前阶段：{currentStage.name}</span>
            <strong>始于 {fmtDate(currentStage.startsOn)}</strong>
          </div>
          <div className="live-stage-manager-date">
            <CalendarDays size={ICON_MD} aria-hidden />
            <span>{scheduledStageRollover ? '预约生效日' : '预计下周一'} <strong>{fmtDate(effectiveWeekStart)}</strong>{scheduledStageRollover ? '' : '生效'}</span>
          </div>
        </section>

        <details className="live-stage-manager-disclosure">
          <summary><Archive size={ICON_MD} aria-hidden />查看归档范围</summary>
          <div className="live-stage-manager-counts">
            <div><strong>{currentTrades.length}</strong><span>实盘交易</span></div>
            <div><strong>{currentCases.length}</strong><span>实盘案例</span></div>
            <div><strong>{reviewCount}</strong><span>周复盘</span></div>
            <div><strong>{riskCount}</strong><span>风险记录</span></div>
          </div>
        </details>

        {blockers.length > 0 || advisories.length > 0 ? <section className="live-stage-manager-section" aria-labelledby="live-stage-blockers-title">
          <div className="live-stage-manager-section-head">
            {blockers.length > 0
              ? <AlertCircle size={ICON_MD} aria-hidden />
              : <CheckCircle size={ICON_MD} aria-hidden />}
            <div>
              <h3 id="live-stage-blockers-title">当前生效条件</h3>
              <p>{blockers.length > 0 ? '先处理持仓交易。' : '以下内容不会阻止切换。'}</p>
            </div>
          </div>
          <div className="live-stage-manager-blockers" aria-label="当前阶段切换阻断项">
            {advisoryCodes.has('planned-trades') ? <span>计划中 {plannedCount} 笔将保留在原阶段</span> : null}
            {blockerCodes.has('open-trades') ? <span>持仓中 {openCount} 笔</span> : null}
            {advisoryCodes.has('weekly-review-incomplete') ? <span>周复盘可稍后补做</span> : null}
          </div>
        </section> : null}

        <details className="live-stage-manager-disclosure">
          <summary>交接规则</summary>
          <p>新阶段风险恢复为未建档；策略、标签、模板和随记继续保留。</p>
        </details>

        {scheduledStageRollover ? (
          <section className="live-stage-manager-scheduled" role="status">
            <div>
              <strong>已有阶段切换预约</strong>
              <span>{fmtDate(scheduledStageRollover.effectiveWeekStart)} 生效，开始交接前可取消。</span>
            </div>
            <Button
              variant="bordered"
              busy={operation === 'cancel'}
              disabled={busy}
              onClick={() => void persistCancellation()}
            >取消预约</Button>
          </section>
        ) : null}

        <section className="live-stage-manager-section" aria-labelledby="live-stage-names-title">
          <div className="live-stage-manager-section-head">
            <Pencil size={ICON_MD} aria-hidden />
            <div>
              <h3 id="live-stage-names-title">阶段名称</h3>
              <p>当前与历史阶段都可自由命名；重命名只改变名称。</p>
            </div>
          </div>
          <div className="live-stage-manager-names">
            {orderedStages.map((stage) => (
              <div className="live-stage-manager-name-row" key={stage.id}>
                <div>
                  <span>{stage.status === 'current' ? '当前阶段' : '历史阶段'} · 第 {stage.sequence} 阶段</span>
                  <small>{fmtDate(stage.startsOn)}{stage.endsOn ? ` — ${fmtDate(stage.endsOn)}` : ' 至今'}</small>
                </div>
                <input
                  type="text"
                  value={nameDrafts[stage.id] ?? stage.name}
                  aria-label={stage.status === 'current' ? '阶段名称' : `阶段名称：${stage.name}`}
                  data-stage-name-current={stage.status === 'current' || undefined}
                  maxLength={80}
                  disabled={busy}
                  onChange={(event) => setNameDrafts((drafts) => ({ ...drafts, [stage.id]: event.target.value }))}
                />
                <Button
                  size="sm"
                  variant="bordered"
                  busy={operation === `rename:${stage.id}`}
                  disabled={busy || !(nameDrafts[stage.id] ?? '').trim()}
                  onClick={() => void persistRename(stage.id)}
                >保存名称</Button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </ModalShell>
  )
}
