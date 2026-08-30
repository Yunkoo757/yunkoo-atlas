import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, CheckCircle, Database } from '@/icons/appIcons'
import { ICON_MD } from '@/icons/iconSize'
import {
  applyRecommendedStageBoundaryRepair,
  listPendingStageOwnership,
  recommendStageBoundaryRepair,
  StageOwnershipRepairError,
  STAGE_OWNERSHIP_ENTITY_LABELS,
  type PendingStageOwnershipItem,
  type RecommendedStageBoundaryRepair,
  type RollbackAssignedStageOwnershipRequest,
  type StageOwnershipRepairState,
} from '@/lib/stageOwnershipRepair'
import { StorageRevisionConflictError } from '@/storage/adapter'
import { flushPersistNow } from '@/storage/persist'
import { useStore } from '@/store/useStore'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { DatePicker } from '@/components/ui/DatePicker'
import { Select } from '@/components/ui/Select'
import './StageOwnershipRepairView.css'

type Feedback = { kind: 'error' | 'success' | 'progress'; message: string }
type PageStatus = { kind: 'error' | 'success'; message: string }
type OwnershipDraft = {
  liveStageId?: string
  weeklyPeriod?: { weekStart: string; weekEnd: string }
}

const OWNERSHIP_DRAFTS_KEY = 'trader-atlas:stage-ownership-drafts:v1'

function readOwnershipDrafts(): Record<string, OwnershipDraft> {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(OWNERSHIP_DRAFTS_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, OwnershipDraft>
      : {}
  } catch {
    return {}
  }
}

function writeOwnershipDrafts(drafts: Record<string, OwnershipDraft>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(OWNERSHIP_DRAFTS_KEY, JSON.stringify(drafts))
  } catch {
    // 草稿记忆失败不应阻止阶段归属保存。
  }
}

function usePendingOwnership() {
  const liveStages = useStore((state) => state.liveStages)
  const currentLiveStageId = useStore((state) => state.currentLiveStageId)
  const trades = useStore((state) => state.trades)
  const weeklyReviews = useStore((state) => state.weeklyReviews)
  const weeklyRiskPreparations = useStore((state) => state.weeklyRiskPreparations)
  const riskPolicyVersions = useStore((state) => state.riskPolicyVersions)
  const monthlyRiskLimits = useStore((state) => state.monthlyRiskLimits)
  const riskOverrideEvents = useStore((state) => state.riskOverrideEvents)
  const display = useStore((state) => state.display)
  return useMemo(() => listPendingStageOwnership({
    liveStages,
    currentLiveStageId,
    trades,
    weeklyReviews,
    weeklyRiskPreparations,
    riskPolicyVersions,
    monthlyRiskLimits,
    riskOverrideEvents,
    display,
  }), [
    currentLiveStageId,
    liveStages,
    monthlyRiskLimits,
    riskOverrideEvents,
    riskPolicyVersions,
    trades,
    weeklyReviews,
    weeklyRiskPreparations,
    display,
  ])
}

function domainFailureMessage(error: StageOwnershipRepairError): string {
  switch (error.code) {
    case 'stale-request': return '待整理项发生变化，请核对最新上下文后重试。'
    case 'target-stage-not-found': return '目标阶段已不存在，请重新选择。'
    case 'target-stage-invalid': return '目标阶段资料无效，无法保存归属。'
    case 'ownership-conflict': return '目标阶段已有同周期记录，请核对已有记录或选择其他阶段。'
    case 'relationship-conflict': return '关联实体与目标阶段不一致或已不存在，请核对关系后重试。'
    case 'dependency-pending': return '关联实体仍在待整理队列，请先完成其阶段归属。'
    case 'invalid-weekly-period': return '修正后的周区间必须是完整的周一至周日。'
    case 'weekly-period-crosses-stage-boundary': return '该周是完整周，但跨越目标阶段边界；请调整阶段边界，或选择能够完整包含该周的阶段。'
    case 'recommended-repair-unavailable': return '推荐设置所依据的数据已经变化，请刷新后重新核对。'
    case 'missing-fingerprint': return '缺少待整理项校验信息，请刷新页面后重试。'
    case 'rollback-conflict': return '回滚目标已被其他操作修改，未覆盖最新资料；请重新打开应用核对资料库。'
    case 'already-assigned': return '该项目已在其他操作中完成归属，请刷新核对。'
    case 'entity-not-found': return '该项目已不存在，请刷新核对。'
    case 'wrong-entity-type': return '该项目类型已经变化，请刷新核对。'
    case 'paper-trade': return '模拟交易不属于实盘阶段，无法分配。'
    case 'invalid-ownership': return '该项目仍是未迁移 schema 状态，不能静默修复。'
  }
}

