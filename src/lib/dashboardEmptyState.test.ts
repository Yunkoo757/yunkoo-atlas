import { resolveDashboardEmptyState } from './dashboardEmptyState'
import assert from 'node:assert/strict'

export function testDashboardEmptyStateExplainsTheActualCause(): void {
  assert.equal(resolveDashboardEmptyState({ totalRecordCount: 0, scopedRecordCount: 0, eligibleClosedCount: 0, activeRecordCount: 0 })?.kind, 'library')
  assert.equal(resolveDashboardEmptyState({ totalRecordCount: 4, scopedRecordCount: 0, eligibleClosedCount: 0, activeRecordCount: 0 })?.kind, 'scope')
  assert.equal(resolveDashboardEmptyState({ totalRecordCount: 4, scopedRecordCount: 2, eligibleClosedCount: 0, activeRecordCount: 1 })?.primary, 'view-active')
  assert.equal(resolveDashboardEmptyState({ totalRecordCount: 4, scopedRecordCount: 2, eligibleClosedCount: 1, activeRecordCount: 0 }), null)
}
