import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Maximize2, X } from '@/icons/appIcons'
import { useShortcutStore } from '@/store/shortcutStore'
import { useShortcutHint } from '@/shortcuts/useShortcutHint'
import { Tooltip } from '@/components/ui/Tooltip'
import {
  LIGHTBOX_VIEW_RESET,
  LIGHTBOX_ZOOM_STEP,
  calculateLightboxImageLayout,
  calculateLightboxTransition,
  lightboxViewTransform,
  panLightboxView,
  registerLightboxCloseHandler,
  registerLightboxResetHandler,
  type LightboxImageLayout,
  type LightboxTransition,
  type LightboxView,
  zoomLightboxAtCursor,
} from '@/lib/lightboxView'
import './ImageLightbox.css'

const LIGHTBOX_TRANSITION_MS = 210

type LightboxPhase = 'pending' | 'open' | 'closing'

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
  const closeTimerRef = useRef<number | null>(null)
  const [view, setView] = useState<LightboxView>(LIGHTBOX_VIEW_RESET)
  const [imageLayout, setImageLayout] = useState<LightboxImageLayout | null>(null)
  const [transition, setTransition] = useState<LightboxTransition | null>(null)
  const [phase, setPhase] = useState<LightboxPhase>('pending')
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    origin: LightboxView
    moved: boolean
  } | null>(null)
  const suppressClickRef = useRef(false)
  const [dragging, setDragging] = useState(false)

  const requestClose = useCallback(() => {
    if (!lightbox || phase === 'closing') return
    if (imageLayout) setView({ scale: imageLayout.fitScale, tx: 0, ty: 0 })
    setPhase('closing')
    closeTimerRef.current = window.setTimeout(closeLightbox, LIGHTBOX_TRANSITION_MS)
  }, [closeLightbox, imageLayout, lightbox, phase])

  useEffect(() => {
    if (!lightbox) return
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
    document.body.classList.add('img-lightbox-open')
    const id = requestAnimationFrame(() => closeRef.current?.focus())
    return () => {
      cancelAnimationFrame(id)
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
      document.body.classList.remove('img-lightbox-open')
    }
  }, [lightbox])

  useEffect(() => {
    if (!lightbox) return
    return registerLightboxCloseHandler(requestClose)
  }, [lightbox, requestClose])

  useEffect(() => {
    setView(LIGHTBOX_VIEW_RESET)
    setImageLayout(null)
    setTransition(null)
    setPhase('pending')
    dragRef.current = null
    suppressClickRef.current = false
    setDragging(false)
  }, [lightbox?.index, lightbox?.images])

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
    const fitWidth = layout.width * layout.fitScale
    const fitHeight = layout.height * layout.fitScale
    const target = {
      x: rect.left + (rect.width - fitWidth) / 2,
      y: rect.top + (rect.height - fitHeight) / 2,
      width: fitWidth,
      height: fitHeight,
    }
    setImageLayout(layout)
    setView({ scale: layout.fitScale, tx: 0, ty: 0 })
    setTransition(lightbox?.origin
      ? calculateLightboxTransition(lightbox.origin, target, layout.fitScale)
      : null)
    requestAnimationFrame(() => requestAnimationFrame(() => setPhase('open')))
  }, [lightbox?.origin])

  useEffect(() => {
    if (!lightbox) return
    return registerLightboxResetHandler(fitImage)
  }, [fitImage, lightbox])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || phase !== 'open') return
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
  }, [phase, view])

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

  const onViewportClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (event.target === event.currentTarget) requestClose()
  }, [requestClose])

  const onViewportDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.img-lightbox-chrome')) return
    event.preventDefault()
    fitImage()
  }, [fitImage])

  if (!lightbox || (!lightbox.loading && lightbox.images.length === 0)) return null

  const src = lightbox.images[lightbox.index]
  const hasMany = !lightbox.loading && lightbox.images.length > 1
  const transitionStyle = transition ? {
    '--img-lightbox-origin-x': `${transition.x}px`,
    '--img-lightbox-origin-y': `${transition.y}px`,
    '--img-lightbox-origin-scale-x': transition.scaleX,
    '--img-lightbox-origin-scale-y': transition.scaleY,
    '--img-lightbox-origin-radius': `${lightbox.origin?.borderRadius ?? 6}px`,
  } as React.CSSProperties : undefined

  return (
    <div
      className={`img-lightbox-overlay is-${phase}${transition ? ' has-origin' : ' has-no-origin'}`}
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
    >
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
            <div className="img-lightbox-transition" style={transitionStyle}>
              <img
                src={src}
                alt=""
                className={'img-lightbox-img' + (imageLayout ? ' is-ready' : '')}
                draggable={false}
                onLoad={onImageLoad}
                style={imageLayout ? { width: imageLayout.width, height: imageLayout.height } : undefined}
              />
            </div>
          </div>
        )}
      </div>

      <div className="img-lightbox-chrome">
        {!lightbox.loading && (
          <div className="img-lightbox-toolbar">
            <span className="img-lightbox-scale">{Math.round(view.scale * 100)}%</span>
            {hasMany && <span className="img-lightbox-counter">{lightbox.index + 1} / {lightbox.images.length}</span>}
            <Tooltip asChild content={resetShortcut ? `适合窗口 · ${resetShortcut}` : '适合窗口'} label="适合窗口">
              <button type="button" className="img-lightbox-action" onClick={fitImage} aria-label="适合窗口">
                <Maximize2 size={14} aria-hidden />
              </button>
            </Tooltip>
            <Tooltip asChild content="源像素与屏幕物理像素 1:1" label="原图像素 1:1">
              <button type="button" className="img-lightbox-action" onClick={showActualSize} aria-label="原图像素 1:1">
                <span className="img-lightbox-ratio" aria-hidden>1:1</span>
              </button>
            </Tooltip>
            <span className="img-lightbox-divider" aria-hidden />
            <Tooltip
              asChild
              content={closeShortcut ? `关闭预览 · ${closeShortcut}` : '关闭预览'}
              label="关闭预览"
            >
              <button
                ref={closeRef}
                type="button"
                className="img-lightbox-close"
                onClick={requestClose}
                aria-label={closeShortcut ? `关闭预览（${closeShortcut}）` : '关闭预览'}
              >
                <X size={16} />
              </button>
            </Tooltip>
          </div>
        )}
        {hasMany && (
          <>
            <Tooltip asChild content={previousShortcut ? `上一张 · ${previousShortcut}` : '上一张'} label="上一张">
              <button type="button" className="img-lightbox-nav img-lightbox-nav--prev" onClick={lightboxPrev} aria-label="上一张">
                <ChevronLeft size={22} />
              </button>
            </Tooltip>
            <Tooltip asChild content={nextShortcut ? `下一张 · ${nextShortcut}` : '下一张'} label="下一张">
              <button type="button" className="img-lightbox-nav img-lightbox-nav--next" onClick={lightboxNext} aria-label="下一张">
                <ChevronRight size={22} />
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  )
}
