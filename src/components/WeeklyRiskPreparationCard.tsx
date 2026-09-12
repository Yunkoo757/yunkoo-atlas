import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { RiskPolicyDraft, RiskPolicyVersion } from '@/data/riskManagement'
import { weekStartFor } from '@/data/weeklyReviews'
import { fmtMoney, fmtR } from '@/lib/format'
import { toMoneyCents } from '@/lib/riskBudget'
import { parseLocalDate } from '@/lib/periods'
import { useLocalDateKey } from '@/hooks/useLocalDateKey'
import { useStore } from '@/store/useStore'
import { getCurrentLiveStage } from '@/lib/liveStages'
import { Button } from '@/components/ui/Button'
import './WeeklyRiskPreparationCard.css'
import { previewRiskPolicyBaseline } from '@/lib/riskPolicy'
import { presentRiskPolicyDiff } from '@/lib/riskPolicyDiff'

function fmtLimitR(value: number): string {
  return fmtR(Math.abs(value)).replace(/^\+/, '')
}

const DEFAULT_DRAFT: RiskPolicyDraft = {
  capitalBase: null,
  riskPercent: 1,
  riskAmount: null,
  dailyLossLimitR: 2,
  weeklyLossLimitR: 5,
  monthlyLossLimitRDefault: 10,
  disciplineText: '触线后停止开仓，先复核执行偏差。',
}

function draftFromPolicy(
  policy: RiskPolicyVersion | null,
): RiskPolicyDraft {
  if (!policy) return { ...DEFAULT_DRAFT }
  return {
    capitalBase: policy.capitalBase,
    riskPercent: policy.riskPercent,
    riskAmount: policy.riskAmount,
    dailyLossLimitR: policy.dailyLossLimitR,
    weeklyLossLimitR: policy.weeklyLossLimitR,
    monthlyLossLimitRDefault: policy.monthlyLossLimitRDefault,
    disciplineText: policy.disciplineText,
  }
}

function withCalculatedRiskAmount(draft: RiskPolicyDraft): RiskPolicyDraft {
  const amount = draft.capitalBase == null
    ? null
    : toMoneyCents(draft.capitalBase * draft.riskPercent / 100) / 100
  return { ...draft, riskAmount: amount }
}

function withRiskAmount(draft: RiskPolicyDraft, riskAmount: number | null): RiskPolicyDraft {
  if (draft.capitalBase == null || riskAmount == null || draft.capitalBase <= 0) {
    return { ...draft, riskAmount }
  }
  const canonicalAmount = toMoneyCents(riskAmount) / 100
  return {
    ...draft,
    riskAmount: canonicalAmount,
    riskPercent: canonicalAmount / draft.capitalBase * 100,
  }
}



