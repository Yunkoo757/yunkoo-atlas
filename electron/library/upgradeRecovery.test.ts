import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { prepareUpgradeRecovery, readUpgradeJournal, recoverOrCommitPendingUpgrade } from './upgradeRecovery'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-upgrade-recovery-'))
  fs.writeFileSync(path.join(root, 'journal.db'), 'v6-database')
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ schemaVersion: 6, libraryId: 'fixture' }))
  return root
}

export function testPendingUpgradeCommitsOnlyAfterActiveValidation(): void {
  const root = fixture()
  try {
    prepareUpgradeRecovery(root, 7)
    fs.writeFileSync(path.join(root, 'journal.db'), 'v7-database')
    const result = recoverOrCommitPendingUpgrade(root, () => true)
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')) as { schemaVersion: number }
    assert(result === 'committed' && manifest.schemaVersion === 7, 'validated active DB commits target manifest')
    assert(readUpgradeJournal(root)?.phase === 'committed-v7', 'journal records committed phase')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export function testPendingUpgradeRestoresVerifiedV6AfterFailure(): void {
  const root = fixture()
  try {
    prepareUpgradeRecovery(root, 7)
    fs.writeFileSync(path.join(root, 'journal.db'), 'broken-v7-database')
    const result = recoverOrCommitPendingUpgrade(root, () => false)
    assert(result === 'restored', 'invalid active DB restores recovery point')
    assert(fs.readFileSync(path.join(root, 'journal.db'), 'utf8') === 'v6-database', 'restored DB matches pre-v7 bytes')
    assert(JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).schemaVersion === 6, 'v6 manifest is restored')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}
