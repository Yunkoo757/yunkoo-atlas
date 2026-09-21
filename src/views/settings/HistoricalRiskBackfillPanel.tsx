import { Link } from 'react-router-dom'
import { useRef, useState } from 'react'
import type { RiskDataIssue, RiskPolicyDraft } from '@/data/riskManagement'
import { useStore } from '@/store/useStore'
import { activeRiskPolicy } from '@/lib/activeRiskPolicy'
import { previewHistoricalRiskBackfill, type HistoricalRiskInput, type HistoricalRiskPreview } from '@/lib/historicalRiskBackfill'
import { flushPersistNow } from '@/storage/persist'
import { ModalShell } from '@/components/ui/ModalShell'
import { fmtR } from '@/lib/format'
import './HistoricalRiskBackfillPanel.css'

export function HistoricalRiskBackfillPanel({ today, issues }: { today: string; issues: RiskDataIssue[] }) {
  const state = useStore()
  const noteRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState<HistoricalRiskInput | null>(null)
  const [preview, setPreview] = useState<HistoricalRiskPreview | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const missing = issues.filter((issue) => issue.reasons.some((reason) => reason === 'missing-policy' || reason === 'partial-missing-policy'))
  const source = activeRiskPolicy(state.riskPolicyVersions.filter((item) => !item.historicalBackfill), today, state.currentLiveStageId)
  const history = state.riskPolicyVersions.filter((item) => item.liveStageId === state.currentLiveStageId && item.historicalBackfill)

  function start() {
    if (!source) return
    setInput({ startsOn: missing.map((issue) => issue.tradingDayKey).filter((day): day is string => !!day).sort()[0] ?? '',
      today, draft: { ...source }, sourcePolicyVersionId: source.id,
      note: '', confirmedAt: new Date().toISOString(), policyVersionId: `risk-history:${crypto.randomUUID()}` })
    setPreview(null); setConfirmed(false); setError(''); setResult(''); setOpen(true)
  }

  function change(patch: Partial<HistoricalRiskInput>) {
    setInput((value) => value ? { ...value, ...patch } : value)
    setPreview(null); setConfirmed(false); setError('')
  }

  async function save() {
    if (!input || !preview || !confirmed || busy) return
    if (!input.note.trim()) {
      setError('请填写确认历史规则的依据。'); noteRef.current?.focus(); return
    }
    setBusy(true); setError('')
    let saved: HistoricalRiskPreview | null = null
    try {
      await flushPersistNow()
      saved = useStore.getState().saveHistoricalRiskBackfill({ ...input, today, confirmedAt: new Date().toISOString() }, preview.fingerprint)
      await flushPersistNow()
      setResult(`已补录历史规则，解除 ${saved.resolved.length} 项缺口；剩余 ${saved.remainingCount} 项。`)
      setOpen(false)
    } catch (caught) {
      if (saved) {
        const id = saved.policy.id
        useStore.setState((latest) => ({
          riskPolicyVersions: latest.riskPolicyVersions.filter((item) => item.id !== id),
          monthlyRiskLimits: latest.monthlyRiskLimits.filter((item) => item.sourcePolicyVersionId !== id),
        }))
        try { await flushPersistNow() } catch {
          setError('保存和回滚均未确认，请先处理资料库保存错误，再重新打开补录。')
          setPreview(null); setConfirmed(false); return
        }
      }
      setError(caught instanceof Error ? caught.message : '保存失败，请重试。')
      setPreview(null); setConfirmed(false)
    } finally { setBusy(false) }
  }

  return <>
    {result ? <p role="status" className="historical-risk-result">{result}</p> : null}
    {missing.length > 0 ? <section className="settings-page-section historical-risk-entry" aria-label="历史规则补录">
      <h2 className="settings-section-title">补录历史规则</h2>
      {source ? <><p className="settings-section-desc">仅补录能确认当时适用的规则。</p>
      <button className="ui-btn ui-btn-bordered" onClick={start}>补录历史风险规则</button></> : null}
      {!source ? <p className="settings-section-desc">请先<Link to="/settings/risk">设置当前风险规则</Link>，生效后再补录。</p> : null}
    </section> : null}
    {history.length ? <section className="settings-page-section historical-risk-history" aria-label="历史补录记录">
      <details>
        <summary className="historical-risk-history-title">历史补录记录 <span>{history.length} 次</span></summary>
        {history.map((policy) => <details key={policy.id} className="historical-risk-record">
          <summary>{policy.effectiveTradingDay} 至 {policy.historicalBackfill!.throughTradingDay}</summary>
          <div className="historical-risk-record-body">
            <p>补录于 {new Date(policy.confirmedAt).toLocaleString()} · 1R = {state.display.privacyMode ? '****' : policy.riskAmount}</p>
            <p>日 {policy.dailyLossLimitR}R · 周 {policy.weeklyLossLimitR}R · 月 {policy.monthlyLossLimitRDefault}R</p>
            <p>依据：{policy.historicalBackfill!.note}</p>
            <details><summary>技术详情</summary><p>参考规则：{policy.historicalBackfill!.sourcePolicyVersionId}</p></details>
          </div>
        </details>)}
      </details>
    </section> : null}
    {open && input ? <ModalShell title={preview ? "确认历史补录" : "补录历史风险规则"} busy={busy}
      description={preview ? undefined : "已参考当前规则，请按历史实际情况调整。"}
      onClose={() => { if (!busy) setOpen(false) }}
      footerClassName="historical-risk-footer"
      footer={<>
        {preview ? <label className="historical-risk-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} /><span>我确认规则在该历史区间实际适用，同意重新核算。</span></label> : null}
        {preview ? <button className="ui-btn ui-btn-ghost historical-risk-back" disabled={busy} onClick={() => { setPreview(null); setConfirmed(false); setError('') }}>返回修改设置</button> : null}
        <button className="ui-btn ui-btn-bordered" disabled={busy} onClick={() => setOpen(false)}>取消</button>
        {preview ? <button className="ui-btn ui-btn-primary" disabled={!confirmed || busy} onClick={() => void save()}>{busy ? '保存并重新核算中…' : '确认补录并重新核算'}</button>
          : <button className="ui-btn ui-btn-primary" disabled={busy} onClick={() => {
            try { setPreview(previewHistoricalRiskBackfill(useStore.getState(), { ...input, today })); setError('') }
            catch (caught) { setError(caught instanceof Error ? caught.message : '无法预览') }
          }}>预览补录结果</button>}
      </>}>
      <div className="historical-risk-form">

        {!preview ? <fieldset disabled={busy}>
          <label>历史起始日期<input type="date" aria-label="历史起始日期" value={input.startsOn} onChange={(e) => change({ startsOn: e.target.value })} /></label>
          {([
            ['capitalBase', '历史资金基准'], ['riskPercent', '单笔风险比例（%）'],
            ['dailyLossLimitR', '日止损线（R）'], ['weeklyLossLimitR', '周止损线（R）'], ['monthlyLossLimitRDefault', '月止损默认（R）'],
          ] as const).map(([key, label]) => <label key={key}>{label}<input type={key === 'capitalBase' && state.display.privacyMode ? 'password' : 'number'} min="0.01" step="0.01" aria-label={label}
            value={input.draft[key] ?? ''} onChange={(e) => change({ draft: { ...input.draft, [key]: e.target.value === '' ? null : Number(e.target.value) } as RiskPolicyDraft })} /></label>)}

        </fieldset> : null}
        {!preview ? <p className="settings-section-desc">截止至首个已有规则生效前一天。</p> : null}
        {preview ? <section className="historical-risk-preview" aria-label="补录结果预览">
          <div className="historical-risk-preview-summary">
            <h3>{preview.policy.effectiveTradingDay} 至 {preview.policy.historicalBackfill!.throughTradingDay}</h3>
            <p>可解除 {preview.resolved.length} 项缺口，剩余 {preview.remainingCount} 项。</p>
            <p className="settings-section-desc">1R = {state.display.privacyMode ? '****' : preview.policy.riskAmount} · 单笔 {preview.policy.riskPercent}% · 日 {preview.policy.dailyLossLimitR}R / 周 {preview.policy.weeklyLossLimitR}R / 月 {preview.policy.monthlyLossLimitRDefault}R</p>
          </div>
          <table><thead><tr><th>周期</th><th>补录前剩余</th><th>补录后剩余</th></tr></thead><tbody>
            {(['day', 'week', 'month'] as const).map((key, index) => <tr key={key}><td>{['日', '周', '月'][index]}</td>
              <td>{preview.beforeOutcomes[key].coverage === 'complete' ? fmtR(preview.beforeOutcomes[key].remainingR) : '数据不完整'}</td>
              <td>{preview.afterOutcomes[key].coverage === 'complete' ? fmtR(preview.afterOutcomes[key].remainingR) : '仍有其他缺口'}</td></tr>)}
          </tbody></table>
          <details className="historical-risk-trades">
            <summary>查看 {preview.affected.length} 笔交易</summary>
            <ul>{preview.affected.map((issue) => <li key={issue.tradeId}><span>{issue.tradeRef} · {issue.tradingDayKey}</span><span>{preview.resolved.some((item) => item.tradeId === issue.tradeId) ? '可解除缺口' : '仍需补全数据'}</span></li>)}</ul>
          </details>
          <p className="settings-section-desc">交易盈亏、已有规则和复盘快照保持不变。{preview.newMonthlyLimits.length ? `将补齐 ${preview.newMonthlyLimits.map((item) => item.monthKey).join('、')} 的月上限。` : '已有月上限保持不变。'}</p>
          <label className="historical-risk-note">历史规则依据
            <input ref={noteRef} aria-label="历史规则依据" aria-invalid={!!error && !input.note.trim() || undefined} aria-describedby={error ? 'historical-risk-error' : undefined} placeholder="例如：已核对当周交易计划中的规则" maxLength={500} value={input.note} disabled={busy} onChange={(e) => { setInput({ ...input, note: e.target.value }); setError('') }} />
          </label>
          {error ? <p id="historical-risk-error" className="historical-risk-error" role="alert">{error}</p> : null}
        </section> : null}
        {error && !preview ? <p className="historical-risk-error" role="alert">{error}</p> : null}
      </div>
    </ModalShell> : null}
  </>
}
