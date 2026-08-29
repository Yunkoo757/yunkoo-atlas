import { useEffect } from 'react'
import { isStorageCutoverInteractionLocked } from '@/storage/cutover'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '@/store/useStore'
import { toast } from '@/lib/toast'
import {
  useShortcutStore,
  resolveBinding,
} from '@/store/shortcutStore'
import { setShortcutHandlers, handleShortcutKeydown } from '@/shortcuts/engine'
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
import { resolveShortcutWorkspaceHref } from '@/shortcuts/workspaceActions'
import { getActionMeta } from '@/shortcuts/actions'
import { requestLightboxClose, requestLightboxReset } from '@/lib/lightboxView'
import { createQuickNote } from '@/data/quickNotes'
import { newTradeKindForPath } from '@/lib/tradeKind'
import { resolveSharedTradeWorkspaceSearch, tradeHomeHref } from '@/lib/tradeWorkspaceQuery'

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
    const sharedTradeParams = () => new URLSearchParams(sharedTradeSearch)
    const sharedTradeViewHref = (view: 'active' | 'starred' | 'missed') => {
      const params = sharedTradeParams()
      params.set('view', view)
      return `/list?${params.toString()}`
    }
    setShortcutHandlers({
      'global.commandPalette': onToggleCmdk,
      'global.commandPaletteMod': onToggleCmdk,
      'global.newTrade': () => {
        openComposer(null, newTradeKindForPath(pathname, search))
      },
      'global.newCase': () => {
        openComposer(null, 'case')
      },
      'global.newQuickNote': () => {
        const note = createQuickNote()
        useStore.getState().upsertQuickNote(note)
        navigate(`/notes/${encodeURIComponent(note.id)}`)
      },
      'global.undo': () => {
        const s = useStore.getState()
        if (s.undoStack.length > 0 && s.undo()) toast('已撤销')
      },
      'global.redo': () => {
        const s = useStore.getState()
        if (s.redoStack.length > 0 && s.redo()) toast('已重做')
      },
      'global.closeOverlay': () => {
        if (lightbox) {
          if (!requestLightboxClose()) closeLightbox()
        }
        else if (cmdkOpen) setCmdkOpen(false)
        else if (composerOpen) closeComposer()
        else if (closeTradeRequest) cancelTradeClose()
        else if (pendingTradeOpenRequest) cancelTradeOpen()
        else if (
          pathname === '/dashboard' ||
          pathname === '/weekly-review' ||
          pathname === '/review-session' ||
          pathname === '/notes' ||
          pathname.startsWith('/notes/')
        ) {
          navigate(tradeHomeHref(rememberedTradeSearch))
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
      'nav.active': () => navigate(sharedTradeViewHref('active')),
      'nav.favorites': () => navigate(sharedTradeViewHref('starred')),
      'nav.missed': () => navigate(sharedTradeViewHref('missed')),
      'nav.sim': () => {
        const params = sharedTradeParams()
        params.set('kind', 'paper')
        navigate(`/list?${params.toString()}`)
      },
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

      'view.list': () => {
        const listContext = useShortcutStore.getState().listContext
        const listPath = listPathFromPathname(pathname) ?? listContext?.listPath ?? '/list'
        navigate(routeWithSearch(listPath, search || listContext?.listSearch || ''))
      },
      'view.board': () => {
        const listContext = useShortcutStore.getState().listContext
        const listPath = listPathFromPathname(pathname) ?? listContext?.listPath ?? '/list'
        navigate(routeWithSearch(boardPathFromListPath(listPath), search || listContext?.listSearch || ''))
      },
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
          navigate(routeWithSearch(boardPathFromListPath(listContext.listPath), listContext.listSearch))
          return
        }
        navigate(target)
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
