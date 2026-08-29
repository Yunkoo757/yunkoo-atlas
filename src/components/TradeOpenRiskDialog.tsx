import { ICON_LG, ICON_MD } from '@/icons/iconSize'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, Shield } from '@/icons/appIcons'
import type { RiskPeriodScope } from '@/data/riskManagement'
import { fmtMoney, fmtR } from '@/lib/format'
import { RiskGatePublishAfterCommitError } from '@/lib/riskGatedTradeOpenCommit'
import { RISK_UNKNOWN_REASON_COPY } from '@/lib/riskUnknownReasonPresentation'
import { ModalShell } from '@/components/ui/ModalShell'
import { Button } from '@/components/ui/Button'
import { WeeklyRiskPreparationCard } from '@/components/WeeklyRiskPreparationCard'
import { useStore, type StorePendingTradeOpenRequest } from '@/store/useStore'
import './TradeOpenRiskDialog.css'

const PERIODS: Array<{ scope: RiskPeriodScope; label: string }> = [
  { scope: 'day', label: '今日' },
  { scope: 'week', label: '本周' },
  { scope: 'month', label: '本月' },
]

type CommitState = 'idle' | 'committing' | 'error' | 'reload-required'

function fmtBudgetR(value: number): string {
  return fmtR(Math.abs(value)).replace(/^\+/, '')
}

