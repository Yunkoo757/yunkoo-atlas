import { randomUUID } from 'node:crypto'
import type { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PrepareJournalImportResult, PreparedJournalImportPreview, JournalBridge } from '../../src/types/journalBridge'
import { writeFileAtomicallySync } from './atomicFile'
import { importJournalZipToPath } from './journalZip'
import { capturePreparedImportSource, stagePreparedJournalArchive, type PreparedImportSource, type PreparedJournalArchiveStaging } from './preparedImportSource'
import { LibraryStorage } from './storage'

type Owner = Pick<EventEmitter, 'once' | 'removeListener'> & { id: number }
type CancelResult = Awaited<ReturnType<JournalBridge['cancelPreparedJournalImport']>>
interface Request {
  ownerId: number
  cancel(): CancelResult
}

interface PreparedImport extends PreparedJournalArchiveStaging {
  prepareRequestId: string
  source: PreparedImportSource<LibraryStorage>
  state: 'prepared' | 'committing' | 'consumed' | 'expired'
  expiresAt: number
  request: Request
  dispose(): void
  retry(): void
}

async function inspectStagedLibrary(root: string, libraryId: string) {
  const manifestFile = path.join(root, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Record<string, unknown>
  writeFileAtomicallySync(manifestFile, JSON.stringify({ ...manifest, libraryId }, null, 2), 'utf8')
  const candidate = new LibraryStorage(root, { ensureDirectories: false, allowCreate: false })
  try {
    await candidate.open()
    const snapshot = candidate.loadSnapshot()
    if (!snapshot) throw new Error('归档没有可读取的数据快照')
    const assets = candidate.listAssetRecords()
    return {
      tradeCount: snapshot.trades.length,
      strategyCount: snapshot.strategies.length,
      attachmentCount: assets.filter(asset => asset.state === 'healthy').length,
      attachmentBytes: assets.reduce((total, asset) => total + (asset.actualBytes ?? 0), 0),
    }
  } finally {
    candidate.release()
  }
}

/** 选择与检查期间由请求负责清理；发布预览后由令牌持有暂存目录，直到提交、取消或过期。 */
export class JournalImportPreviews {
  private readonly pending = new Map<string, Request>()
  private readonly prepared = new Map<string, PreparedImport>()

  constructor(private readonly ttlMs = 15 * 60 * 1000) {}

  async prepare(
    owner: Owner, requestId: string,
    selectArchive: () => Promise<string | undefined>, openStorage: () => Promise<LibraryStorage>,
  ): Promise<PrepareJournalImportResult> {
    if (typeof requestId !== 'string' || !requestId.trim()) return { ok: false, error: '检查请求无效' }
    if (this.pending.has(requestId)) return { ok: false, error: '检查请求已存在' }
    const token = randomUUID()
    let cancelled = false
    let stagingRoot: string | undefined
    let entry: PreparedImport | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    const release = () => {
      clearTimeout(timer)
      owner.removeListener('destroyed', abandon)
      owner.removeListener('render-process-gone', abandon)
      owner.removeListener('did-navigate', abandon)
      this.prepared.delete(token)
      if (stagingRoot) {
        try { fs.rmSync(stagingRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch { /* 临时目录可能正被文件系统占用。 */ }
        stagingRoot = undefined
      }
    }
    const abandon = () => {
      cancelled = true
      // 正在准备或提交时仍可能持有文件句柄，由对应操作退出后释放。
      if (entry?.state === 'prepared') release()
    }
    const request: Request = {
      ownerId: owner.id,
      cancel() {
        if (entry?.state === 'committing') return { ok: false, state: 'committing' }
        if (cancelled || entry?.state === 'consumed') return { ok: true, state: 'terminal' }
        abandon()
        return { ok: true, state: 'cancelled' }
      },
    }
    this.pending.set(requestId, request)
    owner.once('destroyed', abandon)
    owner.once('render-process-gone', abandon)
    owner.once('did-navigate', abandon)
    try {
      const selected = await selectArchive()
      if (!selected || cancelled) return { ok: false, canceled: true }
      const archive = path.resolve(selected)
      stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trader-atlas-journal-import-'))
      const staged = stagePreparedJournalArchive(archive, stagingRoot)
      const storage = await openStorage()
      if (cancelled) return { ok: false, canceled: true }
      const source = capturePreparedImportSource(storage)
      const expiresAt = Date.now() + this.ttlMs
      await importJournalZipToPath(staged.stagedLibraryRoot, staged.stagedArchivePath)
      if (cancelled) return { ok: false, canceled: true }
      const counts = await inspectStagedLibrary(staged.stagedLibraryRoot, storage.readManifest().libraryId)
      if (cancelled) return { ok: false, canceled: true }
      const preview: PreparedJournalImportPreview = {
        token, fileName: path.basename(archive), modifiedAt: staged.archiveModifiedAt, expiresAt, verification: 'verified', ...counts,
      }
      entry = {
        ...staged, source, expiresAt, request, prepareRequestId: requestId, state: 'prepared',
        dispose: release,
        retry() {
          this.state = 'prepared'
          if (cancelled || Date.now() >= expiresAt) release()
        },
      }
      this.prepared.set(token, entry)
      timer = setTimeout(abandon, Math.max(0, expiresAt - Date.now()))
      timer.unref()
      return { ok: true, preview }
    } catch (error) {
      return cancelled ? { ok: false, canceled: true } : { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      this.pending.delete(requestId)
      if (!entry) release()
    }
  }

  resolve(token: string, ownerId: number) {
    const entry = this.prepared.get(token)
    if (!entry || entry.request.ownerId !== ownerId) return null
    if (entry.state === 'prepared' && Date.now() >= entry.expiresAt) {
      entry.state = 'expired'
      entry.dispose()
    }
    return entry
  }

  cancel(tokenOrRequestId: string, ownerId: number): CancelResult {
    const request = this.prepared.get(tokenOrRequestId)?.request ?? this.pending.get(tokenOrRequestId)
    return request?.ownerId === ownerId ? request.cancel() : { ok: false, state: 'missing' }
  }

  clear() {
    for (const request of this.pending.values()) request.cancel()
    for (const entry of this.prepared.values()) entry.request.cancel()
  }
}
