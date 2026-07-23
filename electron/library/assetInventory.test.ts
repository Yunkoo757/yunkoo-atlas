import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LibraryStorage } from './storage'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function testElectronAssetInventoryCrossChecksDatabaseRowsAndAttachmentFiles(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-asset-inventory-'))
  const storage = new LibraryStorage(root)
  try {
    await storage.open()
    storage.importAsset('healthy-asset', 'image/png', Buffer.from('abc'))
    storage.importAsset('missing-asset', 'image/png', Buffer.from('missing'))
    storage.importAsset('mismatch-asset', 'image/png', Buffer.from('before'))

    const { attachments } = storage.getPaths()
    fs.rmSync(path.join(attachments, 'missing-asset.png'))
    fs.writeFileSync(path.join(attachments, 'mismatch-asset.png'), Buffer.from('after-size-changed'))
    fs.writeFileSync(path.join(attachments, 'bad name!.png'), Buffer.from('foreign'))
    fs.writeFileSync(path.join(attachments, '.prepared.stage.tmp'), Buffer.from('temp'))

    const records = storage.listAssetRecords()
    const state = (id: string) => records.find((record) => record.id === id)?.state
    assert(state('healthy-asset') === 'healthy', '数据库行与文件一致时必须为 healthy')
    assert(state('missing-asset') === 'missing', '数据库有行但文件不存在时必须为 missing')
    assert(state('mismatch-asset') === 'size-mismatch', '声明尺寸与真实文件不符时必须报告')
    assert(state('bad name!.png') === 'foreign', '无数据库行或非法命名文件必须为 foreign')
    assert(state('.prepared.stage.tmp') === 'temp', '遗留临时文件必须单独报告为 temp')
  } finally {
    storage.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
}
// Quality-Scenario: A-INVENTORY-MISSING
