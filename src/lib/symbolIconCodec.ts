export const DEFAULT_SYMBOL_CATALOG = [
  'XAUUSD',
  'EURUSD',
  'GBPUSD',
  'BTCUSDT',
  'ETHUSDT',
] as const

const DEFAULT_SYMBOL_SET = new Set<string>(DEFAULT_SYMBOL_CATALOG)

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

/** 应用中的可新建目录固定为五个批准品种；保留用户对这五项的排序。 */
export function normalizeSelectableSymbolCatalog(value: unknown): string[] {
  const source = normalizeSymbolCatalog(value)
  const seen = new Set<string>()
  const out: string[] = []
  for (const symbol of source) {
    if (!DEFAULT_SYMBOL_SET.has(symbol) || seen.has(symbol)) continue
    seen.add(symbol)
    out.push(symbol)
  }
  for (const symbol of DEFAULT_SYMBOL_CATALOG) {
    if (seen.has(symbol)) continue
    seen.add(symbol)
    out.push(symbol)
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
