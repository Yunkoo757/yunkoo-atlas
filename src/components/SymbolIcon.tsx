import {
  resolveSymbolIcon,
  type SymbolIconsMap,
} from '@/lib/symbolIcons'
import { SymbolPresetSvg } from '@/components/SymbolPresetSvg'
import { ICON_TILE } from '@/icons/iconSize'
import './SymbolIcon.css'

export function SymbolIcon({
  symbol,
  overrides,
  size = ICON_TILE,
  className = '',
  title: _title,
}: {
  symbol: string
  overrides?: SymbolIconsMap | null
  size?: number
  className?: string
  /** @deprecated 不再写入原生 title，避免系统默认气泡 */
  title?: string
}) {
  const resolved = resolveSymbolIcon(symbol, overrides)

  if (resolved.type === 'image') {
    return (
      <span
        className={'symbol-icon is-image' + (className ? ` ${className}` : '')}
        style={{ width: size, height: size }}
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
          color: resolved.color,
        }}
        aria-hidden
      >
        <SymbolPresetSvg id={resolved.svgId} size={Math.max(10, Math.round(size * 0.75))} />
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
      aria-hidden
    >
      {resolved.glyph}
    </span>
  )
}

export function SymbolLabel({
  symbol,
  overrides,
  size = ICON_TILE,
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
