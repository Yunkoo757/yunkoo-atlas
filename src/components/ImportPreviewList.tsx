import { useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from '@/icons/appIcons'
import { ICON_SM } from '@/icons/iconSize'
import { DisclosureSummary } from '@/components/ui/DisclosureSummary'
import { IconButton } from '@/components/ui/IconButton'
import { formatTradeCashPnl } from '@/lib/cashCurrency'
import { fmtDate, fmtFullDateTime } from '@/lib/format'
import { duplicateReasonLabel, type DuplicateMatch } from '@/lib/tradeDuplicates'
import type { Trade } from '@/data/trades'
import './ImportPreviewList.css'

const pageSize = 8

export function ImportPreviewList<T extends { rowIndex: number }>({ rows, children }: {
  rows: readonly T[]
  children: (row: T) => ReactNode
}) {
  const [page, setPage] = useState(0)
  const list = useRef<HTMLUListElement>(null)
  const pages = Math.ceil(rows.length / pageSize)
  const current = Math.max(0, Math.min(page, pages - 1))
  const start = current * pageSize
  const changePage = (next: number) => {
    setPage(next)
    requestAnimationFrame(() => list.current?.querySelector('summary')?.focus())
  }
  return <>
    <ul className="import-preview-list" ref={list} aria-label="导入记录">
      {rows.slice(start, start + pageSize).map(row => <li key={row.rowIndex}>{children(row)}</li>)}
    </ul>
    {pages > 1 && <nav className="import-preview-pages" aria-label="导入记录翻页">
      <IconButton label="上一页记录" disabled={current === 0} onClick={() => changePage(current - 1)}><ChevronLeft size={ICON_SM} /></IconButton>
      <span aria-live="polite">{start + 1}–{Math.min(start + pageSize, rows.length)} / {rows.length}</span>
      <IconButton label="下一页记录" disabled={current + 1 >= pages} onClick={() => changePage(current + 1)}><ChevronRight size={ICON_SM} /></IconButton>
    </nav>}
  </>
}

export function ImportPreviewRecord({ trade, rowIndex, privacyMode, errors, warnings = [], duplicate, forceImport, onToggleForce, children }: {
  trade: Partial<Trade>
  rowIndex: number
  privacyMode: boolean
  errors: readonly string[]
  warnings?: readonly string[]
  duplicate?: DuplicateMatch
  forceImport: boolean
  onToggleForce?: () => void
  children: ReactNode
}) {
  return <div className="import-preview-record">
    <details>
      <DisclosureSummary>
        <span className="import-preview-identity">
          <strong>{trade.symbol || '品种待补'}</strong>
          {trade.side && <span>{trade.side === 'long' ? '做多' : '做空'}</span>}
          {warnings.length > 0 && <span>{warnings.length} 项提示</span>}
        </span>
        <span title={trade.openedAt ? fmtFullDateTime(trade.openedAt) : undefined}>{trade.openedAt && fmtDate(trade.openedAt)}</span>
        <span className="import-preview-amount" title="现金盈亏">{trade.pnl != null && formatTradeCashPnl(trade, null, privacyMode)}</span>
        <span>第 {rowIndex + 1} 行</span>
      </DisclosureSummary>
      <dl className="import-preview-facts">
        {trade.openedAt && <><dt>开仓日期</dt><dd>{fmtFullDateTime(trade.openedAt)}</dd></>}
        {children}
      </dl>
      {warnings.length > 0 && <ul className="import-preview-notes">
        {warnings.map((warning, index) => <li key={index}>{warning}</li>)}
      </ul>}
    </details>
    {(errors.length > 0 || duplicate) && <div className="import-preview-issues">
      {errors.length > 0 && <p><strong>无法导入</strong> {errors.join('、')}</p>}
      {duplicate && <p>与 {duplicate.tradeRef} {duplicateReasonLabel(duplicate.reason)}
        {onToggleForce && !errors.length && <button type="button" aria-pressed={forceImport} onClick={onToggleForce}>{forceImport ? '取消仍导入' : '仍导入'}</button>}
      </p>}
    </div>}
  </div>
}
