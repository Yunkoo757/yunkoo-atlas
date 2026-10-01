import type { Strategy } from '@/data/strategies'
import JSZip from 'jszip'
import type { Trade } from '@/data/trades'
import type { ExportAssetRecord } from '@/storage/types'
import { getProjectTrades, summarizeBacktest, type BacktestProject } from '@/lib/backtestProjects'
import { collectAssetIdsFromSnapshot } from '@/storage/assets'
import { loadReferencedAssetsForExport } from '@/lib/importExport'
import { webJournalExtensionForMime } from '@/lib/webJournalArchiveContract'

/** 分析包刻意不采用资料库备份格式；原始身份、正文与图片索引均可供外部分析。 */
export async function buildBacktestAnalysisPackage(
  project: BacktestProject,
  allTrades: readonly Trade[],
  getAsset: (id: string) => Promise<ExportAssetRecord | null>,
  strategies: readonly Strategy[] = [],
): Promise<Blob> {
  const trades = getProjectTrades(allTrades, project.id)
  const summary = summarizeBacktest(trades)
  const exportedAt = new Date().toISOString()
  const assets = await loadReferencedAssetsForExport(collectAssetIdsFromSnapshot({ trades }), getAsset)
  const zip = new JSZip()
  const attachments = assets.map(asset => ({ id: asset.id, mime: asset.mime, path: `images/${encodeURIComponent(asset.id)}.${webJournalExtensionForMime(asset.mime)}` }))
  assets.forEach((asset, index) => zip.file(attachments[index]!.path, asset.data, { base64: true }))
  zip.file('project.json', JSON.stringify({ format: 'atlas-backtest-analysis', version: 1, exportedAt, project, summary, strategies: strategies.filter(strategy => trades.some(trade => trade.strategyId === strategy.id) || project.defaultStrategyId === strategy.id), trades, attachments }, null, 2))
  const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const rows = [['编号', '历史日期', '品种', '方向', '状态', 'R', '策略ID', '执行偏差', '正文HTML'], ...trades.map(trade => [trade.ref, trade.openedAt, trade.symbol, trade.side, trade.status, trade.rMultiple, trade.strategyId, trade.mistakeTags.join(' / '), trade.note])]
  zip.file('trades.csv', rows.map(row => row.map(cell).join(',')).join('\r\n'))
  zip.file('README.md', `# ${project.name}\n\n导出时间：${exportedAt}\n品种：${project.symbol}\n历史开始：${project.startedAt}\n实际记录覆盖：${summary.firstDate ?? '—'} 至 ${summary.lastDate ?? '—'}\n目标：${project.targetCount} 笔，已确认：${summary.evaluatedCount} 笔\n待确认：${summary.pendingCount}；未参与：${summary.observationCount}\n胜 / 负 / 保本：${summary.winCount} / ${summary.lossCount} / ${summary.breakevenCount}\n胜率（含保本）：${summary.winRate?.toFixed(2) ?? '—'}%\n有效 R：${summary.rCount} 笔；总 R：${summary.totalR}；平均 R：${summary.averageR ?? '—'}\n\n## 固定参与规则\n\n${project.rules || '未填写'}\n\n## 阅读方式\n\nproject.json 包含全部记录、正文与附件索引；trades.csv 可用表格工具打开。正文中的 journal-asset://ID 与 attachments 的 id 对应。该包用于分析，不支持作为独立项目导入。完整恢复请使用资料库备份。\n\n统计按实际模拟参与结果计算，包括执行偏差；未参与和未确认结果不计目标笔数。R 为用户记录的最终结果，不自动估算手续费、点差或滑点。已提炼案例不重复计数，独立案例总结不包含在此分析包中。\n`)
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}
