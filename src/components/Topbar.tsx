import { SlidersHorizontal, LayoutGrid, List } from 'lucide-react'
import './Topbar.css'

export function Topbar({
  title,
  view,
  onView,
}: {
  title: string
  view?: 'list' | 'board'
  onView?: (v: 'list' | 'board') => void
}) {
  return (
    <header className="topbar">
      <div className="tb-left">
        <span className="tb-title">{title}</span>
      </div>
      <div className="tb-right">
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
        <button className="tb-btn">
          <SlidersHorizontal size={14} />
          <span>显示</span>
        </button>
      </div>
    </header>
  )
}
