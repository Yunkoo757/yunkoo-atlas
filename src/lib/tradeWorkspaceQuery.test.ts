import assert from 'node:assert/strict'
import type { LiveStage } from '@/lib/liveStages'
import {
  normalizeTradeWorkspaceSearch,
  parseTradeWorkspaceQuery,
  mergeSharedTradeWorkspaceSearch,
  resolveSharedTradeWorkspaceSearch,
  resolveTradeWorkspaceListFilter,
  sharedTradeWorkspaceSearch,
  tradeHomeSearch,
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
  assert.equal(normalized.toString(), 'liveStage=all&kind=paper&view=starred')
}

export function testTradeWorkspaceMigratesRemovedHistoricalAggregate(): void {
  assert.deepEqual(
    parseTradeWorkspaceQuery('?liveStage=all-history&kind=live', stages, 'stage-current'),
    { stage: 'all', kind: 'live', view: 'all' },
  )
  assert.equal(
    normalizeTradeWorkspaceSearch('?liveStage=all-history&strategyId=navigation-2', stages, 'stage-current').toString(),
    'liveStage=all&strategyId=navigation-2',
  )
  assert.equal(sharedTradeWorkspaceSearch('?liveStage=all-history'), '?liveStage=all')
}

export function testTradeWorkspaceQueryRejectsUnknownStage(): void {
  assert.deepEqual(
    parseTradeWorkspaceQuery('?liveStage=missing&kind=all', stages, 'stage-current'),
    { stage: 'current', kind: 'all', view: 'all' },
  )
}

export function testTradeWorkspaceSupportsAllLiveStages(): void {
  assert.deepEqual(
    parseTradeWorkspaceQuery('?liveStage=all&kind=live', stages, 'stage-current'),
    { stage: 'all', kind: 'live', view: 'all' },
  )
  assert.equal(
    normalizeTradeWorkspaceSearch('?liveStage=all&strategyId=navigation-2', stages, 'stage-current').toString(),
    'liveStage=all&strategyId=navigation-2',
  )
}

export function testTradeWorkspaceStageScopeSurvivesKindSwitch(): void {
  assert.deepEqual(
    parseTradeWorkspaceQuery('?liveStage=all&kind=paper', stages, 'stage-current'),
    { stage: 'all', kind: 'paper', view: 'all' },
  )
  assert.deepEqual(
    resolveTradeWorkspaceListFilter({ stage: 'all', kind: 'paper', view: 'all' }),
    { type: 'all', tradeKind: 'paper' },
  )
  assert.deepEqual(
    resolveTradeWorkspaceListFilter({ stage: 'all', kind: 'all', view: 'all' }),
    { type: 'all' },
  )
  assert.equal(
    writeTradeWorkspaceContext('?liveStage=all', { kind: 'paper' }).toString(),
    'liveStage=all&kind=paper',
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

export function testTradeHomeKeepsOnlyStageScope(): void {
  assert.equal(
    tradeHomeSearch('?liveStage=all&kind=paper&strategyId=navigation-2&status=loss'),
    '?liveStage=all',
  )
  assert.equal(tradeHomeSearch('?kind=paper&status=open'), '')
}

export function testSharedTradeWorkspaceContextSurvivesModuleNavigation(): void {
  assert.equal(
    resolveSharedTradeWorkspaceSearch(
      '/list',
      '?liveStage=all&kind=paper&status=loss',
      '?liveStage=stage-old',
    ),
    '?liveStage=all&kind=paper',
  )
  assert.equal(
    resolveSharedTradeWorkspaceSearch('/settings', '', '?liveStage=stage-old&status=loss'),
    '?liveStage=stage-old',
  )
  assert.equal(
    mergeSharedTradeWorkspaceSearch(
      '?status=loss&liveStage=stage-old&kind=paper',
      '?liveStage=all',
    ),
    '?status=loss&liveStage=all',
  )
}
