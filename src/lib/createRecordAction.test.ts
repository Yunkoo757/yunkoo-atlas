import { resolveCreateRecordAction } from './createRecordAction'

export function testCreateActionNamesAndKindsFollowWorkspaceWithoutChangingSavedData() {
  const cases = [
    ['/notes/a', '', 'note', 'global.newQuickNote'],
    ['/review-cases', '', 'case', 'global.newCase'],
    ['/backtests/project', '', 'backtest', 'global.newTrade'],
    ['/list', '?kind=paper', 'paper', 'global.newTrade'],
    ['/list', '', 'live', 'global.newTrade'],
  ] as const
  for (const [path, search, kind, id] of cases) {
    const action = resolveCreateRecordAction(path, search)
    if (action.kind !== kind || action.actionId !== id) throw Error('Incorrect create destination: '+path)
  }
}
