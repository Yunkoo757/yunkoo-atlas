import { ICON_MD } from '@/icons/iconSize'
import type { ReactNode } from 'react'
import { Pencil, Trash2, Star, Ban, BookOpen, Copy } from '@/icons/appIcons'
import { StatusIcon } from '@/components/StatusIcon'
import { STATUS_META, type Trade, type TradeStatus } from '@/data/trades'
import { STATUS_ORDER } from '@/lib/tradeStatus'
import type { CtxItem } from '@/components/ContextMenu'
import { toast } from '@/lib/toast'
import { useStore } from '@/store/useStore'
import { buildRecordActionDescriptors, type RecordActionId } from '@/lib/tradeActionContract'
import { copyTradeRecordWithFeedback } from '@/lib/tradeCopyAction'

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

  const actionIcons: Record<RecordActionId, ReactNode> = {
    edit: <Pencil size={ICON_MD} />,
    copy: <Copy size={ICON_MD} />,
    'extract-case': <BookOpen size={ICON_MD} />,
    star: <Star size={ICON_MD} fill={starred ? 'currentColor' : 'none'} />,
    delete: <Trash2 size={ICON_MD} />,
  }
  const actionHandlers: Record<RecordActionId, () => void> = {
    edit: () => a.openComposer(trade),
    copy: () => copyTradeRecordWithFeedback(trade.id),
    'extract-case': () => a.createReviewCase?.(trade),
    star: () => a.toggleStar?.(trade.id),
    delete: () => {
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
  }
  const businessActions = buildRecordActionDescriptors(trade, { starred: Boolean(starred) })
    .filter((action) => action.id !== 'extract-case' || Boolean(a.createReviewCase))
    .map(
      (action): CtxItem => ({
        type: 'item',
        icon: actionIcons[action.id],
        label: action.label,
        danger: action.danger,
        onClick: actionHandlers[action.id],
      }),
    )

  const deleteIndex = businessActions.length - 1
  items.push(
    { type: 'divider' },
    ...businessActions.slice(0, deleteIndex),
    { type: 'divider' },
    businessActions[deleteIndex],
  )

  return items
}
