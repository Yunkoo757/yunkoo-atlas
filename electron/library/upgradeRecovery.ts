import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { writeFileAtomicallySync } from './atomicFile'
import { ensureLibraryDirs } from './paths'

export interface UpgradeJournal {
  targetVersion: number
  phase: 'pending-v7' | 'committed-v7'
  sourceChecksumSha256: string
  rollbackLocation: string
}

function recoveryPaths(libraryPath: string) {
  const root = path.join(libraryPath, '.upgrade')
  const rollback = path.join(root, 'pre-v7')
  return {
    root,
    rollback,
    journal: path.join(root, 'upgrade-journal.json'),
    rollbackDb: path.join(rollback, 'journal.db'),
    rollbackManifest: path.join(rollback, 'manifest.json'),
  }
}

export function checksumFileSha256(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

export function readUpgradeJournal(libraryPath: string): UpgradeJournal | null {
  const { journal } = recoveryPaths(libraryPath)
  if (!fs.existsSync(journal)) return null
  const value = JSON.parse(fs.readFileSync(journal, 'utf8')) as UpgradeJournal
  if (
    !Number.isInteger(value.targetVersion) || value.targetVersion < 1 ||
    (value.phase !== 'pending-v7' && value.phase !== 'committed-v7') ||
    !/^[a-f0-9]{64}$/.test(value.sourceChecksumSha256) ||
    typeof value.rollbackLocation !== 'string'
  ) throw new Error('upgrade journal is invalid')
  return value
}

export function prepareUpgradeRecovery(libraryPath: string, targetVersion: number): UpgradeJournal {
  const library = ensureLibraryDirs(libraryPath)
  const recovery = recoveryPaths(libraryPath)
  if (!fs.existsSync(library.dbFile) || !fs.existsSync(library.manifestFile)) {
    throw new Error('cannot create pre-v7 recovery point from an incomplete library')
  }
  fs.mkdirSync(recovery.rollback, { recursive: true })
  fs.copyFileSync(library.dbFile, recovery.rollbackDb)
  fs.copyFileSync(library.manifestFile, recovery.rollbackManifest)
  const sourceChecksumSha256 = checksumFileSha256(recovery.rollbackDb)
  const journal: UpgradeJournal = {
    targetVersion,
    phase: 'pending-v7',
    sourceChecksumSha256,
    rollbackLocation: recovery.rollback,
  }
  writeFileAtomicallySync(recovery.journal, JSON.stringify(journal, null, 2), 'utf8')
  return journal
}

export function recoverOrCommitPendingUpgrade(
  libraryPath: string,
  validateActive: () => boolean,
): 'none' | 'committed' | 'restored' {
  const journal = readUpgradeJournal(libraryPath)
  if (!journal || journal.phase === 'committed-v7') return 'none'
  const library = ensureLibraryDirs(libraryPath)
  const recovery = recoveryPaths(libraryPath)
  if (validateActive()) {
    const manifest = JSON.parse(fs.readFileSync(library.manifestFile, 'utf8')) as Record<string, unknown>
    writeFileAtomicallySync(
      library.manifestFile,
      JSON.stringify({ ...manifest, schemaVersion: journal.targetVersion }, null, 2),
      'utf8',
    )
    writeFileAtomicallySync(
      recovery.journal,
      JSON.stringify({ ...journal, phase: 'committed-v7' }, null, 2),
      'utf8',
    )
    return 'committed'
  }
  if (!fs.existsSync(recovery.rollbackDb) || !fs.existsSync(recovery.rollbackManifest)) {
    throw new Error('pending upgrade cannot be restored because pre-v7 recovery files are missing')
  }
  if (checksumFileSha256(recovery.rollbackDb) !== journal.sourceChecksumSha256) {
    throw new Error('pre-v7 recovery database checksum does not match upgrade journal')
  }
  fs.copyFileSync(recovery.rollbackDb, library.dbFile)
  fs.copyFileSync(recovery.rollbackManifest, library.manifestFile)
  fs.rmSync(recovery.journal, { force: true })
  return 'restored'
}
