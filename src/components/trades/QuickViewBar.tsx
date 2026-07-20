import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BookmarkPlus, Check, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from '@/icons/appIcons'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  normalizeSavedViewPath,
  savedViewMatchesLocation,
  savedViewSearch,
  searchParamsToRecord,
  suggestSavedViewName,
  type SavedTradeView,
} from '@/lib/savedTradeViews'
import {
  getActiveWorkspaceView,
  getWorkspacePrimaryViews,
  isSavedViewInWorkspace,
  matchesWorkspaceView,
  searchForWorkspaceViewTarget,
  type WorkspaceKind,
  type WorkspaceViewTarget,
} from '@/lib/workspaceViews'
import { pathWithWorkbenchMode, workbenchModeFromPathname } from '@/lib/routeContext'
import { clampPopoverLeft } from '@/lib/popoverPosition'
import { toast } from '@/lib/toast'
import { useStore } from '@/store/useStore'
import { Tooltip } from '@/components/ui/Tooltip'
import './QuickViewBar.css'

type ViewGroup = {
  label: string
  items: WorkspaceViewTarget[]
}

const TRADE_MORE_GROUPS: ViewGroup[] = [
  {
    label: '时间',
    items: [
      { id: 'today', label: '今日', pathname: '/today-record' },
      { id: 'last-week', label: '上周', pathname: '/period/last-week' },
      { id: 'last-month', label: '上月', pathname: '/period/last-month' },
    ],
  },
  {
    label: '结果',
    items: [
      { id: 'win', label: '盈利', pathname: '/list', search: '?status=win' },
      { id: 'breakeven', label: '保本', pathname: '/list', search: '?status=breakeven' },
    ],
  },
  {
    label: '状态',
    items: [
      { id: 'active', label: '进行中', pathname: '/active' },
      { id: 'missed', label: '错过机会', pathname: '/missed' },
      { id: 'starred', label: '星标交易', pathname: '/favorites' },
    ],
  },
  {
    label: '交易时段',
    items: [
      { id: 'london', label: '伦敦盘', pathname: '/list', search: '?session=london' },
      { id: 'new-york', label: '纽约盘', pathname: '/list', search: '?session=new-york' },
      { id: 'asia', label: '亚盘', pathname: '/list', search: '?session=asia' },
      { id: 'outside', label: '盘外时段', pathname: '/list', search: '?session=outside' },
      { id: 'other', label: '其他时段', pathname: '/list', search: '?session=other' },
    ],
  },
]

const PAPER_MORE_GROUPS: ViewGroup[] = [
  {
    label: '时间',
    items: [
      { id: 'paper-week', label: '本周', pathname: '/sim', search: '?period=this-week' },
      { id: 'paper-month', label: '本月', pathname: '/sim', search: '?period=this-month' },
    ],
  },
  {
    label: '结果',
    items: [
      { id: 'paper-win', label: '盈利', pathname: '/sim', search: '?status=win' },
      { id: 'paper-breakeven', label: '保本', pathname: '/sim', search: '?status=breakeven' },
    ],
  },
  {
    label: '交易时段',
    items: [
      { id: 'paper-london', label: '伦敦盘', pathname: '/sim', search: '?session=london' },
      { id: 'paper-new-york', label: '纽约盘', pathname: '/sim', search: '?session=new-york' },
      { id: 'paper-asia', label: '亚盘', pathname: '/sim', search: '?session=asia' },
      { id: 'paper-outside', label: '盘外时段', pathname: '/sim', search: '?session=outside' },
      { id: 'paper-other', label: '其他时段', pathname: '/sim', search: '?session=other' },
    ],
  },
]

