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
  const create = state.action === 'create'
  return (
    <EmptyState
      title={state.title}
      hint={state.hint}
      action={(
        state.kind === 'library' ? (
          <div className="workbench-empty-actions">
            <button type="button" className="empty-btn" onClick={onCreate}>
              <Plus size={15} />
              <span>{state.actionLabel}</span>
            </button>
            <Link className="ui-btn ui-btn-bordered" to="/settings/data">导入备份</Link>
            <Link className="ui-btn ui-btn-bordered" to="/settings/strategies">配置策略</Link>
          </div>
        ) : (
          <button type="button" className="empty-btn" onClick={create ? onCreate : onReset}>
            {create ? <Plus size={15} /> : <RotateCcw size={15} />}
            <span>{state.actionLabel}</span>
          </button>
        )
      )}
    />
  )
}
