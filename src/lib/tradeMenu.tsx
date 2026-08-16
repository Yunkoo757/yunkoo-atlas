import { ICON_MD } from '@/icons/iconSize'
import { Pencil, Trash2, Star, Ban, BookOpen, Copy } from '@/icons/appIcons'
import { StatusIcon } from '@/components/StatusIcon'
import { STATUS_META, type Trade, type TradeStatus } from '@/data/trades'
import { STATUS_ORDER } from '@/lib/tradeStatus'
import type { CtxItem } from '@/components/ContextMenu'
import { toast } from '@/lib/toast'
import { useStore } from '@/store/useStore'
import { buildSafeTradeCopies } from '@/lib/tradeCopy'

export function buildTradeCtxItems(
  trade: Trade,
  a: {
    setStatus: (id: string, s: TradeStatus) => void
    requestTradeOpen: (id: string, returnFocus?: HTMLElement | null) => void
    changeStatus?: (status: TradeStatus) => void
    openComposer: (t?: Trade | null) => void
    removeTrade: (id: string) => void
    createReviewCase?: (trade: Trade) => void
    toggleStar?: (id: string) => void
    isStarred?: (id: string) => boolean
  },
): CtxItem[] {
  const starred = a.isStarred?.(trade.id)
  const applyStatus = (s: TradeStatus) => {
    if (a.changeStatus) a.changeStatus(s)
    else if (s === 'open') a.requestTradeOpen(trade.id)
    else a.setStatus(trade.id, s)
  }
  const items: CtxItem[] = [
    { type: 'label', text: '改为状态' },
    ...STATUS_ORDER.map(
      (s): CtxItem => ({
        type: 'item',
        icon: <StatusIcon status={s} size={ICON_MD} />,
        label: STATUS_META[s].label,
        onClick: () => applyStatus(s),
      }),
    ),
  ]

  if (trade.status === 'planned') {
    items.push(
      { type: 'divider' },
      {
        type: 'item',
        icon: <Ban size={ICON_MD} />,
        label: '标记为错过',
        onClick: () => applyStatus('missed'),
      },
    )
  }

  items.push(
    { type: 'divider' },
    {
      type: 'item',
      icon: <Star size={ICON_MD} fill={starred ? 'currentColor' : 'none'} />,
      label: starred ? '取消星标' : '加入星标',
      onClick: () => a.toggleStar?.(trade.id),
    },
    {
      type: 'item',
      icon: <Pencil size={ICON_MD} />,
      label: '编辑',
      onClick: () => a.openComposer(trade),
    },
    {
      type: 'item',
      icon: <Copy size={ICON_MD} />,
      label: trade.tradeKind === 'case' ? '复制案例' : '复制为新计划',
      onClick: () => {
        const state = useStore.getState()
        const source = state.trades.find((candidate) => candidate.id === trade.id && !candidate.deletedAt)
        if (!source) {
          toast('源记录已变更，无法复制', { tone: 'error' })
          return
        }
        try {
          const copies = buildSafeTradeCopies([source], state.trades, {
            now: new Date(),
            createId: () => crypto.randomUUID(),
          })
          const result = state.upsertTrades(copies)
          if (result !== 'updated') {
            toast('复制失败，请重试', { tone: 'error' })
            return
          }
          toast(source.tradeKind === 'case' ? '已复制为新案例' : '已复制为新计划', { tone: 'success' })
        } catch {
          toast('复制失败，请重试', { tone: 'error' })
        }
      },
    },
    ...(trade.tradeKind === 'case' || !a.createReviewCase
      ? []
      : [
          {
            type: 'item' as const,
            icon: <BookOpen size={ICON_MD} />,
            label: '提炼为案例',
            onClick: () => a.createReviewCase?.(trade),
          },
        ]),
    { type: 'divider' },
    {
      type: 'item',
      icon: <Trash2 size={ICON_MD} />,
      label: trade.tradeKind === 'case' ? '删除案例记录' : '删除交易',
      danger: true,
      onClick: () => {
        const deletedId = trade.id
        a.removeTrade(deletedId)
        toast('已移至回收站，30 天后自动清空', {
          label: '撤销',
          onClick: () => {
            useStore.getState().restoreTrade(deletedId)
            toast('已从回收站恢复')
          },
        })
      },
    },
  )

  return items
}
