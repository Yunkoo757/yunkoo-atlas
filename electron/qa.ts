import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { LibraryStorage } from './library/storage'
import { processImageBuffer } from './library/images'
import { exportJournalZip } from './library/journalZip'

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
    record('manifest.schemaVersion=3', manifest.schemaVersion === 3, `v${manifest.schemaVersion}`)

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
    await exportJournalZip(storage, zipPath)
    record('journal.zip 导出', fs.existsSync(zipPath), `${fs.statSync(zipPath).size} bytes`)
    fs.rmSync(zipPath, { force: true })
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