export function QuickViewBar({ kind }: { kind: WorkspaceKind }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const savedViews = useStore((state) => state.savedTradeViews)
  const strategies = useStore((state) => state.strategies)
  const saveTradeView = useStore((state) => state.saveTradeView)
  const renameTradeView = useStore((state) => state.renameTradeView)
  const removeTradeView = useStore((state) => state.removeTradeView)
  const togglePinTradeView = useStore((state) => state.togglePinTradeView)
  const [panel, setPanel] = useState<'more' | 'save' | null>(null)
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [popoverLeft, setPopoverLeft] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const overflowAnchorRef = useRef<HTMLDivElement>(null)
  const overflowButtonRef = useRef<HTMLButtonElement>(null)
  const primaryViews = getWorkspacePrimaryViews(kind)
  const moreGroups = kind === 'trade'
    ? TRADE_MORE_GROUPS
    : kind === 'paper'
      ? PAPER_MORE_GROUPS
      : []
  const workspaceLabel = kind === 'case'
    ? '案例视图'
    : kind === 'paper'
      ? '模拟视图'
      : '交易视图'
  const workspaceSavedViews = savedViews.filter((view) => isSavedViewInWorkspace(view, kind))
  const pinned = workspaceSavedViews.filter((view) => view.pinned).slice(0, 4)
  const activeSavedViewId = pinned.find((view) =>
    savedViewMatchesLocation(view, location.pathname, location.search),
  )?.id
  const activePrimaryViewId = activeSavedViewId
    ? undefined
    : getActiveWorkspaceView(kind, location.pathname, location.search)?.id
  const hasActiveQuickView = Boolean(activeSavedViewId || activePrimaryViewId)

  useEffect(() => {
    if (!panel) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setPanel(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPanel(null)
        requestAnimationFrame(() => overflowButtonRef.current?.focus())
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [panel])

  useLayoutEffect(() => {
    if (!panel || !overflowAnchorRef.current) return
    const updatePosition = () => {
      const rect = overflowAnchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(panel === 'more' ? 480 : 300, window.innerWidth - 16)
      const left = clampPopoverLeft(rect.left, width, window.innerWidth)
      setPopoverLeft(left - rect.left)
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [panel])

  const goTarget = (target: WorkspaceViewTarget) => {
    setPanel(null)
    const mode = workbenchModeFromPathname(location.pathname)
    navigate({
      pathname: pathWithWorkbenchMode(target.pathname, mode),
      search: searchForWorkspaceViewTarget(location.search, target),
    })
  }

  const goSavedView = (view: SavedTradeView) => {
    setPanel(null)
    const mode = workbenchModeFromPathname(location.pathname)
    navigate({
      pathname: pathWithWorkbenchMode(normalizeSavedViewPath(view.pathname), mode),
      search: savedViewSearch(view),
    })
  }

  const openSave = () => {
    const strategyId = searchParams.get('strategyId')
    const strategyName = strategies.find((strategy) => strategy.id === strategyId)?.name
    setName(suggestSavedViewName(location.pathname, searchParams, strategyName))
    setPanel('save')
  }

  const createSavedView = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const now = new Date().toISOString()
    const view: SavedTradeView = {
      id: crypto.randomUUID(),
      name: trimmed,
      pathname: normalizeSavedViewPath(location.pathname),
      search: searchParamsToRecord(searchParams),
      pinned: pinned.length < 4,
      order: savedViews.length,
      createdAt: now,
      updatedAt: now,
    }
    saveTradeView(view)
    setPanel(null)
    toast(view.pinned ? '视图已固定到顶部' : '视图已保存')
  }

  const commitRename = (id: string) => {
    renameTradeView(id, editingName)
    setEditingId(null)
  }

  const deleteSavedView = (view: SavedTradeView) => {
    removeTradeView(view.id)
    toast(`已删除视图「${view.name}」`, {
      label: '撤销',
      onClick: () => {
        useStore.getState().saveTradeView(view)
        toast('视图已恢复')
      },
    })
  }

  return (
    <div className="quick-view-bar" ref={rootRef} aria-label={workspaceLabel}>
      <div
        className="quick-view-primary"
        role="tablist"
        aria-label={workspaceLabel}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
          const currentIndex = Math.max(0, tabs.indexOf(document.activeElement as HTMLButtonElement))
          const nextIndex = event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : event.key === 'ArrowLeft'
                ? (currentIndex - 1 + tabs.length) % tabs.length
                : (currentIndex + 1) % tabs.length
          const nextTab = tabs[nextIndex]
          if (!nextTab) return
          event.preventDefault()
          nextTab.focus()
          nextTab.click()
        }}
      >
        {primaryViews.map((item, index) => {
          const active = activePrimaryViewId === item.id
          return (
            <button
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active || (!hasActiveQuickView && index === 0) ? 0 : -1}
              className={'quick-view-chip quick-view-builtin' + (active ? ' is-active' : '')}
              key={item.id}
              onClick={() => goTarget(item)}
            >
              {item.label}
            </button>
          )
        })}
        {pinned.map((view) => (
          <Tooltip content={view.name} label={view.name} asChild key={view.id}>
            <button
              type="button"
              role="tab"
              aria-selected={activeSavedViewId === view.id}
              tabIndex={activeSavedViewId === view.id ? 0 : -1}
              className={'quick-view-chip quick-view-saved' + (activeSavedViewId === view.id ? ' is-active' : '')}
              onClick={() => goSavedView(view)}
            >
              <span className="quick-view-saved-label">{view.name}</span>
            </button>
          </Tooltip>
        ))}
      </div>

      <div className="quick-view-overflow-anchor" ref={overflowAnchorRef}>
        <Tooltip content="视图选项" label="视图选项">
          <button
            ref={overflowButtonRef}
            type="button"
            className={'quick-view-overflow' + (panel ? ' is-active' : '')}
            onClick={() => setPanel((value) => (value === 'more' ? null : 'more'))}
            aria-label="视图选项"
            aria-expanded={panel === 'more'}
          >
            <MoreHorizontal size={15} />
          </button>
        </Tooltip>

        {panel === 'more' && (
          <div
            className="quick-view-popover quick-view-menu"
            role="dialog"
            aria-label="视图选项"
            style={{ left: popoverLeft }}
          >
            <button type="button" className="quick-view-save-entry" onClick={openSave}>
              <BookmarkPlus size={14} />
              <span>保存当前视图</span>
            </button>
            {moreGroups.length > 0 && (
              <div className="quick-view-groups">
                {moreGroups.map((group) => (
                  <section className="quick-view-group" key={group.label}>
                    <h3>{group.label}</h3>
                    {group.items.map((item) => (
                      <button type="button" key={item.id} onClick={() => goTarget(item)}>
                        <span>{item.label}</span>
                        {matchesWorkspaceView(item, location.pathname, location.search) && <Check size={13} />}
                      </button>
                    ))}
                  </section>
                ))}
              </div>
            )}
            {workspaceSavedViews.length > 0 && (
              <section className="quick-view-manage">
                <h3>已保存视图</h3>
                {workspaceSavedViews.map((view) => (
                  <div className="quick-view-manage-row" key={view.id}>
                    {editingId === view.id ? (
                      <input
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitRename(view.id)
                          if (event.key === 'Escape') setEditingId(null)
                        }}
                        onBlur={() => commitRename(view.id)}
                        autoFocus
                        maxLength={24}
                        aria-label="视图名称"
                      />
                    ) : (
                      <button type="button" className="quick-view-manage-name" onClick={() => goSavedView(view)}>
                        <span>{view.name}</span>
                        {savedViewMatchesLocation(view, location.pathname, location.search) && <Check size={13} />}
                      </button>
                    )}
                    <Tooltip content="重命名" label={`重命名 ${view.name}`}>
                      <button
                        type="button"
                        className="quick-view-icon"
                        onClick={() => {
                          setEditingId(view.id)
                          setEditingName(view.name)
                        }}
                        aria-label={`重命名 ${view.name}`}
                      >
                        <Pencil size={12} />
                      </button>
                    </Tooltip>
                    <Tooltip content={view.pinned ? '取消固定' : '固定到顶部'} label={view.pinned ? `取消固定 ${view.name}` : `固定 ${view.name}`}>
                      <button
                        type="button"
                        className="quick-view-icon"
                        onClick={() => {
                          if (!view.pinned && pinned.length >= 4) {
                            toast('每个模块最多固定 4 个视图')
                            return
                          }
                          togglePinTradeView(view.id)
                        }}
                        aria-label={view.pinned ? `取消固定 ${view.name}` : `固定 ${view.name}`}
                      >
                        {view.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                      </button>
                    </Tooltip>
                    <Tooltip content="删除" label={`删除 ${view.name}`}>
                      <button type="button" className="quick-view-icon is-danger" onClick={() => deleteSavedView(view)} aria-label={`删除 ${view.name}`}>
                        <Trash2 size={12} />
                      </button>
                    </Tooltip>
                  </div>
                ))}
              </section>
            )}
          </div>
        )}

        {panel === 'save' && (
          <form
            className="quick-view-popover quick-view-save"
            style={{ left: popoverLeft }}
            onSubmit={(event) => {
              event.preventDefault()
              createSavedView()
            }}
          >
            <label htmlFor="saved-view-name">保存当前视图</label>
            <input id="saved-view-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={24} autoFocus />
            <div className="quick-view-save-actions">
              <span>{pinned.length < 4 ? '保存后固定到顶部' : '保存到视图选项'}</span>
              <button type="submit" disabled={!name.trim()}>保存</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
