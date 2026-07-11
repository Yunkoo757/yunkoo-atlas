import type { Trade } from '@/data/trades'

/** 规范化并合并标签预设：去空、去重、中文排序 */
export function mergeTagPresets(...sources: Array<Iterable<string> | undefined | null>): string[] {
  const set = new Set<string>()
  for (const source of sources) {
    if (!source) continue
    for (const tag of source) {
      if (typeof tag !== 'string') continue
      const trimmed = tag.trim()
      if (trimmed) set.add(trimmed)
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

/** 从所有交易中收集去重标签，按字母序排列 */
export function collectAllTags(trades: Trade[]): string[] {
  return mergeTagPresets(
    [],
    trades.flatMap((trade) => trade.tags ?? []),
  )
}

/** 从所有交易中收集错误 / 违规标签 */
export function collectAllMistakeTags(trades: Trade[]): string[] {
  return mergeTagPresets(
    [],
    trades.flatMap((trade) => trade.mistakeTags ?? []),
  )
}

/** 合并预设与交易中出现过的标签，供点选 / 联想 */
export function collectTagOptions(
  presets: Iterable<string> = [],
  trades: Trade[] = [],
): string[] {
  return mergeTagPresets(presets, collectAllTags(trades))
}

export function collectMistakeTagOptions(
  presets: Iterable<string> = [],
  trades: Trade[] = [],
): string[] {
  return mergeTagPresets(presets, collectAllMistakeTags(trades))
}
