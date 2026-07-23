import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeFileAtomicallySync } from './atomicFile'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testAtomicWriteReplacesTheCompleteFileAndCleansTemporaryData(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-atomic-write-'))
  const target = path.join(root, 'journal.db')
  try {
    fs.writeFileSync(target, 'old-database')
    const replacement = Buffer.alloc(256 * 1024, 7)
    writeFileAtomicallySync(target, replacement)

    assert(fs.readFileSync(target).equals(replacement), '原子替换后必须得到完整的新文件')
    assert(
      fs.readdirSync(root).every((name) => !name.endsWith('.tmp')),
      '成功或失败后不得遗留临时数据库文件',
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export function testAtomicFileHookRunsAfterDurableTempAndBeforeReplace(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-atomic-hook-'))
  const target = path.join(root, 'journal.db')
  fs.writeFileSync(target, 'confirmed', 'utf8')
  try {
    let observedTemporaryPath = ''
    writeFileAtomicallySync(target, Buffer.from('pending'), undefined, (temporaryPath) => {
      observedTemporaryPath = temporaryPath
      if (!fs.existsSync(temporaryPath)) throw new Error('原子临时文件尚不存在')
      if (fs.readFileSync(temporaryPath, 'utf8') !== 'pending') throw new Error('原子临时文件内容未写完')
      if (fs.readFileSync(target, 'utf8') !== 'confirmed') throw new Error('beforeReplace 前目标文件已被替换')
    })
    if (!observedTemporaryPath) throw new Error('beforeReplace 钩子未执行')
    if (fs.readFileSync(target, 'utf8') !== 'pending') throw new Error('钩子返回后未完成原子替换')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}
