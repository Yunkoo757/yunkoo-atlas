import { useMemo, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Gavel } from 'lucide-react'
import type { CaseRecord, DisputeType } from '@/data/case'
import { deriveOutcome, formatCaseId, getDisputeType, OUTCOME_COLORS } from '@/data/case'
import { getStorage } from '@/storage'
import { fmtDateTime } from '@/lib/format'
import './CaseCompare.css'

export function CaseCompare({
  cases,
  disputeTypes,
  onClose,
}: {
  cases: CaseRecord[]
  disputeTypes: DisputeType[]
  onClose: () => void
}) {
  // Group by outcome
  const grouped = useMemo(() => {
    const map = new Map<string, CaseRecord[]>()
    for (const c of cases) {
      const dt = getDisputeType(c.disputeTypeId, disputeTypes)
      const outcome = deriveOutcome(c, dt)
      const label = OUTCOME_COLORS[outcome].label
      if (!map.has(label)) map.set(label, [])
      map.get(label)!.push(c)
    }
    return [...map.entries()]
  }, [cases, disputeTypes])

  return createPortal(
    <div className="cc-overlay" onMouseDown={onClose}>
      <div className="cc-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cc-head">
          <span className="cc-head-title">判例对比 · {cases.length} 条</span>
          <button className="cc-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="cc-body">
          <div className="cc-grid" style={{ gridTemplateColumns: `repeat(${grouped.length}, 1fr)` }}>
            {grouped.map(([outcome, items]) => (
              <div className="cc-col" key={outcome}>
                <div className="cc-col-head">
                  <span className="cc-col-dot" style={{ background: OUTCOME_COLORS[items[0] ? deriveOutcome(items[0], getDisputeType(items[0].disputeTypeId, disputeTypes)) : '待验证'].dot }} />
                  <span>{outcome}</span>
                  <span className="cc-col-count">{items.length}</span>
                </div>
                {items.map((rec) => (
                  <CaseCompareCard key={rec.id} rec={rec} disputeTypes={disputeTypes} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function CaseCompareCard({ rec, disputeTypes }: { rec: CaseRecord; disputeTypes: DisputeType[] }) {
  const dt = getDisputeType(rec.disputeTypeId, disputeTypes)
  const outcome = deriveOutcome(rec, dt)
  const colors = OUTCOME_COLORS[outcome]
  const [imageUrls, setImageUrls] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    Promise.all(
      rec.images.slice(0, 2).map(async (img) => {
        try { return await getStorage().getAssetObjectUrl(img.fileId) }
        catch { return null }
      }),
    ).then((urls) => {
      if (!cancelled) setImageUrls(urls.filter(Boolean) as string[])
    })
    return () => { cancelled = true }
  }, [rec.images])

  return (
    <div className="ccc-card">
      {/* Images */}
      {imageUrls.length > 0 ? (
        <div className="ccc-images">
          {imageUrls.map((url, i) => (
            <img key={i} src={url} alt={`截图 ${i + 1}`} className="ccc-img" />
          ))}
        </div>
      ) : (
        <div className="ccc-noimg">无截图</div>
      )}
      <div className="ccc-meta">
        <span className="ccc-id">{formatCaseId(rec.id)}</span>
        <span className="ccc-type">{dt?.name ?? '未知'}</span>
        <div className="ccc-verdicts">
          <span className="ccc-v">初始: {rec.initialVerdict}</span>
          {rec.finalVerdict && <span className="ccc-v">最终: {rec.finalVerdict}</span>}
        </div>
        <span className="ccc-conf">{rec.confidence}%</span>
        {rec.note && <p className="ccc-note">{rec.note.slice(0, 80)}</p>}
      </div>
    </div>
  )
}
