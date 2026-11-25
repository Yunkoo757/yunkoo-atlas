import {
  DEFAULT_SYMBOL_CATALOG,
  mergeSymbolCatalog,
  mergeSymbolIcons,
  normalizeSymbol,
  normalizeSymbolCatalog,
  normalizeSymbolIcons,
  normalizeSelectableSymbolCatalog,
  type SymbolIconOverride,
  type SymbolIconsMap,
} from '@/lib/symbolIconCodec'

export {
  DEFAULT_SYMBOL_CATALOG,
  mergeSymbolCatalog,
  mergeSymbolIcons,
  normalizeSymbol,
  normalizeSymbolCatalog,
  normalizeSymbolIcons,
  normalizeSelectableSymbolCatalog,
} from '@/lib/symbolIconCodec'
export type { SymbolIconOverride, SymbolIconsMap } from '@/lib/symbolIconCodec'

export type SymbolMarketKind = 'crypto' | 'forex' | 'metal' | 'index' | 'other'

export type SymbolPresetSvgId = 'eth-diamond'

export type SymbolIconPreset = {
  id: string
  label: string
  /** 无 SVG 时的文字占位 */
  glyph: string
  color: string
  background: string
  /** 可选：用内置 SVG 形象代替文字 */
  svgId?: SymbolPresetSvgId
}

export type ResolvedSymbolIcon =
  | { type: 'image'; src: string; label: string }
  | { type: 'glyph'; glyph: string; color: string; background: string; label: string }
  | {
      type: 'svg'
      svgId: SymbolPresetSvgId
      color: string
      background: string
      label: string
    }

/** A「柔和圆章」：只保留足以识别资产的色彩空气感，避免列表形成彩色徽章墙。 */
export const SYMBOL_ICON_SURFACE_TINT = 12

function symbolSurface(color: string): string {
  return `color-mix(in srgb, ${color} ${SYMBOL_ICON_SURFACE_TINT}%, transparent)`
}

function glyphPreset(
  id: string,
  label: string,
  glyph: string,
  color: string,
  svgId?: SymbolPresetSvgId,
): SymbolIconPreset {
  return { id, label, glyph, color, background: symbolSurface(color), svgId }
}

export const SYMBOL_ICON_PRESETS: SymbolIconPreset[] = [
  glyphPreset('gold', '黄金', 'Au', 'var(--instrument-gold)'),
  glyphPreset('eur', '欧元', '€', 'var(--instrument-euro)'),
  glyphPreset('gbp', '英镑', '£', 'var(--instrument-sterling)'),
  glyphPreset('btc', 'Bitcoin', '₿', 'var(--instrument-bitcoin)'),
  glyphPreset('eth', 'Ethereum', 'ETH', 'var(--instrument-ether)', 'eth-diamond'),
]

const LEGACY_SYMBOL_ICON_PRESETS: SymbolIconPreset[] = [
  glyphPreset('sol', 'Solana', '◎', 'var(--instrument-mint)'),
  glyphPreset('bnb', 'BNB', 'B', 'var(--instrument-gold)'),
  glyphPreset('sui', 'Sui', 'S', 'var(--instrument-euro)'),
  glyphPreset('xrp', 'XRP', 'X', 'var(--instrument-silver)'),
  glyphPreset('silver', '白银', 'Ag', 'var(--instrument-silver)'),
  glyphPreset('forex', '外汇', 'Fx', 'var(--text-content-scan)'),
  glyphPreset('jpy', '日元', '¥', 'var(--text-content-scan)'),
  glyphPreset('aud', '澳元', 'A$', 'var(--text-content-scan)'),
  glyphPreset('usd', '美元', '$', 'var(--text-content-scan)'),
  glyphPreset('index', '指数', 'Ix', 'var(--text-content-scan)'),
  glyphPreset('generic', '通用', '·', 'var(--text-content-scan)'),
]

const PRESET_BY_ID = new Map(
  [...SYMBOL_ICON_PRESETS, ...LEGACY_SYMBOL_ICON_PRESETS].map((preset) => [preset.id, preset]),
)

const CRYPTO_BASE_PRESETS: Record<string, string> = {
  BTC: 'btc',
  XBT: 'btc',
  ETH: 'eth',
  SOL: 'sol',
  BNB: 'bnb',
  SUI: 'sui',
  XRP: 'xrp',
}

const BUILTIN_SYMBOL_PRESETS: Record<string, string> = {
  XAUUSD: 'gold',
  XAUUSDT: 'gold',
  GOLD: 'gold',
  XAGUSD: 'silver',
  XAGUSDT: 'silver',
  EURUSD: 'eur',
  GBPUSD: 'gbp',
  USDJPY: 'jpy',
  AUDUSD: 'aud',
  USDCAD: 'usd',
  USDCHF: 'usd',
  NZDUSD: 'usd',
  NAS100: 'index',
  US30: 'index',
  SPX500: 'index',
}

