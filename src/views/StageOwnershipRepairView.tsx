import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, CheckCircle, Database } from '@/icons/appIcons'
import { ICON_MD } from '@/icons/iconSize'
import {
  listPendingStageOwnership,
  StageOwnershipRepairError,
  STAGE_OWNERSHIP_ENTITY_LABELS,
  type PendingStageOwnershipItem,
  type RollbackAssignedStageOwnershipRequest,
  type StageOwnershipRepairState,
} from '@/lib/stageOwnershipRepair'
import { StorageRevisionConflictError } from '@/storage/adapter'
import { flushPersistNow } from '@/storage/persist'
import { useStore } from '@/store/useStore'
import { Button } from '@/components/ui/Button'
import './StageOwnershipRepairView.css'

type Feedback = { kind: 'error' | 'success'; message: string }

function usePendingOwnership() {
  const liveStages = useStore((state) => state.liveStages)
  const currentLiveStageId = useStore((state) => state.currentLiveStageId)
  const trades = useStore((state) => state.trades)
  const weeklyReviews = useStore((state) => state.weeklyReviews)
  const weeklyRiskPreparations = useStore((state) => state.weeklyRiskPreparations)
  const riskPolicyVersions = useStore((state) => state.riskPolicyVersions)
  const monthlyRiskLimits = useStore((state) => state.monthlyRiskLimits)
  const riskOverrideEvents = useStore((state) => state.riskOverrideEvents)
  return useMemo(() => listPendingStageOwnership({
    liveStages,
    currentLiveStageId,
    trades,
    weeklyReviews,
    weeklyRiskPreparations,
    riskPolicyVersions,
    monthlyRiskLimits,
    riskOverrideEvents,
  }), [
    currentLiveStageId,
    liveStages,
    monthlyRiskLimits,
    riskOverrideEvents,
    riskPolicyVersions,
    trades,
    weeklyReviews,
    weeklyRiskPreparations,
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
    case 'invalid-weekly-period': return '修正后的周区间必须是目标阶段内完整的周一至周日。'
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

export function StageOwnershipRepairView() {
  const pending = usePendingOwnership()
  const liveStages = useStore((state) => state.liveStages)
  const assignOwnership = useStore((state) => state.assignPendingStageOwnership)
  const rollbackOwnership = useStore((state) => state.rollbackAssignedStageOwnership)
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({})
  const [weeklyPeriodCorrections, setWeeklyPeriodCorrections] = useState<Record<string, { weekStart: string; weekEnd: string }>>({})
  const [pageStatus, setPageStatus] = useState('')
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [savingItem, setSavingItem] = useState<PendingStageOwnershipItem | null>(null)
  const busyRef = useRef<string | null>(null)

  const stages = useMemo(
    () => [...liveStages].sort((left, right) => right.sequence - left.sequence),
    [liveStages],
  )

  async function save(item: PendingStageOwnershipItem): Promise<void> {
    const key = itemKey(item)
    const liveStageId = selections[key] ?? ''
    if (!liveStageId || busyRef.current) return
    busyRef.current = key
    setBusyKey(key)
    setSavingItem(item)
    setPageStatus('')
    setFeedback((current) => ({ ...current, [key]: { kind: 'success', message: '正在保存阶段归属…' } }))
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
      setPageStatus(`阶段归属已保存：${item.reference} 已归入 ${stageName}。`)
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
    } catch (saveError) {
      try {
        if (!rollbackRequest) throw new StageOwnershipRepairError('rollback-conflict', '缺少本次归属的回滚凭据')
        rollbackOwnership(rollbackRequest)
      } catch (rollbackError) {
        const recoveryMessage = rollbackError instanceof StageOwnershipRepairError
          ? domainFailureMessage(rollbackError)
          : '回滚目标已发生变化，未覆盖最新资料；请重新打开应用核对资料库。'
        setPageStatus(recoveryMessage)
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

  const displayedPending = savingItem && !pending.some((item) => itemKey(item) === itemKey(savingItem))
    ? [savingItem, ...pending]
    : pending

  return (
    <div className="settings-page stage-ownership-repair" data-stage-ownership-repair-view>
      <header className="settings-page-head stage-ownership-repair-hero">
        <div>
          <Link className="stage-ownership-back" to="/settings/data">返回数据设置</Link>
          <h1 className="settings-page-title" tabIndex={-1}>阶段待整理</h1>
          <p className="settings-page-desc">
            这些旧版迁移记录缺少可验证的阶段归属。待整理数据不会进入当前、历史阶段或绩效统计；只有显式保存后才进入所选阶段。
          </p>
        </div>
        <div className="stage-ownership-total" aria-label={`待整理 ${pending.length} 项`}>
          <Database size={ICON_MD} aria-hidden />
          <span>待整理</span>
          <strong>{displayedPending.length}</strong>
        </div>
      </header>
      <p className="stage-ownership-page-status" data-stage-ownership-page-status role="status" aria-live="polite">
        {pageStatus}
      </p>

      <section className="stage-ownership-stage-guide" aria-labelledby="stage-ownership-stage-guide-title">
        <div>
          <h2 id="stage-ownership-stage-guide-title">可选阶段</h2>
          <p>日期仅作为原始上下文展示，系统不会据此推荐或预选阶段。</p>
        </div>
        <ul>
          {stages.map((stage) => (
            <li key={stage.id}>
              <strong>{stage.name}</strong>
              <span>{stage.status === 'current' ? '当前阶段' : '历史阶段'} · 第 {stage.sequence} 阶段</span>
            </li>
          ))}
        </ul>
      </section>

      {displayedPending.length === 0 ? (
        <section className="stage-ownership-empty" data-stage-ownership-empty role="status">
          <CheckCircle size={ICON_MD} aria-hidden />
          <div>
            <strong>所有迁移数据都已完成阶段归属</strong>
            <span>当前没有需要人工整理的阶段实体。</span>
          </div>
        </section>
      ) : (
        <section className="stage-ownership-list" aria-label="阶段待整理项目">
          {displayedPending.map((item) => {
            const key = itemKey(item)
            const selected = selections[key] ?? ''
            const itemFeedback = feedback[key]
            const busy = busyKey === key
            const weeklyPeriodCorrection = weeklyPeriodCorrections[key] ?? { weekStart: '', weekEnd: '' }
            const correctionComplete = !item.requiresWeeklyPeriodCorrection || (
              weeklyPeriodCorrection.weekStart.length > 0 && weeklyPeriodCorrection.weekEnd.length > 0
            )
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
                    <span>{STAGE_OWNERSHIP_ENTITY_LABELS[item.entityType]}</span>
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
                  <p className="stage-ownership-reason"><AlertCircle size={ICON_MD} aria-hidden />{item.reason}</p>
                </div>
                <div className="stage-ownership-actions">
                  {item.requiresWeeklyPeriodCorrection ? (
                    <fieldset className="stage-ownership-period-correction">
                      <legend>原始周区间无效，请显式修正</legend>
                      <p>
                        原始值：<code>{item.weeklyPeriod?.weekStart}</code> 至 <code>{item.weeklyPeriod?.weekEnd}</code>
                      </p>
                      <label htmlFor={`stage-ownership-week-start-${key}`}>修正周起始（周一）</label>
                      <input
                        id={`stage-ownership-week-start-${key}`}
                        type="date"
                        data-weekly-period-weekstart
                        value={weeklyPeriodCorrection.weekStart}
                        disabled={busyKey !== null}
                        onChange={(event) => setWeeklyPeriodCorrections((current) => ({
                          ...current,
                          [key]: { ...weeklyPeriodCorrection, weekStart: event.target.value },
                        }))}
                      />
                      <label htmlFor={`stage-ownership-week-end-${key}`}>修正周结束（周日）</label>
                      <input
                        id={`stage-ownership-week-end-${key}`}
                        type="date"
                        data-weekly-period-weekend
                        value={weeklyPeriodCorrection.weekEnd}
                        disabled={busyKey !== null}
                        onChange={(event) => setWeeklyPeriodCorrections((current) => ({
                          ...current,
                          [key]: { ...weeklyPeriodCorrection, weekEnd: event.target.value },
                        }))}
                      />
                    </fieldset>
                  ) : null}
                  <label htmlFor={`stage-ownership-target-${key}`}>目标阶段</label>
                  <select
                    id={`stage-ownership-target-${key}`}
                    aria-label={`为 ${item.reference} 选择目标阶段`}
                    value={selected}
                    disabled={busyKey !== null}
                    onChange={(event) => {
                      const liveStageId = event.target.value
                      setSelections((current) => ({ ...current, [key]: liveStageId }))
                      setFeedback((current) => {
                        const next = { ...current }
                        delete next[key]
                        return next
                      })
                    }}
                  >
                    <option value="">请选择目标阶段（必选）</option>
                    {stages.map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.name} · {stage.status === 'current' ? '当前阶段' : '历史阶段'}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="primary"
                    busy={busy}
                    disabled={busyKey !== null || !selected || !correctionComplete}
                    data-stage-ownership-save
                    onClick={() => void save(item)}
                  >保存归属</Button>
                  <p
                    className={`stage-ownership-feedback${itemFeedback?.kind === 'error' ? ' is-error' : ''}`}
                    role={itemFeedback?.kind === 'error' ? 'alert' : 'status'}
                    aria-live="polite"
                  >
                    {itemFeedback?.message ?? '保存只会写入所选阶段，不改变其他事实。'}
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
