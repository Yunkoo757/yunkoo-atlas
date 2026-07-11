import { Pencil, Trash2, Star, Ban, BookOpen } from '@/icons/appIcons'
import { StatusIcon } from '@/components/StatusIcon'
import { STATUS_META, type Trade, type TradeStatus } from '@/data/trades'
import { STATUS_ORDER } from '@/lib/tradeStatus'
import type { CtxItem } from '@/components/ContextMenu'

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
      label: starred ? '取消收藏' : '加入收藏',
      onClick: () => a.toggleStar?.(trade.id),
    },
    {
      type: 'item',
      icon: <Pencil size={15} />,
      label: '编辑',
      hint: 'E',
      onClick: () => a.openComposer(trade),
    },
    ...(trade.tradeKind === 'case' || !a.createReviewCase
      ? []
      : [
          {
            type: 'item' as const,
            icon: <BookOpen size={15} />,
            label: '沉淀为案例记录',
            onClick: () => a.createReviewCase?.(trade),
          },
        ]),
    { type: 'divider' },
    {
      type: 'item',
      icon: <Trash2 size={15} />,
      label: '删除交易',
      danger: true,
      onClick: () => a.removeTrade(trade.id),
    },
  )

  return items
}