export function WeeklyRiskPreparationCard({
  currentTradingDayKey,
}: {
  currentTradingDayKey?: string
}) {
  const liveTradingDay = useLocalDateKey()
  const tradingDay = currentTradingDayKey ?? liveTradingDay
  const weekStart = weekStartFor(parseLocalDate(tradingDay))
  const policies = useStore((state) => state.riskPolicyVersions)
  const monthlyLimits = useStore((state) => state.monthlyRiskLimits)
  const liveStages = useStore((state) => state.liveStages)
  const currentLiveStageId = useStore((state) => state.currentLiveStageId)
  const currentStage = getCurrentLiveStage(liveStages, currentLiveStageId)
  const privacyMode = useStore((state) => state.display.privacyMode)
  const saveRiskBaseline = useStore((state) => state.saveRiskBaseline)
  const policy = useMemo(() => policies
    .filter((item) => item.liveStageId === currentStage.id && !item.historicalBackfill)
    .sort((left, right) => left.confirmedAt.localeCompare(right.confirmedAt))
    .at(-1) ?? null, [currentStage.id, policies])
  const previousStagePolicy = useMemo(() => policies
    .filter((item) => item.liveStageId !== currentStage.id && !item.historicalBackfill)
    .sort((left, right) => left.confirmedAt.localeCompare(right.confirmedAt))
    .at(-1) ?? null, [currentStage.id, policies])
  const reviewed = Boolean(policy)
  const confirmedPolicy = policy
  const sourceDraft = draftFromPolicy(policy ?? previousStagePolicy)
  const [draft, setDraft] = useState<RiskPolicyDraft>(() => sourceDraft)
  const [editingReviewed, setEditingReviewed] = useState(false)
  const [error, setError] = useState('')
  const currentMonthKey = tradingDay.slice(0, 7)
  const currentMonthLimit = monthlyLimits.find((item) =>
    item.liveStageId === currentStage.id && item.monthKey === currentMonthKey,
  )
  const preview = useMemo(() => {
    try {
      return previewRiskPolicyBaseline({
        currentLiveStageId: currentStage.id,
        weeklyRiskPreparations: [],
        riskPolicyVersions: policies,
        monthlyRiskLimits: monthlyLimits,
        riskOverrideEvents: [],
      }, {
        currentTradingDayKey: tradingDay,
        weekStart,
        hasClosedLiveTradeOnDay: false,
        draft: withCalculatedRiskAmount(draft),
        confirmedAt: new Date().toISOString(),
        policyVersionId: '__risk-policy-preview__',
      })
    } catch {
      return null
    }
  }, [currentStage.id, draft, monthlyLimits, policies, tradingDay, weekStart])
  const diff = preview ? presentRiskPolicyDiff(preview, policy) : null

  useEffect(() => {
    setDraft(sourceDraft)
    if (!reviewed) setEditingReviewed(false)
  }, [policy?.id, previousStagePolicy?.id, currentStage.id, weekStart, reviewed])

  const updateDraft = (patch: Partial<RiskPolicyDraft>) => {
    const next = withCalculatedRiskAmount({ ...draft, ...patch })
    setDraft(next)
    setError('')
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    try {
      const now = new Date().toISOString()
      saveRiskBaseline({
        currentTradingDayKey: tradingDay,
        weekStart,
        draft: withCalculatedRiskAmount(draft),
        confirmedAt: now,
        policyVersionId: `risk-policy:${weekStart}:${crypto.randomUUID()}`,
      })
      setEditingReviewed(false)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '风险基准无法保存')
    }
  }

  if (reviewed && !editingReviewed) {
    return (
      <section
        className="risk-preparation-card is-reviewed"
        data-risk-preparation
        data-reviewed="true"
        aria-labelledby="risk-preparation-title"
      >
        <div className="risk-preparation-summary-copy">
          <h2 id="risk-preparation-title">当前阶段</h2>
          <p className="risk-preparation-summary-limits">
            日 {fmtLimitR(sourceDraft.dailyLossLimitR)} · 周 {fmtLimitR(sourceDraft.weeklyLossLimitR)} ·
            本月 {fmtLimitR(currentMonthLimit?.limitR ?? sourceDraft.monthlyLossLimitRDefault)}
          </p>
          {confirmedPolicy && confirmedPolicy.effectiveTradingDay > tradingDay ? (
            <p className="risk-preparation-summary-future">本周规则将于 {confirmedPolicy.effectiveTradingDay} 起生效</p>
          ) : null}
        </div>
        <Button variant="bordered" size="sm" onClick={() => setEditingReviewed(true)}>
          修改
        </Button>
      </section>
    )
  }

  return (
    <section
      className="risk-preparation-card"
      data-risk-preparation
      data-reviewed={reviewed ? 'true' : 'false'}
      aria-labelledby="risk-preparation-title"
    >
      <header className="risk-preparation-header">
        <div>
          <h2 id="risk-preparation-title">{reviewed ? '修改风险规则' : '设置风险规则'}</h2>
          {!policy ? <p>{previousStagePolicy ? '已参考上一阶段规则，请核对资金基准。' : '已填入初始参考值，请按实际规则调整。'}</p> : null}
        </div>
      </header>
      <form className="risk-preparation-form" onSubmit={submit}>
        <div className="risk-preparation-fields">
          <label>
            <span>资金基准</span>
            <input
              type={privacyMode ? 'password' : 'number'}
              min="0.01"
              step="0.01"
              value={draft.capitalBase ?? ''}
              onChange={(event) => updateDraft({ capitalBase: event.target.value ? Number(event.target.value) : null })}
              required
            />
          </label>
          <label>
            <span>单笔风险比例</span>
            <span className="risk-preparation-inline-input">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={draft.riskPercent}
                onChange={(event) => updateDraft({ riskPercent: Number(event.target.value) })}
                required
              />
              <small>%</small>
            </span>
          </label>
          {(['dailyLossLimitR', 'weeklyLossLimitR'] as const).map((key, index) => (
            <label key={key}>
              <span>{['日止损线', '周止损线'][index]}</span>
              <span className="risk-preparation-inline-input">
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={draft[key]}
                  onChange={(event) => updateDraft({ [key]: Number(event.target.value) })}
                  required
                />
                <small>R</small>
              </span>
            </label>
          ))}
          <label>
            <span>
              {currentMonthLimit ? '未来月止损线' : '月止损线'}
            </span>
            <span className="risk-preparation-inline-input">
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={draft.monthlyLossLimitRDefault}
                onChange={(event) => updateDraft({ monthlyLossLimitRDefault: Number(event.target.value) })}
                required
              />
              <small>R</small>
            </span>
          </label>
        </div>
        {preview ? (
          <div className="risk-policy-diff" role="status">
            <p>{preview.policy.effectiveTradingDay} 起生效，此前交易不回写；{currentMonthLimit
              ? `${currentMonthKey} 额度保持 ${fmtLimitR(currentMonthLimit.limitR)}，月止损线仅用于未锁定月份。`
              : `本月额度首次锁定为 ${fmtLimitR(draft.monthlyLossLimitRDefault)}。`}</p>
            {diff && diff.changes.length > 0 ? <details><summary>查看 {diff.changes.length} 项修改</summary>
              <ul>{diff.changes.map((change) => <li key={change}>{change}</li>)}</ul>
            </details> : null}
          </div>
        ) : null}
        <div className="risk-preparation-discipline-row">
          <label>
            <span>本周纪律</span>
            <input
              value={draft.disciplineText}
              maxLength={500}
              onChange={(event) => updateDraft({ disciplineText: event.target.value })}
              placeholder="例如：触线后停止开仓，先复核执行偏差。"
            />
          </label>
          <div className="risk-preparation-actions">
            <span className="risk-preparation-risk-amount">
              <label>
                <span>1R 金额</span>
                <input
                  aria-label="1R 金额"
                  type={privacyMode ? 'password' : 'number'}
                  min="0.01"
                  step="0.01"
                  value={draft.riskAmount ?? ''}
                  onChange={(event) => {
                    const next = withRiskAmount(draft, event.target.value ? Number(event.target.value) : null)
                    setDraft(next)
                    setError('')
                  }}
                  required
                />
              </label>
            </span>
            {reviewed ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft(sourceDraft)
                  setEditingReviewed(false)
                  setError('')
                }}
              >
                取消修改
              </Button>
            ) : null}
            <Button type="submit" variant="primary">保存风险基准</Button>
          </div>
        </div>
        {error ? <p className="risk-preparation-error" role="alert">{error}</p> : null}
      </form>
    </section>
  )
}
