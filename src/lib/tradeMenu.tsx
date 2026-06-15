import { Pencil, Trash2 } from 'lucide-react'
import { StatusIcon } from '@/components/StatusIcon'
import { STATUS_META, type Trade, type TradeStatus } from '@/data/trades'
import type { CtxItem } from '@/components/ContextMenu'

const ORDER: TradeStatus[] = ['planned', 'open', 'win', 'breakeven', 'loss']

export function buildTradeCtxItems(
  trade: Trade,
  a: {
    setStatus: (id: string, s: TradeStatus) => void
    openComposer: (t?: Trade | null) => void
    removeTrade: (id: string) => void
  },
): CtxItem[] {
  return [
    { type: 'label', text: '改为状态' },
    ...ORDER.map(
      (s): CtxItem => ({
        type: 'item',
        icon: <StatusIcon status={s} size={15} />,
        label: STATUS_META[s].label,
        onClick: () => a.setStatus(trade.id, s),
      }),
    ),
    { type: 'divider' },
    {
      type: 'item',
      icon: <Pencil size={15} />,
      label: '编辑',
      hint: 'E',
      onClick: () => a.openComposer(trade),
    },
    { type: 'divider' },
    {
      type: 'item',
      icon: <Trash2 size={15} />,
      label: '删除交易',
      danger: true,
      onClick: () => a.removeTrade(trade.id),
    },
  ]
}
