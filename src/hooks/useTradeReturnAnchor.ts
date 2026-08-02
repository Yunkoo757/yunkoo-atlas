import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { TradeDetailFrom } from '@/lib/tradeRoute'
import { requestScrollToTrade } from '@/lib/tradeScrollTargets'

const STORAGE_PREFIX = 'trade-return-anchor:'
const STORAGE_VERSION = 1
const MAX_AGE_MS = 30_000
const MAX_RESTORE_FRAMES = 36

export type TradeReturnLocationState = {
  restoreTradeId?: string
  restoreSearch?: string
  restoreSourceSearch?: string
  restoreCreatedAt?: number
}

export type TradeReturnRequest = {
  tradeId?: string
  restoreSearch?: string
  sourceSearch?: string
  createdAt: number
}

export type UseTradeReturnAnchorOptions = {
  onMissing?: (tradeId: string) => void
  onRestoreStart?: (tradeId: string) => void
  onRestoreFinish?: (tradeId?: string) => void
}

const DEFAULT_RETURN_ANCHOR_OPTIONS: UseTradeReturnAnchorOptions = {}

function storageKey(from: TradeDetailFrom): string {
  const pathname = from.pathname.trim().replace(/\/$/, '') || '/'
  const search = new URLSearchParams(from.search ?? '')
  search.sort()
  const normalizedSearch = search.toString()
  return `${STORAGE_PREFIX}${pathname}${normalizedSearch ? `?${normalizedSearch}` : ''}`
}

function isFreshRequestTime(createdAt: unknown, now: number): createdAt is number {
  return (
    typeof createdAt === 'number' &&
    Number.isFinite(createdAt) &&
    createdAt <= now &&
    now - createdAt <= MAX_AGE_MS
  )
}

function isValidExplicitRequestTime(createdAt: unknown, now: number): createdAt is number {
  return typeof createdAt === 'number' && Number.isFinite(createdAt) && createdAt <= now
}

function parseStoredTradeReturnRequest(value: string | null, now = Date.now()): TradeReturnRequest | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (
      parsed.version !== STORAGE_VERSION ||
      typeof parsed.tradeId !== 'string' ||
      !parsed.tradeId ||
      !isValidExplicitRequestTime(parsed.createdAt, now) ||
      (parsed.restoreSearch !== undefined && typeof parsed.restoreSearch !== 'string') ||
      (parsed.sourceSearch !== undefined && typeof parsed.sourceSearch !== 'string')
    ) {
      return null
    }
    const anchorFresh = isFreshRequestTime(parsed.createdAt, now)
    if (!anchorFresh && typeof parsed.restoreSearch !== 'string') return null
    return {
      ...(anchorFresh ? { tradeId: parsed.tradeId } : {}),
      createdAt: parsed.createdAt,
      ...(typeof parsed.restoreSearch === 'string' ? { restoreSearch: parsed.restoreSearch } : {}),
      ...(typeof parsed.sourceSearch === 'string' ? { sourceSearch: parsed.sourceSearch } : {}),
    }
  } catch {
    return null
  }
}

function parseLocationTradeReturnRequest(state: unknown, now = Date.now()): TradeReturnRequest | null {
  if (!state || typeof state !== 'object') return null
  const candidate = state as TradeReturnLocationState
  if (typeof candidate.restoreTradeId !== 'string' || !candidate.restoreTradeId) return null
  if (candidate.restoreSearch !== undefined && typeof candidate.restoreSearch !== 'string') return null
  if (candidate.restoreSourceSearch !== undefined && typeof candidate.restoreSourceSearch !== 'string') return null
  const createdAt = candidate.restoreCreatedAt
  if (createdAt !== undefined && !isValidExplicitRequestTime(createdAt, now)) return null
  const anchorFresh = createdAt === undefined || isFreshRequestTime(createdAt, now)
  if (!anchorFresh && candidate.restoreSearch === undefined) return null
  return {
    ...(anchorFresh ? { tradeId: candidate.restoreTradeId } : {}),
    createdAt: createdAt ?? 0,
    ...(candidate.restoreSearch !== undefined ? { restoreSearch: candidate.restoreSearch } : {}),
    ...(candidate.restoreSourceSearch !== undefined
      ? { sourceSearch: candidate.restoreSourceSearch }
      : {}),
  }
}

