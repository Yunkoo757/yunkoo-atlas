import { useEffect, useState } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import './TradeMedia.css'

export function TradeMedia({
  tradeId,
  images,
  activeIndex,
  onActiveIndexChange,
  onOpenLightbox,
}: {
  tradeId: string
  images: string[]
  activeIndex: number
  onActiveIndexChange: (index: number) => void
  onOpenLightbox: (index: number) => void
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const activeSrc = images[activeIndex]

  useEffect(() => {
    setLoaded(false)
    setFailed(false)
  }, [activeSrc])

  if (images.length === 0) {
    return (
      <div className="trade-media-empty" data-trade-id={tradeId}>
        <ImageIcon size={18} />
        <span>暂无截图</span>
      </div>
    )
  }

  return (
    <section className="trade-media" data-trade-id={tradeId} aria-label="交易截图">
      <button
        type="button"
        className="trade-media-stage"
        onClick={() => !failed && onOpenLightbox(activeIndex)}
        aria-label={`打开截图 ${activeIndex + 1}`}
      >
        {!loaded && !failed && <span className="trade-media-loading">加载截图…</span>}
        {failed ? (
          <span className="trade-media-error">截图加载失败</span>
        ) : (
          <img
            src={activeSrc}
            alt={`交易截图 ${activeIndex + 1}`}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        )}
      </button>
      {images.length > 1 && (
        <div className="trade-media-thumbs" aria-label="选择截图">
          {images.map((src, index) => (
            <button
              type="button"
              className={index === activeIndex ? 'is-active' : ''}
              onClick={() => onActiveIndexChange(index)}
              aria-label={`查看截图 ${index + 1}`}
              aria-pressed={index === activeIndex}
              key={`${src}-${index}`}
            >
              <img src={src} alt="" />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
