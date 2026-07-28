import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle } from '@/icons/appIcons'
import {
  buildLiveCyclePreview,
  isValidLiveCycleDayKey,
  suggestLiveCycleStartTradingDayKey,
} from '@/lib/liveCycle'
import { toast } from '@/lib/toast'
import { activeRiskPolicy } from '@/lib/riskPolicy'
import { flushPersistNow } from '@/storage/persist'
import { useStore } from '@/store/useStore'
import { DatePicker } from '@/components/ui/DatePicker'
import { ModalShell } from '@/components/ui/ModalShell'
import './LiveCycleSettings.css'

type LiveCycleSettingsProps = {
  variant: 'prompt' | 'settings'
  currentTradingDayKey: string
  forcePrompt?: boolean
}

function resetDraft(current: string | null, suggested: string | null, fallback: string): string {
  return current ?? suggested ?? fallback
}

export function LiveCycleSettings({ variant, currentTradingDayKey, forcePrompt = false }: LiveCycleSettingsProps) {
  const trades = useStore((state) => state.trades)
  const policies = useStore((state) => state.riskPolicyVersions)
  const currentStart = useStore((state) => state.liveStatsStartTradingDayKey)
  const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)
  const saveStart = useStore((state) => state.setLiveStatsStartTradingDayKey)
  const suggested = suggestLiveCycleStartTradingDayKey(policies)
  const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get('visual') === 'dialog')
  const [busy, setBusy] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [draft, setDraft] = useState(() => resetDraft(currentStart, suggested, currentTradingDayKey))
  const preview = useMemo(
    () => isValidLiveCycleDayKey(draft)
      ? buildLiveCyclePreview(trades, draft, tradingDayStartHour)
      : { current: [], preCycle: [], unresolved: [] },
    [draft, trades, tradingDayStartHour],
  )
  const draftLacksRiskPolicyCoverage = isValidLiveCycleDayKey(draft) && activeRiskPolicy(policies, draft) === null
  const promptEligible = currentStart === null && suggested !== null &&
    (preview.preCycle.length > 0 || preview.unresolved.length > 0)
  if (variant === 'prompt' && !promptEligible && !forcePrompt) return null

  const openPreview = () => {
    setDraft(resetDraft(currentStart, suggested, currentTradingDayKey))
    setConfirmClear(false)
    setOpen(true)
  }

  const commitStart = async (next: string | null, successMessage: string) => {
    const previous = useStore.getState().liveStatsStartTradingDayKey
    setBusy(true)
    saveStart(next)
    try {
      await flushPersistNow()
      setOpen(false)
      setConfirmClear(false)
      toast(successMessage)
    } catch {
      saveStart(previous)
      await flushPersistNow().catch(() => undefined)
      toast('统计起点保存失败，原设置已保留')
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!isValidLiveCycleDayKey(draft) || draft > currentTradingDayKey || preview.unresolved.length > 0) return
    await commitStart(draft, `当前实盘周期已从 ${draft} 开始`)
  }

  const trigger = variant === 'prompt' ? currentStart === null ? (
    <section className="live-cycle-prompt" data-live-cycle-prompt>
      <div>
        <strong>实盘统计尚未截断</strong>
        <p>{suggested
          ? `当前风险规则从 ${suggested} 起生效；建立统计起点可避免规则前记录混入本周期。`
          : '风险统计覆盖未知；可先核对实盘统计起点。'}</p>
      </div>
      <button type="button" className="ui-btn ui-btn-bordered" onClick={openPreview}>建立实盘统计起点</button>
    </section>
  ) : (
    <section className="live-cycle-prompt" data-live-cycle-risk-repair>
      <div>
        <strong>当前周期风险覆盖未知</strong>
        <p>统计起点已设置为 {currentStart}；请补齐周期内的风险规则、亏损金额或平仓日期。</p>
      </div>
      <Link className="ui-btn ui-btn-bordered" to="/settings/data">检查风险与数据</Link>
    </section>
  ) : (
    <section className="live-cycle-settings" data-live-cycle-settings>
      <div className="live-cycle-settings-copy">
        <h2>实盘统计周期</h2>
        <p>{currentStart ? `当前从 ${currentStart} 起统计实盘记录。` : '未设置起点，默认统计全部实盘记录。'}</p>
      </div>
      <div className="live-cycle-settings-actions">
        <button type="button" className="ui-btn ui-btn-primary" onClick={openPreview}>
          {currentStart ? '调整实盘统计起点' : '建立实盘统计起点'}
        </button>
        {currentStart ? (
          <button type="button" className="ui-btn ui-btn-bordered" onClick={() => setConfirmClear(true)}>清除统计起点</button>
        ) : null}
      </div>
      {confirmClear ? (
        <div className="live-cycle-clear-confirm" role="status">
          <span>清除后将恢复全部实盘统计。</span>
          <button type="button" className="ui-btn ui-btn-bordered" disabled={busy} onClick={() => setConfirmClear(false)}>取消</button>
          <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={() => void commitStart(null, '已恢复全部实盘统计')}>确认清除</button>
        </div>
      ) : null}
    </section>
  )

  return (
    <>
      {trigger}
      {open ? (
        <ModalShell
          title={currentStart ? '调整实盘统计起点' : '建立实盘统计起点'}
          description="保存前先核对将被纳入当前周期的实盘记录；不会修改任何历史交易。"
          size="compact"
          busy={busy}
          onClose={() => {
            if (!busy) setOpen(false)
          }}
          footer={(
            <>
              <button type="button" className="ui-btn ui-btn-bordered" disabled={busy} onClick={() => setOpen(false)}>取消</button>
              <button
                type="button"
                className="ui-btn ui-btn-primary"
                disabled={busy || !isValidLiveCycleDayKey(draft) || draft > currentTradingDayKey || preview.unresolved.length > 0}
                onClick={() => void confirm()}
              >
                确认建立新周期
              </button>
            </>
          )}
        >
          <div className="live-cycle-dialog" data-live-cycle-dialog>
            <label className="live-cycle-date-field">
              <span>统计起点</span>
              <DatePicker value={draft} onValueChange={setDraft} ariaLabel="实盘统计起点" disabled={busy} />
              <small>不得晚于当前交易日 {currentTradingDayKey}</small>
            </label>
            <div className="live-cycle-counts" aria-label="周期影响预览">
              <div><strong>规则前实盘 {preview.preCycle.length} 笔</strong><span>将不计入新周期</span></div>
              <div><strong>当前周期 {preview.current.length} 笔</strong><span>将继续计入</span></div>
              <div><strong>无法判断 {preview.unresolved.length} 笔</strong><span>需先修正开仓日期</span></div>
            </div>
            {preview.unresolved.length > 0 ? (
              <p className="live-cycle-warning" role="alert"><AlertCircle size={16} />存在无法判断开仓日期的实盘记录，修正后才能保存。</p>
            ) : null}
            {draftLacksRiskPolicyCoverage ? (
              <p className="live-cycle-warning" role="status"><AlertCircle size={16} />所选起点当日没有生效的风险规则；周期内缺少规则覆盖的交易仍会显示为覆盖未知。此提示不阻止保存。</p>
            ) : null}
            <div className="live-cycle-preview-list">
              {[...preview.preCycle, ...preview.current, ...preview.unresolved].map((trade) => (
                <div key={trade.id}>
                  <code>{trade.ref}</code><span>{trade.symbol}</span><time>{trade.openedAt}</time>
                </div>
              ))}
            </div>
          </div>
        </ModalShell>
      ) : null}
    </>
  )
}
