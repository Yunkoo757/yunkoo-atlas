import { createAnalyticsSnapshot } from './analytics-trades.mjs'

/** 仅供隔离客户端复核；这些笔数与结果都是模拟数据，不是真实回测结论。 */
export function createBacktestReviewSnapshot() {
  const snapshot = createAnalyticsSnapshot({ count: 1 })
  const now = '2026-09-30T00:00:00.000Z'
  const project = {
    id: 'isolated-backtest-100', name: '隔离模拟 · XAUUSD 固定规则100笔', symbol: 'XAUUSD',
    startedAt: '2025-02-26', targetCount: 100, defaultStrategyId: snapshot.strategies[0].id,
    rules: '【模拟数据，非真实回测】连续记录同一套固定参与规则下的历史机会；不按后续盈亏挑选样本。每笔只保留最终参与结果，执行偏差照常计入。',
    archivedAt: null, completedAt: null, createdAt: now, updatedAt: now,
  }
  snapshot.backtestProjects = [project]
  snapshot.trades = Array.from({ length: 100 }, (_, index) => {
    const day = new Date(Date.UTC(2025, 1, 26 + index * 2)).toISOString().slice(0, 10)
    const slot = index % 10
    const r = slot < 5 ? 2 : slot < 9 ? -1 : 0
    return {
      id: `isolated-bt-${index + 1}`, ref: `TRD-${index + 1}`, tradeKind: 'backtest', backtestProjectId: project.id,
      symbol: 'XAUUSD', side: index % 2 ? 'short' : 'long', status: r > 0 ? 'win' : r < 0 ? 'loss' : 'breakeven',
      conviction: 'medium', strategyId: project.defaultStrategyId, tags: ['隔离模拟'], mistakeTags: index % 13 === 0 ? ['执行偏差样例'] : [],
      reviewStatus: 'unreviewed', reviewCategory: 'normal', timeframe: '15M', session: 'london',
      openedAt: day, closedAt: day, closedTradingDayKey: day, recordedAt: now,
      entry: 0, size: 0, stopLoss: null, exit: null, pnl: null, rMultiple: r, resultSource: 'r',
      note: `<h2>模拟机会 ${index + 1}</h2><p>这是用于检查项目、统计、编辑和导出的隔离样例，不代表真实市场交易。固定规则下按时间顺序记录，最终模拟结果 ${r} R。</p>${index % 13 === 0 ? '<p>执行偏差：用标签保留偏差，结果仍照常计入；不排除这笔样本。</p>' : ''}${index % 10 === 0 ? '<p>复核点：正文与截图仍采用现有详情页；可以提炼独立案例，原记录与项目统计保持不变。</p><img src="journal-asset://backtest-demo-chart" />' : ''}`,
      comments: [], activities: [{ id: `isolated-create-${index + 1}`, kind: 'create', timestamp: now }],
    }
  })
  snapshot.starredIds = ['isolated-bt-1', 'isolated-bt-14']
  snapshot.symbolCatalog = [...new Set(['XAUUSD', ...snapshot.symbolCatalog])]
  snapshot.profile.displayName = '回测功能 · 隔离测试资料库'
  snapshot.display = { ...snapshot.display, privacyMode: false, hideClosed: false }
  return snapshot
}