function focusFallback(request: { tradeId: string; returnFocus?: HTMLElement | null }): void {
  const original = request.returnFocus
  if (
    original?.isConnected &&
    original !== document.body &&
    original !== document.documentElement
  ) {
    original.focus()
    if (document.activeElement === original) return
  }
  const escapedId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(request.tradeId)
    : request.tradeId.replace(/["\\]/g, '\\$&')
  const tradeRoot = document.querySelector<HTMLElement>(`[data-trade-id="${escapedId}"]`)
  const tradeTarget = tradeRoot?.querySelector<HTMLElement>(
    'button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
  )
  if (tradeTarget) {
    tradeTarget.focus()
    return
  }
  if (tradeRoot) {
    tradeRoot.tabIndex = -1
    tradeRoot.focus()
    return
  }
  const commandEntry = document.querySelector<HTMLElement>(
    '[data-command-palette-trigger], .sb-hbtn-search',
  )
  if (commandEntry?.isConnected) {
    commandEntry.focus()
    return
  }
  const workspace = document.querySelector<HTMLElement>('.ui-main-frame, [data-main-workspace]')
  if (workspace) {
    workspace.tabIndex = -1
    workspace.focus()
  }
}

export function TradeOpenRiskDialog() {
  const request = useStore((state) => state.pendingTradeOpenRequest)
  const setupRequest = useStore((state) => state.riskSetupTradeOpenRequest)
  const currentLiveStageId = useStore((state) => state.currentLiveStageId)
  const activeRequest = request ?? setupRequest
  const trade = useStore((state) => activeRequest
    ? state.trades.find((item) => item.id === activeRequest.tradeId)
    : undefined)
  const policy = useStore((state) => request?.policyVersionId
    ? state.riskPolicyVersions.find((item) =>
        item.liveStageId === currentLiveStageId && item.id === request.policyVersionId,
      )
    : undefined)
  const privacyMode = useStore((state) => state.display.privacyMode)
  const cancelTradeOpen = useStore((state) => state.cancelTradeOpen)
  const confirmTradeOpen = useStore((state) => state.confirmTradeOpen)
  const requestTradeOpen = useStore((state) => state.requestTradeOpen)
  const currentStagePolicyCount = useStore((state) => state.riskPolicyVersions.filter(
    (item) => item.liveStageId === state.currentLiveStageId,
  ).length)
  const rehydrateRiskGateFromStorage = useStore((state) => state.rehydrateRiskGateFromStorage)
  const errorId = useId()
  const reloadButtonRef = useRef<HTMLButtonElement>(null)
  const [reason, setReason] = useState('')
  const [commitState, setCommitState] = useState<CommitState>('idle')
  const [error, setError] = useState('')
  const [showBaselineEditor, setShowBaselineEditor] = useState(false)
  const [baselinePolicyCount, setBaselinePolicyCount] = useState(0)
  const [baselineSaving, setBaselineSaving] = useState(false)
  const [baselineError, setBaselineError] = useState('')

  useEffect(() => {
    setReason('')
    setCommitState('idle')
    setError('')
    setShowBaselineEditor(false)
    setBaselineError('')
  }, [activeRequest?.tradeId])

  useEffect(() => {
    if (!showBaselineEditor || currentStagePolicyCount <= baselinePolicyCount || !activeRequest) return
    let cancelled = false
    setBaselineSaving(true)
    setBaselineError('')
    void import('@/storage/persist').then(({ flushPersistNow }) => flushPersistNow()).then(() => {
      if (cancelled) return
      const { tradeId, returnFocus } = activeRequest
      cancelTradeOpen()
      requestTradeOpen(tradeId, returnFocus)
      setShowBaselineEditor(false)
      setBaselineSaving(false)
    }).catch((cause) => {
      if (cancelled) return
      setBaselineSaving(false)
      setBaselineError(cause instanceof Error ? cause.message : '风险基准保存失败，请重试。')
    })
    return () => { cancelled = true }
  }, [activeRequest, baselinePolicyCount, cancelTradeOpen, currentStagePolicyCount, requestTradeOpen, showBaselineEditor])

  useEffect(() => {
    if (!activeRequest) return
    const requestAtOpen = activeRequest
    return () => {
      requestAnimationFrame(() => requestAnimationFrame(() => focusFallback(requestAtOpen)))
    }
  }, [activeRequest?.tradeId])

  useEffect(() => {
    if (commitState !== 'reload-required') return
    const frame = requestAnimationFrame(() => reloadButtonRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [commitState])

  const unknownReasonText = useMemo(() => request
    ? request.unknownReasons.map((item) => RISK_UNKNOWN_REASON_COPY[item]).join('、')
    : '', [request])

  if (!activeRequest || !trade) return null

  const close = () => {
    if (commitState === 'committing') return
    cancelTradeOpen()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = reason.trim()
    const length = Array.from(trimmed).length
    if (length > 500) {
      setCommitState('error')
      setError('继续开仓原因最多 500 字。')
      return
    }
    setCommitState('committing')
    setError('')
    try {
      const result = await confirmTradeOpen(trimmed)
      if (result.kind === 'needs-reconfirmation') {
        setCommitState('error')
        setError('风险数据已变化，请重新核对最新预算后再次确认。')
      } else if (result.kind === 'cancelled') {
        setCommitState('idle')
      }
    } catch (cause) {
      if (cause instanceof RiskGatePublishAfterCommitError) {
        try {
          await rehydrateRiskGateFromStorage()
          return
        } catch (reloadError) {
          setCommitState('reload-required')
          setError(
            `开仓已写入存储，但工作台恢复失败。请立即重新载入资料库，勿继续编辑。${
              reloadError instanceof Error ? ` ${reloadError.message}` : ''
            }`,
          )
          return
        }
      }
      setCommitState('error')
      setError(cause instanceof Error ? cause.message : '开仓确认失败，请保留原因后重试。')
    }
  }

  const retryStorageReload = async () => {
    setCommitState('committing')
    try {
      await rehydrateRiskGateFromStorage()
    } catch (reloadError) {
      setCommitState('reload-required')
      setError(
        `工作台仍无法从已提交快照恢复，请重试载入，成功前勿继续编辑。${
          reloadError instanceof Error ? ` ${reloadError.message}` : ''
        }`,
      )
    }
  }

  const reloadRequired = commitState === 'reload-required'

  if (showBaselineEditor && request) {
    return (
      <ModalShell
        title="设置当前阶段风险基准"
        description={`${trade.ref} · ${trade.symbol} · 保存后将重新计算本次开仓风险`}
        busy={baselineSaving}
        dismissible={!baselineSaving}
        onClose={close}
        size="default"
        footer={<Button variant="bordered" size="lg" disabled={baselineSaving} onClick={close}>取消开仓</Button>}
      >
        <div data-risk-baseline-dialog>
          <WeeklyRiskPreparationCard currentTradingDayKey={request.currentTradingDayKey} />
          {baselineSaving ? <p className="trade-open-risk-baseline-status" role="status">正在耐久保存风险基准并重新计算…</p> : null}
          {baselineError ? (
            <div className="trade-open-risk-baseline-retry" role="alert">
              <p className="trade-open-risk-error">{baselineError}</p>
              <Button variant="bordered" onClick={() => setBaselinePolicyCount(currentStagePolicyCount - 1)}>
                重试保存并重新计算
              </Button>
            </div>
          ) : null}
        </div>
      </ModalShell>
    )
  }

  if (setupRequest) {
    const isStageMismatch = setupRequest.reason === 'not-current-stage'
    return (
      <ModalShell
        title={isStageMismatch ? '无法打开非当前阶段交易' : '先完成当前阶段风险设置'}
        description={isStageMismatch
          ? `${trade.ref} · ${trade.symbol} · 交易归属与当前实盘阶段不一致`
          : `${trade.ref} · ${trade.symbol} · 首次进入持仓前必须建立本阶段风险规则`}
        onClose={close}
        size="compact"
        footer={(
          <>
            <Button variant="bordered" size="lg" onClick={close}>取消开仓</Button>
            {isStageMismatch ? null : (
              <Link className="ui-btn ui-btn-primary ui-btn-lg" to="/settings/risk" onClick={close}>
                前往风险设置
              </Link>
            )}
          </>
        )}
      >
        <section className="trade-open-risk-dialog" data-risk-setup-dialog>
          <div className="trade-open-risk-callout is-unknown">
            <Shield size={ICON_LG} aria-hidden />
            <div>
              <strong>{isStageMismatch ? '历史或未归属交易不能在当前阶段开仓' : '当前实盘阶段尚未建立风险规则'}</strong>
              <p>{isStageMismatch
                ? '请保留该交易的原阶段归属；如需新交易，请在当前阶段另行创建计划交易。'
                : '请先设置资金基准、日周月止损线并确认本周规则；完成后再重新开仓。'}</p>
            </div>
          </div>
        </section>
      </ModalShell>
    )
  }

  if (!request) return null

  const triggeredPeriods = PERIODS
    .filter(({ scope }) => request.outcomes[scope].triggered)
    .map(({ label }) => label)

  return (
    <ModalShell
      title={request.decisionType === 'unknown' ? '当前风险无法确认' : '止损预算已触线'}
      description={`${trade.ref} · ${trade.symbol} · 继续进入持仓前需要逐笔确认`}
      busy={commitState === 'committing'}
      dismissible={commitState !== 'committing' && !reloadRequired}
      describedById={error ? errorId : undefined}
      onClose={close}
      size="default"
      footer={(
        reloadRequired ? (
          <Button
            ref={reloadButtonRef}
            variant="primary"
            size="lg"
            onClick={retryStorageReload}
          >
            重新载入已提交快照
          </Button>
        ) : (
          <>
            <Button variant="bordered" size="lg" disabled={commitState === 'committing'} onClick={close}>
              取消开仓
            </Button>
            <Button
              type="submit"
              form="trade-open-risk-form"
              variant="primary"
              size="lg"
              disabled={commitState === 'committing'}
            >
              {commitState === 'committing'
                ? '正在写入…'
                : commitState === 'error'
                  ? '重试确认'
                  : '确认继续开仓'}
            </Button>
          </>
        )
      )}
    >
      <form
        id="trade-open-risk-form"
        className="trade-open-risk-dialog"
        data-trade-open-risk-dialog
        onSubmit={submit}
      >
        <section className={`trade-open-risk-callout is-${request.decisionType}`}>
          <Shield size={ICON_LG} aria-hidden />
          <div>
            <strong>
              {request.decisionType === 'unknown'
                ? '无法确认当前是否触线'
                : `${triggeredPeriods.join('、') || '当前'}止损预算已触线`}
            </strong>
            <p>
              {request.decisionType === 'unknown'
                ? unknownReasonText || '当前风险数据覆盖不足。'
                : '继续开仓会形成不可撤销的风险确认审计记录。'}
            </p>
          </div>
        </section>

        <div className="trade-open-risk-periods" aria-label="日周月风险预算">
          {PERIODS.map(({ scope, label }) => {
            const outcome = request.outcomes[scope]
            return (
              <div key={scope} className={outcome.triggered ? 'is-triggered' : outcome.coverage === 'unknown' ? 'is-unknown' : ''}>
                <span>{label}</span>
                <strong>{fmtR(outcome.netBudgetR)}</strong>
                <small>已用 {fmtBudgetR(outcome.consumedR)} / 限额 {fmtBudgetR(outcome.limitR)}</small>
                <em>{outcome.coverage === 'complete' ? '完整' : outcome.coverage === 'partial' ? '部分' : '未知'}</em>
              </div>
            )
          })}
        </div>

        <section className="trade-open-risk-policy">
          <div>
            <span>有效规则</span>
            <strong>{policy ? `${policy.effectiveTradingDay} 起生效` : '当前无有效规则'}</strong>
          </div>
          <div>
            <span>1R 金额</span>
            <strong>{policy ? (privacyMode ? '****' : fmtMoney(policy.riskAmount, 'USD')) : '—'}</strong>
          </div>
          <p>{policy?.disciplineText || '当前无风险基准；你仍可确认本次开仓，系统会保留未知风险审计。'}</p>
          {!policy ? (
            <button
              type="button"
              className="trade-open-risk-baseline-action"
              onClick={() => {
                setBaselinePolicyCount(currentStagePolicyCount)
                setBaselineError('')
                setShowBaselineEditor(true)
              }}
            >
              设置风险基准
            </button>
          ) : null}
        </section>

        <label className="trade-open-risk-reason">
          <span>继续开仓原因（可选） <small>{Array.from(reason).length}/500</small></span>
          <textarea
            aria-label="继续开仓原因"
            data-autofocus
            value={reason}
            maxLength={500}
            rows={4}
            disabled={commitState === 'committing' || reloadRequired}
            onChange={(event) => {
              setReason(event.target.value)
              if (commitState === 'error') {
                setCommitState('idle')
                setError('')
              }
            }}
            placeholder="可留空；如填写，将与本次风险快照一起保存。"
          />
        </label>

        {error ? (
          <div id={errorId} className="trade-open-risk-error" role="alert" tabIndex={-1}>
            <AlertCircle size={ICON_MD} aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}
      </form>
    </ModalShell>
  )
}
