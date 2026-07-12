import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { LibraryStorage } from './library/storage'
import { processImageBuffer } from './library/images'
import { exportJournalZip, importJournalZipToPath } from './library/journalZip'
import { createBackup, restoreBackup, rotateBackups } from './library/backup'
import { SCHEMA_VERSION } from '../src/storage/types'
import { ZipArchive } from 'archiver'

export interface QaCheck {
  name: string
  pass: boolean
  detail?: string
}

function pngBuf(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
}

function seedSnapshot() {
  return {
    trades: [
      {
        id: 'qa-trade-1',
        ref: 'TRD-QA1',
        symbol: 'BTC',
        side: 'long',
        status: 'win',
        conviction: 'medium',
        strategyId: 'qa-strategy',
        tags: ['qa'],
        tradeKind: 'live',
        entry: 100,
        exit: 110,
        size: 1,
        pnl: 10,
        rMultiple: 1,
        openedAt: '2026-01-01T00:00:00.000Z',
        closedAt: '2026-01-02T00:00:00.000Z',
        note: '<p>QA seed</p>',
      },
    ],
    strategies: [
      {
        id: 'qa-strategy',
        name: 'QA 策略',
        icon: 'target',
        color: '#6366f1',
      },
    ],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: {
      hideClosed: false,
      showEmptyGroups: true,
      groupByStrategy: false,
      groupByDate: true,
      sortBy: 'date',
    },
  }
}

function snapshotWithRef(ref: string) {
  const snapshot = seedSnapshot()
  return {
    ...snapshot,
    trades: snapshot.trades.map((trade) => ({ ...trade, ref })),
  }
}

function writeProgress(message: string): void {
  const progressPath = process.env.LINEAR_JOURNAL_QA_PROGRESS
  if (!progressPath) return
  fs.appendFileSync(progressPath, `${new Date().toISOString()} ${message}\n`, 'utf8')
}

async function writeWebJournalZip(destinationFile: string, snapshot = seedSnapshot()): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(destinationFile)
    const archive = new ZipArchive({ zlib: { level: 9 } })

    output.on('close', () => resolve())
    archive.on('error', reject)
    archive.pipe(output)
    archive.append(
      JSON.stringify({
        version: SCHEMA_VERSION,
        trades: snapshot.trades,
        strategies: snapshot.strategies,
        starredIds: snapshot.starredIds,
        subscribedIds: snapshot.subscribedIds,
        pinnedStrategyIds: snapshot.pinnedStrategyIds,
        display: snapshot.display,
        assets: [],
      }),
      { name: 'data.json' },
    )
    void archive.finalize()
  })
}

