import assert from 'node:assert/strict'
import { composerDefaultsForWorkspace, resolveCreateRecordAction } from './createRecordAction'

export function testCreateActionNamesAndKindsFollowWorkspaceWithoutChangingSavedData() {
  const cases = [
    ['/notes/a', '', 'note', 'global.newQuickNote'],
    ['/review-cases', '', 'case', 'global.newCase'],
    ['/backtests/project', '', 'backtest', 'global.newTrade'],
    ['/list', '?kind=paper', 'paper', 'global.newTrade'],
    ['/board', '?kind=paper', 'paper', 'global.newTrade'],
    ['/dashboard', '?kind=paper', 'paper', 'global.newTrade'],
    ['/review-cases/mistakes/board', '', 'case', 'global.newCase'],
    ['/list', '', 'live', 'global.newTrade'],
  ] as const
  const scoped = composerDefaultsForWorkspace('/review-cases/mistakes/board', '?strategyId=s2&side=short&symbol=BTCUSD')
  assert.deepEqual(scoped, { strategyId: 's2', side: 'short', symbol: 'BTCUSD', caseType: 'mistake', status: 'planned' })
  assert.equal(composerDefaultsForWorkspace('/backtests/project', '?records=missed').status, 'missed')
  assert.equal(composerDefaultsForWorkspace('/notes', '?strategyId=s2').strategyId, undefined)
  assert.equal(composerDefaultsForWorkspace('/list', '?status=win').status, 'planned')
  for (const [path, search, kind, id] of cases) {
    const action = resolveCreateRecordAction(path, search)
    if (action.kind !== kind || action.actionId !== id) throw Error('Incorrect create destination: '+path)
  }
}
