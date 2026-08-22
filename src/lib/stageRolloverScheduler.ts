import type { ScheduledStageRollover } from '@/lib/liveStages'
import { getTradingDayKey } from '@/lib/periods'

const MAX_TIMEOUT_MS = 2_147_000_000

export interface StageRolloverSchedulerClock {
  now(): Date
  setTimeout(callback: () => void, milliseconds: number): unknown
  clearTimeout(handle: unknown): void
}

export interface StageRolloverSchedulerSnapshot {
  visible: boolean
  tradingDayStartHour: number
  scheduledStageRollover: ScheduledStageRollover | null
}

export interface ForegroundStageRolloverSchedulerDependencies {
  capture(): StageRolloverSchedulerSnapshot
  checkDue(): Promise<unknown>
  clock?: StageRolloverSchedulerClock
  fallbackIntervalMs?: number
  reportError?(error: unknown): void
}

export interface ForegroundStageRolloverScheduler {
  start(): void
  /** 资料库、预约、取消、顺延、提交或显示起点变化后重算。 */
  notifyBoundaryChange(): void
  /** 可见性恢复、窗口 focus 或唤醒时立即以权威时钟重查。 */
  notifyForeground(): void
  stop(): void
}

function defaultClock(): StageRolloverSchedulerClock {
  return {
    now: () => new Date(),
    setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  }
}

function boundaryInstant(day: string, startHour: number): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match || !Number.isInteger(startHour) || startHour < 0 || startHour > 23) return null
  const instant = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    startHour,
    0,
    0,
    0,
  )
  return Number.isFinite(instant.getTime()) && getTradingDayKey(instant, startHour) === day
    ? instant
    : null
}

function dueSignature(
  snapshot: StageRolloverSchedulerSnapshot,
  now: Date,
): string | null {
  const scheduled = snapshot.scheduledStageRollover
  if (!snapshot.visible || !scheduled) return null
  const tradingDay = getTradingDayKey(now, snapshot.tradingDayStartHour)
  return tradingDay >= scheduled.effectiveWeekStart
    ? `${scheduled.id}\u0000${scheduled.effectiveWeekStart}\u0000${scheduled.postponedCount}\u0000${tradingDay}`
    : null
}

export function createForegroundStageRolloverScheduler(
  dependencies: ForegroundStageRolloverSchedulerDependencies,
): ForegroundStageRolloverScheduler {
  const clock = dependencies.clock ?? defaultClock()
  const fallbackIntervalMs = dependencies.fallbackIntervalMs ?? 5 * 60_000
  if (!Number.isFinite(fallbackIntervalMs) || fallbackIntervalMs < 1_000) {
    throw new Error('阶段交接时钟回退间隔无效')
  }

  let running = false
  let exactTimer: unknown = null
  let fallbackTimer: unknown = null
  let checking: Promise<void> | null = null
  let lastAttemptSignature: string | null = null

  const clearTimers = () => {
    if (exactTimer !== null) clock.clearTimeout(exactTimer)
    if (fallbackTimer !== null) clock.clearTimeout(fallbackTimer)
    exactTimer = null
    fallbackTimer = null
  }

  const scheduleTimers = (allowImmediateCheck: boolean) => {
    clearTimers()
    if (!running) return
    const snapshot = dependencies.capture()
    if (!snapshot.visible) return
    const now = clock.now()
    const signature = dueSignature(snapshot, now)
    if (allowImmediateCheck && signature && signature !== lastAttemptSignature) {
      triggerCheck(signature)
      return
    }

    const scheduled = snapshot.scheduledStageRollover
    if (!scheduled) return
    if (!signature) {
      const boundary = boundaryInstant(scheduled.effectiveWeekStart, snapshot.tradingDayStartHour)
      if (boundary) {
        const delay = Math.max(0, Math.min(MAX_TIMEOUT_MS, boundary.getTime() - now.getTime()))
        exactTimer = clock.setTimeout(() => {
          exactTimer = null
          const latest = dependencies.capture()
          const latestSignature = dueSignature(latest, clock.now())
          if (latestSignature && latestSignature !== lastAttemptSignature) triggerCheck(latestSignature)
          else scheduleTimers(false)
        }, delay)
      }
    }

    fallbackTimer = clock.setTimeout(() => {
      fallbackTimer = null
      // 每次低频观测都允许对同一到期状态重试，以覆盖休眠、时钟跳变与短暂故障。
      lastAttemptSignature = null
      scheduleTimers(true)
    }, fallbackIntervalMs)
  }

  const triggerCheck = (signature: string) => {
    if (!running || checking) return
    lastAttemptSignature = signature
    checking = (async () => {
      try {
        await dependencies.checkDue()
      } catch (error) {
        dependencies.reportError?.(error)
      } finally {
        checking = null
        scheduleTimers(false)
      }
    })()
  }

  return {
    start() {
      if (running) return
      running = true
      lastAttemptSignature = null
      scheduleTimers(true)
    },
    notifyBoundaryChange() {
      if (!running) return
      lastAttemptSignature = null
      scheduleTimers(true)
    },
    notifyForeground() {
      if (!running) return
      lastAttemptSignature = null
      scheduleTimers(true)
    },
    stop() {
      running = false
      clearTimers()
      lastAttemptSignature = null
    },
  }
}