export async function runElectronQa(): Promise<QaCheck[]> {
  const checks: QaCheck[] = []
  const record = (name: string, pass: boolean, detail = '') => {
    checks.push({ name, pass, detail: detail || undefined })
  }

  const storage = new LibraryStorage()
  try {
    await storage.open()
    record('storage.open', true)

    const paths = storage.getPaths()
    record('manifest.json 存在', fs.existsSync(paths.manifestFile))
    record('journal.db 存在', fs.existsSync(paths.dbFile))
    record('attachments/ 存在', fs.existsSync(paths.attachments))

    const manifest = storage.readManifest()
    record('manifest.platform=electron', manifest.platform === 'electron', manifest.platform)
    record(
      `manifest.schemaVersion=${SCHEMA_VERSION}`,
      manifest.schemaVersion === SCHEMA_VERSION,
      `v${manifest.schemaVersion}`,
    )

    let snapshot = storage.loadSnapshot()
    if (!snapshot?.trades?.length) {
      snapshot = seedSnapshot()
      storage.saveSnapshot(snapshot)
    }

    record('snapshot 含交易', (snapshot.trades?.length ?? 0) > 0, `${snapshot.trades.length} 条`)
    record('snapshot 含策略', (snapshot.strategies?.length ?? 0) > 0, `${snapshot.strategies.length} 个`)

    const processed = await processImageBuffer(pngBuf(), 'image/png')
    record('sharp 图片管线', processed.mime.startsWith('image/'), processed.mime)

    const assetId = await storage.saveAssetAsync(processed.buffer, processed.mime)
    const assetFile = path.join(paths.attachments, `${assetId}.${processed.ext}`)
    record('附件写入磁盘', fs.existsSync(assetFile), assetId)

    const zipPath = path.join(paths.root, '_qa-export.journal.zip')
    storage.saveSnapshot(snapshotWithRef('TRD-DESKTOPZIP'))
    await exportJournalZip(storage, zipPath)
    record('journal.zip 导出', fs.existsSync(zipPath), `${fs.statSync(zipPath).size} bytes`)
    storage.saveSnapshot(snapshotWithRef('TRD-AFTER-EXPORT'))
    storage.release()
    await importJournalZipToPath(paths.root, zipPath)
    await storage.open()
    const desktopZipSnapshot = storage.loadSnapshot()
    record(
      'journal.zip import accepts manifest/db archive',
      desktopZipSnapshot?.trades?.[0]?.ref === 'TRD-DESKTOPZIP',
      desktopZipSnapshot?.trades?.[0]?.ref ?? '',
    )
    fs.rmSync(zipPath, { force: true })

    storage.saveSnapshot(snapshotWithRef('TRD-BACKUP'))
    const backupPath = createBackup(storage)
    storage.saveSnapshot(snapshotWithRef('TRD-CURRENT'))
    const backupName = backupPath ? path.basename(backupPath) : ''
    record('backup.create', !!backupName, backupName)
    record('backup.restore returns true', backupName ? restoreBackup(backupName) : false)
    storage.close()
    await storage.open()
    const restoredSnapshot = storage.loadSnapshot()
    record(
      'backup.restore keeps restored db after close',
      restoredSnapshot?.trades?.[0]?.ref === 'TRD-BACKUP',
      restoredSnapshot?.trades?.[0]?.ref ?? '',
    )

    const webZipPath = path.join(paths.root, '_qa-web-export.journal.zip')
    await writeWebJournalZip(webZipPath, snapshotWithRef('TRD-WEBZIP'))
    storage.release()
    await importJournalZipToPath(paths.root, webZipPath)
    await storage.open()
    const importedSnapshot = storage.loadSnapshot()
    record(
      'journal.zip import accepts data.json archive',
      importedSnapshot?.trades?.[0]?.ref === 'TRD-WEBZIP',
      importedSnapshot?.trades?.[0]?.ref ?? '',
    )
    fs.rmSync(webZipPath, { force: true })

    const providedZipPath = process.env.LINEAR_JOURNAL_QA_IMPORT_ZIP
    if (providedZipPath) {
      writeProgress(`provided import: release storage ${providedZipPath}`)
      storage.release()
      writeProgress('provided import: start importJournalZipToPath')
      await importJournalZipToPath(paths.root, providedZipPath)
      writeProgress('provided import: importJournalZipToPath done')
      await storage.open()
      writeProgress('provided import: storage.open done')
      const providedSnapshot = storage.loadSnapshot()
      writeProgress('provided import: loadSnapshot done')
      record(
        'journal.zip import accepts provided archive',
        (providedSnapshot?.trades?.length ?? 0) > 0,
        `${providedSnapshot?.trades?.length ?? 0} trades`,
      )
    }

    // iCloud 可能把 journal.db 改名为冲突副本。缺少主文件时必须恢复已有数据，
    // 而不是静默创建空库；若只有 manifest，则必须拒绝启动写入。
    storage.saveSnapshot(snapshotWithRef('TRD-CONFLICT-RECOVERY'))
    storage.release()
    const conflictPath = path.join(paths.root, 'journal 2.db')
    fs.copyFileSync(paths.dbFile, conflictPath)
    fs.rmSync(paths.dbFile, { force: true })
    await storage.open()
    record(
      'iCloud conflict copy recovers missing journal.db',
      storage.loadSnapshot()?.trades?.[0]?.ref === 'TRD-CONFLICT-RECOVERY',
    )

    storage.release()
    fs.rmSync(conflictPath, { force: true })
    const protectedDb = fs.readFileSync(paths.dbFile)
    fs.rmSync(paths.dbFile, { force: true })
    let missingDbError = ''
    try {
      await storage.open()
    } catch (err) {
      missingDbError = String(err)
    }
    record(
      'manifest without db blocks empty-library overwrite',
      missingDbError.includes('已阻止写入空库'),
      missingDbError,
    )
    fs.writeFileSync(paths.dbFile, protectedDb)
    await storage.open()

    const rotationDir = path.join(paths.root, '_qa-backup-rotation')
    fs.mkdirSync(rotationDir, { recursive: true })
    const oldNonEmpty = 'journal-2026-01-01-00-00-00-001Z.db'
    const middleEmpty = 'journal-2026-01-02-00-00-00-001Z.db'
    const newestEmpty = 'journal-2026-01-03-00-00-00-001Z.db'
    for (const [name, tradeCount] of [
      [oldNonEmpty, 1],
      [middleEmpty, 0],
      [newestEmpty, 0],
    ] as const) {
      const dbPath = path.join(rotationDir, name)
      fs.writeFileSync(dbPath, Buffer.alloc(16))
      fs.writeFileSync(
        dbPath + '.meta.json',
        JSON.stringify({ tradeCount, strategyCount: 0, attachmentCount: 0, librarySizeBytes: 16 }),
        'utf8',
      )
    }
    rotateBackups(rotationDir, 2, 1024)
    record(
      'backup rotation preserves non-empty history before empty copies',
      fs.existsSync(path.join(rotationDir, oldNonEmpty)) &&
        fs.existsSync(path.join(rotationDir, newestEmpty)) &&
        !fs.existsSync(path.join(rotationDir, middleEmpty)),
    )
    fs.rmSync(rotationDir, { recursive: true, force: true })
  } catch (e) {
    record('主进程 QA 异常', false, String(e))
  } finally {
    storage.close()
  }

  return checks
}

export async function runElectronQaAndExit(): Promise<void> {
  const checks = await runElectronQa()
  const resultPath = process.env.LINEAR_JOURNAL_QA_RESULT
  const payload = {
    checks,
    passed: checks.filter((c) => c.pass).length,
    total: checks.length,
    libraryPath: process.env.LINEAR_JOURNAL_LIBRARY ?? '',
  }
  if (resultPath) {
    fs.mkdirSync(path.dirname(resultPath), { recursive: true })
    fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf8')
  }
  app.exit(checks.every((c) => c.pass) ? 0 : 1)
}
