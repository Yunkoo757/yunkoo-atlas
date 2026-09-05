import type { ReactNode } from 'react'
import type { Trade } from '@/data/trades'
import { HoverPreview, PreviewHeader } from '@/components/HoverPreview'
import { caseExcerpt } from '@/lib/caseExcerpt'
import './CaseContentPreview.css'

export function CaseContentPreview({ trade, children }: { trade: Trade; children: ReactNode }) {
  const excerpt = caseExcerpt(trade.note)
  const imageCount = trade.note.match(/<img\b/gi)?.length ?? 0
  return (
    <HoverPreview content={(
      <div className="case-content-preview">
        <PreviewHeader title={trade.symbol} subtitle={trade.ref} />
        <p>{excerpt || (imageCount > 0 ? '以截图记录的案例' : '暂无案例正文')}</p>
        {imageCount > 0 ? <span className="case-content-preview-meta">{imageCount} 张截图 · 打开详情查看</span> : null}
      </div>
    )}>
      {children}
    </HoverPreview>
  )
}
