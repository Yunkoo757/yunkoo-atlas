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
  quiet = false,
  title: _title,
}: {
  symbol: string
  overrides?: SymbolIconsMap | null
  size?: number
  className?: string
  /** 高密度列表中的低噪声呈现；详情、表单与设置仍使用完整资产色。 */
  quiet?: boolean
  /** @deprecated 不再写入原生 title，避免系统默认气泡 */
  title?: string
}) {
  const resolved = resolveSymbolIcon(symbol, overrides)
  const quietColor = (color: string) =>
    quiet
      ? `color-mix(in srgb, ${color} 86%, var(--text-body))`
      : color
  const quietBackground = (_color: string, background: string) =>
    quiet ? 'transparent' : background

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
        className={'symbol-icon is-svg' + (quiet ? ' is-quiet' : '') + (className ? ` ${className}` : '')}
        style={{
          width: size,
          height: size,
          background: quietBackground(resolved.color, resolved.background),
          color: quietColor(resolved.color),
        }}
        aria-hidden
      >
        <SymbolPresetSvg id={resolved.svgId} size={Math.max(10, Math.round(size * (quiet ? 0.82 : 0.75)))} />
      </span>
    )
  }

  // 无底列表符号把有限像素交给字形本身；大尺寸预览仍保持原有光学重量。
  const glyphScale = quiet ? 0.66 : resolved.glyph.length > 1 ? 0.46 : 0.56

  return (
    <span
      className={'symbol-icon is-glyph' + (quiet ? ' is-quiet' : '') + (className ? ` ${className}` : '')}
      style={{
        width: size,
        height: size,
        color: quietColor(resolved.color),
        background: quietBackground(resolved.color, resolved.background),
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
