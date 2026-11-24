import { forwardRef, useId, useImperativeHandle, useRef, useState } from 'react'
import { resultRepairAnchor } from '@/hooks/useResultRepairReturn'
import { STATUS_META } from '@/data/trades'
import { AlertCircle, ArrowRight, ChevronLeft, ChevronRight } from '@/icons/appIcons'
import { ICON_2XL, ICON_SM } from '@/icons/iconSize'
import { SymbolIcon } from '@/components/SymbolIcon'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { InlineStatus } from '@/components/ui/InlineStatus'
import { ModalShell } from '@/components/ui/ModalShell'
import { resolveTradeCashCurrencyFact } from '@/lib/cashCurrency'
import { captureOrganizationSnapshot, repairLibraryResults } from '@/lib/dataOrganizationService'
import { groupResultRepairs, type ResultRepairGroup, type ResultRepairRow } from '@/lib/resultConflictRepair'
import { toast } from '@/lib/toast'
import { userFacingErrorMessage } from '@/lib/userFacingError'
import { useStore } from '@/store/useStore'
import { getStorage, isElectron } from '@/storage'
import './ResultConflictRepair.css'

const sections = [
  ['metrics', '现金与 R 不一致'],
  ['status', '与登记盈亏不符'],
  ['pending', '待补结果'],
  ['byR', '可按 R 修正'],
] as const
const pageSize = 4

// 核对原始记录时保留已录入的精度，避免把很小的非零结果显示成零。
function signedValue(value: number, currency?: string | null): string {
  return value.toLocaleString('en-US', {
    ...(currency ? { style: 'currency', currency } : {}),
    signDisplay: 'exceptZero',
    maximumSignificantDigits: 17,
  })
}

function RepairSection({ kind, title, rows, busy, returnId, onOpen }: {
  kind: ResultRepairGroup
  title: string
  rows: ResultRepairRow[]
  returnId?: string
  busy: boolean
  onOpen: (id: string) => void
}) {
  const heading = useId()
  const list = useRef<HTMLUListElement>(null)
  const [page, setPage] = useState(() => Math.floor(Math.max(0, rows.findIndex(({ trade }) => trade.id === returnId)) / pageSize))
  const icons = useStore(state => state.symbolIcons)
  const masked = useStore(state => state.display.privacyMode)
  const pages = Math.ceil(rows.length / pageSize)
  const current = Math.min(page, pages - 1)
  const showValues = kind !== 'pending' || rows.some(({ trade }) => trade.pnl != null || trade.rMultiple != null)

  const goToPage = (next: number) => {
    setPage(next)
    requestAnimationFrame(() => list.current?.querySelector('button')?.focus({ preventScroll: true }))
  }

  return (
    <section className="result-repair-section" aria-labelledby={heading}>
      <div className="result-repair-columns result-repair-heading">
        <h3 id={heading}>{title}<span className="result-repair-count">{rows.length} 笔</span></h3>
        {showValues ? <><span aria-hidden>现金盈亏</span><span aria-hidden>R 倍数</span></> : <span className="result-repair-status" aria-hidden>登记状态</span>}
      </div>
      <ul ref={list}>
        {rows.slice(current * pageSize, (current + 1) * pageSize).map(({ trade, proposedStatus }) => (
          <li key={trade.id} data-trade-id={resultRepairAnchor(trade.id)}>
            <button type="button" className="result-repair-columns result-repair-row" data-result-return={trade.id === returnId || undefined} disabled={busy} onClick={() => onOpen(trade.id)}>
              <span className="result-repair-identity">
                <SymbolIcon symbol={trade.symbol} overrides={icons} size={ICON_2XL} />
                <span className="result-repair-name">
                  <span className="result-repair-symbol">{trade.symbol}</span>
                  <span className="result-repair-meta">
                    <span className="result-repair-ref">{trade.ref}</span>
                    {showValues && <span>登记为{STATUS_META[trade.status].label}</span>}
                    {proposedStatus && proposedStatus !== trade.status && (
                      <span className="result-repair-change"><ArrowRight size={ICON_SM} aria-hidden /><span className="result-repair-sr">改为</span>{STATUS_META[proposedStatus].label}</span>
                    )}
                  </span>
                </span>
              </span>
              {showValues ? <>
                <span className="result-repair-value"><span className="result-repair-sr">现金盈亏 </span>
                  {trade.pnl == null ? '—' : masked ? '****' : signedValue(trade.pnl, resolveTradeCashCurrencyFact(trade).currency)}
                  {proposedStatus && trade.pnl === 0 && <span className="result-repair-change"><ArrowRight size={ICON_SM} aria-hidden /><span className="result-repair-sr">清空为未填写</span>—</span>}
                </span>
                <span className="result-repair-value"><span className="result-repair-sr">R 倍数 </span>{trade.rMultiple == null ? '—' : signedValue(trade.rMultiple) + 'R'}</span>
              </> : <span className="result-repair-status"><span className="result-repair-sr">登记状态 </span>{STATUS_META[trade.status].label}</span>}
              <ChevronRight size={ICON_SM} aria-hidden />
              <span className="result-repair-sr">打开交易详情</span>
            </button>
          </li>
        ))}
      </ul>
      {pages > 1 && <div className="result-repair-pager">
        <IconButton label={`${title}上一页`} disabled={busy || current === 0} onClick={() => goToPage(current - 1)}><ChevronLeft size={ICON_SM} /></IconButton>
        <span aria-live="polite">{current + 1} / {pages}</span>
        <IconButton label={`${title}下一页`} disabled={busy || current + 1 === pages} onClick={() => goToPage(current + 1)}><ChevronRight size={ICON_SM} /></IconButton>
      </div>}
    </section>
  )
}

