import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Maximize2, X } from '@/icons/appIcons'
import { useShortcutStore } from '@/store/shortcutStore'
import { useShortcutHint } from '@/shortcuts/useShortcutHint'
import {
  LIGHTBOX_VIEW_RESET,
  LIGHTBOX_ZOOM_STEP,
  calculateLightboxImageLayout,
  lightboxViewTransform,
  panLightboxView,
  registerLightboxResetHandler,
  type LightboxImageLayout,
  type LightboxView,
  zoomLightboxAtCursor,
} from '@/lib/lightboxView'
import './ImageLightbox.css'

export function ImageLightbox() {
  const lightbox = useShortcutStore((s) => s.lightbox)
  const closeLightbox = useShortcutStore((s) => s.closeLightbox)
  const lightboxPrev = useShortcutStore((s) => s.lightboxPrev)
  const lightboxNext = useShortcutStore((s) => s.lightboxNext)
  const closeShortcut = useShortcutHint('image.close').hint
  const previousShortcut = useShortcutHint('image.prev').hint
  const nextShortcut = useShortcutHint('image.next').hint
  const resetShortcut = useShortcutHint('image.reset').hint
  const closeRef = useRef<HTMLButtonElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<LightboxView>(LIGHTBOX_VIEW_RESET)
  const [imageLayout, setImageLayout] = useState<LightboxImageLayout | null>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    origin: LightboxView
    moved: boolean
  } | null>(null)
  const suppressClickRef = useRef(false)
  const [dragging, setDragging] = useState(false)

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

  // 切图时重置变换
  useEffect(() => {
    setView(LIGHTBOX_VIEW_RESET)
    setImageLayout(null)
    dragRef.current = null
    suppressClickRef.current = false
    setDragging(false)
  }, [lightbox?.index, lightbox?.images])

  // wheel 需非 passive 才能 preventDefault，避免页面跟着滚
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !lightbox) return
    const onWheelNative = (event: WheelEvent) => {
      event.preventDefault()
      const rect = viewport.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const factor = event.deltaY < 0 ? LIGHTBOX_ZOOM_STEP : 1 / LIGHTBOX_ZOOM_STEP
      setView((current) =>
        zoomLightboxAtCursor(current, event.clientX, event.clientY, cx, cy, factor),
      )
    }
    viewport.addEventListener('wheel', onWheelNative, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheelNative)
  }, [lightbox])

  const fitImage = useCallback(() => {
    setView(imageLayout
      ? { scale: imageLayout.fitScale, tx: 0, ty: 0 }
      : LIGHTBOX_VIEW_RESET)
  }, [imageLayout])

  const showActualSize = useCallback(() => setView(LIGHTBOX_VIEW_RESET), [])

  const onImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const image = event.currentTarget
    const rect = viewport.getBoundingClientRect()
    const layout = calculateLightboxImageLayout({
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      viewportWidth: rect.width,
      viewportHeight: rect.height,
      devicePixelRatio: window.devicePixelRatio,
    })
    setImageLayout(layout)
    setView({ scale: layout.fitScale, tx: 0, ty: 0 })
  }, [])

  useEffect(() => {
    if (!lightbox) return
    return registerLightboxResetHandler(fitImage)
  }, [fitImage, lightbox])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest('.img-lightbox-chrome')) return
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: view,
      moved: false,
    }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [view])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (Math.hypot(dx, dy) > 3) drag.moved = true
    setView(panLightboxView(drag.origin, dx, dy))
  }, [])

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.moved) suppressClickRef.current = true
    dragRef.current = null
    setDragging(false)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
  }, [])

  const onViewportClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false
        return
      }
      // 点遮罩空白始终关闭；点在图片画布上不关
      if (event.target !== event.currentTarget) return
      closeLightbox()
    },
    [closeLightbox],
  )

  const onViewportDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest('.img-lightbox-chrome')) return
      event.preventDefault()
      fitImage()
    },
    [fitImage],
  )

  if (!lightbox || (!lightbox.loading && lightbox.images.length === 0)) return null

  const src = lightbox.images[lightbox.index]
  const hasMany = !lightbox.loading && lightbox.images.length > 1

  return (
    <div className="img-lightbox-overlay" role="dialog" aria-modal="true" aria-label="图片预览">
      <div
        ref={viewportRef}
        className={'img-lightbox-viewport' + (dragging ? ' is-dragging' : '')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={onViewportClick}
        onDoubleClick={onViewportDoubleClick}
      >
        {lightbox.loading ? (
          <div className="img-lightbox-loading" role="status" aria-live="polite">
            <span className="img-lightbox-loading-indicator" aria-hidden />
            <span>正在载入当前案例图片…</span>
          </div>
        ) : (
          <div className="img-lightbox-canvas" style={{ transform: lightboxViewTransform(view) }}>
            <img
              src={src}
              alt=""
              className={'img-lightbox-img' + (imageLayout ? ' is-ready' : '')}
              draggable={false}
              onLoad={onImageLoad}
              style={imageLayout ? { width: imageLayout.width, height: imageLayout.height } : undefined}
            />
          </div>
        )}
      </div>

      <div className="img-lightbox-chrome">
        <button
          ref={closeRef}
          type="button"
          className="img-lightbox-close"
          onClick={closeLightbox}
          aria-label={closeShortcut ? `关闭预览（${closeShortcut}）` : '关闭预览'}
          title={closeShortcut ? `关闭预览 · ${closeShortcut}` : '关闭预览'}
        >
          <X size={18} />
        </button>
        {hasMany && (
          <>
            <button
              type="button"
              className="img-lightbox-nav img-lightbox-nav--prev"
              onClick={lightboxPrev}
              aria-label={previousShortcut ? `上一张（${previousShortcut}）` : '上一张'}
              title={previousShortcut ? `上一张 · ${previousShortcut}` : '上一张'}
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              className="img-lightbox-nav img-lightbox-nav--next"
              onClick={lightboxNext}
              aria-label={nextShortcut ? `下一张（${nextShortcut}）` : '下一张'}
              title={nextShortcut ? `下一张 · ${nextShortcut}` : '下一张'}
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}
        {!lightbox.loading && <div className="img-lightbox-hud-dock">
          <div className="img-lightbox-hud">
            <span className="img-lightbox-scale">{Math.round(view.scale * 100)}%</span>
            {hasMany && (
              <span className="img-lightbox-counter">
                {lightbox.index + 1} / {lightbox.images.length}
              </span>
            )}
            <button
              type="button"
              className="img-lightbox-action"
              onClick={fitImage}
              aria-label={resetShortcut ? `适合窗口（${resetShortcut}）` : '适合窗口'}
              title={resetShortcut ? `适合窗口 · ${resetShortcut}` : '适合窗口'}
            >
              <Maximize2 size={14} aria-hidden />
            </button>
            <button
              type="button"
              className="img-lightbox-action"
              onClick={showActualSize}
              aria-label="原图像素 1:1"
              title="源像素与屏幕物理像素 1:1"
            >
              <span className="img-lightbox-ratio" aria-hidden>
                1:1
              </span>
            </button>
          </div>
        </div>}
      </div>
    </div>
  )
}
