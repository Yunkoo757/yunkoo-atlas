import assert from 'node:assert/strict'
import type { LiveStage } from '@/lib/liveStages'
import {
  normalizeTradeWorkspaceSearch,
  parseTradeWorkspaceQuery,
  resolveTradeWorkspaceListFilter,
  sharedTradeWorkspaceSearch,
  writeTradeWorkspaceContext,
} from '@/lib/tradeWorkspaceQuery'

const stages: LiveStage[] = [
  { id: 'stage-old', sequence: 1, name: '第二阶段', status: 'archived', startsOn: '2026-01-01', endsOn: '2026-06-30', createdAt: '2026-01-01T00:00:00.000Z', archivedAt: '2026-07-01T00:00:00.000Z' },
  { id: 'stage-current', sequence: 2, name: '当前阶段', status: 'current', startsOn: '2026-07-01', endsOn: null, createdAt: '2026-07-01T00:00:00.000Z', archivedAt: null },
]

export function testTradeWorkspaceLegacyQueryNormalization(): void {
  const normalized = normalizeTradeWorkspaceSearch(
    '?scope=history&source=paper&filter=starred&unknown=1',
    stages,
    'stage-current',
  )
  assert.equal(normalized.toString(), 'liveStage=all-history&kind=live&view=starred')
}

export function testTradeWorkspaceQueryRejectsUnknownStage(): void {
  assert.deepEqual(
    parseTradeWorkspaceQuery('?liveStage=missing&kind=all', stages, 'stage-current'),
    { stage: 'current', kind: 'all', view: 'all' },
  )
}

export function testTradeWorkspaceListFilterUsesOneQuery(): void {
  assert.deepEqual(
    resolveTradeWorkspaceListFilter({ stage: 'stage-old', kind: 'live', view: 'active' }),
    { type: 'active', tradeKind: 'live' },
  )
  assert.deepEqual(
    resolveTradeWorkspaceListFilter({ stage: 'current', kind: 'all', view: 'all' }),
    { type: 'all' },
  )
}

export function testTradeWorkspaceContextSurvivesPageSwitch(): void {
  assert.equal(
    sharedTradeWorkspaceSearch('?liveStage=stage-old&kind=paper&status=loss'),
    '?liveStage=stage-old&kind=paper',
  )
  assert.equal(
    writeTradeWorkspaceContext('?status=loss&liveStage=stage-old', { stage: 'current', kind: 'paper' }).toString(),
    'status=loss&kind=paper',
  )
}
