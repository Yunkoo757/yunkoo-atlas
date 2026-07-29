import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { TradeDetailFrom } from '@/lib/tradeRoute'
import { requestScrollToTrade } from '@/lib/tradeScrollTargets'

const STORAGE_PREFIX = 'trade-return-anchor:'
const STORAGE_VERSION = 1
const MAX_AGE_MS = 30_000
const MAX_RESTORE_FRAMES = 36

type TradeReturnLocationState = {
  restoreTradeId?: string
}

export type UseTradeReturnAnchorOptions = {
  onMissing?: (tradeId: string) => void
}

const DEFAULT_RETURN_ANCHOR_OPTIONS: UseTradeReturnAnchorOptions = {}

function storageKey(from: TradeDetailFrom): string {
  const pathname = from.pathname.trim().replace(/\/$/, '') || '/'
  const search = new URLSearchParams(from.search ?? '')
  search.sort()
  const normalizedSearch = search.toString()
  return `${STORAGE_PREFIX}${pathname}${normalizedSearch ? `?${normalizedSearch}` : ''}`
}

export function serializeTradeReturnAnchor(tradeId: string, createdAt = Date.now()): string {
  return JSON.stringify({ version: STORAGE_VERSION, tradeId, createdAt })
}

export function parseTradeReturnAnchor(value: string | null, now = Date.now()): string | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (
      parsed.version !== STORAGE_VERSION ||
      typeof parsed.tradeId !== 'string' ||
      !parsed.tradeId ||
      typeof parsed.createdAt !== 'number' ||
      !Number.isFinite(parsed.createdAt) ||
      parsed.createdAt > now ||
      now - parsed.createdAt > MAX_AGE_MS
    ) {
      return null
    }
    return parsed.tradeId
  } catch {
    return null
  }
}

export function rememberTradeReturnAnchor(from: TradeDetailFrom): void {
  if (!from.anchorTradeId || typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(storageKey(from), serializeTradeReturnAnchor(from.anchorTradeId))
}

export function tradeReturnLocationState(anchorTradeId?: string): TradeReturnLocationState {
  return anchorTradeId ? { restoreTradeId: anchorTradeId } : {}
}

export function useTradeReturnAnchor(
  options: UseTradeReturnAnchorOptions = DEFAULT_RETURN_ANCHOR_OPTIONS,
): void {
  const location = useLocation()
  const navigate = useNavigate()
  const pendingRef = useRef<{ key: string; tradeId: string; explicit: boolean } | null>(null)
  const onMissingRef = useRef(options.onMissing)

  useEffect(() => {
    onMissingRef.current = options.onMissing
  }, [options.onMissing])

  useEffect(() => {
    const key = storageKey({ pathname: location.pathname, search: location.search })
    const explicit = (location.state as TradeReturnLocationState | null)?.restoreTradeId
    if (pendingRef.current?.key !== key) {
      const stored = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(key)
      if (stored !== null) sessionStorage.removeItem(key)
      const tradeId = explicit ?? parseTradeReturnAnchor(stored)
      pendingRef.current = tradeId ? { key, tradeId, explicit: Boolean(explicit) } : null
    }
    const pending = pendingRef.current
    if (!pending) return

    let frame = 0
    let animationFrame = 0
    let requestedVirtualScroll = false
    const finish = () => {
      pendingRef.current = null
      if (!pending.explicit) return
      navigate(
        { pathname: location.pathname, search: location.search, hash: location.hash },
        { replace: true, state: null },
      )
    }
    const attemptRestore = () => {
      if (!requestedVirtualScroll) {
        requestedVirtualScroll = requestScrollToTrade(pending.tradeId)
      }
      const target = [...document.querySelectorAll<HTMLElement>('[data-trade-id]')]
        .find((element) => element.dataset.tradeId === pending.tradeId)
      if (target) {
        const focusTarget = target.querySelector<HTMLElement>(
          '[data-trade-primary-action], button, a',
        )
        focusTarget?.focus({ preventScroll: true })
        target.scrollIntoView({ block: 'center' })
        finish()
        return
      }
      if (frame >= MAX_RESTORE_FRAMES) {
        onMissingRef.current?.(pending.tradeId)
        finish()
        return
      }
      frame += 1
      animationFrame = requestAnimationFrame(attemptRestore)
    }
    attemptRestore()
    return () => cancelAnimationFrame(animationFrame)
  }, [location.hash, location.pathname, location.search, location.state, navigate])
}
