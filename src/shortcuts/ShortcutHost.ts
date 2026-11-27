import { backtestProjectIdForPath } from '@/lib/backtestProjects'
import { useEffect } from 'react'
import { isStorageCutoverInteractionLocked } from '@/storage/cutover'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '@/store/useStore'
import { toast } from '@/lib/toast'
import { useShortcutStore } from '@/store/shortcutStore'
import {
  setShortcutHandlers,
  handleShortcutKeydown,
  isTradeLogEscapePage,
} from '@/shortcuts/engine'
import {
  getDetailNavigation,
} from '@/shortcuts/listNav'
import {
  boardPathFromListPath,
  isBoardPath,
  isDetailPath,
  listPathFromPathname,
} from '@/lib/routeContext'
import { tradeDetailPath, resolveTradeDetailReturn, findTradeByRouteParam } from '@/lib/tradeRoute'
import { routeWithSearch } from '@/lib/tradeView'
import {
  resolveShortcutWorkspaceHref,
  tradeWorkspaceCommandHref,
  resolveSidebarStrategyShortcutHref,
  SIDEBAR_STRATEGY_SHORTCUT_LIMIT,
} from '@/shortcuts/workspaceActions'
import { getActionMeta } from '@/shortcuts/actions'
import { requestLightboxClose, requestLightboxReset } from '@/lib/lightboxView'
import { createAndOpenQuickNote, resolveCreateRecordAction } from '@/lib/createRecordAction'
import { newTradeKindForPath } from '@/lib/tradeKind'
import { getJournalViewState } from '@/lib/journalQuickViews'
import { resolveSharedTradeWorkspaceSearch, isSharedTradeWorkspacePath } from '@/lib/tradeWorkspaceQuery'

