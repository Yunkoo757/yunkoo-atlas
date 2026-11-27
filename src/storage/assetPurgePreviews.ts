import type { AssetPurgePreview, PhysicalAssetRecord } from './adapter'
import { OperationalError } from '../lib/operationalError'

type RecoveryCheck = (submitted: AssetPurgePreview) => void
interface Entry<Context> {
  prepared: Readonly<Omit<AssetPurgePreview, 'candidateIds'> & { candidateIds: readonly string[]; context: Context }>
  recovery?: { token: string; createdAt: number; verify?: RecoveryCheck }
}

export class AssetPurgePreviews<Context> {
  private readonly entries = new Map<string, Entry<Context>>()

  create(revision: number, orphans: readonly PhysicalAssetRecord[], context: Context): AssetPurgePreview {
    const operationId = crypto.randomUUID()
    const candidateIds = orphans.map(record => record.id).sort()
    const totalBytes = orphans.reduce((sum, record) => sum + (record.actualBytes ?? 0), 0)
    this.entries.set(operationId, { prepared: { operationId, revision, candidateIds, totalBytes, context } })
    return { operationId, revision, candidateIds: [...candidateIds], totalBytes }
  }

  private requireEntry(preview: AssetPurgePreview, currentRevision?: number): Entry<Context> {
    const entry = this.entries.get(preview.operationId)
    if (!entry ||
      entry.prepared.revision !== preview.revision ||
      entry.prepared.totalBytes !== preview.totalBytes ||
      entry.prepared.candidateIds.length !== preview.candidateIds.length ||
      !entry.prepared.candidateIds.every((id, index) => id === preview.candidateIds[index])) {
      throw new OperationalError('asset-gc-stale-revision', '附件清理预览无效或已使用，请重新扫描')
    }
    if (currentRevision !== undefined && currentRevision !== entry.prepared.revision) {
      throw new OperationalError('asset-gc-stale-revision', '资料库在预览后已变化，请重新扫描附件')
    }
    return entry
  }

  read(preview: AssetPurgePreview, currentRevision?: number) {
    return this.requireEntry(preview, currentRevision).prepared
  }

  authorize(preview: AssetPurgePreview, currentRevision: number, verify?: RecoveryCheck): string {
    const entry = this.requireEntry(preview, currentRevision)
    const token = crypto.randomUUID()
    entry.recovery = { token, createdAt: Date.now(), verify }
    return token
  }

  take(preview: AssetPurgePreview, authorization?: string) {
    const entry = this.entries.get(preview.operationId)
    const recovery = entry?.recovery
    if (entry) delete entry.recovery
    if (authorization !== undefined) {
      if (!recovery || recovery.token !== authorization || Date.now() - recovery.createdAt > 15 * 60_000) {
        throw new Error('附件清理缺少与本次预览绑定的恢复归档授权')
      }
      recovery.verify?.(preview)
    }
    try { return this.read(preview) }
    finally { this.cancel(preview.operationId) }
  }

  cancel(operationId: string): void { this.entries.delete(operationId) }
  clear(): void { this.entries.clear() }
}
