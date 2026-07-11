import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { TradeDetailFrom } from '@/lib/tradeRoute'

const STORAGE_PREFIX = 'trade-return-anchor:'

type TradeReturnLocationState = {
  restoreTradeId?: string
}

function storageKey(from: TradeDetailFrom): string {
  const pathname = from.pathname.trim().replace(/\/$/, '') || '/'
  const search = new URLSearchParams(from.search ?? '')
  search.sort()
  const normalizedSearch = search.toString()
  return `${STORAGE_PREFIX}${pathname}${normalizedSearch ? `?${normalizedSearch}` : ''}`
}

export function rememberTradeReturnAnchor(from: TradeDetailFrom): void {
  if (!from.anchorTradeId || typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(storageKey(from), from.anchorTradeId)
}

export function tradeReturnLocationState(anchorTradeId?: string): TradeReturnLocationState {
  return anchorTradeId ? { restoreTradeId: anchorTradeId } : {}
}

export function useTradeReturnAnchor(): void {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const key = storageKey({ pathname: location.pathname, search: location.search })
    const explicit = (location.state as TradeReturnLocationState | null)?.restoreTradeId
    const stored = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(key)
    const tradeId = explicit ?? stored
    if (!tradeId) return

    const target = [...document.querySelectorAll<HTMLElement>('[data-trade-id]')]
      .find((element) => element.dataset.tradeId === tradeId)
    if (!target) return

    target.scrollIntoView({ block: 'center' })
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(key)
    if (explicit) {
      navigate(
        { pathname: location.pathname, search: location.search, hash: location.hash },
        { replace: true, state: null },
      )
    }
  }, [location.hash, location.pathname, location.search, location.state, navigate])
}
