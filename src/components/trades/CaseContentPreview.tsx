import type { ReactNode } from 'react'
import type { Trade } from '@/data/trades'
import { HoverPreview, PreviewHeader } from '@/components/HoverPreview'
import { resolveCasePreview, casePreviewSummary } from '@/lib/caseExcerpt'
import './CaseContentPreview.css'

export function CaseContentPreview({ trade, children }: { trade: Trade; children: ReactNode }) {
  const preview = resolveCasePreview(trade)
  return (
    <HoverPreview content={(
      <div className="case-content-preview">
        <PreviewHeader title={trade.symbol} subtitle={trade.ref} />
        <p>{casePreviewSummary(preview) || '暂无案例内容'}</p>
        {preview.excerpt && preview.imageCount > 0 ? <span className="case-content-preview-meta">{preview.imageCount} 张截图 · 打开详情查看</span> : null}
      </div>
    )}>
      {children}
    </HoverPreview>
  )
}
