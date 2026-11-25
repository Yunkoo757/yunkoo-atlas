import { ICON_MD } from '@/icons/iconSize'
import type { ReactNode } from 'react'
import { Pencil, Trash2, BookOpen, Copy } from '@/icons/appIcons'
import { MarkIcon } from '@/icons/StateIcons'
import { StatusIcon } from '@/components/StatusIcon'
import { STATUS_META, type Trade, type TradeStatus } from '@/data/trades'
import { STATUS_ORDER } from '@/lib/tradeStatus'
import type { CtxItem } from '@/components/ContextMenu'
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
    canCopy?: boolean
    createReviewCase?: (trade: Trade) => void
    toggleStar?: (id: string) => void
    isStarred?: (id: string) => boolean
    toggleCaseFocus?: (id: string) => void
    isCaseFocused?: (id: string) => boolean
  },
): CtxItem[] {
  const starred = trade.tradeKind === 'case'
    ? a.isCaseFocused?.(trade.id)
    : a.isStarred?.(trade.id)
  const applyStatus = (s: TradeStatus) => {
    if (a.changeStatus) a.changeStatus(s)
    else if (s === 'open') a.requestTradeOpen(trade.id)
    else a.setStatus(trade.id, s)
  }
  const items: CtxItem[] = [
    { type: 'label', text: '改为状态' },
    ...STATUS_ORDER.filter(status => status !== trade.status).map(
      (s): CtxItem => ({
        type: 'item',
        icon: <StatusIcon status={s} size={ICON_MD} />,
        label: STATUS_META[s].label,
        onClick: () => applyStatus(s),
      }),
    ),
  ]

  const actionIcons: Record<RecordActionId, ReactNode> = {
    edit: <Pencil size={ICON_MD} />,
    copy: <Copy size={ICON_MD} />,
    'extract-case': <BookOpen size={ICON_MD} />,
    star: <MarkIcon kind="star" active={Boolean(starred)} size={ICON_MD} />,
    'focus-case': <MarkIcon kind="bookmark" active={Boolean(starred)} size={ICON_MD} />,
    delete: <Trash2 size={ICON_MD} />,
  }
  const actionHandlers: Record<RecordActionId, () => void> = {
    edit: () => a.openComposer(trade),
    copy: () => copyTradeRecordWithFeedback(trade.id),
    'extract-case': () => a.createReviewCase?.(trade),
    star: () => a.toggleStar?.(trade.id),
    'focus-case': () => a.toggleCaseFocus?.(trade.id),
    delete: () => a.removeTrade(trade.id),
  }
  const businessActions = buildRecordActionDescriptors(trade, { starred: Boolean(starred) })
    .filter((action) => action.id !== 'extract-case' || Boolean(a.createReviewCase))
    .map(
      (action): CtxItem => ({
        type: 'item',
        icon: actionIcons[action.id],
        label: action.label,
        danger: action.danger,
        disabled: action.id === 'copy' && a.canCopy === false,
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
