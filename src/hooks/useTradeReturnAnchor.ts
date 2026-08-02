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
  onRestoreStart?: (tradeId: string) => void
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

function isTradeReturnElementVisible(element: HTMLElement): boolean {
  const closedDetails = element.closest<HTMLDetailsElement>('details:not([open])')
  if (closedDetails && closedDetails !== element) {
    const summary = closedDetails.querySelector<HTMLElement>(':scope > summary')
    if (!summary?.contains(element)) return false
  }
  const style = window.getComputedStyle(element)
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.visibility !== 'collapse' &&
    element.getClientRects().length > 0
  )
}

export function findTradeReturnFocusTarget(target: HTMLElement): HTMLElement | null {
  const primaryActions = target.querySelectorAll<HTMLElement>('[data-trade-primary-action]')
  const fallbackActions = target.querySelectorAll<HTMLElement>('button, a')
  const candidates = [...primaryActions, ...fallbackActions]

  return candidates.find((candidate) => {
    const canBeDisabled = candidate as HTMLElement & { disabled?: boolean }
    return (
      candidate.tabIndex >= 0 &&
      !canBeDisabled.disabled &&
      candidate.getAttribute('aria-disabled') !== 'true' &&
      !candidate.hidden &&
      candidate.getAttribute('aria-hidden') !== 'true' &&
      candidate.closest('[hidden], [aria-hidden="true"]') === null &&
      isTradeReturnElementVisible(candidate)
    )
  }) ?? null
}

export function useTradeReturnAnchor(
  options: UseTradeReturnAnchorOptions = DEFAULT_RETURN_ANCHOR_OPTIONS,
): void {
  const location = useLocation()
  const navigate = useNavigate()
  const pendingRef = useRef<{
    storageKey: string
    locationKey: string
    explicitTradeId?: string
    tradeId: string
    explicit: boolean
    prepared: boolean
  } | null>(null)
  const consumedStorageKeyRef = useRef<string | null>(null)
  const onMissingRef = useRef(options.onMissing)
  const onRestoreStartRef = useRef(options.onRestoreStart)

  useEffect(() => {
    onMissingRef.current = options.onMissing
  }, [options.onMissing])

  useEffect(() => {
    onRestoreStartRef.current = options.onRestoreStart
  }, [options.onRestoreStart])

  useEffect(() => {
    const currentStorageKey = storageKey({ pathname: location.pathname, search: location.search })
    const explicit = (location.state as TradeReturnLocationState | null)?.restoreTradeId
    const currentPending = pendingRef.current
    if (
      currentPending?.storageKey !== currentStorageKey ||
      currentPending.locationKey !== location.key ||
      currentPending.explicitTradeId !== explicit
    ) {
      let stored: string | null = null
      if (consumedStorageKeyRef.current !== currentStorageKey) {
        consumedStorageKeyRef.current = currentStorageKey
        stored = typeof sessionStorage === 'undefined'
          ? null
          : sessionStorage.getItem(currentStorageKey)
        if (stored !== null) sessionStorage.removeItem(currentStorageKey)
      }
      const tradeId = explicit ?? parseTradeReturnAnchor(stored)
      pendingRef.current = tradeId
        ? {
            storageKey: currentStorageKey,
            locationKey: location.key,
            explicitTradeId: explicit,
            tradeId,
            explicit: Boolean(explicit),
            prepared: false,
          }
        : null
    }
    const pending = pendingRef.current
    if (!pending) return

    let frame = 0
    let animationFrame = 0
    let requestedVirtualScroll = false
    const finish = () => {
      if (pendingRef.current !== pending) return
      pendingRef.current = null
      if (!pending.explicit) return
      navigate(
        { pathname: location.pathname, search: location.search, hash: location.hash },
        { replace: true, state: null },
      )
    }
    const attemptRestore = () => {
      if (pendingRef.current !== pending) return
      if (!pending.prepared) {
        pending.prepared = true
        onRestoreStartRef.current?.(pending.tradeId)
        frame += 1
        animationFrame = requestAnimationFrame(attemptRestore)
        return
      }
      if (!requestedVirtualScroll) {
        requestedVirtualScroll = requestScrollToTrade(pending.tradeId)
      }
      const target = [...document.querySelectorAll<HTMLElement>('[data-trade-id]')]
        .find((element) => element.dataset.tradeId === pending.tradeId)
      if (target && isTradeReturnElementVisible(target)) {
        const focusTarget = findTradeReturnFocusTarget(target)
        if (focusTarget) {
          focusTarget.focus({ preventScroll: true })
          target.scrollIntoView({ block: 'center' })
          finish()
          return
        }
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
  }, [location.hash, location.key, location.pathname, location.search, location.state, navigate])
}