function itemKey(item: PendingStageOwnershipItem): string {
  return `${item.entityType}:${item.entityId}`
}

function itemDraftKey(item: PendingStageOwnershipItem): string {
  return `${itemKey(item)}:${item.fingerprint}`
}

export function StageOwnershipRepairView() {
  const pending = usePendingOwnership()
  const liveStages = useStore((state) => state.liveStages)
  const assignOwnership = useStore((state) => state.assignPendingStageOwnership)
  const rollbackOwnership = useStore((state) => state.rollbackAssignedStageOwnership)
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({})
  const [weeklyPeriodCorrections, setWeeklyPeriodCorrections] = useState<Record<string, { weekStart: string; weekEnd: string }>>({})
  const [drafts, setDrafts] = useState<Record<string, OwnershipDraft>>(readOwnershipDrafts)
  const [pageStatus, setPageStatus] = useState<PageStatus | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [savingItem, setSavingItem] = useState<PendingStageOwnershipItem | null>(null)
  const busyRef = useRef<string | null>(null)

  const stages = useMemo(
    () => [...liveStages].sort((left, right) => right.sequence - left.sequence),
    [liveStages],
  )

  const updateDraft = (item: PendingStageOwnershipItem, patch: OwnershipDraft) => {
    setDrafts((current) => {
      const key = itemDraftKey(item)
      const next = { ...current, [key]: { ...current[key], ...patch } }
      writeOwnershipDrafts(next)
      return next
    })
  }

  const clearDraft = (item: PendingStageOwnershipItem) => {
    setDrafts((current) => {
      const next = { ...current }
      delete next[itemDraftKey(item)]
      writeOwnershipDrafts(next)
      return next
    })
  }

  async function save(item: PendingStageOwnershipItem): Promise<void> {
    const key = itemKey(item)
    const liveStageId = selections[key] ?? drafts[itemDraftKey(item)]?.liveStageId ?? ''
    if (!liveStageId || busyRef.current) return
    busyRef.current = key
    setBusyKey(key)
    setSavingItem(item)
    setPageStatus(null)
    setFeedback((current) => ({ ...current, [key]: { kind: 'progress', message: '正在保存阶段归属…' } }))
    let stageName = liveStageId
    let rollbackRequest: RollbackAssignedStageOwnershipRequest | null = null
    try {
      // 先把编辑器草稿和既有待保存状态冲洗进 Store/资料库；后续失败只会在最新
      // Store 上 CAS 反向修改本次目标的 ownership，不会用旧数组覆盖并发正文。
      await flushPersistNow()
      stageName = useStore.getState().liveStages.find((stage) => stage.id === liveStageId)?.name ?? liveStageId
      rollbackRequest = assignOwnership({
        entityType: item.entityType,
        entityId: item.entityId,
        liveStageId,
        expectedFingerprint: item.fingerprint,
        ...(item.requiresWeeklyPeriodCorrection
          ? { correctedWeeklyPeriod: weeklyPeriodCorrections[key] }
          : {}),
      })
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        [key]: {
          kind: 'error',
          message: error instanceof StageOwnershipRepairError
            ? domainFailureMessage(error)
            : error instanceof StorageRevisionConflictError
              ? '保存前同步发生冲突，阶段归属尚未修改；请核对后重试。'
              : '保存前同步失败，阶段归属尚未修改；请重试。',
        },
      }))
      busyRef.current = null
      setBusyKey(null)
      setSavingItem(null)
      return
    }

    try {
      await flushPersistNow()
      setPageStatus({ kind: 'success', message: `阶段归属已保存：${item.reference} 已归入 ${stageName}。` })
      setFeedback((current) => ({ ...current, [key]: { kind: 'success', message: '阶段归属已保存。' } }))
      setSelections((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
      setWeeklyPeriodCorrections((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
      clearDraft(item)
    } catch (saveError) {
      try {
        if (!rollbackRequest) throw new StageOwnershipRepairError('rollback-conflict', '缺少本次归属的回滚凭据')
        rollbackOwnership(rollbackRequest)
      } catch (rollbackError) {
        const recoveryMessage = rollbackError instanceof StageOwnershipRepairError
          ? domainFailureMessage(rollbackError)
          : '回滚目标已发生变化，未覆盖最新资料；请重新打开应用核对资料库。'
        setPageStatus({ kind: 'error', message: recoveryMessage })
        setFeedback((current) => ({
          ...current,
          [key]: {
            kind: 'error',
            message: recoveryMessage,
          },
        }))
        return
      }
      try {
        await flushPersistNow()
        setFeedback((current) => ({
          ...current,
          [key]: {
            kind: 'error',
            message: saveError instanceof StorageRevisionConflictError
              ? '阶段归属保存冲突，已恢复待整理状态；请核对后重试。'
              : '阶段归属保存失败，已恢复待整理状态；可以重试。',
          },
        }))
      } catch {
        setFeedback((current) => ({
          ...current,
          [key]: { kind: 'error', message: '阶段归属保存与回滚均失败，请重新打开应用核对资料库。' },
        }))
      }
    } finally {
      busyRef.current = null
      setBusyKey(null)
      setSavingItem(null)
    }
  }

  async function applyRecommendation(
    item: PendingStageOwnershipItem,
    recommendation: RecommendedStageBoundaryRepair,
  ): Promise<void> {
    const key = itemKey(item)
    if (busyRef.current) return
    busyRef.current = key
    setBusyKey(key)
    setSavingItem(item)
    setPageStatus(null)
    setFeedback((current) => ({ ...current, [key]: { kind: 'progress', message: '正在按推荐设置修复…' } }))

    const before = useStore.getState()
    let candidate: ReturnType<typeof useStore.getState> | null = null
    try {
      await flushPersistNow()
      const latest = useStore.getState()
      const refreshed = recommendStageBoundaryRepair(latest, item.entityId)
      if (!refreshed || JSON.stringify(refreshed) !== JSON.stringify(recommendation)) {
        throw new StageOwnershipRepairError('recommended-repair-unavailable', '推荐设置已经变化')
      }
      candidate = applyRecommendedStageBoundaryRepair(latest, refreshed)
      useStore.setState({
        liveStages: candidate.liveStages,
        trades: candidate.trades,
        weeklyReviews: candidate.weeklyReviews,
        weeklyRiskPreparations: candidate.weeklyRiskPreparations,
        riskPolicyVersions: candidate.riskPolicyVersions,
        monthlyRiskLimits: candidate.monthlyRiskLimits,
        riskOverrideEvents: candidate.riskOverrideEvents,
      })
      await flushPersistNow()
      setPageStatus({
        kind: 'success',
        message: `推荐修复已完成：${recommendation.targetStageName} 从 ${recommendation.targetStageStartAfter} 开始，` +
          `${recommendation.affectedTradeIds.length} 条记录已同步校正。`,
      })
      setFeedback((current) => ({ ...current, [key]: { kind: 'success', message: '推荐修复已完成。' } }))
      clearDraft(item)
    } catch (error) {
      if (candidate) {
        const current = useStore.getState()
        const candidateStillCurrent = (
          current.liveStages === candidate.liveStages &&
          current.trades === candidate.trades &&
          current.weeklyReviews === candidate.weeklyReviews &&
          current.weeklyRiskPreparations === candidate.weeklyRiskPreparations &&
          current.riskPolicyVersions === candidate.riskPolicyVersions &&
          current.monthlyRiskLimits === candidate.monthlyRiskLimits &&
          current.riskOverrideEvents === candidate.riskOverrideEvents
        )
        if (candidateStillCurrent) {
          useStore.setState({
            liveStages: before.liveStages,
            trades: before.trades,
            weeklyReviews: before.weeklyReviews,
            weeklyRiskPreparations: before.weeklyRiskPreparations,
            riskPolicyVersions: before.riskPolicyVersions,
            monthlyRiskLimits: before.monthlyRiskLimits,
            riskOverrideEvents: before.riskOverrideEvents,
          })
          try { await flushPersistNow() } catch { /* 页面提示已覆盖恢复失败。 */ }
        }
      }
      setFeedback((current) => ({
        ...current,
        [key]: {
          kind: 'error',
          message: error instanceof StageOwnershipRepairError
            ? domainFailureMessage(error)
            : error instanceof StorageRevisionConflictError
              ? '推荐修复发生同步冲突，已恢复原设置；请核对后重试。'
              : '推荐修复保存失败，已恢复原设置；请重试。',
        },
      }))
    } finally {
      busyRef.current = null
      setBusyKey(null)
      setSavingItem(null)
    }
  }

  const displayedPending = savingItem && !pending.some((item) => itemKey(item) === itemKey(savingItem))
    ? [savingItem, ...pending]
    : pending

  return (
    <div className="settings-page settings-page--standard stage-ownership-repair" data-stage-ownership-repair-view>
      <header className="settings-page-head stage-ownership-repair-hero">
        <div>
          <Link className="stage-ownership-back" to="/settings/data">返回数据设置</Link>
          <h1 className="settings-page-title" tabIndex={-1}>待归属记录</h1>
          <p className="settings-page-desc">
            为旧记录选择所属阶段。选择会自动记住，保存后不再出现。
          </p>
        </div>
        <div className="stage-ownership-total" aria-label={`待整理 ${pending.length} 项`}>
          <Database size={ICON_MD} aria-hidden />
          <span>待整理</span>
          <strong>{displayedPending.length}</strong>
        </div>
      </header>
      {pageStatus ? (
        <p
          className={`stage-ownership-page-status is-${pageStatus.kind}`}
          data-stage-ownership-page-status
          role={pageStatus.kind === 'error' ? 'alert' : 'status'}
          aria-live={pageStatus.kind === 'error' ? 'assertive' : 'polite'}
        >
          {pageStatus.message}
        </p>
      ) : null}

      {displayedPending.length === 0 ? (
        <section className="stage-ownership-empty" data-stage-ownership-empty role="status">
          <CheckCircle size={ICON_MD} aria-hidden />
          <div>
            <strong>所有迁移数据都已完成阶段归属</strong>
            <span>当前没有需要人工整理的阶段实体。</span>
          </div>
        </section>
      ) : (
        <section className="stage-ownership-list" aria-label="待归属记录">
          {displayedPending.map((item) => {
            const key = itemKey(item)
            const remembered = drafts[itemDraftKey(item)]
            const selected = selections[key]
              ?? (stages.some((stage) => stage.id === remembered?.liveStageId) ? remembered?.liveStageId : '')
            const itemFeedback = feedback[key]
            const busy = busyKey === key
            const weeklyPeriodCorrection = weeklyPeriodCorrections[key]
              ?? remembered?.weeklyPeriod
              ?? { weekStart: '', weekEnd: '' }
            const correctionComplete = !item.requiresWeeklyPeriodCorrection || (
              weeklyPeriodCorrection.weekStart.length > 0 && weeklyPeriodCorrection.weekEnd.length > 0
            )
            const recommendation = item.entityType === 'weekly-review'
              ? recommendStageBoundaryRepair(useStore.getState(), item.entityId)
              : null
            return (
              <article
                className="stage-ownership-row"
                key={key}
                data-stage-ownership-id={item.entityId}
                data-stage-ownership-type={item.entityType}
                aria-busy={busy || undefined}
              >
                <div className="stage-ownership-copy">
                  <div className="stage-ownership-heading">
                    <Chip size="sm" variant="soft">{STAGE_OWNERSHIP_ENTITY_LABELS[item.entityType]}</Chip>
                    <strong>{item.title}</strong>
                    <code>{item.reference}</code>
                  </div>
                  <dl className="stage-ownership-context">
                    {item.context.map((context) => (
                      <div key={`${context.label}:${context.value}`}>
                        <dt>{context.label}</dt>
                        <dd>{context.value}</dd>
                      </div>
                    ))}
                    {item.source ? (
                      <div>
                        <dt>{item.source.label}</dt>
                        <dd>{[item.source.reference, item.source.title, item.source.id].filter(Boolean).join(' · ')}</dd>
                      </div>
                    ) : null}
                  </dl>
                  <p className="stage-ownership-reason" title={item.reason}>
                    <AlertCircle size={ICON_MD} aria-hidden />旧记录缺少阶段信息
                  </p>
                </div>
                <div className="stage-ownership-actions">
                  {recommendation ? (
                    <section className="stage-ownership-recommendation" data-stage-ownership-recommendation>
                      <div className="stage-ownership-recommendation-copy">
                        <strong>建议调整阶段日期</strong>
                        <span>同步归档 {recommendation.affectedTradeIds.length} 条记录</span>
                      </div>
                      <Button
                        variant="primary"
                        busy={busy}
                        disabled={busyKey !== null}
                        data-stage-ownership-apply-recommended
                        onClick={() => void applyRecommendation(item, recommendation)}
                      >应用建议</Button>
                      <details className="stage-ownership-impact">
                        <summary>查看影响</summary>
                        <p>
                          “{recommendation.targetStageName}”开始日调整为 {recommendation.targetStageStartAfter}，
                          “{recommendation.previousStageName}”截止日调整为 {recommendation.previousStageEndAfter}。
                        </p>
                        <span>有历史来源约束的案例保持原阶段。</span>
                      </details>
                    </section>
                  ) : null}
                  <details className={`stage-ownership-manual${recommendation ? ' is-secondary' : ''}`} open={!recommendation}>
                    <summary>{recommendation ? '手动处理' : '设置归属'}</summary>
                    <div className="stage-ownership-manual-fields">
                      {item.requiresWeeklyPeriodCorrection ? (
                        <fieldset className="stage-ownership-period-correction">
                          <legend>修正周区间</legend>
                          <p>
                            当前：<code>{item.weeklyPeriod?.weekStart}</code> 至 <code>{item.weeklyPeriod?.weekEnd}</code>
                          </p>
                          <div className="stage-ownership-date-field" role="group" aria-labelledby={`stage-ownership-week-start-label-${key}`}>
                            <span id={`stage-ownership-week-start-label-${key}`}>周一</span>
                            <DatePicker
                              className="stage-ownership-week-start"
                              ariaLabel={`为 ${item.reference} 选择修正周起始日期`}
                              value={weeklyPeriodCorrection.weekStart}
                              disabled={busyKey !== null}
                              required
                              onValueChange={(value) => {
                                const weeklyPeriod = { ...weeklyPeriodCorrection, weekStart: value }
                                setWeeklyPeriodCorrections((current) => ({ ...current, [key]: weeklyPeriod }))
                                updateDraft(item, { weeklyPeriod })
                              }}
                            />
                          </div>
                          <div className="stage-ownership-date-field" role="group" aria-labelledby={`stage-ownership-week-end-label-${key}`}>
                            <span id={`stage-ownership-week-end-label-${key}`}>周日</span>
                            <DatePicker
                              className="stage-ownership-week-end"
                              ariaLabel={`为 ${item.reference} 选择修正周结束日期`}
                              value={weeklyPeriodCorrection.weekEnd}
                              disabled={busyKey !== null}
                              required
                              onValueChange={(value) => {
                                const weeklyPeriod = { ...weeklyPeriodCorrection, weekEnd: value }
                                setWeeklyPeriodCorrections((current) => ({ ...current, [key]: weeklyPeriod }))
                                updateDraft(item, { weeklyPeriod })
                              }}
                            />
                          </div>
                        </fieldset>
                      ) : null}
                      <div className="stage-ownership-target-field" role="group" aria-labelledby={`stage-ownership-target-label-${key}`}>
                        <span id={`stage-ownership-target-label-${key}`}>目标阶段</span>
                        <Select
                          className="stage-ownership-target"
                          ariaLabel={`为 ${item.reference} 选择目标阶段`}
                          value={selected}
                          disabled={busyKey !== null}
                          placeholder="选择阶段"
                          options={stages.map((stage) => ({
                            value: stage.id,
                            label: `${stage.name}${stage.status === 'current' ? '（当前）' : ''}`,
                          }))}
                          onValueChange={(liveStageId) => {
                            setSelections((current) => ({ ...current, [key]: liveStageId }))
                            updateDraft(item, { liveStageId })
                            setFeedback((current) => {
                              const next = { ...current }
                              delete next[key]
                              return next
                            })
                          }}
                        />
                      </div>
                      <Button
                        variant="primary"
                        busy={busy}
                        disabled={busyKey !== null || !selected || !correctionComplete}
                        data-stage-ownership-save
                        onClick={() => void save(item)}
                      >保存归属</Button>
                    </div>
                  </details>
                  <p
                    className={`stage-ownership-feedback${itemFeedback ? ` is-${itemFeedback.kind}` : ''}`}
                    role={itemFeedback?.kind === 'error' ? 'alert' : 'status'}
                    aria-live="polite"
                  >
                    {itemFeedback?.message ?? '选择会自动记住'}
                  </p>
                </div>
              </article>
            )
          })}
        </section>
      )}
    </div>
  )
}
