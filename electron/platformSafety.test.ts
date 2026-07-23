import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { decodeCanonicalSnapshot } from '../src/storage/snapshotCodec'
import {
  createBackupAtPath,
  verifyBackupAtPath,
} from './library/backup'
import { resolveLibraryLocation } from './library/libraryLocation'
import { LibraryStorage } from './library/storage'
import { QuitCoordinator } from './quitCoordinator'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function inspectRealPath(filePath: string): 'missing' | 'file' | 'directory' {
  try {
    const stat = fs.statSync(filePath)
    return stat.isDirectory() ? 'directory' : 'file'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    throw error
  }
}

export async function testPlatformPathFileFailsClosedWithoutCreatingDefaultLibrary(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-platform-path-'))
  const configPath = path.join(root, 'library-config.json')
  const configuredFile = path.join(root, 'not-a-library-directory')
  const defaultPath = path.join(root, 'must-not-be-created')
  fs.writeFileSync(configuredFile, 'not a directory', 'utf8')
  fs.writeFileSync(configPath, JSON.stringify({ libraryPath: configuredFile }), 'utf8')
  try {
    const state = await resolveLibraryLocation({
      configPath,
      defaultPath,
      readTextFile: (filePath) => fs.readFileSync(filePath, 'utf8'),
      inspectPath: inspectRealPath,
      assertReadableWritable: (filePath) => fs.accessSync(filePath, fs.constants.R_OK | fs.constants.W_OK),
      validateExistingLibrary: async () => {
        throw new Error('目标是文件时不应进入资料库校验')
      },
    })
    assert(state.kind === 'invalid', '真实平台文件目标必须 fail-closed 为 invalid')
    assert(state.configuredPath === configuredFile, '错误必须保留用户配置的真实路径')
    assert(!fs.existsSync(defaultPath), '失败后不得创建默认 manifest、DB 或目录')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testPlatformBackupVerificationFailureKeepsStorageAndRestorePointUsable(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-platform-backup-'))
  const storage = new LibraryStorage(root)
  await storage.open()
  storage.saveSnapshot(decodeCanonicalSnapshot({}, { version: 1 }))
  const previous = createBackupAtPath(storage, root, Date.UTC(2026, 6, 23, 0, 0, 0))
  assert(previous, '必须先建立一个可验证恢复点')
  assert((await verifyBackupAtPath(root, path.basename(previous))).status === 'verified', '前一恢复点必须可恢复')

  let commitCalled = false
  const errors: string[] = []
  const coordinator = new QuitCoordinator({
    timeoutMs: 10_000,
    createRequestId: () => 'platform-backup-failure',
    requestRendererFlush: async () => {},
    createVerifiedBackup: async () => {
      const candidate = createBackupAtPath(storage, root, Date.UTC(2026, 6, 23, 0, 1, 0))
      assert(candidate, '候选恢复点必须真实写入磁盘')
      fs.appendFileSync(candidate, Buffer.from('tampered-after-write'))
      const verification = await verifyBackupAtPath(root, path.basename(candidate))
      if (verification.status !== 'verified') throw new Error('backup verification failed')
    },
    commitExit: async () => { commitCalled = true },
    cancelPreparation: () => {},
    reportError: (failure) => errors.push(`${failure.code}:${failure.message}`),
  })
  try {
    const result = await coordinator.request('quit')
    assert(!result.ok, '恢复点校验失败必须取消退出')
    assert(!commitCalled, '恢复点校验失败不得 release 或 finalize')
    assert(errors.some((message) => message.includes('backup verification failed')), '必须报告真实失败阶段')
    assert(storage.loadSnapshot() !== null, '取消退出后当前 storage 必须继续可读写')
    assert((await verifyBackupAtPath(root, path.basename(previous))).status === 'verified', '已有恢复点必须仍可验证恢复')
  } finally {
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

// Quality-Scenario: E-PATH-PERM
// Quality-Scenario: E-QUIT-BACKUP-FAIL
