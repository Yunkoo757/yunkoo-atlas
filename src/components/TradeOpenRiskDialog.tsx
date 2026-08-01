import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { AlertCircle, Shield } from '@/icons/appIcons'
import type { RiskPeriodScope } from '@/data/riskManagement'
import { fmtMoney, fmtR } from '@/lib/format'
import { RiskGatePublishAfterCommitError } from '@/lib/riskGatedTradeOpenCommit'
import { RISK_UNKNOWN_REASON_COPY } from '@/lib/riskUnknownReasonPresentation'
import { ModalShell } from '@/components/ui/ModalShell'
import { Button } from '@/components/ui/Button'
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

function focusFallback(request: StorePendingTradeOpenRequest): void {
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
    '[data-command-palette-trigger], .sb-hbtn-search, .mobile-navigation-action[aria-label="更多"]',
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
  const trade = useStore((state) => request
    ? state.trades.find((item) => item.id === request.tradeId)
    : undefined)
  const policy = useStore((state) => request?.policyVersionId
    ? state.riskPolicyVersions.find((item) => item.id === request.policyVersionId)
    : undefined)
  const privacyMode = useStore((state) => state.display.privacyMode)
  const cancelTradeOpen = useStore((state) => state.cancelTradeOpen)
  const confirmTradeOpen = useStore((state) => state.confirmTradeOpen)
  const rehydrateRiskGateFromStorage = useStore((state) => state.rehydrateRiskGateFromStorage)
  const errorId = useId()
  const reloadButtonRef = useRef<HTMLButtonElement>(null)
  const [reason, setReason] = useState('')
  const [commitState, setCommitState] = useState<CommitState>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    setReason('')
    setCommitState('idle')
    setError('')
  }, [request?.tradeId])

  useEffect(() => {
    if (!request) return
    const requestAtOpen = request
    return () => {
      requestAnimationFrame(() => requestAnimationFrame(() => focusFallback(requestAtOpen)))
    }
  }, [request?.tradeId])

  useEffect(() => {
    if (commitState !== 'reload-required') return
    const frame = requestAnimationFrame(() => reloadButtonRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [commitState])

  const unknownReasonText = useMemo(() => request
    ? request.unknownReasons.map((item) => RISK_UNKNOWN_REASON_COPY[item]).join('、')
    : '', [request])

  if (!request || !trade) return null

  const close = () => {
    if (commitState === 'committing') return
    cancelTradeOpen()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = reason.trim()
    const length = Array.from(trimmed).length
    if (length < 1) {
      setCommitState('error')
      setError('请填写 1–500 字的继续开仓原因。')
      return
    }
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
                : commitState === 'error' && reason.trim()
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
          <Shield size={18} aria-hidden />
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
            <strong>{policy ? (privacyMode ? '****' : fmtMoney(policy.riskAmount)) : '—'}</strong>
          </div>
          <p>{policy?.disciplineText || '先补齐风险规则与缺失数据，再决定是否继续开仓。'}</p>
        </section>

        <label className="trade-open-risk-reason">
          <span>继续开仓原因 <small>{Array.from(reason).length}/500</small></span>
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
            placeholder="写明为什么仍要开仓，以及本笔风险将如何控制。"
          />
        </label>

        {error ? (
          <div id={errorId} className="trade-open-risk-error" role="alert" tabIndex={-1}>
            <AlertCircle size={15} aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}
      </form>
    </ModalShell>
  )
}
