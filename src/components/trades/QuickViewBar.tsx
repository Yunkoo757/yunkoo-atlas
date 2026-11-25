import { useExitClone } from '@/components/ui/useExitClone'
import { isComposingKey } from '@/lib/keyboardComposition'
import { ICON_SM } from '@/icons/iconSize'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BookmarkPlus, Check, Pencil, Trash2 } from '@/icons/appIcons'
import { DisclosureIcon, PinActionIcon } from '@/icons/StateIcons'
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
  MAX_PINNED_WORKSPACE_VIEWS,
  matchesWorkspaceView,
  searchForWorkspaceViewTarget,
  type WorkspaceKind,
  type WorkspaceViewTarget,
} from '@/lib/workspaceViews'
import { pathWithWorkbenchMode, workbenchModeFromPathname } from '@/lib/routeContext'
import { clampPopoverLeft } from '@/lib/popoverPosition'
import { toast } from '@/lib/toast'
import { useStore } from '@/store/useStore'
import { OverflowTooltip, Tooltip } from '@/components/ui/Tooltip'
import { journalBuiltinTarget, getMoreViewGroups, resolveJournalView } from '@/lib/journalQuickViews'
import './QuickViewBar.css'

export function QuickViewBar({ kind, journal = false }: { kind: WorkspaceKind; journal?: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const savedViews = useStore((state) => state.savedTradeViews)
  const strategies = useStore((state) => state.strategies)
  const sidebarWorkspaceItems = useStore((state) => state.display.sidebarWorkspaceItems)
  const saveTradeView = useStore((state) => state.saveTradeView)
  const renameTradeView = useStore((state) => state.renameTradeView)
  const removeTradeView = useStore((state) => state.removeTradeView)
  const togglePinTradeView = useStore((state) => state.togglePinTradeView)
  const [panel, setPanel] = useState<'more' | 'save' | null>(null)
  const menuExit = useExitClone<HTMLDivElement>(panel === 'more')
  const formExit = useExitClone<HTMLFormElement>(panel === 'save')
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [popoverLeft, setPopoverLeft] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const overflowAnchorRef = useRef<HTMLDivElement>(null)
  const overflowButtonRef = useRef<HTMLButtonElement>(null)
  const renameButtonRef = useRef<HTMLButtonElement | null>(null)
  const cancelRenameRef = useRef(false)
  const primaryViews = getWorkspacePrimaryViews(kind, sidebarWorkspaceItems).filter((view) => (
    view.id !== 'historical-cases' && view.id !== 'historical-trades'
  ))
  const moreGroups = getMoreViewGroups(kind, sidebarWorkspaceItems)
  const workspaceLabel = kind === 'case'
    ? '案例视图'
    : kind === 'historical-case'
      ? '历史案例视图'
      : kind === 'historical-trade'
        ? '历史实盘视图'
        : kind === 'paper'
          ? '模拟视图'
          : '交易视图'
  const workspaceSavedViews = savedViews.filter((view) => isSavedViewInWorkspace(view, kind))
  const pinned = workspaceSavedViews.filter((view) => view.pinned).slice(0, MAX_PINNED_WORKSPACE_VIEWS)
  const namedViews = journal || kind === 'case'
  const namedView = namedViews
    ? resolveJournalView(kind, location.pathname, location.search, sidebarWorkspaceItems, savedViews, location.state)
    : undefined
  const activeSaved = namedViews ? namedView?.saved : pinned.find((view) =>
    savedViewMatchesLocation(view, location.pathname, location.search),
  )
  const activeView = namedViews ? namedView : getActiveWorkspaceView(kind, location.pathname, location.search, sidebarWorkspaceItems)
  const builtinTabs = namedViews && !activeSaved && activeView && !primaryViews.some((view) => view.id === activeView.id)
    ? [...primaryViews, activeView]
    : primaryViews
  const savedTabs = namedViews && activeSaved && !pinned.includes(activeSaved) ? [...pinned, activeSaved] : pinned
  const tabItems = [
    ...builtinTabs.map((item) => ({
      key: `builtin-${item.id}`, label: item.label, saved: false,
      active: !activeSaved && activeView?.id === item.id, select: () => goTarget(item),
    })),
    ...savedTabs.map((view) => ({
      key: `saved-${view.id}`, label: view.name, saved: true,
      active: activeSaved?.id === view.id, select: () => goSavedView(view),
    })),
  ]
  const selectedIndex = tabItems.findIndex((item) => item.active)
  const priorityIndex = Math.max(0, selectedIndex)
  const sizesRef = useRef<HTMLDivElement>(null)
  const [visibleLimit, setVisibleLimit] = useState(Infinity)
  const tabSignature = JSON.stringify(tabItems.map(({ key, label, active }) => [key, label, active]))
  useLayoutEffect(() => {
    const root = rootRef.current
    const sizes = sizesRef.current
    const more = overflowButtonRef.current
    if (!root || !sizes || !more) return
    const chips = Array.from(sizes.querySelectorAll<HTMLElement>('[data-tab-size]'))
    const moreLabel = sizes.querySelector<HTMLElement>('.quick-view-more-label')!
    const measure = () => {
      const widths = chips.map((chip) => chip.getBoundingClientRect().width)
      const room = root.getBoundingClientRect().width - parseFloat(getComputedStyle(root).columnGap)
      const gap = parseFloat(getComputedStyle(sizes).columnGap)
      const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * gap
      if (total + more.offsetHeight <= room) {
        setVisibleLimit(widths.length)
        return
      }
      // 先为当前项预留空间，余下位置按原顺序展示完整标签。
      const available = room - moreLabel.getBoundingClientRect().width
      let used = widths[priorityIndex] ?? 0
      let limit = 0
      for (; limit < widths.length; limit += 1) {
        if (limit === priorityIndex) continue
        used += gap + widths[limit]
        if (used > available) break
      }
      setVisibleLimit(limit)
    }
    measure()
    const observer = new ResizeObserver(measure)
    for (const element of [root, moreLabel, ...chips]) observer.observe(element)
    return () => observer.disconnect()
  }, [priorityIndex, tabSignature])
  const isOverflowed = (index: number) => index >= visibleLimit && index !== priorityIndex
  const hiddenBuiltinTabs = builtinTabs.filter((_, index) => isOverflowed(index))
  const showMoreLabel = tabItems.some((_, index) => isOverflowed(index))
  const menuGroups = hiddenBuiltinTabs.length
    ? [{ label: '快捷视图', items: hiddenBuiltinTabs }, ...moreGroups]
    : moreGroups
  const moreName = '更多视图'

  useEffect(() => {
    if (!panel) return
    const focusFrame = requestAnimationFrame(() => {
      if (panel === 'more') {
        rootRef.current?.querySelector<HTMLButtonElement>('.quick-view-menu button')?.focus({ preventScroll: true })
      }
    })
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setPanel(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !isComposingKey(event)) {
        event.preventDefault()
        event.stopPropagation()
        setPanel(null)
        requestAnimationFrame(() => overflowButtonRef.current?.focus())
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(focusFrame)
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
    const observer = new ResizeObserver(updatePosition)
    const strip = rootRef.current?.querySelector('.quick-view-primary')
    if (strip) observer.observe(strip)
    window.addEventListener('resize', updatePosition)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updatePosition)
    }
  }, [panel])

  const closeViewMenu = () => {
    setPanel(null)
    if (panel === 'more') {
      requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true }))
    }
  }

  const goTarget = (target: WorkspaceViewTarget) => {
    closeViewMenu()
    const mode = workbenchModeFromPathname(location.pathname)
    const destination = journal ? journalBuiltinTarget(target) : target
    navigate({
      pathname: pathWithWorkbenchMode(destination.pathname, mode),
      search: searchForWorkspaceViewTarget(location.search, destination),
    }, namedViews ? { state: { journalView: { type: 'builtin', id: target.id } } } : undefined)
  }

  const goSavedView = (view: SavedTradeView) => {
    closeViewMenu()
    const mode = workbenchModeFromPathname(location.pathname)
    const path = normalizeSavedViewPath(view.pathname)
    const params = new URLSearchParams(savedViewSearch(view))
    const paperAlias = journal && path === '/sim'
    if (paperAlias) params.set('kind', 'paper')
    navigate({
      pathname: pathWithWorkbenchMode(paperAlias ? '/list' : path, mode),
      search: params.toString(),
    }, namedViews ? { state: { journalView: { type: 'saved', id: view.id } } } : undefined)
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
      pinned: pinned.length < MAX_PINNED_WORKSPACE_VIEWS,
      order: savedViews.length,
      createdAt: now,
      updatedAt: now,
    }
    const pinnedAtTop = saveTradeView(view)
    if (namedViews) {
      navigate({ pathname: location.pathname, search: location.search }, {
        replace: true, state: { journalView: { type: 'saved', id: view.id } },
      })
    }
    setPanel(null)
    requestAnimationFrame(() => overflowButtonRef.current?.focus())
    toast(pinnedAtTop ? '视图已固定到顶部' : `视图已保存，可在「${moreName}」中打开`)
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
        const state = useStore.getState()
        if (state.savedTradeViews.some(item => item.id === view.id)) return
        state.saveTradeView(view)
        toast('视图已恢复')
      },
    })
  }

  const saveEntry = (
    <button type="button" className="quick-view-save-entry" onClick={openSave}>
      <BookmarkPlus size={ICON_SM} />
      <span>保存当前视图</span>
    </button>
  )

  return (
    <div className="quick-view-bar" ref={rootRef} aria-label={workspaceLabel}>
      <div
        className="quick-view-primary"
        role="tablist"
        aria-label={workspaceLabel}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          const currentIndex = Number((event.target as HTMLElement).closest('[data-tab-index]')?.getAttribute('data-tab-index') ?? 0)
          const nextIndex = event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabItems.length - 1
              : event.key === 'ArrowLeft'
                ? (currentIndex - 1 + tabItems.length) % tabItems.length
                : (currentIndex + 1) % tabItems.length
          const next = tabItems[nextIndex]
          if (!next) return
          event.preventDefault()
          const tabList = event.currentTarget
          tabList.querySelector<HTMLButtonElement>(`[data-tab-index="${nextIndex}"]`)?.focus({ preventScroll: true })
          next.select()
          requestAnimationFrame(() => tabList.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus({ preventScroll: true }))
        }}
      >
        {tabItems.map((item, index) => {
          if (isOverflowed(index)) return null
          const active = item.active
          return (
            <button
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active || (selectedIndex < 0 && index === 0) ? 0 : -1}
              data-tab-index={index}
              className={'quick-view-chip ' + (item.saved ? 'quick-view-saved' : 'quick-view-builtin') + (active ? ' is-active' : '')}
              key={item.key}
              onClick={item.select}
            >
              {item.saved ? (
                <OverflowTooltip text={item.label}>
                  <span className="quick-view-saved-label">{item.label}</span>
                </OverflowTooltip>
              ) : <span className="quick-view-saved-label">{item.label}</span>}
            </button>
          )
        })}
      </div>
      <div ref={sizesRef} className="quick-view-sizes" aria-hidden="true">
        {tabItems.map((item) => (
          <span key={item.key} data-tab-size className={'quick-view-chip' + (item.active ? ' is-active' : '')}>{item.label}</span>
        ))}
        <span className="quick-view-more-label">{moreName}</span>
      </div>

      <div className="quick-view-overflow-anchor" ref={overflowAnchorRef}>
        <Tooltip content={moreName} label={moreName} disabled={showMoreLabel}>
          <button
            ref={overflowButtonRef}
            type="button"
            className={'quick-view-overflow' + (panel ? ' is-active' : '') + (showMoreLabel ? ' has-label' : '')}
            onClick={() => setPanel((value) => (value === 'more' ? null : 'more'))}
            aria-label={moreName}
            aria-haspopup="dialog"
            aria-expanded={panel !== null}
          >
            {showMoreLabel ? <span className="quick-view-more-label">{moreName}</span> : <DisclosureIcon kind="menu" expanded={panel !== null} size={ICON_SM} />}
          </button>
        </Tooltip>

        {panel === 'more' && (
          <div
            ref={menuExit}
            className="quick-view-popover quick-view-menu"
            role="dialog"
            aria-label={moreName}
            style={{ left: popoverLeft }}
          >
            {menuGroups.length > 0 && (
              <div className="quick-view-groups">
                {menuGroups.map((group) => (
                  <section className="quick-view-group" key={group.label}>
                    <h3>{group.label}</h3>
                    {group.items.map((item) => (
                      <button type="button" key={item.id} onClick={() => goTarget(item)}>
                        <span>{item.label}</span>
                        {(namedViews ? !activeSaved && activeView?.id === item.id : matchesWorkspaceView(item, location.pathname, location.search)) && <Check size={ICON_SM} />}
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
                          if (isComposingKey(event.nativeEvent) || (event.key !== 'Enter' && event.key !== 'Escape')) return
                          event.preventDefault()
                          event.stopPropagation()
                          cancelRenameRef.current = event.key === 'Escape'
                          event.currentTarget.blur()
                          renameButtonRef.current?.focus()
                        }}
                        onBlur={() => {
                          if (cancelRenameRef.current) setEditingId(null)
                          else commitRename(view.id)
                        }}
                        autoFocus
                        maxLength={24}
                        aria-label="视图名称"
                      />
                    ) : (
                      <button type="button" className="quick-view-manage-name" onClick={() => goSavedView(view)}>
                        <span>{view.name}</span>
                        {(namedViews ? activeSaved?.id === view.id : savedViewMatchesLocation(view, location.pathname, location.search)) && <Check size={ICON_SM} />}
                      </button>
                    )}
                    <Tooltip content="重命名" label={`重命名 ${view.name}`}>
                      <button
                        type="button"
                        className="quick-view-icon"
                        onClick={(event) => {
                          cancelRenameRef.current = false
                          renameButtonRef.current = event.currentTarget
                          setEditingId(view.id)
                          setEditingName(view.name)
                        }}
                        aria-label={`重命名 ${view.name}`}
                      >
                        <Pencil size={ICON_SM} />
                      </button>
                    </Tooltip>
                    <Tooltip content={view.pinned ? '取消固定' : '固定到顶部'} label={view.pinned ? `取消固定 ${view.name}` : `固定 ${view.name}`}>
                      <button
                        type="button"
                        className="quick-view-icon"
                        onClick={() => {
                          if (togglePinTradeView(view.id) === 'full') {
                            toast(`${workspaceLabel}最多固定 ${MAX_PINNED_WORKSPACE_VIEWS} 个，可先取消固定一个`)
                          }
                        }}
                        aria-label={view.pinned ? `取消固定 ${view.name}` : `固定 ${view.name}`}
                        aria-pressed={view.pinned}
                      >
                        <PinActionIcon pinned={view.pinned} size={ICON_SM} />
                      </button>
                    </Tooltip>
                    <Tooltip content="删除" label={`删除 ${view.name}`}>
                      <button type="button" className="quick-view-icon is-danger" onClick={() => deleteSavedView(view)} aria-label={`删除 ${view.name}`}>
                        <Trash2 size={ICON_SM} />
                      </button>
                    </Tooltip>
                  </div>
                ))}
              </section>
            )}
            {saveEntry}
          </div>
        )}

        {panel === 'save' && (
          <form
            ref={formExit}
            className="quick-view-popover quick-view-save"
            role="dialog"
            aria-labelledby="saved-view-name-label"
            style={{ left: popoverLeft }}
            onSubmit={(event) => {
              event.preventDefault()
              createSavedView()
            }}
          >
            <label id="saved-view-name-label" htmlFor="saved-view-name">保存当前视图</label>
            <input id="saved-view-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={24} autoFocus />
            <div className="quick-view-save-actions">
              <span>{pinned.length < MAX_PINNED_WORKSPACE_VIEWS ? '保存后固定到顶部' : `保存到「${moreName}」`}</span>
              <button type="submit" disabled={!name.trim()}>保存</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
