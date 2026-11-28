import fs from 'node:fs'
import path from 'node:path'
import type { BackupVerificationResult } from '../../src/types/journalBridge'
import { writeFileAtomicallySync } from './atomicFile'

export interface BackupMeta {
  tradeCount: number
  strategyCount: number
  attachmentCount: number
  librarySizeBytes: number
  databaseSha256?: string
  manifestSha256?: string
  /** 该恢复点引用的原始附件文件；旧版元数据没有此字段。 */
  attachmentFiles?: string[]
  /** 原文件名与内容寻址仓库文件的映射。 */
  attachmentEntries?: { fileName: string; vaultName: string }[]
  verification?: BackupVerificationResult
  /** 仅退出协调器可写：源库尚未产生 snapshot，且交易、策略、附件计数均为零。 */
  emptyLibrary?: true
}

function readMetadataText(dbPath: string): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(dbPath + '.meta.json'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export function readBackupMetadata(dbPath: string): { text: string | null; value: BackupMeta | null } {
  const text = readMetadataText(dbPath)
  if (text === null) return { text, value: null }
  try {
    const value = JSON.parse(text)
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return { text, value }
  } catch { /* 保留损坏说明的原始字节。 */ }
  throw new Error('恢复点元数据损坏')
}

/** 列表和轮换允许未知统计；附件回收遇到未知引用时停止整轮回收。 */
export function tryReadBackupMeta(dbPath: string): BackupMeta | null {
  try { return readBackupMetadata(dbPath).value } catch { return null }
}

export function backupAttachmentEntries(meta: BackupMeta | null) {
  if (!meta) return undefined
  if ((meta.attachmentEntries !== undefined && !Array.isArray(meta.attachmentEntries)) ||
      (meta.attachmentFiles !== undefined && !Array.isArray(meta.attachmentFiles))) {
    throw new Error('恢复点附件清单损坏')
  }
  const entries = meta.attachmentEntries ?? meta.attachmentFiles?.map(fileName => ({ fileName, vaultName: fileName }))
  if ((entries?.length ?? 0) !== meta.attachmentCount) throw new Error('恢复点附件数量与清单不一致')
  const names = new Set<string>()
  for (const entry of entries ?? []) {
    if (!entry || !isFileName(entry.fileName) || !isFileName(entry.vaultName) || names.has(entry.fileName)) {
      throw new Error('恢复点附件清单损坏')
    }
    names.add(entry.fileName)
  }
  return entries
}

function isFileName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name !== '.' && name !== '..' &&
    path.posix.basename(name) === name && path.win32.basename(name) === name
}

export function recordBackupVerification(
  dbPath: string,
  observed: ReturnType<typeof readBackupMetadata>,
  verification: BackupVerificationResult,
): void {
  if (readMetadataText(dbPath) !== observed.text || !fs.existsSync(dbPath)) {
    throw new Error('恢复点在验证期间已变化，请重新验证')
  }
  if (!observed.value && verification.status !== 'verified') return
  const meta = observed.value ?? {
    tradeCount: verification.tradeCount,
    strategyCount: verification.strategyCount,
    attachmentCount: verification.attachmentCount,
    librarySizeBytes: fs.statSync(dbPath).size,
  }
  writeFileAtomicallySync(dbPath + '.meta.json', JSON.stringify({ ...meta, verification }), 'utf8')
}
