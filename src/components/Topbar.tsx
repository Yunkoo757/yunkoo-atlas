import { LayoutGrid, List, Table2 } from '@/icons/appIcons'
import { DisplayMenu } from '@/components/DisplayMenu'
import { SaveStatusIndicator } from '@/components/SaveStatusIndicator'
import { Toolbar } from '@/components/ui/Toolbar'
import './Topbar.css'

export type WorkbenchView = 'list' | 'board' | 'table'

export function Topbar({
  title,
  subtitle,
  view,
  onView,
  showDisplay = true,
  showSaveStatus = true,
  titleAsHeading = true,
}: {
  title: string
  subtitle?: string
  view?: WorkbenchView
  onView?: (v: WorkbenchView) => void
  showDisplay?: boolean
  showSaveStatus?: boolean
  titleAsHeading?: boolean
}) {
  return (
    <Toolbar
      title={title}
      titleAsHeading={titleAsHeading}
      context={subtitle}
      actions={(
        <div className="tb-right">
        {showSaveStatus && <SaveStatusIndicator />}
        {onView && (
          <div className="tb-segmented" role="group" aria-label="视图切换">
            <button
              type="button"
              className={'tb-seg' + (view === 'list' ? ' is-on' : '')}
              aria-label="列表视图"
              aria-pressed={view === 'list'}
              onClick={() => onView('list')}
            >
              <List size={15} />
            </button>
            <button
              type="button"
              className={'tb-seg' + (view === 'board' ? ' is-on' : '')}
              aria-label="看板视图"
              aria-pressed={view === 'board'}
              onClick={() => onView('board')}
            >
              <LayoutGrid size={15} />
            </button>
            <button
              type="button"
              className={'tb-seg' + (view === 'table' ? ' is-on' : '')}
              aria-label="表格视图"
              aria-pressed={view === 'table'}
              onClick={() => onView('table')}
            >
              <Table2 size={15} />
            </button>
          </div>
        )}
        {showDisplay && <DisplayMenu view={view ?? 'list'} />}
        </div>
      )}
    />
  )
}
