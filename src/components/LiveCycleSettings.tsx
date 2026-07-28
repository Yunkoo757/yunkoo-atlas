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

const PREVIEW_LIMIT = 50

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
      try {
        await flushPersistNow()
        toast('风险核算起点保存失败，原设置已保留')
      } catch {
        toast('风险核算起点保存与回滚均失败，请重新打开应用核对当前设置')
      }
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!isValidLiveCycleDayKey(draft) || draft > currentTradingDayKey || preview.unresolved.length > 0) return
    await commitStart(draft, `风险核算将从 ${draft} 开始`)
  }

  const trigger = variant === 'prompt' ? currentStart === null ? (
    <section className="live-cycle-prompt" data-live-cycle-prompt>
      <div>
        <strong>风险核算起点尚未设置</strong>
        <p>{suggested
          ? `当前风险规则从 ${suggested} 起生效；建立核算起点可避免此前记录造成覆盖未知。`
          : '风险统计覆盖未知；可先核对风险核算起点。'}</p>
      </div>
      <button type="button" className="ui-btn ui-btn-bordered" onClick={openPreview}>建立风险核算起点</button>
    </section>
  ) : (
    <section className="live-cycle-prompt" data-live-cycle-risk-repair>
      <div>
        <strong>起点后风险覆盖未知</strong>
        <p>风险核算起点为 {currentStart}；请补齐起点后的风险规则、亏损金额或平仓日期。</p>
      </div>
      <Link className="ui-btn ui-btn-bordered" to="/settings/data">检查风险与数据</Link>
    </section>
  ) : (
    <section className="live-cycle-settings" data-live-cycle-settings>
      <div className="live-cycle-settings-copy">
        <h2>风险核算范围</h2>
        <p>{currentStart
          ? `风险额度与开仓门禁从 ${currentStart} 起核算；交易日志、策略与绩效统计仍保留全部历史。`
          : '未设置起点，风险核算会检查全部实盘历史。'}</p>
      </div>
      <div className="live-cycle-settings-actions">
        <button type="button" className="ui-btn ui-btn-primary" onClick={openPreview}>
          {currentStart ? '调整风险核算起点' : '建立风险核算起点'}
        </button>
        {currentStart ? (
          <button type="button" className="ui-btn ui-btn-bordered" onClick={() => setConfirmClear(true)}>清除风险核算起点</button>
        ) : null}
      </div>
      {confirmClear ? (
        <div className="live-cycle-clear-confirm" role="status">
          <span>清除后风险核算将检查全部实盘历史；旧记录缺失风险数据时可能重新显示为无法判断。</span>
          <button type="button" className="ui-btn ui-btn-bordered" disabled={busy} onClick={() => setConfirmClear(false)}>取消</button>
          <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={() => void commitStart(null, '已恢复全历史风险核算')}>确认清除</button>
        </div>
      ) : null}
    </section>
  )

  return (
    <>
      {trigger}
      {open ? (
        <ModalShell
          title={currentStart ? '调整风险核算起点' : '建立风险核算起点'}
          description="保存前先核对风险核算范围；不会修改交易记录，也不会改变策略与绩效统计。"
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
                确认设置起点
              </button>
            </>
          )}
        >
          <div className="live-cycle-dialog" data-live-cycle-dialog>
            <label className="live-cycle-date-field">
              <span>风险核算起点</span>
              <DatePicker value={draft} onValueChange={setDraft} ariaLabel="风险核算起点" disabled={busy} />
              <small>不得晚于当前交易日 {currentTradingDayKey}</small>
            </label>
            <div className="live-cycle-counts" aria-label="周期影响预览">
              <div><strong>规则前实盘 {preview.preCycle.length} 笔</strong><span>不计入风险核算</span></div>
              <div><strong>起点后实盘 {preview.current.length} 笔</strong><span>计入风险核算</span></div>
              <div><strong>无法判断 {preview.unresolved.length} 笔</strong><span>需先修正开仓日期</span></div>
            </div>
            {preview.unresolved.length > 0 ? (
              <p className="live-cycle-warning" role="alert"><AlertCircle size={16} />存在无法判断开仓日期的实盘记录，修正后才能保存。</p>
            ) : null}
            {draftLacksRiskPolicyCoverage ? (
              <p className="live-cycle-warning" role="status"><AlertCircle size={16} />所选起点当日没有生效的风险规则；周期内缺少规则覆盖的交易仍会显示为覆盖未知。此提示不阻止保存。</p>
            ) : null}
            <div className="live-cycle-preview-list">
              {[...preview.preCycle, ...preview.current, ...preview.unresolved].slice(0, PREVIEW_LIMIT).map((trade) => (
                <div key={trade.id}>
                  <code>{trade.ref}</code><span>{trade.symbol}</span><time>{trade.openedAt}</time>
                </div>
              ))}
            </div>
            {preview.preCycle.length + preview.current.length + preview.unresolved.length > PREVIEW_LIMIT ? (
              <p className="live-cycle-preview-more">
                仅显示前 {PREVIEW_LIMIT} 笔，另有 {preview.preCycle.length + preview.current.length + preview.unresolved.length - PREVIEW_LIMIT} 笔未展开。
              </p>
            ) : null}
          </div>
        </ModalShell>
      ) : null}
    </>
  )
}
