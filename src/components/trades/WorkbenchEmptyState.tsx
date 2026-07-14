import { Plus, RotateCcw } from '@/icons/appIcons'
import { EmptyState } from '@/components/EmptyState'
import type { WorkbenchEmptyState as WorkbenchEmptyStateModel } from '@/lib/workbenchEmptyState'

export function WorkbenchEmptyState({
  state,
  onCreate,
  onReset,
}: {
  state: WorkbenchEmptyStateModel
  onCreate: () => void
  onReset: () => void
}) {
  const create = state.action === 'create'
  return (
    <EmptyState
      title={state.title}
      hint={state.hint}
      action={(
        <button className="empty-btn" onClick={create ? onCreate : onReset}>
          {create ? <Plus size={15} /> : <RotateCcw size={15} />}
          <span>{state.actionLabel}</span>
        </button>
      )}
    />
  )
}