function latestTradeReturnRequest(
  explicit: TradeReturnRequest | null,
  stored: TradeReturnRequest | null,
): TradeReturnRequest | null {
  if (!explicit) return stored
  if (!stored) return explicit
  return stored.createdAt > explicit.createdAt ? stored : explicit
}

function sameTradeReturnRequest(left: TradeReturnRequest, right: TradeReturnRequest): boolean {
  return (
    left.tradeId === right.tradeId &&
    left.createdAt === right.createdAt &&
    left.restoreSearch === right.restoreSearch &&
    left.sourceSearch === right.sourceSearch
  )
}

export function serializeTradeReturnAnchor(
  tradeId: string,
  createdAt = Date.now(),
  restoreSearch?: string,
  sourceSearch?: string,
): string {
  return JSON.stringify({
    version: STORAGE_VERSION,
    tradeId,
    createdAt,
    ...(restoreSearch !== undefined ? { restoreSearch } : {}),
    ...(sourceSearch !== undefined ? { sourceSearch } : {}),
  })
}

export function parseTradeReturnAnchor(value: string | null, now = Date.now()): string | null {
  return parseStoredTradeReturnRequest(value, now)?.tradeId ?? null
}

export function rememberTradeReturnAnchor(from: TradeDetailFrom): void {
  if (!from.anchorTradeId || typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(
    storageKey(from),
    serializeTradeReturnAnchor(
      from.anchorTradeId,
      Date.now(),
      from.restoreSearch ?? from.search ?? '',
      from.search ?? '',
    ),
  )
}

export function tradeReturnLocationState(
  source?: string | TradeDetailFrom,
): TradeReturnLocationState {
  const anchorTradeId = typeof source === 'string' ? source : source?.anchorTradeId
  if (!anchorTradeId) return {}
  const restoreSearch = typeof source === 'string'
    ? undefined
    : source?.restoreSearch ?? source?.search ?? ''
  const sourceSearch = typeof source === 'string' ? undefined : source?.search ?? ''
  return {
    restoreTradeId: anchorTradeId,
    restoreCreatedAt: Date.now(),
    ...(restoreSearch !== undefined ? { restoreSearch } : {}),
    ...(sourceSearch !== undefined ? { restoreSourceSearch: sourceSearch } : {}),
  }
}

export function peekTradeReturnRequest(
  from: Pick<TradeDetailFrom, 'pathname' | 'search'>,
  state: unknown,
  now = Date.now(),
): TradeReturnRequest | null {
  const explicit = parseLocationTradeReturnRequest(state, now)
  const stored = typeof sessionStorage === 'undefined'
    ? null
    : parseStoredTradeReturnRequest(sessionStorage.getItem(storageKey(from)), now)
  const sourceStored = typeof sessionStorage === 'undefined' || explicit?.sourceSearch === undefined
    ? null
    : parseStoredTradeReturnRequest(
        sessionStorage.getItem(storageKey({ pathname: from.pathname, search: explicit.sourceSearch })),
        now,
      )
  return latestTradeReturnRequest(latestTradeReturnRequest(explicit, stored), sourceStored)
}

function consumeTradeReturnLocationState(state: unknown): unknown {
  if (!state || typeof state !== 'object') return null
  const nextState = { ...(state as Record<string, unknown>) }
  delete nextState.restoreTradeId
  delete nextState.restoreSearch
  delete nextState.restoreSourceSearch
  delete nextState.restoreCreatedAt
  return Object.keys(nextState).length > 0 ? nextState : null
}

function isTradeReturnElementVisible(element: HTMLElement): boolean {
  if (typeof window === 'undefined') return element.getClientRects().length > 0
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

  const isEligible = (candidate: HTMLElement) => {
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
  }

  return candidates.find(isEligible) ?? (isEligible(target) ? target : null)
}

export function useTradeReturnAnchor(
  options: UseTradeReturnAnchorOptions = DEFAULT_RETURN_ANCHOR_OPTIONS,
): void {
  const location = useLocation()
  const navigate = useNavigate()
  const pendingRef = useRef<{
    locationKey: string
    request: TradeReturnRequest
    prepared: boolean
  } | null>(null)
  const selfReplaceRef = useRef<{
    pending: NonNullable<typeof pendingRef.current>
    pathname: string
    search: string
  } | null>(null)
  const onMissingRef = useRef(options.onMissing)
  const onRestoreStartRef = useRef(options.onRestoreStart)
  const onRestoreFinishRef = useRef(options.onRestoreFinish)

  useEffect(() => {
    onMissingRef.current = options.onMissing
  }, [options.onMissing])

  useEffect(() => {
    onRestoreStartRef.current = options.onRestoreStart
  }, [options.onRestoreStart])

  useEffect(() => {
    onRestoreFinishRef.current = options.onRestoreFinish
  }, [options.onRestoreFinish])

  useEffect(() => {
    const currentStorageKey = storageKey({ pathname: location.pathname, search: location.search })
    const explicit = parseLocationTradeReturnRequest(location.state)
    const storedValue = typeof sessionStorage === 'undefined'
      ? null
      : sessionStorage.getItem(currentStorageKey)
    const stored = parseStoredTradeReturnRequest(storedValue)
    if (stored && typeof sessionStorage !== 'undefined') sessionStorage.removeItem(currentStorageKey)
    const sourceStorageKey = explicit?.sourceSearch === undefined
      ? null
      : storageKey({ pathname: location.pathname, search: explicit.sourceSearch })
    const sourceStoredValue = typeof sessionStorage === 'undefined' || !sourceStorageKey || sourceStorageKey === currentStorageKey
      ? null
      : sessionStorage.getItem(sourceStorageKey)
    const sourceStored = parseStoredTradeReturnRequest(sourceStoredValue)
    if (sourceStoredValue !== null && sourceStorageKey && typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(sourceStorageKey)
    }
    const candidate = latestTradeReturnRequest(
      latestTradeReturnRequest(explicit, stored),
      sourceStored,
    )
    const currentPending = pendingRef.current
    const selfReplace = selfReplaceRef.current
    if (
      selfReplace &&
      selfReplace.pending === currentPending &&
      selfReplace.pathname === location.pathname &&
      selfReplace.search === location.search
    ) {
      selfReplaceRef.current = null
      currentPending.locationKey = location.key
      if (candidate && !sameTradeReturnRequest(candidate, currentPending.request)) {
        pendingRef.current = {
          locationKey: location.key,
          request: candidate,
          prepared: false,
        }
      }
    } else if (candidate) {
      if (
        !currentPending ||
        currentPending.locationKey !== location.key ||
        !sameTradeReturnRequest(currentPending.request, candidate)
      ) {
        pendingRef.current = {
          locationKey: location.key,
          request: candidate,
          prepared: false,
        }
      }
    } else if (currentPending?.locationKey !== location.key) {
      pendingRef.current = null
    }
    const pending = pendingRef.current
    if (!pending) return

    const restoreSearch = pending.request.restoreSearch
    const hasExplicitState = Boolean(
      location.state &&
      typeof location.state === 'object' &&
      'restoreTradeId' in location.state
    )
    if (restoreSearch !== undefined && restoreSearch !== location.search) {
      selfReplaceRef.current = {
        pending,
        pathname: location.pathname,
        search: restoreSearch,
      }
      navigate(
        { pathname: location.pathname, search: restoreSearch, hash: location.hash },
        { replace: true, state: consumeTradeReturnLocationState(location.state) },
      )
      return
    }
    if (hasExplicitState) {
      selfReplaceRef.current = {
        pending,
        pathname: location.pathname,
        search: location.search,
      }
      navigate(
        { pathname: location.pathname, search: location.search, hash: location.hash },
        { replace: true, state: consumeTradeReturnLocationState(location.state) },
      )
      return
    }

    const tradeId = pending.request.tradeId
    if (!tradeId) {
      pendingRef.current = null
      onRestoreFinishRef.current?.()
      return
    }

    let frame = 0
    let animationFrame = 0
    let requestedVirtualScroll = false
    const finish = () => {
      if (pendingRef.current !== pending) return
      pendingRef.current = null
      onRestoreFinishRef.current?.(tradeId)
    }
    const attemptRestore = () => {
      if (pendingRef.current !== pending) return
      if (!pending.prepared) {
        pending.prepared = true
        onRestoreStartRef.current?.(tradeId)
        frame += 1
        animationFrame = requestAnimationFrame(attemptRestore)
        return
      }
      if (!requestedVirtualScroll) {
        requestedVirtualScroll = requestScrollToTrade(tradeId)
      }
      const target = [...document.querySelectorAll<HTMLElement>('[data-trade-id]')]
        .find((element) => element.dataset.tradeId === tradeId)
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
        onMissingRef.current?.(tradeId)
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
