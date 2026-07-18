import { Eye, EyeOff, LayoutGrid, List } from '@/icons/appIcons'
import { DisplayMenu } from '@/components/DisplayMenu'
import { SaveStatusIndicator } from '@/components/SaveStatusIndicator'
import { Toolbar } from '@/components/ui/Toolbar'
import { ShortcutTooltip } from '@/components/ShortcutTooltip'
import { useStore } from '@/store/useStore'
import { toast } from '@/lib/toast'
import './Topbar.css'

export type WorkbenchView = 'list' | 'board'

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
  const privacyMode = useStore((state) => state.display.privacyMode)
  const setDisplay = useStore((state) => state.setDisplay)

  const togglePrivacyMode = () => {
    const next = !privacyMode
    setDisplay({ privacyMode: next })
    toast(next ? '直播模式已开启，所有盈亏金额已隐藏' : '直播模式已关闭')
  }

  return (
    <Toolbar
      title={title}
      titleAsHeading={titleAsHeading}
      context={subtitle}
      actions={(
        <div className="tb-right">
        {showSaveStatus && <SaveStatusIndicator />}
        <button
          type="button"
          className={'tb-btn tb-privacy' + (privacyMode ? ' is-on' : '')}
          aria-pressed={privacyMode}
          aria-label={privacyMode ? '关闭直播模式' : '开启直播模式'}
          onClick={togglePrivacyMode}
        >
          {privacyMode ? <EyeOff size={14} /> : <Eye size={14} />}
          <span>{privacyMode ? '直播中' : '直播模式'}</span>
        </button>
        {onView && (
          <div className="tb-segmented" role="group" aria-label="视图切换">
            <ShortcutTooltip actionId="view.list" label="列表视图">
              <button
                type="button"
                className={'tb-seg' + (view === 'list' ? ' is-on' : '')}
                aria-pressed={view === 'list'}
                onClick={() => onView('list')}
              >
                <List size={15} />
              </button>
            </ShortcutTooltip>
            <ShortcutTooltip actionId="view.board" label="看板视图">
              <button
                type="button"
                className={'tb-seg' + (view === 'board' ? ' is-on' : '')}
                aria-pressed={view === 'board'}
                onClick={() => onView('board')}
              >
                <LayoutGrid size={15} />
              </button>
            </ShortcutTooltip>
          </div>
        )}
        {showDisplay && <DisplayMenu view={view ?? 'list'} />}
        </div>
      )}
    />
  )
}
