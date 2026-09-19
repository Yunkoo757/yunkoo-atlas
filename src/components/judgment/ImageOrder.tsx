import { Button } from '@/components/ui/Button'
import { JudgmentImage } from './JudgmentImage'
import { moveImage } from '@/lib/judgment/images'
import type { JudgmentImage as ImageRef } from '@/lib/judgment/model'
import { useState, type ReactNode } from 'react'
import { GripVertical, ArrowUp, ArrowDown } from '@/icons/appIcons'
import { ICON_MD } from '@/icons/iconSize'

export function ImageOrder({ images, onChange, disabled = false }: { images: ImageRef[]; onChange: (images: ImageRef[]) => void; disabled?: boolean }) {
  return <SortableImages disabled={disabled} items={images} getKey={image => image.assetId} onChange={onChange} render={image => <JudgmentImage assetId={image.assetId} compact />} />
}

export function SortableImages<T>({ items, getKey, render, onChange, disabled = false }: { items: T[]; getKey: (item: T) => string; render: (item: T) => ReactNode; onChange: (items: T[]) => void; disabled?: boolean }) {
  const [dragged, setDragged] = useState<string | null>(null), [over, setOver] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const move = (from: number, to: number) => { if (disabled) return; onChange(moveImage(items, from, to - from)); setAnnouncement(`已移到第 ${to + 1} 张`) }
  return <div className="jd-fields"><div className="jd-sort-list">{items.map((item, index) => {
    const key = getKey(item)
    return <div key={key} data-sort-id={key} className={`jd-order-row${dragged === key ? ' is-dragging' : ''}${over === key && dragged !== key ? items.findIndex(item => getKey(item) === dragged) > index ? ' is-drop-before' : ' is-drop-after' : ''}`} draggable={!disabled && items.length > 1}
      onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', key); setDragged(key) }}
      onDragOver={event => { if (dragged) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOver(key) } }}
      onDrop={event => { event.preventDefault(); const from = items.findIndex(item => getKey(item) === dragged); if (from >= 0 && from !== index) move(from, index); setDragged(null); setOver(null) }}
      onDragEnd={() => { setDragged(null); setOver(null) }}>
      <Button className="jd-drag-handle" aria-label={`拖动第 ${index + 1} 张图片排序`} title="拖拽排序；聚焦后可用上下方向键" disabled={disabled || items.length < 2} onKeyDown={event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault(); event.stopPropagation(); const to = index + (event.key === 'ArrowUp' ? -1 : 1)
        if (to >= 0 && to < items.length) move(index, to)
      }}><GripVertical size={ICON_MD} /><span>{index + 1}</span></Button>
      {render(item)}
      <div className="jd-order-actions"><Button size="sm" aria-label={`第 ${index + 1} 张前移`} disabled={disabled || index === 0} onClick={() => move(index, index - 1)}><ArrowUp size={ICON_MD} /></Button><Button size="sm" aria-label={`第 ${index + 1} 张后移`} disabled={disabled || index === items.length - 1} onClick={() => move(index, index + 1)}><ArrowDown size={ICON_MD} /></Button></div>
    </div>
  })}</div><span className="jd-sr-only" role="status">{announcement}</span></div>
}
