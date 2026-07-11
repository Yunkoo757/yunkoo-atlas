import { useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, X } from '@/icons/appIcons'
import { useShortcutStore } from '@/store/shortcutStore'
import { getShortcutHint } from '@/shortcuts/ShortcutHost'
import './ImageLightbox.css'

export function ImageLightbox() {
  const lightbox = useShortcutStore((s) => s.lightbox)
  const closeLightbox = useShortcutStore((s) => s.closeLightbox)
  const lightboxPrev = useShortcutStore((s) => s.lightboxPrev)
  const lightboxNext = useShortcutStore((s) => s.lightboxNext)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!lightbox) return
    const active = document.activeElement
    if (active instanceof HTMLElement) {
      active.blur()
    }
    document.body.classList.add('img-lightbox-open')
    const id = requestAnimationFrame(() => closeRef.current?.focus())
    return () => {
      cancelAnimationFrame(id)
      document.body.classList.remove('img-lightbox-open')
    }
  }, [lightbox])

  if (!lightbox || lightbox.images.length === 0) return null

  const src = lightbox.images[lightbox.index]
  const hasMany = lightbox.images.length > 1

  return (
    <div
      className="img-lightbox-overlay"
      onMouseDown={closeLightbox}
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
    >
      <button
        ref={closeRef}
        type="button"
        className="img-lightbox-close"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={closeLightbox}
        aria-label={`关闭预览 (${getShortcutHint('image.close') ?? 'Esc'})`}
      >
        <X size={18} />
      </button>
      {hasMany && (
        <>
          <button
            type="button"
            className="img-lightbox-nav img-lightbox-nav--prev"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              lightboxPrev()
            }}
            aria-label={`上一张 (${getShortcutHint('image.prev') ?? '←'})`}
          >
            <ChevronLeft size={22} />
          </button>
          <button
            type="button"
            className="img-lightbox-nav img-lightbox-nav--next"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              lightboxNext()
            }}
            aria-label={`下一张 (${getShortcutHint('image.next') ?? '→'})`}
          >
            <ChevronRight size={22} />
          </button>
          <div className="img-lightbox-counter" onMouseDown={(e) => e.stopPropagation()}>
            {lightbox.index + 1} / {lightbox.images.length}
          </div>
        </>
      )}
      <img
        src={src}
        alt=""
        className="img-lightbox-img"
        onMouseDown={(e) => e.stopPropagation()}
      />
    </div>
  )
}
