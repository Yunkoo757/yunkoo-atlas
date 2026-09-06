import assert from 'node:assert/strict'
import { strategyNavigationSearch } from './strategyNavigation'

export function testStrategySwitchPreservesAllOtherFilters() {
  const original='?strategyId=old&liveStage=all&kind=all&view=starred&symbol=EURUSD&tag=a&tag=b&from=2026-01-01'
  for (const strategy of ['first','second','first']) {
    const result=new URLSearchParams(strategyNavigationSearch(strategy,original))
    assert.equal(result.get('strategyId'),strategy)
    result.delete('strategyId')
    const expected=new URLSearchParams(original);expected.delete('strategyId')
    assert.equal(result.toString(),expected.toString())
  }
}
export function testStrategySwitchPreservesPaperAndArchivedStage() {
  assert.equal(strategyNavigationSearch('s','?kind=paper&liveStage=old-stage'),'?strategyId=s&kind=paper&liveStage=old-stage')
  assert.equal(strategyNavigationSearch('s',''),'?strategyId=s')
}
