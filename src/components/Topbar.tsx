import { ICON_MD } from '@/icons/iconSize'
import { LayoutGrid, List } from '@/icons/appIcons'
import { DisplayMenu } from '@/components/DisplayMenu'
import { SaveStatusIndicator } from '@/components/SaveStatusIndicator'
import { Toolbar } from '@/components/ui/Toolbar'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { ShortcutTooltip } from '@/components/ShortcutTooltip'
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
  return (
    <Toolbar
      title={title}
      titleAsHeading={titleAsHeading}
      context={subtitle}
      actions={(
        <div className="tb-right">
          {showSaveStatus && <SaveStatusIndicator />}
          {onView && view && (
            <SegmentedControl
              label="视图切换"
              value={view}
              onChange={onView}
              options={[
                {
                  value: 'list',
                  label: '列表视图',
                  content: <List size={ICON_MD} />,
                  wrap: (button) => (
                    <ShortcutTooltip key="list" actionId="view.list" label="列表视图">
                      {button}
                    </ShortcutTooltip>
                  ),
                },
                {
                  value: 'board',
                  label: '看板视图',
                  content: <LayoutGrid size={ICON_MD} />,
                  wrap: (button) => (
                    <ShortcutTooltip key="board" actionId="view.board" label="看板视图">
                      {button}
                    </ShortcutTooltip>
                  ),
                },
              ]}
            />
          )}
          {showDisplay && <DisplayMenu view={view ?? 'list'} />}
        </div>
      )}
    />
  )
}
