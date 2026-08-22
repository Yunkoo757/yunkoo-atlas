import { assertValidPersistedSnapshot } from '../src/storage/snapshotValidation'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createForcedKillSnapshot } from './forcedKillQa'
import { createBackupAtPath, verifyBackupAtPath } from './library/backup'
import { LibraryStorage } from './library/storage'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testForcedKillSeedIsAValidSelfContainedNativeStageGraph(): void {
  for (const fixture of [
    createForcedKillSnapshot('confirmed-revision-1'),
    createForcedKillSnapshot('unconfirmed-revision-2', 1024),
  ]) {
    assertValidPersistedSnapshot(fixture)

    const currentStageId = fixture.currentLiveStageId
    const archivedStageIds = new Set(
      fixture.liveStages.filter((stage) => stage.status === 'archived').map((stage) => stage.id),
    )
    assert(currentStageId !== null, '强杀 fixture 必须拥有 current stage')
    assert(
      fixture.trades.some((trade) => trade.tradeKind !== 'paper' && trade.liveStageId === currentStageId),
      '必须覆盖 current trade',
    )
    assert(
      fixture.trades.some((trade) => (
        trade.tradeKind !== 'paper' &&
        typeof trade.liveStageId === 'string' &&
        archivedStageIds.has(trade.liveStageId)
      )),
      '必须覆盖 archived trade',
    )
    assert(
      fixture.weeklyReviews?.every((review) => review.liveStageId === currentStageId),
      '周复盘必须属于覆盖其完整周区间的 current stage',
    )
    assert(
      [
        ...fixture.weeklyRiskPreparations,
        ...fixture.riskPolicyVersions,
        ...fixture.monthlyRiskLimits,
        ...fixture.riskOverrideEvents,
      ].every((entity) => entity.liveStageId === currentStageId),
      '直接风险图必须与其 current trade 和周复盘同 stage',
    )
  }
}

export async function testForcedKillSeedProducesAVerifiableRolloverBackup(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trader-atlas-forced-kill-backup-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.saveSnapshot(createForcedKillSnapshot('confirmed-revision-1'))
    const backup = createBackupAtPath(storage, root, Date.UTC(2026, 6, 20, 0, 0, 0))
    assert(backup !== null, '强杀 seed 必须能够生成 rollover 前置恢复点')

    const verification = await verifyBackupAtPath(root, path.basename(backup))
    assert(
      verification.status === 'verified',
      `强杀 seed 不得留下无物理附件的 journal-asset 引用：${verification.error ?? 'unknown error'}`,
    )
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}
