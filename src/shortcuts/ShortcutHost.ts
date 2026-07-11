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
} from '@/lib/routeContext'
import { tradeDetailPath, resolveTradeDetailReturn, findTradeByRouteParam } from '@/lib/tradeRoute'
import { routeWithSearch } from '@/lib/tradeView'
import {
  resolveWorkspaceNavTarget,
  workspaceRouteHref,
} from '@/lib/workspaceViews'
import { formatBinding } from '@/shortcuts/format'
import { getActionMeta } from '@/shortcuts/actions'

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
        openComposer()
      },
      'global.switchModule': () => {
        const inReviewCases = pathname.startsWith('/review-cases')
        navigate(inReviewCases ? '/list' : '/review-cases')
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
      },

      'nav.active': () => navigate('/active'),
      'nav.favorites': () => navigate('/favorites'),
      'nav.missed': () => navigate('/missed'),
      'nav.sim': () => navigate('/sim'),
      'nav.list': () => {
        const memory = useStore.getState().display.workspaceMemory?.trade
        navigate(workspaceRouteHref(resolveWorkspaceNavTarget('trade', memory)))
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
    })
  }, [
    pathname,
    search,
    locationState,
    trades,
    lightbox,
    cmdkOpen,
    composerOpen,
    navigate,
    onToggleCmdk,
    openComposer,
    closeComposer,
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

export function getShortcutHint(actionId: string): string | undefined {
  const bindings = useShortcutStore.getState().bindings
  const binding = resolveBinding(actionId, bindings)
  if (!binding) return undefined
  return formatBinding(binding)
}

export function isShortcutContextDetail(pathname: string): boolean {
  return isDetailPath(pathname)
}

export function getActionLabel(actionId: string): string {
  return getActionMeta(actionId)?.label ?? actionId
}
