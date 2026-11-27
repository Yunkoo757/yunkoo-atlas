import { useState } from 'react'
import type { Trade } from '@/data/trades'
import { Copy, Trash2 } from '@/icons/appIcons'
import { ICON_SM } from '@/icons/iconSize'
import { getBatchCopyActionLabel } from '@/lib/tradeActionContract'
import { buildSafeTradeCopies } from '@/lib/tradeCopy'
import { moveRecordsToTrash } from '@/lib/tradeTrashAction'
import { intersectSelectedTradeIds } from '@/lib/tradeView'
import { toast } from '@/lib/toast'
import { useStore } from '@/store/useStore'
import { BatchActionBar } from '@/components/ui/BatchActionBar'
import { Button } from '@/components/ui/Button'
import { ModalShell } from '@/components/ui/ModalShell'

export function TradeBatchActions({ selectedIds, visible, trades, onClear }: {
  selectedIds: Set<string>
  visible: Trade[]
  trades: Trade[]
  onClear: () => void
}) {
  const [copyCandidateIds, setCopyCandidateIds] = useState<string[] | null>(null)
  const upsertTrades = useStore(state => state.upsertTrades)

  const batchDelete = () => {
    const actionableIds = intersectSelectedTradeIds(selectedIds, visible)
    moveRecordsToTrash([...actionableIds])
    onClear()
  }

  const requestBatchCopy = () => {
    const actionableIds = intersectSelectedTradeIds(selectedIds, visible)
    if (actionableIds.size === 0) {
      toast('当前没有可复制的记录')
      return
    }
    setCopyCandidateIds([...actionableIds])
  }

  const confirmBatchCopy = () => {
    if (!copyCandidateIds) return
    const sourceById = new Map(trades.map((trade) => [trade.id, trade]))
    const sources = copyCandidateIds
      .map((id) => sourceById.get(id))
      .filter((trade): trade is Trade => Boolean(trade && !trade.deletedAt))
    if (sources.length !== copyCandidateIds.length) {
      toast('部分源记录已变化，请重新选择后再复制', { tone: 'warning' })
      setCopyCandidateIds(null)
      return
    }

    try {
      const copies = buildSafeTradeCopies(sources, useStore.getState().trades, {
        now: new Date(),
        tradingDayStartHour: useStore.getState().display.tradingDayStartHour,
        createId: () => crypto.randomUUID(),
      })
      if (upsertTrades(copies) !== 'updated') throw new Error('复制失败，请重试')

      const hasCases = sources.some((trade) => trade.tradeKind === 'case')
      const hasAccountTrades = sources.some((trade) => trade.tradeKind !== 'case')
      toast(
        hasCases && hasAccountTrades
          ? `已复制 ${copies.length} 条记录`
          : hasCases
            ? `已复制 ${copies.length} 个案例`
            : `已将 ${copies.length} 笔交易复制为新计划`,
        { tone: 'success' },
      )
      onClear()
      setCopyCandidateIds(null)
    } catch (error) {
      toast(error instanceof Error ? error.message : '复制失败，源记录未改变', { tone: 'error' })
      setCopyCandidateIds(null)
    }
  }

  const selectedSources = selectedIds.size ? visible.filter((trade) => selectedIds.has(trade.id)) : []
  const copyActionLabel = getBatchCopyActionLabel(selectedSources)
  const copyCandidateSet = new Set(copyCandidateIds ?? [])
  const copyCandidates = copyCandidateIds ? trades.filter((trade) => copyCandidateSet.has(trade.id)) : []
  const copyAccountCount = copyCandidates.filter((trade) => trade.tradeKind !== 'case').length
  const copyCaseCount = copyCandidates.length - copyAccountCount
  const copyConfirmLabel = copyAccountCount > 0 && copyCaseCount > 0
    ? `复制 ${copyCandidates.length} 条记录`
    : copyCaseCount > 0
      ? `复制 ${copyCaseCount} 个案例`
      : `创建 ${copyAccountCount} 笔新计划`

  return (
    <>
      <BatchActionBar count={selectedIds.size}>
        <Button size="sm" onClick={requestBatchCopy}>
          <Copy size={ICON_SM} />
          <span>{copyActionLabel}</span>
        </Button>
        <Button size="sm" variant="danger" onClick={batchDelete}>
          <Trash2 size={ICON_SM} />
          <span>删除</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={onClear}>取消选择</Button>
      </BatchActionBar>
      {copyCandidateIds ? (
        <ModalShell
          title="确认复制所选记录"
          size="compact"
          panelClassName="copy-confirm-modal"
          onClose={() => setCopyCandidateIds(null)}
          footer={(
            <>
              <Button
                type="button"
                size="lg" variant="bordered"
                data-autofocus
                onClick={() => setCopyCandidateIds(null)}
              >
                取消
              </Button>
              <Button
                type="button"
                size="lg" variant="primary"
                disabled={copyCandidates.length !== copyCandidateIds.length}
                onClick={confirmBatchCopy}
              >
                {copyConfirmLabel}
              </Button>
            </>
          )}
        >
          <div className="copy-preview">
            {copyAccountCount > 0 ? (
              <section className="copy-preview-section">
                <div className="copy-preview-heading">
                  <strong>{copyAccountCount} 笔实盘/模拟记录</strong>
                  <span>复制为新计划</span>
                </div>
                <dl className="copy-preview-list">
                  <div>
                    <dt>保留</dt>
                    <dd>品种、方向、策略、周期、标签、止损、仓位与交易上下文</dd>
                  </div>
                  <div>
                    <dt>清空</dt>
                    <dd>成交与平仓结果、盈亏/R、复盘正文与状态、错误标签、评论、活动、删除及案例字段</dd>
                  </div>
                </dl>
              </section>
            ) : null}
            {copyCaseCount > 0 ? (
              <section className="copy-preview-section">
                <div className="copy-preview-heading">
                  <strong>{copyCaseCount} 个案例</strong>
                  <span>复制为新案例</span>
                </div>
                <dl className="copy-preview-list">
                  <div>
                    <dt>保留</dt>
                    <dd>案例正文、分类、标签、错误标签与来源追溯</dd>
                  </div>
                  <div>
                    <dt>重置</dt>
                    <dd>掌握状态、复看进度、复盘完成时间、评论、活动与删除状态</dd>
                  </div>
                </dl>
              </section>
            ) : null}
          </div>
        </ModalShell>
      ) : null}
    </>
  )
}
