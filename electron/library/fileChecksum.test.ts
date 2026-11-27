import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sha256File } from './fileChecksum'

export function testFileChecksumMatchesOriginalBytesAcrossReads() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-checksum-'))
  const file = path.join(root, 'fixture')
  try {
    const content = Buffer.alloc(2 * 1024 * 1024 + 13)
    for (let index = 0; index < content.length; index++) content[index] = index % 251
    for (const bytes of [content.subarray(0, 0), content.subarray(4, 10), content]) {
      fs.writeFileSync(file, bytes)
      assert.equal(sha256File(file), createHash('sha256').update(bytes).digest('hex'))
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}
