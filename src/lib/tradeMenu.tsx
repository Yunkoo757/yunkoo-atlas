import { Pencil, Trash2, Star, Ban, BookOpen } from '@/icons/appIcons'
import { StatusIcon } from '@/components/StatusIcon'
import { STATUS_META, type Trade, type TradeStatus } from '@/data/trades'
import { STATUS_ORDER } from '@/lib/tradeStatus'
import type { CtxItem } from '@/components/ContextMenu'
import { toast } from '@/lib/toast'
import { useStore } from '@/store/useStore'

export function buildTradeCtxItems(
  trade: Trade,
  a: {
    setStatus: (id: string, s: TradeStatus) => void
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
    else a.setStatus(trade.id, s)
  }
  const items: CtxItem[] = [
    { type: 'label', text: '改为状态' },
    ...STATUS_ORDER.map(
      (s): CtxItem => ({
        type: 'item',
        icon: <StatusIcon status={s} size={15} />,
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
        icon: <Ban size={15} />,
        label: '标记为错过',
        onClick: () => applyStatus('missed'),
      },
    )
  }

  items.push(
    { type: 'divider' },
    {
      type: 'item',
      icon: <Star size={15} fill={starred ? 'currentColor' : 'none'} />,
      label: starred ? '取消星标' : '加入星标',
      onClick: () => a.toggleStar?.(trade.id),
    },
    {
      type: 'item',
      icon: <Pencil size={15} />,
      label: '编辑',
      onClick: () => a.openComposer(trade),
    },
    ...(trade.tradeKind === 'case' || !a.createReviewCase
      ? []
      : [
          {
            type: 'item' as const,
            icon: <BookOpen size={15} />,
            label: '提炼为案例',
            onClick: () => a.createReviewCase?.(trade),
          },
        ]),
    { type: 'divider' },
    {
      type: 'item',
      icon: <Trash2 size={15} />,
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
