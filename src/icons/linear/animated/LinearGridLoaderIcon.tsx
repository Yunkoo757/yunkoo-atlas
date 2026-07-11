import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { resolveIconA11y } from '../iconA11y'
import type { LinearStaticIconProps } from '../types'
import './linearGridIcons.css'

const FRAME_COUNTS = {
  scope: 12,
  upDown: 14,
  pong: 8,
  blowOut: 9,
  ufo: 5,
  down: 7,
  zap: 1,
  hourglass: 5,
  stats: 9,
  cat: 11,
  agent: 16,
  read: 1,
  unread: 1,
  outlines: 8,
} as const

const FRAME_MASKS: Record<LinearGridLoaderVariant, readonly number[]> = {
  scope: [4657152, 2328576, 72768, 2274, 7335, 0, 7335, 0, 4548, 9096, 291072, 9314304],
  upDown: [4194304, 14811136, 4657152, 4339840, 135620, 4238, 132, 4, 142, 4548, 145540, 4657280, 14815232, 4325376],
  pong: [577056, 17482784, 25740320, 17482784, 17320993, 542369, 17977, 50864],
  blowOut: [4096, 141440, 4543812, 11184810, 22369621, 11184810, 22365525, 11043370, 17825809],
  ufo: [32968704, 1030272, 452, 4, 0],
  down: [4194308, 142, 4548, 145540, 4657280, 14815232, 4325376],
  zap: [4619460],
  hourglass: [15012302, 15143246, 13532326, 915296, 6487948],
  stats: [32505856, 33521664, 33543168, 33543808, 33543824, 33543808, 33543168, 33521664, 0],
  cat: [17825792, 28868608, 33408000, 23064096, 15400817, 15400817, 15728497, 15400817, 23064096, 28868608, 0],
  agent: [1, 3, 7, 39, 103, 231, 487, 1511, 3559, 36327, 101863, 232935, 1281511, 3378663, 7572967, 15961575],
  read: [141440],
  unread: [145536],
  outlines: [31457295, 15728670, 7373340, 3196440, 1623600, 17352225, 25707555, 29884455],
}

const DOTS = Array.from({ length: 25 }, (_, index) => ({
  cx: 1 + (index % 5) * 3.5,
  cy: 1 + Math.floor(index / 5) * 3.5,
  mask: 2 ** index,
}))

const MIN_CANVAS_SCALE = 2
const TRANSPARENT_GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
const spriteCache = new Map<string, string>()
const observedElements = new Map<Element, (isIntersecting: boolean) => void>()
let sharedObserver: IntersectionObserver | undefined

export type LinearGridLoaderVariant = keyof typeof FRAME_COUNTS

export interface LinearGridLoaderIconProps extends LinearStaticIconProps {
  variant: LinearGridLoaderVariant
  interval?: number
  dimColor?: string
  initialFrame?: number
}

function parsePixelSize(value: number | string | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^(\d+|\d*\.\d+)(px)?$/.test(value)) return Number.parseFloat(value)
  return 16
}

function getCanvasScale(size: number | string | undefined): number {
  return Math.max(MIN_CANVAS_SCALE, Math.ceil((parsePixelSize(size) / 16) * MIN_CANVAS_SCALE))
}

function getSpriteCacheKey(variant: LinearGridLoaderVariant, color: string, dimColor: string, scale: number): string {
  return [variant, color, dimColor, scale].join('\0')
}

function drawFrame(
  context: CanvasRenderingContext2D,
  mask: number,
  frameIndex: number,
  color: string,
  dimColor: string,
) {
  context.save()
  context.translate(frameIndex * 16, 0)
  context.fillStyle = dimColor
  context.globalAlpha = dimColor === 'transparent' ? 0 : 0.3
  for (const dot of DOTS) {
    context.beginPath()
    context.arc(dot.cx, dot.cy, 1, 0, Math.PI * 2)
    context.fill()
  }
  context.fillStyle = color
  context.globalAlpha = 1
  for (const dot of DOTS) {
    if ((mask & dot.mask) !== 0) {
      context.beginPath()
      context.arc(dot.cx, dot.cy, 1, 0, Math.PI * 2)
      context.fill()
    }
  }
  context.restore()
}

