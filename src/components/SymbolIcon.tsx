import {
  resolveSymbolIcon,
  resolveSymbolPreset,
  type SymbolIconPreset,
  type SymbolIconsMap,
} from '@/lib/symbolIcons'
import { ICON_TILE } from '@/icons/iconSize'
import { InstrumentMark } from '@/icons/InstrumentMark'
import './SymbolIcon.css'

export function SymbolIcon({
  symbol,
  overrides,
  preset,
  size = ICON_TILE,
  className = '',
  quiet = false,
  title: _title,
}: {
  symbol: string
  overrides?: SymbolIconsMap | null
  preset?: SymbolIconPreset
  size?: number
  className?: string
  /** 高密度列表使用无底色的品种标识。 */
  quiet?: boolean
  /** @deprecated 不再写入原生 title，避免系统默认气泡 */
  title?: string
}) {
  const resolved = preset ? resolveSymbolPreset(symbol, preset) : resolveSymbolIcon(symbol, overrides)

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
    const markSize = Math.min(size, Math.max(12, quiet ? size - 2 : Math.round(size * 0.75)))
    return (
      <span
        className={'symbol-icon is-svg' + (quiet ? ' is-quiet' : '') + (className ? ` ${className}` : '')}
        style={{
          width: size,
          height: size,
          background: quiet ? 'transparent' : resolved.background,
          color: resolved.color,
        }}
        aria-hidden
      >
        <InstrumentMark id={resolved.svgId} size={markSize} />
      </span>
    )
  }

  // 无底列表符号把有限像素交给字形本身；大尺寸预览仍保持原有光学重量。
  const glyphScale = resolved.glyph.length > 1 ? 0.46 : 0.56

  return (
    <span
      className={'symbol-icon is-glyph' + (quiet ? ' is-quiet' : '') + (className ? ` ${className}` : '')}
      style={{
        width: size,
        height: size,
        color: resolved.color,
        background: quiet ? 'transparent' : resolved.background,
        fontSize: quiet
          ? resolved.glyph.length > 1 ? 'var(--type-caption-size)' : 'var(--type-metadata-size)'
          : Math.max(9, Math.round(size * glyphScale)),
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
