import { matchesSearchQuery } from '@/lib/tradeFilters'

export interface LimitedCommandMatches<TResult> {
  items: TResult[]
  total: number
}

/**
 * 扫描全部候选以保留准确的匹配总数，但只为可见结果创建命令对象。
 * 空查询交由命令面板的固定快捷入口处理，避免构造动态数据命令。
 */
export function collectLimitedCommandMatches<TCandidate, TResult>(
  candidates: readonly TCandidate[],
  query: string,
  getSearchFields: (candidate: TCandidate) => (string | undefined)[],
  project: (candidate: TCandidate) => TResult,
  limit: number,
): LimitedCommandMatches<TResult> {
  if (!query.trim()) return { items: [], total: 0 }

  const result: TResult[] = []
  let total = 0
  const safeLimit = Math.max(0, Math.floor(limit))

  for (const candidate of candidates) {
    if (!matchesSearchQuery(query, ...getSearchFields(candidate))) continue
    total += 1
    if (result.length < safeLimit) result.push(project(candidate))
  }

  return { items: result, total }
}
