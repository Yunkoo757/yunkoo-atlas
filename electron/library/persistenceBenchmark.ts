import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { decodeCanonicalSnapshot } from '../../src/storage/snapshotCodec'
import { SCHEMA_VERSION, type ExportAssetRecord, type PersistedSnapshot } from '../../src/storage/types'
import { QuitCoordinator, releaseThenFinalizeWithRollback } from '../quitCoordinator'
import {
  createBackupAtPath,
  deleteBackupAtPath,
  verifyBackupAtPath,
} from './backup'
import { LibraryStorage } from './storage'

export interface ElectronPersistenceBenchmarkInput {
  label: '10k' | '20k'
  snapshot: PersistedSnapshot
  assets: ExportAssetRecord[]
  expectedHash: string
  warmups: number
  samples: number
  measureQuit?: boolean
}

function checksum(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function runElectronPersistenceBenchmark(
  input: ElectronPersistenceBenchmarkInput,
): Promise<{
  label: string
  saveSamplesMs: number[]
  quitSamplesMs: number[]
  checksum: string
  databaseBytes: number
}> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `atlas-persistence-${input.label}-`))
  let storage = new LibraryStorage(root)
  const durableHash = checksum(decodeCanonicalSnapshot(input.snapshot, {
    version: SCHEMA_VERSION,
    label: `${input.label} Electron persistence benchmark fixture`,
  }))
  const assertReloadedState = () => {
    const loaded = storage.loadSnapshot()
    if (checksum(loaded) !== durableHash) throw new Error('退出 release 后 snapshot checksum 不一致')
    for (const expected of input.assets) {
      const actual = storage.getAssetBytes(expected.id)
      if (!actual || !Buffer.from(actual.bytes).equals(Buffer.from(expected.data, 'base64'))) {
        throw new Error(`退出 release 后附件不一致：${expected.id}`)
      }
    }
  }
  try {
    await storage.open()
    await storage.commitImport(input.snapshot, input.assets.map((asset) => ({
      id: asset.id,
      mime: asset.mime,
      buffer: Buffer.from(asset.data, 'base64'),
    })))

    const saveSamplesMs: number[] = []
    const iterations = input.warmups + input.samples
    for (let index = 0; index < iterations; index += 1) {
      const startedAt = performance.now()
      storage.saveSnapshot(input.snapshot)
      const elapsed = performance.now() - startedAt
      storage.close()
      storage = new LibraryStorage(root, { ensureDirectories: false, allowCreate: false })
      await storage.open()
      const loaded = storage.loadSnapshot()
      if (checksum(loaded) !== durableHash) {
        throw new Error(`${input.label} Electron durable reload checksum 不一致`)
      }
      for (const expected of input.assets) {
        const actual = storage.getAssetBytes(expected.id)
        if (
          !actual ||
          actual.mime !== expected.mime ||
          !Buffer.from(actual.bytes).equals(Buffer.from(expected.data, 'base64'))
        ) {
          throw new Error(`${input.label} Electron durable reload 附件不一致：${expected.id}`)
        }
      }
      const manifest = storage.readManifest()
      if (!manifest.libraryId || !Number.isSafeInteger(manifest.schemaVersion)) {
        throw new Error(`${input.label} Electron durable reload manifest 无效`)
      }
      if (index >= input.warmups) saveSamplesMs.push(elapsed)
    }

    const quitSamplesMs: number[] = []
    if (input.measureQuit) {
      for (let index = 0; index < input.warmups + input.samples; index += 1) {
        let backupName: string | null = null
        const coordinator = new QuitCoordinator({
          timeoutMs: 15_000,
          createRequestId: () => `benchmark-quit-${index}`,
          requestRendererFlush: async () => { storage.saveSnapshot(input.snapshot) },
          createVerifiedBackup: async () => {
            const backupPath = createBackupAtPath(storage, root, Date.now() + index)
            if (!backupPath) throw new Error('退出性能基准未生成恢复点')
            backupName = path.basename(backupPath)
            const verification = await verifyBackupAtPath(root, backupName)
            if (verification.status !== 'verified') {
              throw new Error(verification.error ?? '退出性能基准恢复点验证失败')
            }
          },
          commitExit: async () => {
            await releaseThenFinalizeWithRollback(
              () => storage.release(),
              () => {},
              () => storage.open(),
            )
            let released = false
            try {
              storage.loadSnapshot()
            } catch {
              released = true
            }
            if (!released) throw new Error('QuitCoordinator 未释放 LibraryStorage')
            await storage.open()
            assertReloadedState()
          },
          cancelPreparation: () => {},
          reportError: () => {},
        })
        const startedAt = performance.now()
        const result = await coordinator.request('quit')
        const elapsed = performance.now() - startedAt
        if (!result.ok) throw new Error(result.error)
        if (backupName) deleteBackupAtPath(root, backupName)
        if (index >= input.warmups) quitSamplesMs.push(elapsed)
      }
    }

    return {
      label: input.label,
      saveSamplesMs,
      quitSamplesMs,
      checksum: input.expectedHash,
      databaseBytes: fs.statSync(storage.getPaths().dbFile).size,
    }
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}