export function useShortcutHost({
  onToggleCmdk,
}: {
  onToggleCmdk: () => void
}) {
  const navigate = useNavigate()
  const { pathname, search, state: locationState } = useLocation()
  const openComposer = useStore((s) => s.openComposer)
  const closeComposer = useStore((s) => s.closeComposer)
  const composerOpen = useStore((s) => s.composerOpen)
  const closeTradeRequest = useStore((s) => s.closeTradeRequest)
  const cancelTradeClose = useStore((s) => s.cancelTradeClose)
  const pendingTradeOpenRequest = useStore((s) => s.pendingTradeOpenRequest)
  const cancelTradeOpen = useStore((s) => s.cancelTradeOpen)

  const lightbox = useShortcutStore((s) => s.lightbox)
  const cmdkOpen = useShortcutStore((s) => s.cmdkOpen)
  const closeLightbox = useShortcutStore((s) => s.closeLightbox)
  const lightboxPrev = useShortcutStore((s) => s.lightboxPrev)
  const lightboxNext = useShortcutStore((s) => s.lightboxNext)
  const setCmdkOpen = useShortcutStore((s) => s.setCmdkOpen)

  useEffect(() => {
    const rememberedTradeSearch = useStore.getState().display.workspaceMemory?.trade?.search ?? ''
    const sharedTradeSearch = resolveSharedTradeWorkspaceSearch(
      pathname,
      search,
      rememberedTradeSearch,
    )
    const journalViewState = getJournalViewState(locationState) ?? getJournalViewState(locationState?.from)
    const tradeCommandHref = (target: 'active' | 'starred' | 'missed' | 'paper') =>
      tradeWorkspaceCommandHref(target, { pathname, search }, useStore.getState().display.workspaceMemory?.trade)
    const strategySlotHandlers = Object.fromEntries(
      Array.from({ length: SIDEBAR_STRATEGY_SHORTCUT_LIMIT }, (_, index) => [
        `nav.strategySlot${index + 1}`,
        () => {
          const state = useStore.getState()
          const href = resolveSidebarStrategyShortcutHref(
            index + 1,
            state.display.sidebarWorkspaceItems,
            state.strategies,
            state.display.workspaceMemory?.trade?.pathname ?? pathname,
            isSharedTradeWorkspacePath(pathname) ? search : rememberedTradeSearch,
          )
          if (href) navigate(href)
        },
      ]),
    )
    setShortcutHandlers({
      'global.commandPalette': onToggleCmdk,
      'global.commandPaletteMod': onToggleCmdk,
      'global.newTrade': () => {
        const trades = useStore.getState().trades
        const action = resolveCreateRecordAction(pathname, search, trades)
        openComposer(null, action.kind === 'note' || action.kind === 'case' ? newTradeKindForPath(pathname, search) : action.kind, backtestProjectIdForPath(pathname, trades))
      },
      'global.newCase': () => {
        openComposer(null, 'case')
      },
      'global.newQuickNote': () => createAndOpenQuickNote(navigate, pathname),
      'global.undo': () => {
        const s = useStore.getState()
        if (s.undoStack.length > 0 && s.undo()) toast('已撤销', { tone: 'success' })
      },
      'global.redo': () => {
        const s = useStore.getState()
        if (s.redoStack.length > 0 && s.redo()) toast('已重做', { tone: 'success' })
      },
      'global.closeOverlay': () => {
        if (lightbox) {
          if (!requestLightboxClose()) closeLightbox()
        }
        else if (cmdkOpen) setCmdkOpen(false)
        else if (composerOpen) closeComposer()
        else if (closeTradeRequest) cancelTradeClose()
        else if (pendingTradeOpenRequest) cancelTradeOpen()
        else if (isTradeLogEscapePage(pathname)) {
          const state = useStore.getState()
          navigate(resolveShortcutWorkspaceHref(
            'trade',
            state.display,
            state.strategies,
            null,
            { pathname, search },
          ))
        }
      },
      'global.toggleFullscreen': () => {
        const bridge = window.journalBridge
        if (bridge?.toggleFullscreen) {
          void bridge.toggleFullscreen()
          return
        }
        if (document.fullscreenElement) void document.exitFullscreen()
        else if (document.fullscreenEnabled) void document.documentElement.requestFullscreen()
      },

      'nav.quickNotes': () => navigate('/notes'),
      'nav.backtests': () => navigate('/backtests'),
      'nav.active': () => navigate(tradeCommandHref('active')),
      'nav.favorites': () => navigate(tradeCommandHref('starred')),
      'nav.missed': () => navigate(tradeCommandHref('missed')),
      'nav.sim': () => navigate(tradeCommandHref('paper')),
      'nav.list': () => {
        const state = useStore.getState()
        const listContext = useShortcutStore.getState().listContext
        navigate(resolveShortcutWorkspaceHref(
          'trade',
          state.display,
          state.strategies,
          listContext
            ? { pathname: listContext.listPath, search: listContext.listSearch }
            : null,
          { pathname, search },
        ))
      },
      'nav.reviewCases': () => {
        const state = useStore.getState()
        navigate(resolveShortcutWorkspaceHref('case', state.display, state.strategies))
      },
      'nav.weeklyReview': () => {
        navigate(`/weekly-review${sharedTradeSearch}`)
      },
      'nav.reviewSession': () => navigate('/review-session'),
      'nav.dashboard': () => {
        navigate(`/dashboard${sharedTradeSearch}`)
      },
      'nav.strategies': () => navigate('/settings/strategies'),
      ...strategySlotHandlers,

      'list.toggleFilters': () => {
        if (listPathFromPathname(pathname)) {
          window.dispatchEvent(new CustomEvent('atlas:toggle-trade-filters'))
        }
      },

      'trade.prev': () => {
        const trades = useStore.getState().trades
        const listContext = useShortcutStore.getState().listContext
        const param = pathname.replace(/^\/trade\//, '')
        const trade = findTradeByRouteParam(trades, param)
        const navigation = getDetailNavigation(trades, listContext, trade)
        const next = trades.find((t) => t.id === navigation?.prevId)
        if (next) navigate(tradeDetailPath(next), { state: locationState })
      },
      'trade.next': () => {
        const trades = useStore.getState().trades
        const listContext = useShortcutStore.getState().listContext
        const param = pathname.replace(/^\/trade\//, '')
        const trade = findTradeByRouteParam(trades, param)
        const navigation = getDetailNavigation(trades, listContext, trade)
        const next = trades.find((t) => t.id === navigation?.nextId)
        if (next) navigate(tradeDetailPath(next), { state: locationState })
      },
      'trade.backToList': () => {
        const trades = useStore.getState().trades
        const listContext = useShortcutStore.getState().listContext
        const param = pathname.replace(/^\/trade\//, '')
        const trade = findTradeByRouteParam(trades, param)
        const target = resolveTradeDetailReturn({
          from: (locationState as { from?: { pathname: string; search?: string } } | null)?.from,
          listPath: listContext?.listPath,
          listSearch: listContext?.listSearch,
          tradeKind: trade?.tradeKind,
        })
        if (isBoardPath(pathname) && listContext?.listPath) {
          navigate(routeWithSearch(boardPathFromListPath(listContext.listPath), listContext.listSearch), { state: journalViewState })
          return
        }
        navigate(target, { state: journalViewState })
      },

      'image.prev': lightboxPrev,
      'image.next': lightboxNext,
      'image.close': () => {
        if (!requestLightboxClose()) closeLightbox()
      },
      'image.reset': () => {
        requestLightboxReset()
      },
    })
  }, [
    pathname,
    search,
    locationState,
    lightbox,
    cmdkOpen,
    composerOpen,
    closeTradeRequest,
    pendingTradeOpenRequest,
    navigate,
    onToggleCmdk,
    openComposer,
    closeComposer,
    cancelTradeClose,
    cancelTradeOpen,
    closeLightbox,
    lightboxPrev,
    lightboxNext,
    setCmdkOpen,
  ])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isStorageCutoverInteractionLocked()) return
      handleShortcutKeydown(e, pathname)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pathname])
}

export function isShortcutContextDetail(pathname: string): boolean {
  return isDetailPath(pathname)
}

export function getActionLabel(actionId: string): string {
  return getActionMeta(actionId)?.label ?? actionId
}
