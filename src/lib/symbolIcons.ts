export type SymbolMarketKind = 'crypto' | 'forex' | 'metal' | 'index' | 'other'

/** 新建交易 / 设置页共用的默认品种目录 */
export const DEFAULT_SYMBOL_CATALOG = [
  'XAUUSD',
  'EURUSD',
  'GBPUSD',
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
] as const


export type SymbolIconOverride = {
  /** 选用内置预设；与 customDataUrl 互斥，自定义图优先 */
  presetId?: string | null
  /** 用户上传的图标（data URL），后续可迁到资产库 */
  customDataUrl?: string | null
  updatedAt: string
}

/** key = normalizeSymbol(symbol) */
export type SymbolIconsMap = Record<string, SymbolIconOverride>

export type SymbolPresetSvgId = 'gold-bar' | 'silver-bar'

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

export const SYMBOL_ICON_PRESETS: SymbolIconPreset[] = [
  { id: 'btc', label: 'Bitcoin', glyph: '₿', color: '#F7931A', background: 'color-mix(in srgb, #F7931A 20%, transparent)' },
  { id: 'eth', label: 'Ethereum', glyph: 'Ξ', color: '#8B9CFF', background: 'color-mix(in srgb, #627EEA 20%, transparent)' },
  { id: 'sol', label: 'Solana', glyph: '◎', color: '#14F195', background: 'color-mix(in srgb, #9945FF 20%, transparent)' },
  { id: 'bnb', label: 'BNB', glyph: 'B', color: '#F3BA2F', background: 'color-mix(in srgb, #F3BA2F 20%, transparent)' },
  { id: 'sui', label: 'Sui', glyph: 'S', color: '#4DA2FF', background: 'color-mix(in srgb, #4DA2FF 20%, transparent)' },
  { id: 'xrp', label: 'XRP', glyph: 'X', color: '#E5E7EB', background: 'color-mix(in srgb, #23292F 20%, transparent)' },
  /* A1：金/银用平面 glyph，去掉立体金条以免抢戏 */
  { id: 'gold', label: '黄金', glyph: 'Au', color: '#E8C547', background: 'color-mix(in srgb, #C99212 20%, transparent)' },
  { id: 'silver', label: '白银', glyph: 'Ag', color: '#C5CDD8', background: 'color-mix(in srgb, #8B95A5 20%, transparent)' },
  { id: 'forex', label: '外汇', glyph: 'Fx', color: '#7DD3FC', background: 'color-mix(in srgb, #0EA5E9 20%, transparent)' },
  { id: 'eur', label: '欧元', glyph: '€', color: '#60A5FA', background: 'color-mix(in srgb, #2563EB 20%, transparent)' },
  { id: 'gbp', label: '英镑', glyph: '£', color: '#F9A8D4', background: 'color-mix(in srgb, #DB2777 20%, transparent)' },
  { id: 'jpy', label: '日元', glyph: '¥', color: '#FCA5A5', background: 'color-mix(in srgb, #DC2626 20%, transparent)' },
  { id: 'aud', label: '澳元', glyph: 'A$', color: '#86EFAC', background: 'color-mix(in srgb, #16A34A 20%, transparent)' },
  { id: 'usd', label: '美元', glyph: '$', color: '#86EFAC', background: 'color-mix(in srgb, #15803D 20%, transparent)' },
  { id: 'index', label: '指数', glyph: 'Ix', color: '#C4B5FD', background: 'color-mix(in srgb, #7C3AED 20%, transparent)' },
  { id: 'generic', label: '通用', glyph: '·', color: 'var(--text-secondary)', background: 'var(--bg-hover)' },
]

const PRESET_BY_ID = new Map(SYMBOL_ICON_PRESETS.map((preset) => [preset.id, preset]))

