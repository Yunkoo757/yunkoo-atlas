import { getStorage } from '@/storage'
import type { AssetPurgePreview } from '@/storage/adapter'
import { flushPersistNow } from '@/storage/persist'
import { buildWebJournalArchiveBlob } from '@/lib/webJournalArchiveWriter'

export interface PurgeSelection {
  preview: AssetPurgePreview
  authorization?: string
}

/** 一个弹窗拥有初次扫描及导出时重扫的预览。关闭后，迟到的扫描也归还给原来的存储实例。 */
export class AssetPurgeSession {
  private readonly storage = getStorage()
  private readonly owned = new Set<string>()
  private ended = false

  get closed() { return this.ended }

  async scan() {
    await flushPersistNow()
    if (this.ended) return null
    const preview = await this.storage.previewAssetPurge?.()
    if (!preview) throw new Error('当前存储后端不支持附件清理预览')
    this.owned.add(preview.operationId)
    if (this.ended) {
      this.cancel(preview.operationId)
      return null
    }
    return preview
  }

  async exportRecovery(displayed: AssetPurgePreview): Promise<PurgeSelection | null> {
    const candidate = await this.scan()
    if (!candidate || this.ended) return null
    let adopted = false
    try {
      const recovery = await this.storage.prepareAssetPurgeRecovery?.(candidate)
      if (!recovery || this.ended) return null
      if (recovery.webArchive) {
        const { snapshot, assets, recoveryOrphanAssetIds } = recovery.webArchive
        const blob = buildWebJournalArchiveBlob(snapshot, assets, { recoveryOrphanAssetIds })
        const anchor = document.createElement('a')
        const url = URL.createObjectURL(blob)
        try {
          anchor.href = url
          anchor.download = `trader-atlas-before-cleanup-${new Date().toISOString().slice(0, 10)}.journal.zip`
          document.body.appendChild(anchor)
          anchor.click()
        } finally {
          anchor.remove()
          URL.revokeObjectURL(url)
        }
      }
      if (displayed.operationId !== candidate.operationId) this.cancel(displayed.operationId)
      adopted = true
      return { preview: candidate, authorization: recovery.authorization }
    } finally {
      if (!adopted && candidate.operationId !== displayed.operationId) this.cancel(candidate.operationId)
    }
  }

  async commit({ preview, authorization }: PurgeSelection) {
    if (!this.storage.commitAssetPurge) throw new Error('当前存储后端不支持永久清理')
    const result = await this.storage.commitAssetPurge(preview, authorization)
    this.owned.delete(preview.operationId)
    return result
  }

  private cancel(id: string) {
    if (!this.owned.delete(id)) return
    void this.storage.cancelAssetPurge?.(id).catch(error => console.warn('[DataSettings] 撤销附件清理预览失败', error))
  }

  close() {
    this.ended = true
    for (const id of this.owned) this.cancel(id)
  }
}
