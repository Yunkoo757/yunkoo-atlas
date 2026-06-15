import type { Trade } from '@/data/trades'

/** 从所有交易中收集去重标签，按字母序排列 */
export function collectAllTags(trades: Trade[]): string[] {
  const set = new Set<string>()
  for (const t of trades) {
    for (const tag of t.tags) {
      const trimmed = tag.trim()
      if (trimmed) set.add(trimmed)
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}
