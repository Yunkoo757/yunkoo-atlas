import { ICON_LG, ICON_MD } from '@/icons/iconSize'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { CheckCircle, Shield } from '@/icons/appIcons'
import type { RiskPolicyDraft } from '@/data/riskManagement'
import { weekStartFor } from '@/data/weeklyReviews'
import { fmtMoney, fmtR } from '@/lib/format'
import { toMoneyCents } from '@/lib/riskBudget'
import { activeRiskPolicy } from '@/lib/riskPolicy'
import { parseLocalDate } from '@/lib/periods'
import { useLocalDateKey } from '@/hooks/useLocalDateKey'
import { useStore } from '@/store/useStore'
import { Button } from '@/components/ui/Button'
import './WeeklyRiskPreparationCard.css'

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
  policy: ReturnType<typeof activeRiskPolicy>,
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

function nextMonthKey(tradingDay: string): string {
  const date = parseLocalDate(`${tradingDay.slice(0, 7)}-01`)
  date.setMonth(date.getMonth() + 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function WeeklyRiskPreparationCard({
  currentTradingDayKey,
}: {
  currentTradingDayKey?: string
}) {
  const liveTradingDay = useLocalDateKey()
  const tradingDay = currentTradingDayKey ?? liveTradingDay
  const weekStart = weekStartFor(parseLocalDate(tradingDay))
  const preparations = useStore((state) => state.weeklyRiskPreparations)
  const policies = useStore((state) => state.riskPolicyVersions)
  const monthlyLimits = useStore((state) => state.monthlyRiskLimits)
  const privacyMode = useStore((state) => state.display.privacyMode)
  const saveDraft = useStore((state) => state.saveWeeklyRiskDraft)
  const confirmPreparation = useStore((state) => state.confirmWeeklyRiskPreparation)
  const preparation = preparations.find((item) => item.weekStart === weekStart)
  const policy = useMemo(
    () => activeRiskPolicy(policies, tradingDay),
    [policies, tradingDay],
  )
  const reviewed = Boolean(preparation?.reviewedAt && preparation.confirmedPolicyVersionId)
  const confirmedPolicy = preparation?.confirmedPolicyVersionId
    ? policies.find((item) => item.id === preparation.confirmedPolicyVersionId)
    : null
  const sourceDraft = preparation?.draft ?? draftFromPolicy(policy)
  const [draft, setDraft] = useState<RiskPolicyDraft>(() => sourceDraft)
  const [editingReviewed, setEditingReviewed] = useState(false)
  const [error, setError] = useState('')
  const currentMonthKey = tradingDay.slice(0, 7)
  const currentMonthLimit = monthlyLimits.find((item) => item.monthKey === currentMonthKey)

  useEffect(() => {
    setDraft(sourceDraft)
    if (!reviewed) setEditingReviewed(false)
  }, [preparation?.updatedAt, policy?.id, weekStart, reviewed])

  const updateDraft = (patch: Partial<RiskPolicyDraft>) => {
    const next = withCalculatedRiskAmount({ ...draft, ...patch })
    setDraft(next)
    setError('')
    if (!reviewed) saveDraft(weekStart, next, new Date().toISOString())
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    try {
      const now = new Date().toISOString()
      confirmPreparation({
        currentTradingDayKey: tradingDay,
        weekStart,
        draft: withCalculatedRiskAmount(draft),
        confirmedAt: now,
        policyVersionId: `risk-policy:${weekStart}:${crypto.randomUUID()}`,
      })
      setEditingReviewed(false)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '本周风险规则无法确认')
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
        <div className="risk-preparation-summary-icon" aria-hidden><CheckCircle size={ICON_MD} /></div>
        <div className="risk-preparation-summary-copy">
          <h2 id="risk-preparation-title">本周风险规则已复核</h2>
          <p className="risk-preparation-summary-limits">
            日 {fmtLimitR(sourceDraft.dailyLossLimitR)} · 周 {fmtLimitR(sourceDraft.weeklyLossLimitR)} ·
            本月 {fmtLimitR(currentMonthLimit?.limitR ?? sourceDraft.monthlyLossLimitRDefault)}
          </p>
          {confirmedPolicy && confirmedPolicy.effectiveTradingDay > tradingDay ? (
            <p className="risk-preparation-summary-future">本周规则将于 {confirmedPolicy.effectiveTradingDay} 起生效</p>
          ) : null}
        </div>
        <Button variant="bordered" size="sm" onClick={() => setEditingReviewed(true)}>
          修改规则
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
        <span className="risk-preparation-icon" aria-hidden><Shield size={ICON_LG} /></span>
        <div>
          <span className="risk-preparation-eyebrow">本周准备</span>
          <h2 id="risk-preparation-title">{reviewed ? '修改本周风险规则' : '先复核本周风险规则'}</h2>
          <p>{reviewed ? '修改后的版本按下一有效交易日起生效。' : '复核前此卡会持续显示；上一版有效规则仍然生效。'}</p>
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
              {currentMonthLimit
                ? `${nextMonthKey(tradingDay)} 起未来月止损默认`
                : '当前月止损上限（首次确认后锁定）'}
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
        <div className="risk-preparation-month-lock">
          {currentMonthLimit
            ? `当前月 ${currentMonthKey} 已锁定：${fmtLimitR(currentMonthLimit.limitR)}`
            : `首次确认将以 ${fmtLimitR(draft.monthlyLossLimitRDefault)} 建立并锁定当前月 ${currentMonthKey} 上限`}
          {currentMonthLimit ? '；修改仅影响尚未锁定的未来月份。' : '。'}
        </div>
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
                    if (!reviewed) saveDraft(weekStart, next, new Date().toISOString())
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
            <Button type="submit" variant="primary">确认本周规则</Button>
          </div>
        </div>
        {error ? <p className="risk-preparation-error" role="alert">{error}</p> : null}
      </form>
    </section>
  )
}
