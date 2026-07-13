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
