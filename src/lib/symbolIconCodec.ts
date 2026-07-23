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
  presetId?: string | null
  customDataUrl?: string | null
  updatedAt: string
}

export type SymbolIconsMap = Record<string, SymbolIconOverride>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[\s/_-]+/g, '')
}

export function normalizeSymbolIcons(value: unknown): SymbolIconsMap {
  if (!isRecord(value)) return {}
  const out: SymbolIconsMap = {}
  for (const [rawKey, rawEntry] of Object.entries(value)) {
    const key = normalizeSymbol(rawKey)
    if (!key || !isRecord(rawEntry)) continue
    const presetId = typeof rawEntry.presetId === 'string' && rawEntry.presetId.trim()
      ? rawEntry.presetId.trim()
      : null
    const customDataUrl = typeof rawEntry.customDataUrl === 'string' && rawEntry.customDataUrl.startsWith('data:')
      ? rawEntry.customDataUrl
      : null
    const updatedAt = typeof rawEntry.updatedAt === 'string' && rawEntry.updatedAt.trim()
      ? rawEntry.updatedAt
      : null
    if ((!presetId && !customDataUrl) || !updatedAt) continue
    out[key] = {
      presetId,
      customDataUrl,
      updatedAt,
    }
  }
  return out
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
  return out
}

export function mergeSymbolIcons(
  current: SymbolIconsMap,
  imported: SymbolIconsMap,
): SymbolIconsMap {
  return normalizeSymbolIcons({ ...current, ...imported })
}

export function mergeSymbolCatalog(current: string[], imported: string[]): string[] {
  return normalizeSymbolCatalog([...current, ...imported])
}