type RepairPreview = { snapshot: string; libraryId: string; returnId?: string; groups: ReturnType<typeof groupResultRepairs> }

export const ResultConflictRepair = forwardRef<{ reopen: (id: string) => void }, {
  ids: readonly string[]
  onOpenTrade: (id: string) => void
  showCount?: boolean
}>(function ResultConflictRepair({ ids, onOpenTrade, showCount = false }, ref) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [preview, setPreview] = useState<RepairPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [feedback, setFeedback] = useState('')
  const close = () => {
    setPreview(null)
    setFeedback('')
  }
  const show = async (returnId?: string) => {
    if (busy) return
    setBusy(true)
    setConfirmed(false)
    try {
      const manifest = await getStorage().getManifest()
      const snapshot = captureOrganizationSnapshot()
      setPreview({ snapshot: JSON.stringify(snapshot), libraryId: manifest.libraryId, returnId, groups: groupResultRepairs(snapshot.trades, ids) })
      setFeedback('')
    } catch (error) {
      setFeedback(userFacingErrorMessage(error, '暂时无法读取交易记录。'))
    } finally { setBusy(false) }
  }
  useImperativeHandle(ref, () => ({
    reopen(id) {
      const notice = trigger.current?.closest('details')
      if (notice) notice.open = true
      void show(id)
    },
  }))
  const eligible = preview?.groups.byR ?? []
  const execute = async () => {
    if (!preview || busy || feedback || !confirmed || !eligible.length) return
    setBusy(true)
    try {
      const backup = await repairLibraryResults(preview.snapshot, eligible.map(({ trade }) => trade.id), preview.libraryId)
      close()
      toast(`已修正 ${eligible.length} 笔。备份已保存到 ${backup}，可在数据设置中恢复。`, { tone: 'success', persistent: true })
    } catch (error) {
      setFeedback(userFacingErrorMessage(error, '修正未完成，请重新预览。'))
      setConfirmed(false)
    } finally { setBusy(false) }
  }
  if (!isElectron()) return null
  const visibleSections = preview ? sections.filter(([key]) => preview.groups[key].length > 0) : []
  const returningRowExists = preview?.returnId && visibleSections.some(([kind]) =>
    preview.groups[kind].some(({ trade }) => trade.id === preview.returnId),
  )

  return <div className="result-repair" data-workbench-result-repair={showCount || undefined}>
    <Button ref={trigger} variant="ghost" size="sm" aria-haspopup="dialog" busy={busy} onClick={() => void show()}>
      {showCount ? <><AlertCircle size={ICON_SM} aria-hidden />{ids.length} 笔结果待核对<ChevronRight size={ICON_SM} aria-hidden /></> : '查看并修正'}
    </Button>
    {(preview || feedback) && (
      <ModalShell
        title="核对交易结果"
        size={visibleSections.length ? 'default' : 'compact'}
        bodyClassName="result-repair-body"
        footerClassName="result-repair-footer"
        busy={busy}
        returnFocusTo={trigger.current}
        initialFocusSelector={returningRowExists ? '[data-result-return]' : preview?.returnId ? '.result-repair-row' : undefined}
        onClose={close}
        footer={feedback ? (
          <Button variant="bordered" busy={busy} onClick={() => void show()}>{preview ? '重新预览' : '重新读取'}</Button>
        ) : eligible.length > 0 && <>
          <label className="result-repair-confirm">
            <input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />
            <span>{eligible.some(({ trade }) => trade.pnl === 0) ? '已核对实际 R，现金 0 为占位值' : '已核对以上交易的实际 R'}</span>
          </label>
          <Button variant="primary" disabled={!confirmed} busy={busy} onClick={() => void execute()}>{busy ? '正在备份并修正…' : `备份并修正 ${eligible.length} 笔`}</Button>
        </>}
      >
        {feedback && <InlineStatus compact tone="error" title={feedback} />}
        {preview && visibleSections.map(([kind, title]) => (
          <RepairSection key={kind} kind={kind} title={title} rows={preview.groups[kind]} busy={busy} returnId={preview.returnId}
            onOpen={id => { close(); onOpenTrade(id) }} />
        ))}
        {preview && !visibleSections.length && <InlineStatus compact tone="success" title="当前范围的交易已全部核对" />}
        {eligible.length > 0 && <p className="result-repair-scope">修正前会校验备份，已完成的周复盘沿用原快照。</p>}
      </ModalShell>
    )}
  </div>
})
