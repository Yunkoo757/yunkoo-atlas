import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import initSqlJs from 'sql.js'
import {
  createBackupAtPath,
  deleteBackupAtPath,
  getBackupStatsAtPath,
  rotateBackups,
  restoreBackupAtPath,
  verifyBackupAtPath,
} from './backup'
import { validateLibraryDatabaseFile } from './journalZip'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

async function createVerifiableBackup(
  root: string,
  options: {
    referencedAssetId?: string
    includeAsset?: boolean
    omitSnapshot?: boolean
    emptyLibraryBackup?: boolean
  } = {},
): Promise<string> {
  const includeAsset = options.includeAsset ?? true
  const attachments = path.join(root, 'attachments')
  fs.mkdirSync(attachments, { recursive: true })
  if (includeAsset) {
    fs.writeFileSync(path.join(attachments, 'asset-1.bin'), Buffer.from('original-asset'))
  }

  const SQL = await initSqlJs({
    locateFile: () => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  })
  const db = new SQL.Database()
  try {
    db.run(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE assets (
        id TEXT PRIMARY KEY,
        mime TEXT NOT NULL,
        file_name TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
    `)
    const trades = options.referencedAssetId
      ? [{
          id: 'trade-1',
          ref: 'TRD-1',
          symbol: 'BTCUSDT',
          strategyId: 'strategy-1',
          openedAt: '2026-07-14',
          side: 'long',
          status: 'open',
          conviction: 'medium',
          entry: 1,
          size: 1,
          note: `<p><img src="journal-asset://${options.referencedAssetId}"></p>`,
        }]
      : []
    if (!options.omitSnapshot) {
      db.run('INSERT INTO meta (key, value) VALUES (?, ?)', [
        'snapshot',
        JSON.stringify({
          trades,
          strategies: [],
          starredIds: [],
          subscribedIds: [],
          pinnedStrategyIds: [],
          display: {},
        }),
      ])
    }
    if (includeAsset) {
      db.run('INSERT INTO assets VALUES (?, ?, ?, ?, ?)', [
        'asset-1',
        'application/octet-stream',
        'asset-1.bin',
        14,
        '2026-07-14T08:00:00.000Z',
      ])
    }
    fs.writeFileSync(path.join(root, 'journal.db'), Buffer.from(db.export()))
    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({ schemaVersion: 6, libraryId: 'backup-test-library' }),
      'utf8',
    )

    const backup = createBackupAtPath(
      {
        getCounts: () => ({
          tradeCount: trades.length,
          strategyCount: 0,
          assetCount: includeAsset ? 1 : 0,
        }),
      },
      root,
      Date.UTC(2026, 6, 14, 8, 0, 0),
      { emptyLibrary: options.emptyLibraryBackup },
    )
    if (!backup) throw new Error('测试恢复点创建失败')
    return backup
  } finally {
    db.close()
  }
}

export async function testExitBackupCanExplicitlyVerifyARecoverableEmptyLibrary(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-backup-verify-empty-'))
  try {
    const backup = await createVerifiableBackup(root, {
      includeAsset: false,
      omitSnapshot: true,
      emptyLibraryBackup: true,
    })
    const result = await verifyBackupAtPath(root, path.basename(backup))
    assert(result.status === 'verified' && result.emptyLibrary === true, '普通产品入口必须能重验带标记的空库恢复点')
    assert(result.tradeCount === 0 && result.attachmentCount === 0, '空库恢复点必须证明计数均为零')
    assert(restoreBackupAtPath(root, path.basename(backup)), '普通恢复入口必须接受已验证的空库恢复点')
    const restored = await validateLibraryDatabaseFile(path.join(root, 'journal.db'), {
      allowEmptySnapshot: true,
    })
    assert(restored.tradeCount === 0 && restored.assets.length === 0, '空库恢复后必须仍是可打开的零数据资料库')
    assertVerificationWorkspaceRemoved(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testUnmarkedMissingSnapshotBackupRemainsInvalid(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-backup-verify-unmarked-empty-'))
  try {
    const backup = await createVerifiableBackup(root, { includeAsset: false, omitSnapshot: true })
    const result = await verifyBackupAtPath(root, path.basename(backup))
    assert(result.status === 'invalid', '缺少显式空库标记时不得放宽 snapshot 验证')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

function assertVerificationWorkspaceRemoved(root: string): void {
  assert(
    !fs.readdirSync(root).some((name) => name.startsWith('.backup-verify-')),
    '恢复点验证结束后必须清理临时资料库',
  )
}

export async function testBackupVerificationRestoresDatabaseAndAttachmentBytes(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-backup-verify-ok-'))
  try {
    const backup = await createVerifiableBackup(root)
    const result = await verifyBackupAtPath(root, path.basename(backup))
    assert(result.status === 'verified', '完整恢复演练应验证通过')
    assert(result.tradeCount === 0, '验证结果应包含实际交易数量')
    assert(result.attachmentCount === 1, '验证结果应包含实际附件数量')
    assertVerificationWorkspaceRemoved(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testBackupVerificationRejectsTamperedAttachmentBytes(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-backup-verify-asset-'))
  try {
    const backup = await createVerifiableBackup(root)
    const meta = JSON.parse(fs.readFileSync(backup + '.meta.json', 'utf8')) as {
      attachmentEntries: { vaultName: string }[]
    }
    const vaultName = meta.attachmentEntries[0]?.vaultName
    if (!vaultName) throw new Error('测试恢复点缺少附件映射')
    fs.writeFileSync(path.join(root, 'backups', 'assets', vaultName), 'tampered-asset')

    const result = await verifyBackupAtPath(root, path.basename(backup))
    assert(result.status === 'invalid', '附件字节被篡改后必须拒绝恢复点')
    assertVerificationWorkspaceRemoved(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testBackupVerificationRejectsTamperedMetadata(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-backup-verify-meta-'))
  try {
    const backup = await createVerifiableBackup(root)
    const meta = JSON.parse(fs.readFileSync(backup + '.meta.json', 'utf8')) as Record<string, unknown>
    meta.tradeCount = 99
    fs.writeFileSync(backup + '.meta.json', JSON.stringify(meta), 'utf8')

    const result = await verifyBackupAtPath(root, path.basename(backup))
    assert(result.status === 'invalid', '恢复点元数据与数据库不一致时必须拒绝')
    assertVerificationWorkspaceRemoved(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testBackupVerificationRejectsTamperedManifest(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-backup-verify-manifest-'))
  try {
    const backup = await createVerifiableBackup(root)
    fs.writeFileSync(backup + '.manifest.json', '{broken', 'utf8')

    const result = await verifyBackupAtPath(root, path.basename(backup))
    assert(result.status === 'invalid', '资料库清单损坏后不得标记为已验证')
    assertVerificationWorkspaceRemoved(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testBackupVerificationRejectsTamperedDatabaseBytes(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-backup-verify-database-'))
  try {
    const backup = await createVerifiableBackup(root)
    const bytes = fs.readFileSync(backup)
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff
    fs.writeFileSync(backup, bytes)

    const result = await verifyBackupAtPath(root, path.basename(backup))
    assert(result.status === 'invalid', '数据库字节被篡改后不得标记为已验证')
    assertVerificationWorkspaceRemoved(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testBackupVerificationRejectsMissingNoteAttachmentReferences(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-backup-verify-reference-'))
  try {
    const backup = await createVerifiableBackup(root, {
      referencedAssetId: 'missing-asset',
      includeAsset: false,
    })

    const result = await verifyBackupAtPath(root, path.basename(backup))
    assert(result.status === 'invalid', '笔记引用缺少附件记录时不得标记为已验证')
    assertVerificationWorkspaceRemoved(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
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

export function testBackupsCreatedInTheSameMillisecondRemainIndependent(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-backup-collision-'))
  try {
    fs.writeFileSync(path.join(root, 'journal.db'), 'first-snapshot')
    const counts = { getCounts: () => ({ tradeCount: 1, strategyCount: 1, assetCount: 0 }) }
    const now = Date.UTC(2026, 6, 13, 8, 0, 0)
    const first = createBackupAtPath(counts, root, now)
    fs.writeFileSync(path.join(root, 'journal.db'), 'second-snapshot')
    const second = createBackupAtPath(counts, root, now)

    assert(Boolean(first && second), '同一毫秒内的两次备份都应成功')
    assert(first !== second, '同一毫秒内的备份不得覆盖同名恢复点')
    assert(fs.readFileSync(first!, 'utf8') === 'first-snapshot', '首个恢复点内容不得被覆盖')
    assert(fs.readFileSync(second!, 'utf8') === 'second-snapshot', '第二个恢复点应保存最新内容')
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

export function testBackupRotationNeverDeletesTheOnlyLatestRestorePoint(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-backup-capacity-floor-'))
  try {
    const attachments = path.join(root, 'attachments')
    fs.mkdirSync(attachments, { recursive: true })
    fs.writeFileSync(path.join(root, 'journal.db'), 'latest-snapshot')
    fs.writeFileSync(path.join(attachments, 'large.png'), Buffer.alloc(128, 1))
    createBackupAtPath(
      { getCounts: () => ({ tradeCount: 1, strategyCount: 1, assetCount: 1 }) },
      root,
      Date.UTC(2026, 6, 13, 10, 0, 0),
    )

    const backups = path.join(root, 'backups')
    rotateBackups(backups, 7, 1)
    assert(
      fs.readdirSync(backups).filter((name) => name.endsWith('.db')).length === 1,
      '即使单份图片超过容量建议值，也必须保留最新恢复点',
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export function testRestoreWithMissingAttachmentLeavesCurrentLibraryUntouched(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-backup-safe-restore-'))
  try {
    const attachments = path.join(root, 'attachments')
    fs.mkdirSync(attachments, { recursive: true })
    fs.writeFileSync(path.join(root, 'journal.db'), 'backup-db')
    fs.writeFileSync(path.join(attachments, 'chart.png'), 'backup-image')
    const backup = createBackupAtPath(
      { getCounts: () => ({ tradeCount: 1, strategyCount: 1, assetCount: 1 }) },
      root,
      Date.UTC(2026, 6, 13, 10, 0, 0),
    )!

    fs.writeFileSync(path.join(root, 'journal.db'), 'current-db')
    fs.writeFileSync(path.join(attachments, 'chart.png'), 'current-image')
    const meta = JSON.parse(fs.readFileSync(backup + '.meta.json', 'utf8')) as {
      attachmentEntries: { vaultName: string }[]
    }
    fs.rmSync(path.join(root, 'backups', 'assets', meta.attachmentEntries[0]!.vaultName))

    let rejected = false
    try {
      restoreBackupAtPath(root, path.basename(backup))
    } catch {
      rejected = true
    }
    assert(rejected, '缺失附件的恢复点必须拒绝恢复')
    assert(fs.readFileSync(path.join(root, 'journal.db'), 'utf8') === 'current-db', '失败后数据库不得改变')
    assert(
      fs.readFileSync(path.join(attachments, 'chart.png'), 'utf8') === 'current-image',
      '失败后当前附件不得改变',
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
// Quality-Scenario: E-QUIT-BACKUP-FAIL
