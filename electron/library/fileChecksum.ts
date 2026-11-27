import fs from 'node:fs'
import { createHash } from 'node:crypto'

export function sha256File(filePath: string): string {
  const hash = createHash('sha256')
  const descriptor = fs.openSync(filePath, 'r')
  try {
    const size = fs.fstatSync(descriptor).size
    const chunk = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(1, size)))
    let bytesRead = 0
    do {
      bytesRead = fs.readSync(descriptor, chunk, 0, chunk.length, null)
      if (bytesRead > 0) hash.update(chunk.subarray(0, bytesRead))
    } while (bytesRead > 0)
  } finally {
    fs.closeSync(descriptor)
  }
  return hash.digest('hex')
}
