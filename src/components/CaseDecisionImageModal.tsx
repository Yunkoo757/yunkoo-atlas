import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { ModalShell } from '@/components/ui/ModalShell'
import { Select } from '@/components/ui/Select'
import type { Trade } from '@/data/trades'
import { useDecisionImage } from '@/hooks/useDecisionImage'
import { getDecisionImageOptions } from '@/lib/reviewSession'
import { matchesReviewCaseScope } from '@/lib/reviewCaseScope'
import './CaseDecisionImageModal.css'

export function CaseDecisionImageModal({ trade, onSave, onClose }: {
  trade: Trade
  onSave: (id: string | null) => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState(trade.decisionImageId ?? '')
  const options = matchesReviewCaseScope(trade, 'mistakes', new Set()) ? getDecisionImageOptions(trade) : []
  const assetId = options.some((option) => option.value === selected) ? selected : null
  const image = useDecisionImage(assetId)

  return (
    <ModalShell
      title="先判断图"
      description={options.length > 0 ? '选择只截到决策时点的盘面。' : undefined}
      bodyClassName="case-decision-image-body"
      initialFocusSelector=".ui-select-trigger"
      onClose={onClose}
      footer={<>
        {trade.decisionImageId && <Button onClick={() => onSave(null)}>取消标记</Button>}
        <Button variant="bordered" onClick={onClose}>取消</Button>
        {options.length > 0 && <Button variant="primary" disabled={!image?.src} onClick={() => onSave(assetId)}>设为先判断图</Button>}
      </>}
    >
      {options.length > 0 ? (
        <Select value={assetId ?? ''} options={options} ariaLabel="决策时点截图" placeholder="选择一张截图" onValueChange={setSelected} />
      ) : <p>可在有本地截图的错题中设置先判断图。</p>}
      {assetId && (
        <div className="case-decision-image-preview">
          {image?.src ? <img src={image.src} alt="决策时点截图预览" />
            : image ? <p role="status">此图无法打开，请选择另一张。</p>
            : <p role="status">正在载入截图…</p>}
        </div>
      )}
    </ModalShell>
  )
}
