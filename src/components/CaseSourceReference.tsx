import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { Editor } from '@/editor/Editor'
import { Link2 } from '@/icons/appIcons'
import { DisclosureIcon } from '@/icons/StateIcons'
import { ICON_SM } from '@/icons/iconSize'
import { evaluateReviewCompletion } from '@/lib/reviewCompletion'
import { relatedTradeDetailState, tradeDetailPath } from '@/lib/tradeRoute'
import { AssetObjectUrlScope } from '@/storage/assetObjectUrls'
import { resolveNoteForDisplayResult } from '@/storage/assets'
import { getStorage } from '@/storage/bootstrap'
import { loadDetailNote, type DetailNoteLoadResult } from '@/views/detailNoteLoad'
import { Button } from './ui/Button'
import './CaseSourceReference.css'

function SourceReview({ html }: { html: string }) {
  const [loaded, setLoaded] = useState<{ source: string; result: DetailNoteLoadResult } | null>(null)
  useEffect(() => {
    const images = new AssetObjectUrlScope()
    let cancelled = false
    void loadDetailNote(html, (note) => resolveNoteForDisplayResult(note, getStorage(), images))
      .then((result) => {
        if (!cancelled) setLoaded({ source: html, result })
      })
    return () => {
      cancelled = true
      images.release()
    }
  }, [html])

  const note = loaded?.source === html ? loaded.result : null
  if (!note) return <p className="dv-case-reference-status" role="status">正在载入来源复盘…</p>

  return (
    <>
      {note.status === 'error' && (
        <p className="dv-case-reference-status" role="alert">部分图片未能载入，已显示可用内容。</p>
      )}
      <Editor
        content={note.status === 'ready' ? note.html : note.fallbackHtml}
        onChange={() => {}}
        ariaLabel="来源复盘正文"
        readOnly
        allowImages={false}
      />
    </>
  )
}

export function CaseSourceReference({ trade, sourceTrade }: { trade: Trade; sourceTrade?: Trade }) {
  const location = useLocation()
  const [expanded, setExpanded] = useState(() => !evaluateReviewCompletion(trade.note).ready)
  const sourceHtml = trade.sourceNoteHtml
  const hasReview = useMemo(() => Boolean(sourceHtml && evaluateReviewCompletion(sourceHtml).ready), [sourceHtml])
  if (!trade.sourceTradeId && !hasReview) return null

  return (
    <section className="dv-case-reference" aria-label="案例来源">
      <div className="dv-case-reference-actions">
        {hasReview && (
          <Button size="sm" aria-expanded={expanded} aria-controls="case-source-review" onClick={() => setExpanded(!expanded)}>
            <DisclosureIcon size={ICON_SM} />
            来源复盘
          </Button>
        )}
        {sourceTrade ? (
          <Link className="ui-btn ui-btn-sm ui-btn-ghost" to={tradeDetailPath(sourceTrade)} state={relatedTradeDetailState(trade.id, sourceTrade.id, location.state)}
            aria-label={`查看原交易 ${sourceTrade.ref} · ${sourceTrade.symbol}`}>
            <Link2 size={ICON_SM} aria-hidden />
            原交易 {sourceTrade.ref}
          </Link>
        ) : trade.sourceTradeId ? (
          <span className="dv-case-reference-status">原交易不可用</span>
        ) : null}
      </div>
      {hasReview && (
        <div className="dv-case-reference-body" id="case-source-review" hidden={!expanded}>
          {expanded && sourceHtml && <SourceReview html={sourceHtml} />}
        </div>
      )}
    </section>
  )
}
