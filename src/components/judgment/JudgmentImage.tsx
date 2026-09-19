import { useEffect, useState } from 'react'
import { getStorage } from '@/storage'
import { useShortcutStore } from '@/store/shortcutStore'

export function JudgmentImage({ assetId, group, onSelect, selected, sourceTradeId, compact = false }: {
  assetId: string; group?: string[]; onSelect?: () => void; selected?: boolean; sourceTradeId?: string | null; compact?: boolean
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    setUrl(null); setFailed(false)
    void getStorage().getAssetObjectUrl(assetId).then(value => { if (active) { setUrl(value); setFailed(!value) } }, () => { if (active) setFailed(true) })
    return () => { active = false }
  }, [assetId])
  return <button type="button" className={`jd-image${compact ? ' jd-image-compact' : ''}`} data-source-trade-id={sourceTradeId ?? undefined}
    aria-label={onSelect ? (selected ? '取消选择图片' : '选择图片') : '查看大图'} aria-pressed={onSelect ? !!selected : undefined}
    onClick={onSelect ?? (() => {
      if (!url) return
      const ids = group ?? [assetId]
      void Promise.all(ids.map(id => getStorage().getAssetObjectUrl(id))).then(urls => {
        const available = urls.flatMap((value, i) => value ? [{ url: value, id: ids[i] }] : [])
        const index = available.findIndex(i => i.id === assetId)
        if (index >= 0) useShortcutStore.getState().openLightbox(available.map(i => i.url), index)
      }).catch(() => setFailed(true))
    })}>
    {url ? <img draggable={false} src={url} data-asset-id={assetId} alt="判断素材" onError={() => { setUrl(null); setFailed(true) }} /> : <span>{failed ? '图片不可用，请检查资料库附件' : '正在载入图片…'}</span>}
    {onSelect && <span className="jd-image-selection">{selected ? '已选' : '选择'}</span>}
  </button>
}
