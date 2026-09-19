import { automaticVerificationTarget, presentBackupHealth, shouldSurfaceBackupHealth } from './backupHealthPresentation'
import assert from 'node:assert/strict'

export function testBackupHealthUsesExplicitInputStatesAndLatestVerification(): void {
  assert.equal(presentBackupHealth('loading', []).title, '正在读取备份')
  assert.equal(presentBackupHealth('error', []).action, 'retry-load')
  assert.equal(presentBackupHealth('loaded', []).action, 'create')
  const failed = { name: 'new', timestamp: 2, size: 1, verification: { status: 'invalid' as const, checkedAt: 2 } }
  const verified = { name: 'old', timestamp: 1, size: 1, verification: { status: 'verified' as const, checkedAt: 1 } }
  assert.equal(presentBackupHealth('loaded', [verified, failed]).lastVerified?.name, 'old')
}

export function testRoutineBackupStatesStayVisuallyNeutral(): void {
  assert.equal(presentBackupHealth('loaded', []).tone, 'neutral')
  const unverified = { name: 'latest', timestamp: 2, size: 1 }
  const presentation = presentBackupHealth('loaded', [unverified])
  assert.equal(presentation.tone, 'neutral')
  assert.equal(presentation.title, '最新备份 · 未验证')
}

export function testOnlyLatestUnverifiedBackupIsAutomaticallyVerified(): void {
  const unverified = { name: 'latest', timestamp: 3, size: 1 }
  const verified = { name: 'old', timestamp: 2, size: 1, verification: { status: 'verified' as const, checkedAt: 2 } }
  assert.equal(automaticVerificationTarget('loaded', [verified, unverified])?.name, 'latest')
  assert.equal(automaticVerificationTarget('loading', [unverified]), undefined)
  assert.equal(automaticVerificationTarget('loaded', [verified]), undefined)
}

export function testBackupHealthOnlySurfacesFailuresInTheSidebar(): void {
  assert.equal(shouldSurfaceBackupHealth(presentBackupHealth('loading', [])), false)
  assert.equal(shouldSurfaceBackupHealth(presentBackupHealth('error', [])), true)
  assert.equal(shouldSurfaceBackupHealth(presentBackupHealth('loaded', [])), false)
  const unverified = { name: 'latest', timestamp: 2, size: 1 }
  assert.equal(shouldSurfaceBackupHealth(presentBackupHealth('loaded', [unverified])), false)
  const verified = { name: 'ok', timestamp: 3, size: 1, verification: { status: 'verified' as const, checkedAt: 3 } }
  assert.equal(shouldSurfaceBackupHealth(presentBackupHealth('loaded', [verified])), false)
  const invalid = { name: 'broken', timestamp: 4, size: 1, verification: { status: 'invalid' as const, checkedAt: 4 } }
  assert.equal(shouldSurfaceBackupHealth(presentBackupHealth('loaded', [invalid])), true)
  assert.equal(shouldSurfaceBackupHealth(presentBackupHealth('loaded', [verified, invalid])), true)
}
