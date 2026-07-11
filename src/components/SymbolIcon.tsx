import {
  resolveSymbolIcon,
  type SymbolIconsMap,
} from '@/lib/symbolIcons'
import { SymbolPresetSvg } from '@/components/SymbolPresetSvg'
import './SymbolIcon.css'

export function SymbolIcon({
  symbol,
  overrides,
  size = 16,
  className = '',
  title,
}: {
  symbol: string
  overrides?: SymbolIconsMap | null
  size?: number
  className?: string
  title?: string
}) {
  const resolved = resolveSymbolIcon(symbol, overrides)
  const label = title ?? resolved.label

  if (resolved.type === 'image') {
    return (
      <span
        className={'symbol-icon' + (className ? ` ${className}` : '')}
        style={{ width: size, height: size }}
        title={label}
        aria-hidden
      >
        <img src={resolved.src} alt="" draggable={false} />
      </span>
    )
  }

  if (resolved.type === 'svg') {
    return (
      <span
        className={'symbol-icon is-svg' + (className ? ` ${className}` : '')}
        style={{
          width: size,
          height: size,
          background: resolved.background,
        }}
        title={label}
        aria-hidden
      >
        <SymbolPresetSvg id={resolved.svgId} size={Math.max(10, Math.round(size * 0.78))} />
      </span>
    )
  }

  const glyphScale = /[^\u0000-\u00ff]/.test(resolved.glyph)
    ? 0.72
    : resolved.glyph.length > 1
      ? 0.48
      : 0.62

  return (
    <span
      className={'symbol-icon is-glyph' + (className ? ` ${className}` : '')}
      style={{
        width: size,
        height: size,
        color: resolved.color,
        background: resolved.background,
        fontSize: Math.max(9, Math.round(size * glyphScale)),
      }}
      title={label}
      aria-hidden
    >
      {resolved.glyph}
    </span>
  )
}

export function SymbolLabel({
  symbol,
  overrides,
  size = 16,
  className = '',
}: {
  symbol: string
  overrides?: SymbolIconsMap | null
  size?: number
  className?: string
}) {
  return (
    <span className={'symbol-label' + (className ? ` ${className}` : '')}>
      <SymbolIcon symbol={symbol} overrides={overrides} size={size} />
      <span className="symbol-label-text">{symbol}</span>
    </span>
  )
}
