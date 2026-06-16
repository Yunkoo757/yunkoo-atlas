import { useEffect } from 'react'
import { X } from 'lucide-react'
import './ImageLightbox.css'

export function ImageLightbox({
  src,
  onClose,
}: {
  src: string | null
  onClose: () => void
}) {
  useEffect(() => {
    if (!src) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [src, onClose])

  if (!src) return null

  return (
    <div
      className="img-lightbox-overlay"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
    >
      <button
        type="button"
        className="img-lightbox-close"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onClose}
        aria-label="关闭预览"
      >
        <X size={18} />
      </button>
      <img
        src={src}
        alt=""
        className="img-lightbox-img"
        onMouseDown={(e) => e.stopPropagation()}
      />
    </div>
  )
}