export function detectSymbolMarket(symbol: string): SymbolMarketKind {
  const key = normalizeSymbol(symbol)
  if (!key) return 'other'
  if (/^(XAU|XAG|GOLD|SILVER)/.test(key)) return 'metal'
  if (/(USDT|USDC|BUSD|USD)$/.test(key) && key.length >= 6 && !/^(EUR|GBP|AUD|NZD|USD|CAD|CHF|JPY)/.test(key)) {
    // crypto pairs often end with USDT; forex also ends with USD — prefer crypto if base looks like ticker
    if (key.endsWith('USDT') || key.endsWith('USDC') || key.endsWith('BUSD')) return 'crypto'
  }
  if (/^(BTC|ETH|SOL|BNB|XRP|SUI|DOGE|ADA|AVAX|DOT|LINK|MATIC|OP|ARB)/.test(key)) return 'crypto'
  if (/^(NAS|SPX|US30|US100|NDX|DJI|DAX|HK50)/.test(key)) return 'index'
  if (/^[A-Z]{6}$/.test(key) || /^(EUR|GBP|AUD|NZD|USD|CAD|CHF|JPY)/.test(key)) return 'forex'
  if (key.endsWith('USDT') || key.endsWith('USDC')) return 'crypto'
  return 'other'
}

function initialGlyph(symbol: string): string {
  const key = normalizeSymbol(symbol)
  if (!key) return '?'
  if (key.length <= 2) return key
  if (key.endsWith('USDT')) return key.slice(0, Math.min(3, key.length - 4))
  if (key.endsWith('USD') && key.length > 3) return key.slice(0, 3)
  return key.slice(0, 2)
}

export function defaultSymbolPresetId(symbol: string): string {
  const key = normalizeSymbol(symbol)
  const cryptoBase = key.replace(/(?:USDT|USDC|BUSD|USD)$/, '')
  const preset = BUILTIN_SYMBOL_PRESETS[key] ?? CRYPTO_BASE_PRESETS[cryptoBase]
  if (preset) return preset
  const kind = detectSymbolMarket(key)
  if (kind === 'crypto') return 'generic'
  if (kind === 'forex') return 'forex'
  if (kind === 'metal') return /^(XAG|SILVER)/.test(key) ? 'silver' : 'gold'
  if (kind === 'index') return 'index'
  return 'generic'
}

export function resolveSymbolPreset(symbol: string, preset: SymbolIconPreset): ResolvedSymbolIcon {
  const label = normalizeSymbol(symbol) || symbol
  if (preset.svgId) {
    return {
      type: 'svg',
      svgId: preset.svgId,
      color: preset.color,
      background: preset.background,
      label,
    }
  }
  return {
    type: 'glyph',
    glyph: preset.id === 'generic' ? initialGlyph(symbol) : preset.glyph,
    color: preset.color,
    background: preset.background,
    label,
  }
}

export function getSymbolIconPreset(id: string | null | undefined): SymbolIconPreset | undefined {
  if (!id) return undefined
  return PRESET_BY_ID.get(id)
}

export function resolveSymbolIcon(
  symbol: string,
  overrides?: SymbolIconsMap | null,
): ResolvedSymbolIcon {
  const key = normalizeSymbol(symbol)
  const label = key || symbol.trim() || '?'
  const override = key ? overrides?.[key] : undefined

  if (override?.customDataUrl) {
    return { type: 'image', src: override.customDataUrl, label }
  }

  const presetId = override?.presetId || defaultSymbolPresetId(symbol)
  const preset = getSymbolIconPreset(presetId) ?? getSymbolIconPreset('generic')!
  return resolveSymbolPreset(symbol, preset)
}

/** 合并目录与历史/当前品种；显式空目录保持为空。 */
export function collectSymbolOptions(
  catalog: string[],
  tradeSymbols: Iterable<string> = [],
  extra: Iterable<string> = [],
): string[] {
  return normalizeSymbolCatalog([...catalog, ...tradeSymbols, ...extra])
}

/** 压缩为正方形小图标，便于本地持久化 */
export function resizeSymbolIconImage(file: File, size = 64): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('canvas unavailable'))
          return
        }
        const scale = Math.max(size / img.width, size / img.height)
        const w = img.width * scale
        const h = img.height * scale
        ctx.clearRect(0, 0, size, size)
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
        resolve(canvas.toDataURL('image/png'))
      }
      img.onerror = () => reject(new Error('image load failed'))
      img.src = String(reader.result)
    }
    reader.onerror = () => reject(new Error('file read failed'))
    reader.readAsDataURL(file)
  })
}
