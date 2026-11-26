import { toast } from '@/lib/toast'
import { useStore } from '@/store/useStore'

export function moveRecordsToTrash(target: string | string[]): void {
  const state = useStore.getState()
  const action = state.removeTrades(typeof target === 'string' ? [target] : target)
  if (!action) return
  const count = action.trades.length
  const single = count === 1 ? state.trades.find(trade => trade.id === action.trades[0]!.id) : undefined
  const label = single?.ref ?? `${count} 条记录`
  toast(`${label} 已移至回收站`, {
    tone: 'success',
    actionLabel: '撤销',
    onAction: () => {
      if (useStore.getState().undo(action.actionId)) toast(`已恢复 ${label}`, { tone: 'success' })
      else toast('记录已发生变化，请到回收站查看', { tone: 'warning' })
    },
  })
}
