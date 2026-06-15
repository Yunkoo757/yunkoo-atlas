import { LayoutGrid, List } from 'lucide-react'
import { DisplayMenu } from '@/components/DisplayMenu'
import { SaveStatusIndicator } from '@/components/SaveStatusIndicator'
import './Topbar.css'

export function Topbar({
  title,
  subtitle,
  view,
  onView,
  showDisplay = true,
  showSaveStatus = true,
}: {
  title: string
  subtitle?: string
  view?: 'list' | 'board'
  onView?: (v: 'list' | 'board') => void
  showDisplay?: boolean
  showSaveStatus?: boolean
}) {
  return (
    <header className="topbar">
      <div className="tb-left">
        <span className="tb-title">{title}</span>
        {subtitle && <span className="tb-subtitle">{subtitle}</span>}
      </div>
      <div className="tb-right">
        {showSaveStatus && <SaveStatusIndicator />}
        {onView && (
          <div className="tb-segmented">
            <button
              className={'tb-seg' + (view === 'list' ? ' is-on' : '')}
              onClick={() => onView('list')}
            >
              <List size={15} />
            </button>
            <button
              className={'tb-seg' + (view === 'board' ? ' is-on' : '')}
              onClick={() => onView('board')}
            >
              <LayoutGrid size={15} />
            </button>
          </div>
        )}
        {showDisplay && <DisplayMenu />}
      </div>
    </header>
  )
}
