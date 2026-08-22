export interface LiveStage {
  id: string
  sequence: number
  name: string
  status: 'current' | 'archived'
  startsOn: string
  endsOn: string | null
  createdAt: string
  archivedAt: string | null
}

export interface ScheduledStageRollover {
  id: string
  requestedAt: string
  effectiveWeekStart: string
  postponedCount: number
}

export interface LiveStageState {
  liveStages: LiveStage[]
  currentLiveStageId: string
}

function fail(message: string): never {
  throw new Error(`实盘阶段数据无效：${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isCanonicalYmd(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

function isIsoInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function previousDay(date: string): string {
  if (!isCanonicalYmd(date)) fail('阶段日期必须是有效的 YYYY-MM-DD')
  let [year, month, day] = date.split('-').map(Number)
  if (day > 1) day -= 1
  else if (month > 1) {
    month -= 1
    day = daysInMonth(year, month)
  } else {
    year -= 1
    month = 12
    day = 31
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function assertValidLiveStage(value: unknown): asserts value is LiveStage {
  if (!isRecord(value)) fail('阶段必须是对象')
  if (!isNonEmptyString(value.id)) fail('阶段 ID 不能为空')
  if (!Number.isInteger(value.sequence) || (value.sequence as number) <= 0) fail('阶段序号必须是正整数')
  if (!isNonEmptyString(value.name)) fail('阶段名称不能为空')
  if (value.status !== 'current' && value.status !== 'archived') fail('阶段状态不合法')
  if (!isCanonicalYmd(value.startsOn)) fail('阶段开始日期必须是有效的 YYYY-MM-DD')
  if (!isIsoInstant(value.createdAt)) fail('阶段创建时间必须是 ISO 时间点')

  if (value.status === 'current') {
    if (value.endsOn !== null || value.archivedAt !== null) fail('当前阶段不能有归档边界')
    return
  }

  if (!isCanonicalYmd(value.endsOn) || value.endsOn < value.startsOn) fail('已归档阶段的结束日期无效')
  if (!isIsoInstant(value.archivedAt)) fail('已归档阶段必须有 ISO 归档时间')
}

/**
 * 校验持久化实盘阶段状态。阶段列表按起始日期形成彼此不重叠的时间线，
 * 并且仅 currentLiveStageId 指向的阶段可以是当前阶段。
 */
export function assertValidLiveStageState(value: unknown): asserts value is LiveStageState {
  if (!isRecord(value) || !Array.isArray(value.liveStages) || !isNonEmptyString(value.currentLiveStageId)) {
    fail('状态结构不完整')
  }

  const ids = new Set<string>()
  const sequences = new Set<number>()
  const stages = value.liveStages
  let currentCount = 0
  for (const stage of stages) {
    assertValidLiveStage(stage)
    if (ids.has(stage.id)) fail('阶段 ID 必须唯一')
    if (sequences.has(stage.sequence)) fail('阶段序号必须唯一')
    ids.add(stage.id)
    sequences.add(stage.sequence)
    if (stage.status === 'current') currentCount += 1
  }

  if (currentCount !== 1) fail('必须且只能有一个当前阶段')
  const current = stages.find((stage) => stage.id === value.currentLiveStageId)
  if (!current || current.status !== 'current') fail('当前实盘阶段无效')

  const chronological = [...stages].sort((left, right) => left.startsOn.localeCompare(right.startsOn))
  for (let index = 1; index < chronological.length; index += 1) {
    const previous = chronological[index - 1]
    const stage = chronological[index]
    if (previous.endsOn === null || previous.endsOn >= stage.startsOn) fail('阶段时间线不能重叠')
  }
}

export function getCurrentLiveStage(stages: readonly LiveStage[], currentId: string): LiveStage {
  const current = stages.find((stage) => stage.id === currentId)
  if (!current || current.status !== 'current') throw new Error('当前实盘阶段无效')
  return current
}

export function createInitialLiveStage(startsOn: string, createdAt: string, id: string): LiveStage {
  const stage: LiveStage = {
    id,
    sequence: 1,
    name: '实盘阶段 1',
    status: 'current',
    startsOn,
    endsOn: null,
    createdAt,
    archivedAt: null,
  }
  assertValidLiveStageState({ liveStages: [stage], currentLiveStageId: id })
  return stage
}

export function createNextLiveStage(
  previous: LiveStage,
  startsOn: string,
  createdAt: string,
  id: string,
): { archived: LiveStage; current: LiveStage } {
  assertValidLiveStageState({ liveStages: [previous], currentLiveStageId: previous.id })
  if (!isCanonicalYmd(startsOn) || startsOn <= previous.startsOn) fail('新阶段必须晚于当前阶段开始日期')
  if (id === previous.id) fail('新阶段 ID 必须不同于当前阶段')

  const archived: LiveStage = {
    ...previous,
    status: 'archived',
    endsOn: previousDay(startsOn),
    archivedAt: createdAt,
  }
  const current: LiveStage = {
    id,
    sequence: previous.sequence + 1,
    name: `实盘阶段 ${previous.sequence + 1}`,
    status: 'current',
    startsOn,
    endsOn: null,
    createdAt,
    archivedAt: null,
  }
  assertValidLiveStageState({ liveStages: [archived, current], currentLiveStageId: current.id })
  return { archived, current }
}
