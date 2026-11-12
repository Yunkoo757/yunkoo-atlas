import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LibraryStorage } from './storage'
import { createEmptyPersistedSnapshot } from '../../src/storage/emptySnapshot'

async function library(run: (storage: LibraryStorage, root: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-attachment-scan-test-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    await storage.commitImport(createEmptyPersistedSnapshot(), Array.from({ length: 32 }, (_, i) => ({
      id: `scan-${i}`, mime: 'image/png', buffer: Buffer.from(`synthetic-${i}`),
    })))
    run(storage, root)
  } finally { storage.close(); fs.rmSync(root, { recursive: true, force: true }) }
}

export async function testCommittedAttachmentInventoryScansTheDirectoryTwiceRegardlessOfAssetCount() {
  await library((storage, root) => {
    const original = fs.readdirSync
    let scans = 0
    try {
      fs.readdirSync = ((directory: fs.PathLike, ...args: unknown[]) => {
        if (String(directory) === path.join(root, 'attachments')) scans++
        return (original as (...args: unknown[]) => unknown)(directory, ...args)
      }) as typeof fs.readdirSync
      const rows = storage.listCommittedAttachmentFiles()
      assert.equal(rows.length, 32)
      assert.equal(scans, 2, '目录应一次建索引、一次确认未变化，而不是每张图重扫')
    } finally { fs.readdirSync = original }
  })
}

export async function testBatchAttachmentInspectionStillRejectsPortableNameCollisionsAndMissingFiles() {
  await library((storage, root) => {
    const collision = path.join(root, 'attachments', 'SCAN-0.jpg')
    fs.writeFileSync(collision, 'synthetic collision')
    assert.throws(() => storage.listCommittedAttachmentFiles(), /多个物理文件|冲突/)
    fs.rmSync(collision)
    fs.rmSync(path.join(root, 'attachments', 'scan-0.png'))
    assert.throws(() => storage.listCommittedAttachmentFiles(), /缺失/)
  })
}

export async function testBatchAttachmentInspectionRejectsDirectoryChangesDuringInspection() {
  await library((storage, root) => {
    const original = fs.readdirSync
    let scans = 0
    try {
      fs.readdirSync = ((directory: fs.PathLike, ...args: unknown[]) => {
        if (String(directory) === path.join(root, 'attachments') && ++scans === 2) {
          fs.writeFileSync(path.join(root, 'attachments', 'SCAN-0.jpg'), 'late synthetic collision')
        }
        return (original as (...args: unknown[]) => unknown)(directory, ...args)
      }) as typeof fs.readdirSync
      assert.throws(() => storage.listCommittedAttachmentFiles(), /目录.*变化|多个物理文件|冲突/)
    } finally { fs.readdirSync = original }
  })
}