const BUILTIN_SYMBOL_PRESETS: Record<string, string> = {
  BTCUSDT: 'btc',
  BTCUSD: 'btc',
  XBTUSD: 'btc',
  ETHUSDT: 'eth',
  ETHUSD: 'eth',
  SOLUSDT: 'sol',
  SOLUSD: 'sol',
  BNBUSDT: 'bnb',
  BNBUSD: 'bnb',
  SUIUSDT: 'sui',
  SUIUSD: 'sui',
  XRPUSDT: 'xrp',
  XRPUSD: 'xrp',
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

const PALETTE = [
  { color: '#93C5FD', background: 'color-mix(in srgb, #3B82F6 20%, transparent)' },
  { color: '#86EFAC', background: 'color-mix(in srgb, #22C55E 20%, transparent)' },
  { color: '#FCD34D', background: 'color-mix(in srgb, #EAB308 20%, transparent)' },
  { color: '#F9A8D4', background: 'color-mix(in srgb, #EC4899 20%, transparent)' },
  { color: '#C4B5FD', background: 'color-mix(in srgb, #8B5CF6 20%, transparent)' },
  { color: '#67E8F9', background: 'color-mix(in srgb, #06B6D4 20%, transparent)' },
  { color: '#FDBA74', background: 'color-mix(in srgb, #F97316 20%, transparent)' },
  { color: '#FDA4AF', background: 'color-mix(in srgb, #F43F5E 20%, transparent)' },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[\s/_-]+/g, '')
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

function hashSymbol(symbol: string): number {
  let hash = 0
  for (const char of symbol) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash
}

function initialGlyph(symbol: string): string {
  const key = normalizeSymbol(symbol)
  if (!key) return '?'
  if (key.length <= 2) return key
  if (key.endsWith('USDT')) return key.slice(0, Math.min(3, key.length - 4))
  if (key.endsWith('USD') && key.length > 3) return key.slice(0, 3)
  return key.slice(0, 2)
}

function defaultPresetId(symbol: string): string {
  const key = normalizeSymbol(symbol)
  if (BUILTIN_SYMBOL_PRESETS[key]) return BUILTIN_SYMBOL_PRESETS[key]!
  const kind = detectSymbolMarket(key)
  if (kind === 'crypto') return 'generic'
  if (kind === 'forex') return 'forex'
  if (kind === 'metal') return 'gold'
  if (kind === 'index') return 'index'
  return 'generic'
}

function glyphFromPresetOrFallback(symbol: string, preset: SymbolIconPreset): ResolvedSymbolIcon {
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
  if (preset.id === 'generic') {
    const tone = PALETTE[hashSymbol(normalizeSymbol(symbol)) % PALETTE.length]!
    return {
      type: 'glyph',
      glyph: initialGlyph(symbol),
      color: tone.color,
      background: tone.background,
      label,
    }
  }
  return {
    type: 'glyph',
    glyph: preset.glyph,
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

  const presetId = override?.presetId || defaultPresetId(symbol)
  const preset = getSymbolIconPreset(presetId) ?? getSymbolIconPreset('generic')!
  return glyphFromPresetOrFallback(symbol, preset)
}

export function normalizeSymbolIcons(value: unknown): SymbolIconsMap {
  if (!isRecord(value)) return {}
  const out: SymbolIconsMap = {}
  for (const [rawKey, rawEntry] of Object.entries(value)) {
    const key = normalizeSymbol(rawKey)
    if (!key || !isRecord(rawEntry)) continue
    const presetId =
      typeof rawEntry.presetId === 'string' && rawEntry.presetId.trim()
        ? rawEntry.presetId.trim()
        : null
    const customDataUrl =
      typeof rawEntry.customDataUrl === 'string' && rawEntry.customDataUrl.startsWith('data:')
        ? rawEntry.customDataUrl
        : null
    if (!presetId && !customDataUrl) continue
    out[key] = {
      presetId,
      customDataUrl,
      updatedAt:
        typeof rawEntry.updatedAt === 'string' && rawEntry.updatedAt
          ? rawEntry.updatedAt
          : new Date().toISOString(),
    }
  }
  return out
}

export function mergeSymbolIcons(
  current: SymbolIconsMap,
  imported: SymbolIconsMap,
): SymbolIconsMap {
  return normalizeSymbolIcons({ ...current, ...imported })
}

export function normalizeSymbolCatalog(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [...DEFAULT_SYMBOL_CATALOG]
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of source) {
    if (typeof item !== 'string') continue
    const key = normalizeSymbol(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out.length > 0 ? out : [...DEFAULT_SYMBOL_CATALOG]
}

export function mergeSymbolCatalog(current: string[], imported: string[]): string[] {
  return normalizeSymbolCatalog([...current, ...imported])
}

/** 合并目录与交易中出现过的品种，供下拉与设置共用 */
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
