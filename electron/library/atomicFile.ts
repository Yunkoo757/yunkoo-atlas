import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const WINDOWS_RENAME_RETRY_CODES = new Set(['EACCES', 'EBUSY', 'EPERM'])

type RenameRetryOptions = {
  platform?: NodeJS.Platform
  maxAttempts?: number
  rename?: (source: string, target: string) => void
  wait?: (delayMs: number) => void
}

function waitSynchronously(delayMs: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs)
}

export function renameFileWithRetrySync(
  source: string,
  target: string,
  options: RenameRetryOptions = {},
): void {
  const platform = options.platform ?? process.platform
  const maxAttempts = platform === 'win32' ? (options.maxAttempts ?? 6) : 1
  const rename = options.rename ?? fs.renameSync
  const wait = options.wait ?? waitSynchronously

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      rename(source, target)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const canRetry = platform === 'win32' && code != null && WINDOWS_RENAME_RETRY_CODES.has(code)
      if (!canRetry || attempt === maxAttempts) throw error
      wait(25 * attempt)
    }
  }
}

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
  beforeReplace?: (temporaryPath: string) => void,
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
    beforeReplace?.(temporaryPath)
    renameFileWithRetrySync(temporaryPath, filePath)
    return fsyncDirectorySync(directory)
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor)
    fs.rmSync(temporaryPath, { force: true })
  }
}
