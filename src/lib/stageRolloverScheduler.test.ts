import type { ScheduledStageRollover } from '@/lib/liveStages'
import {
  createForegroundStageRolloverScheduler,
  type StageRolloverSchedulerClock,
} from '@/lib/stageRolloverScheduler'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

class FakeClock implements StageRolloverSchedulerClock {
  private current: Date
  private nextId = 1
  private timers = new Map<number, { due: number; callback: () => void }>()

  constructor(now: Date) {
    this.current = now
  }

  now = (): Date => new Date(this.current)

  setTimeout = (callback: () => void, milliseconds: number): number => {
    const id = this.nextId
    this.nextId += 1
    this.timers.set(id, { due: this.current.getTime() + milliseconds, callback })
    return id
  }

  clearTimeout = (handle: unknown): void => {
    this.timers.delete(Number(handle))
  }

  async advanceTo(now: Date): Promise<void> {
    const target = now.getTime()
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .sort((left, right) => left[1].due - right[1].due || left[0] - right[0])[0]
      if (!next) break
      this.current = new Date(next[1].due)
      this.timers.delete(next[0])
      next[1].callback()
      await Promise.resolve()
      await Promise.resolve()
    }
    this.current = new Date(target)
  }

  async fireNextTimerAt(now: Date): Promise<void> {
    this.current = now
    const next = [...this.timers.entries()]
      .sort((left, right) => left[1].due - right[1].due || left[0] - right[0])[0]
    if (!next) return
    this.timers.delete(next[0])
    next[1].callback()
    await Promise.resolve()
    await Promise.resolve()
  }

  pendingTimerCount(): number {
    return this.timers.size
  }

  pendingDueTimes(): number[] {
    return [...this.timers.values()].map((timer) => timer.due).sort((left, right) => left - right)
  }
}

function scheduled(effectiveWeekStart = '2026-08-31'): ScheduledStageRollover {
  return {
    id: 'rollover-1',
    requestedAt: '2026-08-28T09:00:00.000Z',
    effectiveWeekStart,
    postponedCount: 0,
  }
}

export async function testVisibleDesktopChecksAtTheSundayToMondayBusinessBoundary(): Promise<void> {
  const clock = new FakeClock(new Date(2026, 7, 30, 23, 0, 0))
  let checks = 0
  const scheduler = createForegroundStageRolloverScheduler({
    clock,
    capture: () => ({
      visible: true,
      tradingDayStartHour: 6,
      scheduledStageRollover: scheduled(),
    }),
    checkDue: async () => { checks += 1 },
    fallbackIntervalMs: 5 * 60_000,
  })

  scheduler.start()
  assert(
    clock.pendingDueTimes().includes(new Date(2026, 7, 31, 6, 0, 0).getTime()),
    '持续可见时必须直接预约周一交易日起点，而不能只依赖轮询碰巧发现',
  )
  await clock.advanceTo(new Date(2026, 7, 31, 6, 0, 0))
  assert(checks === 1, '持续可见的桌面端跨过周一交易日起点时必须自动检查到期阶段交接')
  scheduler.stop()
}

export async function testWakeAfterMultipleWeeksRunsOneCheckAndAcceptsAuthoritativePostponement(): Promise<void> {
  const clock = new FakeClock(new Date(2026, 7, 30, 23, 0, 0))
  let activeSchedule: ScheduledStageRollover | null = scheduled()
  let checks = 0
  const scheduler = createForegroundStageRolloverScheduler({
    clock,
    capture: () => ({
      visible: true,
      tradingDayStartHour: 6,
      scheduledStageRollover: activeSchedule,
    }),
    checkDue: async () => {
      checks += 1
      activeSchedule = {
        ...scheduled('2026-09-28'),
        postponedCount: 1,
      }
    },
    fallbackIntervalMs: 5 * 60_000,
  })

  scheduler.start()
  await clock.advanceTo(new Date(2026, 8, 24, 12, 0, 0))
  assert(checks === 1, '休眠跨过多周后只应执行一次权威到期检查')
  assert(
    activeSchedule?.effectiveWeekStart === '2026-09-28' && activeSchedule.postponedCount === 1,
    '阻断后调度器必须采纳执行器从当前交易日计算的新顺延日期',
  )
  scheduler.stop()
}

export async function testCancellingTheScheduleRemovesTheExactBoundaryCheck(): Promise<void> {
  const clock = new FakeClock(new Date(2026, 7, 30, 23, 0, 0))
  let activeSchedule: ScheduledStageRollover | null = scheduled()
  let checks = 0
  const scheduler = createForegroundStageRolloverScheduler({
    clock,
    capture: () => ({ visible: true, tradingDayStartHour: 6, scheduledStageRollover: activeSchedule }),
    checkDue: async () => { checks += 1 },
    fallbackIntervalMs: 5 * 60_000,
  })

  scheduler.start()
  activeSchedule = null
  scheduler.notifyBoundaryChange()
  await clock.advanceTo(new Date(2026, 7, 31, 6, 0, 0))
  assert(checks === 0, '取消预约后原周一边界不得再执行阶段检查')
  assert(clock.pendingTimerCount() === 0, '取消后必须清除全部边界与回退定时器，避免空闲桌面常驻唤醒')
  scheduler.stop()
}

