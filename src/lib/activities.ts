import type { ActivityEvent, Trade } from '@/data/trades'

export function newActivityId(): string {
  return `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function toIsoTimestamp(value: string): string {
  if (!value) return new Date().toISOString()
  return value.includes('T') ? value : `${value}T00:00:00.000Z`
}

export function appendActivity(
  trade: Trade,
  event: Omit<ActivityEvent, 'id'> & { id?: string },
): Trade {
  const activity: ActivityEvent = {
    id: event.id ?? newActivityId(),
    kind: event.kind,
    timestamp: event.timestamp,
    ...(event.status !== undefined ? { status: event.status } : {}),
    ...(event.strategyId !== undefined ? { strategyId: event.strategyId } : {}),
    ...(event.fromStrategyId !== undefined ? { fromStrategyId: event.fromStrategyId } : {}),
    ...(event.tag !== undefined ? { tag: event.tag } : {}),
    ...(event.tagAction !== undefined ? { tagAction: event.tagAction } : {}),
    ...(event.commentId !== undefined ? { commentId: event.commentId } : {}),
    ...(event.text !== undefined ? { text: event.text } : {}),
    ...(event.fromTradeKind !== undefined ? { fromTradeKind: event.fromTradeKind } : {}),
    ...(event.toTradeKind !== undefined ? { toTradeKind: event.toTradeKind } : {}),
  }
  return {
    ...trade,
    activities: [...(trade.activities ?? []), activity],
  }
}

/** 旧数据无 activities 时，从 create / closedAt / comments 合成 */
export function synthesizeActivities(trade: Trade): ActivityEvent[] {
  const events: ActivityEvent[] = [
    {
      id: `create-${trade.id}`,
      kind: 'create',
      timestamp: toIsoTimestamp(trade.openedAt),
    },
  ]
  if (trade.closedAt) {
    events.push({
      id: `status-${trade.id}`,
      kind: 'status',
      status: trade.status,
      timestamp: toIsoTimestamp(trade.closedAt),
    })
  }
  for (const c of trade.comments ?? []) {
    events.push({
      id: c.id,
      kind: 'comment',
      commentId: c.id,
      text: c.text,
      timestamp: c.createdAt,
    })
  }
  return events.sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp))
}

export function getTradeActivities(trade: Trade): ActivityEvent[] {
  if (trade.activities?.length) {
    const commentIds = new Set((trade.comments ?? []).map((c) => c.id))
    const sorted = [...trade.activities]
      .filter((a) => a.kind !== 'comment' || !a.commentId || commentIds.has(a.commentId))
      .sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp))
    return compressActivitiesForDisplay(sorted)
  }
  return synthesizeActivities(trade)
}

/** 展示用：合并连续的笔记更新，避免自动保存刷屏 */
export type DisplayActivityEvent = ActivityEvent & { noteEditCount?: number }

export function compressActivitiesForDisplay(
  events: ActivityEvent[],
): DisplayActivityEvent[] {
  const out: DisplayActivityEvent[] = []
  for (const e of events) {
    if (e.kind === 'note') {
      const prev = out[out.length - 1]
      if (prev?.kind === 'note') {
        out[out.length - 1] = {
          ...prev,
          timestamp: e.timestamp,
          noteEditCount: (prev.noteEditCount ?? 1) + 1,
        }
        continue
      }
      out.push({ ...e, noteEditCount: 1 })
      continue
    }
    out.push(e)
  }
  return out
}

export function createActivity(trade: Trade): Trade {
  return appendActivity(trade, {
    kind: 'create',
    timestamp: toIsoTimestamp(trade.openedAt),
  })
}
