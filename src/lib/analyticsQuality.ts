import type { Trade } from '@/data/trades'
import { buildAnalyticsMetrics, type AnalyticsMetrics } from '@/lib/analyticsMetrics'

export interface QualitySlice {
  key: string
  label: string
  count: number
  metrics: AnalyticsMetrics
}

export interface QualityBreakdown {
  byStrategy: QualitySlice[]
  byMistakeTag: QualitySlice[]
  bySession: QualitySlice[]
}

function slices(groups: Map<string, Trade[]>): QualitySlice[] {
  return [...groups.entries()]
    .map(([key, values]) => ({
      key,
      label: key || '未设置',
      count: values.length,
      metrics: buildAnalyticsMetrics(values),
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'zh-CN'))
}

export function buildQualityBreakdown(trades: Trade[]): QualityBreakdown {
  const byStrategy = new Map<string, Trade[]>()
  const byMistakeTag = new Map<string, Trade[]>()
  const bySession = new Map<string, Trade[]>()
  for (const trade of trades) {
    const strategy = byStrategy.get(trade.strategyId) ?? []
    strategy.push(trade)
    byStrategy.set(trade.strategyId, strategy)
    const session = bySession.get(trade.session ?? '') ?? []
    session.push(trade)
    bySession.set(trade.session ?? '', session)
    for (const tag of trade.mistakeTags) {
      const tagged = byMistakeTag.get(tag) ?? []
      tagged.push(trade)
      byMistakeTag.set(tag, tagged)
    }
  }
  return {
    byStrategy: slices(byStrategy),
    byMistakeTag: slices(byMistakeTag),
    bySession: slices(bySession),
  }
}

export function buildMistakeTagQuality(trades: Trade[]): QualitySlice[] {
  const byMistakeTag = new Map<string, Trade[]>()
  for (const trade of trades) {
    for (const tag of trade.mistakeTags) {
      const tagged = byMistakeTag.get(tag) ?? []
      tagged.push(trade)
      byMistakeTag.set(tag, tagged)
    }
  }
  return slices(byMistakeTag)
}
