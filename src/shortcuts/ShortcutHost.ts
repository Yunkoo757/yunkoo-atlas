import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '@/store/useStore'
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
import { tradeDetailPath } from '@/lib/tradeRoute'
import { findTradeByRouteParam } from '@/lib/tradeRoute'
import { formatBinding } from '@/shortcuts/format'
import { getActionMeta } from '@/shortcuts/actions'

export function useShortcutHost({
  onToggleCmdk,
}: {
  onToggleCmdk: () => void
}) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
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
      'global.newTrade': () => openComposer(),
      'global.closeOverlay': () => {
        if (lightbox) closeLightbox()
        else if (cmdkOpen) setCmdkOpen(false)
        else if (composerOpen) closeComposer()
      },

      'nav.active': () => navigate('/active'),
      'nav.favorites': () => navigate('/favorites'),
      'nav.missed': () => navigate('/missed'),
      'nav.sim': () => navigate('/sim'),
      'nav.list': () => navigate('/list'),
      'nav.board': () => navigate('/board'),
      'nav.dashboard': () => navigate('/dashboard'),
      'nav.strategies': () => navigate('/settings/strategies'),

      'view.list': () => {
        const listContext = useShortcutStore.getState().listContext
        const listPath = listPathFromPathname(pathname) ?? listContext?.listPath ?? '/list'
        navigate(listPath)
      },
      'view.board': () => {
        const listContext = useShortcutStore.getState().listContext
        const listPath = listPathFromPathname(pathname) ?? listContext?.listPath ?? '/list'
        navigate(boardPathFromListPath(listPath))
      },

      'trade.prev': () => {
        const listContext = useShortcutStore.getState().listContext
        const param = pathname.replace(/^\/trade\//, '')
        const trade = findTradeByRouteParam(trades, param)
        const id =
          findAdjacentTradeId(listContext, trade?.id, 'prev') ??
          fallbackAdjacentTradeId(trades, trade?.id, 'prev')
        const next = trades.find((t) => t.id === id)
        if (next) navigate(tradeDetailPath(next))
      },
      'trade.next': () => {
        const listContext = useShortcutStore.getState().listContext
        const param = pathname.replace(/^\/trade\//, '')
        const trade = findTradeByRouteParam(trades, param)
        const id =
          findAdjacentTradeId(listContext, trade?.id, 'next') ??
          fallbackAdjacentTradeId(trades, trade?.id, 'next')
        const next = trades.find((t) => t.id === id)
        if (next) navigate(tradeDetailPath(next))
      },
      'trade.backToList': () => {
        const listContext = useShortcutStore.getState().listContext
        const listPath = listContext?.listPath ?? '/list'
        navigate(isBoardPath(pathname) ? boardPathFromListPath(listPath) : listPath)
      },

      'image.prev': lightboxPrev,
      'image.next': lightboxNext,
      'image.close': closeLightbox,
    })
  }, [
    pathname,
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
      handleShortcutKeydown(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
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
