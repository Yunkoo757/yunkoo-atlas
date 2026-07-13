import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createBackupAtPath,
  deleteBackupAtPath,
  getBackupStatsAtPath,
  rotateBackups,
  restoreBackupAtPath,
} from './backup'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testDefaultBackupRotationKeepsSevenLatestRestorePoints(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-backup-default-limit-'))
  try {
    fs.writeFileSync(path.join(root, 'journal.db'), 'snapshot')
    const counts = { getCounts: () => ({ tradeCount: 1, strategyCount: 1, assetCount: 0 }) }
    for (let hour = 0; hour < 8; hour += 1) {
      createBackupAtPath(counts, root, Date.UTC(2026, 6, 13, hour, 0, 0))
    }

    const backups = path.join(root, 'backups')
    rotateBackups(backups)
    const dbFiles = fs.readdirSync(backups).filter((name) => name.endsWith('.db'))
    assert(dbFiles.length === 7, '默认轮换上限应只保留最新 7 个恢复点')
    assert(
      !dbFiles.includes('journal-2026-07-13-00-00-00-000Z.db'),
      '默认轮换应删除最旧恢复点',
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export function testBackupRotationKeepsLatestRestorePointAndItsAttachments(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-backup-rotate-'))
  try {
    const attachments = path.join(root, 'attachments')
    fs.mkdirSync(attachments, { recursive: true })
    fs.writeFileSync(path.join(root, 'journal.db'), 'v1')
    fs.writeFileSync(path.join(attachments, 'old.png'), 'old-image')
    const counts = { getCounts: () => ({ tradeCount: 1, strategyCount: 1, assetCount: 1 }) }
    createBackupAtPath(counts, root, Date.UTC(2026, 6, 13, 9, 0, 0))

    fs.rmSync(path.join(attachments, 'old.png'))
    fs.writeFileSync(path.join(attachments, 'new.png'), 'new-image')
    fs.writeFileSync(path.join(root, 'journal.db'), 'v2')
    createBackupAtPath(counts, root, Date.UTC(2026, 6, 13, 10, 0, 0))

    const backups = path.join(root, 'backups')
    rotateBackups(backups, 1, 1024 * 1024)
    const dbFiles = fs.readdirSync(backups).filter((name) => name.endsWith('.db'))
    assert(dbFiles.length === 1 && dbFiles[0]!.includes('10-00-00'), '轮换应保留最新恢复点')
    const vaultFiles = fs.readdirSync(path.join(backups, 'assets'))
    assert(vaultFiles.length === 1, '轮换后应只保留最新恢复点引用的附件内容')
    assert(
      fs.readFileSync(path.join(backups, 'assets', vaultFiles[0]!)).toString() === 'new-image',
      '应保留最新恢复点引用的附件',
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export function testBackupAccountingAndDeletionIncludeDeduplicatedAttachments(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-backup-stats-'))
  try {
    const attachments = path.join(root, 'attachments')
    fs.mkdirSync(attachments, { recursive: true })
    fs.writeFileSync(path.join(root, 'journal.db'), Buffer.alloc(12, 1))
    fs.writeFileSync(path.join(attachments, 'large.png'), Buffer.alloc(40, 2))
    const backup = createBackupAtPath(
      { getCounts: () => ({ tradeCount: 1, strategyCount: 1, assetCount: 1 }) },
      root,
      Date.UTC(2026, 6, 13, 9, 0, 0),
    )!

    const stats = getBackupStatsAtPath(root)
    assert(stats.count === 1, '恢复点统计应包含数据库快照')
    assert(stats.totalSize >= 52, '恢复点占用应包含去重附件仓库')

    assert(deleteBackupAtPath(root, path.basename(backup)), '应能删除恢复点')
    assert(getBackupStatsAtPath(root).count === 0, '删除后恢复点数量应归零')
    assert(
      fs.readdirSync(path.join(root, 'backups', 'assets')).length === 0,
      '没有恢复点引用后应清理附件副本',
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export function testBackupRestoreProtectsDatabaseManifestAndOriginalAttachments(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-backup-'))
  try {
    const attachments = path.join(root, 'attachments')
    fs.mkdirSync(attachments, { recursive: true })
    fs.writeFileSync(path.join(root, 'journal.db'), Buffer.from('snapshot-v1'))
    fs.writeFileSync(path.join(root, 'manifest.json'), '{"libraryId":"original"}', 'utf8')
    fs.writeFileSync(path.join(attachments, 'chart.png'), Buffer.from([0, 1, 2, 3, 255]))

    const backup = createBackupAtPath(
      { getCounts: () => ({ tradeCount: 1, strategyCount: 2, assetCount: 1 }) },
      root,
      Date.UTC(2026, 6, 13, 8, 30, 0),
    )
    assert(Boolean(backup), '应成功创建恢复点')

    fs.writeFileSync(path.join(root, 'journal.db'), Buffer.from('snapshot-v2'))
    fs.writeFileSync(path.join(root, 'manifest.json'), '{"libraryId":"changed"}', 'utf8')
    fs.rmSync(path.join(attachments, 'chart.png'))

    const restored = restoreBackupAtPath(root, path.basename(backup!))
    assert(restored, '应成功恢复资料库')
    assert(fs.readFileSync(path.join(root, 'journal.db'), 'utf8') === 'snapshot-v1', '应恢复数据库快照')
    assert(
      fs.readFileSync(path.join(root, 'manifest.json'), 'utf8').includes('original'),
      '应恢复资料库清单',
    )
    assert(
      fs.readFileSync(path.join(attachments, 'chart.png')).equals(Buffer.from([0, 1, 2, 3, 255])),
      '应逐字节恢复原始附件',
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export function testBackupKeepsHistoricalBytesWhenAnAttachmentNameIsReused(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-backup-history-'))
  try {
    const attachments = path.join(root, 'attachments')
    fs.mkdirSync(attachments, { recursive: true })
    fs.writeFileSync(path.join(root, 'journal.db'), 'v1')
    fs.writeFileSync(path.join(attachments, 'shared.png'), Buffer.from('first-image'))
    const counts = { getCounts: () => ({ tradeCount: 1, strategyCount: 1, assetCount: 1 }) }
    const first = createBackupAtPath(counts, root, Date.UTC(2026, 6, 13, 8, 0, 0))!

    fs.writeFileSync(path.join(root, 'journal.db'), 'v2')
    fs.writeFileSync(path.join(attachments, 'shared.png'), Buffer.from('second-img!'))
    const second = createBackupAtPath(counts, root, Date.UTC(2026, 6, 13, 9, 0, 0))!

    assert(restoreBackupAtPath(root, path.basename(first)), '应能恢复较早恢复点')
    assert(
      fs.readFileSync(path.join(attachments, 'shared.png'), 'utf8') === 'first-image',
      '附件文件名复用后仍应恢复旧版本的原始字节',
    )
    assert(restoreBackupAtPath(root, path.basename(second)), '应能恢复较新恢复点')
    assert(
      fs.readFileSync(path.join(attachments, 'shared.png'), 'utf8') === 'second-img!',
      '相同大小的新附件也应恢复到对应版本',
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}