export async function testUnmountStopsEverySchedulerTimer(): Promise<void> {
  const clock = new FakeClock(new Date(2026, 7, 30, 23, 0, 0))
  let checks = 0
  const scheduler = createForegroundStageRolloverScheduler({
    clock,
    capture: () => ({ visible: true, tradingDayStartHour: 6, scheduledStageRollover: scheduled() }),
    checkDue: async () => { checks += 1 },
    fallbackIntervalMs: 5 * 60_000,
  })

  scheduler.start()
  scheduler.stop()
  assert(clock.pendingTimerCount() === 0, '应用卸载时必须清理精确边界和低频回退定时器')
  await clock.advanceTo(new Date(2026, 7, 31, 6, 0, 0))
  assert(checks === 0, '应用卸载后不得再回调阶段检查')
}

export async function testClockMovingBackwardRecomputesWithoutPrematureCommit(): Promise<void> {
  const clock = new FakeClock(new Date(2026, 7, 30, 23, 0, 0))
  let checks = 0
  const scheduler = createForegroundStageRolloverScheduler({
    clock,
    capture: () => ({ visible: true, tradingDayStartHour: 6, scheduledStageRollover: scheduled() }),
    checkDue: async () => { checks += 1 },
    fallbackIntervalMs: 5 * 60_000,
  })

  scheduler.start()
  await clock.fireNextTimerAt(new Date(2026, 7, 30, 20, 0, 0))
  assert(checks === 0, '系统时钟向后跳时不得在交易日边界前提前交接')
  await clock.advanceTo(new Date(2026, 7, 31, 6, 0, 0))
  assert(Number(checks) === 1, '时钟向后跳后必须重算并在新的真实边界到达时检查')
  scheduler.stop()
}

export async function testLowFrequencyFallbackDetectsAForwardClockJump(): Promise<void> {
  const clock = new FakeClock(new Date(2026, 7, 30, 23, 0, 0))
  let checks = 0
  const scheduler = createForegroundStageRolloverScheduler({
    clock,
    capture: () => ({ visible: true, tradingDayStartHour: 6, scheduledStageRollover: scheduled() }),
    checkDue: async () => { checks += 1 },
    fallbackIntervalMs: 5 * 60_000,
  })

  scheduler.start()
  await clock.fireNextTimerAt(new Date(2026, 8, 10, 12, 0, 0))
  assert(checks === 1, '低频时钟回退必须在系统时钟向前跳过多周时立即检测到期预约')
  scheduler.stop()
}

export async function testVisibilityAndFocusRecheckTheAuthoritativeClock(): Promise<void> {
  const clock = new FakeClock(new Date(2026, 7, 31, 7, 0, 0))
  let visible = false
  let checks = 0
  const scheduler = createForegroundStageRolloverScheduler({
    clock,
    capture: () => ({ visible, tradingDayStartHour: 6, scheduledStageRollover: scheduled() }),
    checkDue: async () => { checks += 1 },
    fallbackIntervalMs: 5 * 60_000,
  })

  scheduler.start()
  assert(clock.pendingTimerCount() === 0, '隐藏状态不得保留前台边界定时器')
  visible = true
  scheduler.notifyForeground()
  await Promise.resolve()
  await Promise.resolve()
  assert(checks === 1, '恢复可见时必须立即核对到期预约')
  scheduler.notifyForeground()
  await Promise.resolve()
  await Promise.resolve()
  assert(Number(checks) === 2, '窗口重新获得焦点时必须重新核对系统时钟与预约')
  scheduler.stop()
}

export function testLibraryAndScheduleChangesRecomputeTheExactBoundary(): void {
  const clock = new FakeClock(new Date(2026, 7, 30, 23, 0, 0))
  let activeSchedule: ScheduledStageRollover | null = null
  const scheduler = createForegroundStageRolloverScheduler({
    clock,
    capture: () => ({ visible: true, tradingDayStartHour: 6, scheduledStageRollover: activeSchedule }),
    checkDue: async () => {},
    fallbackIntervalMs: 5 * 60_000,
  })

  scheduler.start()
  assert(clock.pendingTimerCount() === 0, '无预约时不得建立常驻低频回退定时器')
  activeSchedule = scheduled()
  scheduler.notifyBoundaryChange()
  assert(clock.pendingTimerCount() === 2, '切换资料库或创建预约后必须立即建立精确边界定时器')
  activeSchedule = scheduled('2026-09-07')
  scheduler.notifyBoundaryChange()
  assert(clock.pendingTimerCount() === 2, '顺延或预约更改必须取消旧边界并只保留一个新边界')
  scheduler.stop()
}

export async function testFailedCheckRetriesOnlyOnTheBoundedFallback(): Promise<void> {
  const clock = new FakeClock(new Date(2026, 7, 31, 7, 0, 0))
  let checks = 0
  let reported = 0
  const scheduler = createForegroundStageRolloverScheduler({
    clock,
    capture: () => ({ visible: true, tradingDayStartHour: 6, scheduledStageRollover: scheduled() }),
    checkDue: async () => {
      checks += 1
      throw new Error('temporary failure')
    },
    reportError: () => { reported += 1 },
    fallbackIntervalMs: 5 * 60_000,
  })

  scheduler.start()
  await Promise.resolve()
  await Promise.resolve()
  assert(checks === 1 && reported === 1, '首次到期失败必须报告一次且不得形成同步忙循环')
  assert(clock.pendingTimerCount() === 1, '失败后只能保留一个有界低频重试定时器')
  await clock.advanceTo(new Date(2026, 7, 31, 7, 5, 0))
  assert(Number(checks) === 2 && Number(reported) === 2, '下一次重试只能由配置的低频回退触发')
  scheduler.stop()
}
