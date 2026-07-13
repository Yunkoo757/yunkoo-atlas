import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '@/store/useStore'
import { toast } from '@/lib/toast'
import {
  useShortcutStore,
  resolveBinding,
} from '@/store/shortcutStore'
import { setShortcutHandlers, handleShortcutKeydown } from '@/shortcuts/engine'
import {
  fallbackAdjacentTradeId,
  findAdjacentTradeId,
} from '@/shortcuts/listNav'
import {
  boardPathFromListPath,
  isBoardPath,
  isDetailPath,
  listPathFromPathname,
  tablePathFromListPath,
} from '@/lib/routeContext'
import { tradeDetailPath, resolveTradeDetailReturn, findTradeByRouteParam } from '@/lib/tradeRoute'
import { routeWithSearch } from '@/lib/tradeView'
import { resolveShortcutWorkspaceHref } from '@/shortcuts/workspaceActions'
import { getActionMeta } from '@/shortcuts/actions'
import { requestLightboxReset } from '@/lib/lightboxView'
import { newTradeKindForPath } from '@/lib/tradeKind'

export function useShortcutHost({
  onToggleCmdk,
}: {
  onToggleCmdk: () => void
}) {
  const navigate = useNavigate()
  const { pathname, search, state: locationState } = useLocation()
  const trades = useStore((s) => s.trades)
  const openComposer = useStore((s) => s.openComposer)
  const closeComposer = useStore((s) => s.closeComposer)
  const composerOpen = useStore((s) => s.composerOpen)
  const closeTradeRequest = useStore((s) => s.closeTradeRequest)
  const cancelTradeClose = useStore((s) => s.cancelTradeClose)

  const lightbox = useShortcutStore((s) => s.lightbox)
  const cmdkOpen = useShortcutStore((s) => s.cmdkOpen)
  const closeLightbox = useShortcutStore((s) => s.closeLightbox)
  const lightboxPrev = useShortcutStore((s) => s.lightboxPrev)
  const lightboxNext = useShortcutStore((s) => s.lightboxNext)
  const setCmdkOpen = useShortcutStore((s) => s.setCmdkOpen)

  useEffect(() => {
    setShortcutHandlers({
      'global.commandPalette': onToggleCmdk,
      'global.newTrade': () => {
        openComposer(null, newTradeKindForPath(pathname))
      },
      'global.newCase': () => {
        openComposer(null, 'case')
      },
      'global.undo': () => {
        const s = useStore.getState()
        if (s.undoStack.length > 0) { s.undo(); toast('已撤销') }
      },
      'global.redo': () => {
        const s = useStore.getState()
        if (s.redoStack.length > 0) { s.redo(); toast('已重做') }
      },
      'global.closeOverlay': () => {
        if (lightbox) closeLightbox()
        else if (cmdkOpen) setCmdkOpen(false)
        else if (composerOpen) closeComposer()
        else if (closeTradeRequest) cancelTradeClose()
      },

      'nav.today': () => navigate('/today-record'),
      'nav.active': () => navigate('/active'),
      'nav.favorites': () => navigate('/favorites'),
      'nav.missed': () => navigate('/missed'),
      'nav.sim': () => navigate('/sim'),
      'nav.list': () => {
        const state = useStore.getState()
        navigate(resolveShortcutWorkspaceHref('trade', state.display, state.strategies))
      },
      'nav.reviewCases': () => {
        const state = useStore.getState()
        navigate(resolveShortcutWorkspaceHref('case', state.display, state.strategies))
      },
      'nav.board': () => {
        const listPath = listPathFromPathname(pathname) ?? '/list'
        navigate(routeWithSearch(boardPathFromListPath(listPath), search))
      },
      'nav.dashboard': () => navigate('/dashboard'),
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
      'view.table': () => {
        const listContext = useShortcutStore.getState().listContext
        const listPath = listPathFromPathname(pathname) ?? listContext?.listPath ?? '/list'
        navigate(routeWithSearch(tablePathFromListPath(listPath), search || listContext?.listSearch || ''))
      },

      'list.toggleFilters': () => {
        if (listPathFromPathname(pathname)) {
          window.dispatchEvent(new CustomEvent('atlas:toggle-trade-filters'))
        }
      },

      'trade.prev': () => {
        const listContext = useShortcutStore.getState().listContext
        const param = pathname.replace(/^\/trade\//, '')
        const trade = findTradeByRouteParam(trades, param)
        const id =
          findAdjacentTradeId(listContext, trade?.id, 'prev') ??
          fallbackAdjacentTradeId(trades, trade?.id, 'prev')
        const next = trades.find((t) => t.id === id)
        if (next) navigate(tradeDetailPath(next), { state: locationState })
      },
      'trade.next': () => {
        const listContext = useShortcutStore.getState().listContext
        const param = pathname.replace(/^\/trade\//, '')
        const trade = findTradeByRouteParam(trades, param)
        const id =
          findAdjacentTradeId(listContext, trade?.id, 'next') ??
          fallbackAdjacentTradeId(trades, trade?.id, 'next')
        const next = trades.find((t) => t.id === id)
        if (next) navigate(tradeDetailPath(next), { state: locationState })
      },
      'trade.backToList': () => {
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
      'image.close': closeLightbox,
      'image.reset': () => {
        requestLightboxReset()
      },
    })
  }, [
    pathname,
    search,
    locationState,
    trades,
    lightbox,
    cmdkOpen,
    composerOpen,
    closeTradeRequest,
    navigate,
    onToggleCmdk,
    openComposer,
    closeComposer,
    cancelTradeClose,
    closeLightbox,
    lightboxPrev,
    lightboxNext,
    setCmdkOpen,
  ])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
