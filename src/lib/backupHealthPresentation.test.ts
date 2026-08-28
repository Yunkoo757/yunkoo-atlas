import { presentBackupHealth } from './backupHealthPresentation'
import assert from 'node:assert/strict'

export function testBackupHealthUsesExplicitInputStatesAndLatestVerification(): void {
  assert.equal(presentBackupHealth('loading', []).title, '正在读取备份')
  assert.equal(presentBackupHealth('error', []).action, 'retry-load')
  assert.equal(presentBackupHealth('loaded', []).action, 'create')
  const failed = { name: 'new', timestamp: 2, size: 1, verification: { status: 'invalid' as const, checkedAt: 2 } }
  const verified = { name: 'old', timestamp: 1, size: 1, verification: { status: 'verified' as const, checkedAt: 1 } }
  assert.equal(presentBackupHealth('loaded', [verified, failed]).lastVerified?.name, 'old')
}
