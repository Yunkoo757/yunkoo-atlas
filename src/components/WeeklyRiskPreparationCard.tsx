import { ICON_LG, ICON_MD } from '@/icons/iconSize'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { CheckCircle, Shield } from '@/icons/appIcons'
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
  const policies = useStore((state) => state.riskPolicyVersions)
  const monthlyLimits = useStore((state) => state.monthlyRiskLimits)
  const liveStages = useStore((state) => state.liveStages)
  const currentLiveStageId = useStore((state) => state.currentLiveStageId)
  const currentStage = getCurrentLiveStage(liveStages, currentLiveStageId)
  const privacyMode = useStore((state) => state.display.privacyMode)
  const saveRiskBaseline = useStore((state) => state.saveRiskBaseline)
  const policy = useMemo(() => policies
    .filter((item) => item.liveStageId === currentStage.id)
    .sort((left, right) => left.confirmedAt.localeCompare(right.confirmedAt))
    .at(-1) ?? null, [currentStage.id, policies])
  const previousStagePolicy = useMemo(() => policies
    .filter((item) => item.liveStageId !== currentStage.id)
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
        <div className="risk-preparation-summary-icon" aria-hidden><CheckCircle size={ICON_MD} /></div>
        <div className="risk-preparation-summary-copy">
          <h2 id="risk-preparation-title">当前阶段风险基准已设置</h2>
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
          <span className="risk-preparation-eyebrow">风险基准</span>
          <h2 id="risk-preparation-title">{reviewed ? '修改风险规则' : '设置当前阶段风险基准'}</h2>
          <p>{reviewed ? '修改会生成新版本，并从下一交易日起生效。' : previousStagePolicy ? '已预填上一阶段规则；确认后从今天立即生效。' : '设置后系统才能计算日、周、月风险额度。'}</p>
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
        {diff ? (
          <div className="risk-policy-diff" role="status">
            <strong>保存影响</strong>
            <p>{diff.summary}</p>
            {diff.monthlyImpact ? <p>{diff.monthlyImpact}</p> : null}
            {diff.changes.length ? <ul>{diff.changes.map((change) => <li key={change}>{change}</li>)}</ul> : null}
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