function createSpriteDataUrl(
  variant: LinearGridLoaderVariant,
  color: string,
  dimColor: string,
  scale: number,
): string {
  const cacheKey = getSpriteCacheKey(variant, color, dimColor, scale)
  const cached = spriteCache.get(cacheKey)
  if (cached) return cached
  if (typeof document === 'undefined') return TRANSPARENT_GIF

  const masks = FRAME_MASKS[variant]
  const canvas = document.createElement('canvas')
  canvas.width = masks.length * 16 * scale
  canvas.height = 16 * scale

  const context = canvas.getContext('2d')
  if (!context) return TRANSPARENT_GIF

  context.scale(scale, scale)
  masks.forEach((mask, frameIndex) => drawFrame(context, mask, frameIndex, color, dimColor))

  const dataUrl = canvas.toDataURL('image/png')
  spriteCache.set(cacheKey, dataUrl)
  return dataUrl
}

function observeViewport(element: Element, onChange: (isIntersecting: boolean) => void): () => void {
  if (typeof IntersectionObserver !== 'function') {
    onChange(true)
    return () => {}
  }

  observedElements.set(element, onChange)
  sharedObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      observedElements.get(entry.target)?.(entry.isIntersecting)
    }
  })
  sharedObserver.observe(element)

  return () => {
    sharedObserver?.unobserve(element)
    observedElements.delete(element)
    if (observedElements.size === 0) {
      sharedObserver?.disconnect()
      sharedObserver = undefined
    }
  }
}

function normalizeFrame(frame: number | undefined, frameCount: number): number {
  if (frame === undefined || !Number.isFinite(frame)) return 0
  return ((Math.floor(frame) % frameCount) + frameCount) % frameCount
}

export function LinearGridLoaderIcon({
  variant,
  interval = 200,
  dimColor,
  initialFrame,
  size = 16,
  title,
  color = 'currentColor',
  className,
  style,
  ...props
}: LinearGridLoaderIconProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [isIntersecting, setIsIntersecting] = useState(true)
  const [spriteHref, setSpriteHref] = useState(TRANSPARENT_GIF)
  const a11y = resolveIconA11y(title)
  const frameCount = FRAME_COUNTS[variant]
  const safeInterval = Number.isFinite(interval) ? Math.max(0, interval) : 200
  const normalizedInitialFrame = normalizeFrame(initialFrame, frameCount)
  const durationMs = frameCount * 20 * safeInterval
  const delayMs = -normalizedInitialFrame * 20 * safeInterval
  const classes = ['linear-grid-loader', !isIntersecting && 'linear-grid-loader--paused', className]
    .filter(Boolean)
    .join(' ')
  const mergedStyle = {
    ...style,
    overflow: 'hidden',
    '--linear-grid-loader-duration': `${durationMs}ms`,
    '--linear-grid-loader-delay': `${delayMs}ms`,
    '--linear-grid-loader-frames': frameCount,
    '--linear-grid-loader-reduced-transform': 'translate(0)',
  } as CSSProperties

  useEffect(() => {
    const element = svgRef.current
    if (!element) return

    const computedColor = window.getComputedStyle(element).color
    const resolvedColor = color === 'currentColor' ? computedColor : color
    const resolvedDimColor = dimColor === undefined || dimColor === 'currentColor' ? resolvedColor : dimColor
    setSpriteHref(createSpriteDataUrl(variant, resolvedColor, resolvedDimColor, getCanvasScale(size)))
  }, [color, dimColor, size, variant])

  useEffect(() => {
    const element = svgRef.current
    if (!element) return undefined
    return observeViewport(element, setIsIntersecting)
  }, [])

  return (
    <svg
      {...a11y.svgProps}
      {...props}
      ref={svgRef}
      className={classes}
      style={mergedStyle}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      data-variant={variant}
    >
      {a11y.titleNode}
      <image
        className="linear-grid-loader__sprite"
        href={spriteHref}
        xlinkHref={spriteHref}
        width={frameCount * 16}
        height="16"
      />
    </svg>
  )
}
