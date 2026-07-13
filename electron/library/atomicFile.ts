import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export function writeFileAtomicallySync(
  filePath: string,
  data: string | NodeJS.ArrayBufferView,
  encoding?: BufferEncoding,
): void {
  const directory = path.dirname(filePath)
  fs.mkdirSync(directory, { recursive: true })
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  let descriptor: number | null = null

  try {
    descriptor = fs.openSync(temporaryPath, 'wx')
    if (typeof data === 'string') {
      fs.writeFileSync(descriptor, data, encoding ?? 'utf8')
    } else {
      fs.writeFileSync(descriptor, data)
    }
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = null
    fs.renameSync(temporaryPath, filePath)
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor)
    fs.rmSync(temporaryPath, { force: true })
  }
}
