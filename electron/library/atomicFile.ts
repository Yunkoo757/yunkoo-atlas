import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * 返回平台是否提供了真实的目录 durability barrier。
 * Node 在 Windows 上无法用 fsync 刷新目录句柄；调用方必须采用不依赖
 * rename 排序的数据安全协议，不能把普通文件 fsync 冒充目录屏障。
 */
export function fsyncDirectorySync(directory: string): boolean {
  if (process.platform !== 'win32') {
    const descriptor = fs.openSync(directory, 'r')
    try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
    return true
  }
  return false
}

export function writeFileAtomicallySync(
  filePath: string,
  data: string | NodeJS.ArrayBufferView,
  encoding?: BufferEncoding,
): boolean {
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
    return fsyncDirectorySync(directory)
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor)
    fs.rmSync(temporaryPath, { force: true })
  }
}
