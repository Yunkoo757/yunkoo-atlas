import { Link } from 'react-router-dom'
import { Plus, RotateCcw } from '@/icons/appIcons'
import { EmptyState } from '@/components/EmptyState'
import type { WorkbenchEmptyState as WorkbenchEmptyStateModel } from '@/lib/workbenchEmptyState'
import './WorkbenchEmptyState.css'

export function WorkbenchEmptyState({
  state,
  onCreate,
  onReset,
}: {
  state: WorkbenchEmptyStateModel
  onCreate: () => void
  onReset: () => void
}) {
  const primary = state.primaryAction
  const create = primary.intent === 'create'
  return (
    <EmptyState
      variant={state.kind === 'library' ? 'first-use' : state.kind === 'filtered' ? 'filtered' : 'missing'}
      title={state.title}
      hint={state.hint}
      action={(
        <div className="workbench-empty-actions">
          <button
            type="button"
            className="empty-btn workbench-empty-primary"
            onClick={create ? onCreate : onReset}
          >
            {create ? <Plus size={15} /> : <RotateCcw size={15} />}
            <span>{primary.label}</span>
          </button>
          {state.secondaryActions.map((action) => (
            <Link
              key={action.id}
              className="workbench-empty-secondary"
              to={action.href ?? '/'}
            >
              {action.label}
            </Link>
          ))}
        </div>
      )}
    />
  )
}
