import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  clearCloudSyncConfig,
  loadCloudSyncConfig,
  saveCloudSyncConfig,
} from './configFile'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const cipher = {
  encrypt: (plainText: string) => Buffer.from(`sealed:${plainText}`, 'utf8'),
  decrypt: (encrypted: Buffer) => encrypted.toString('utf8').replace(/^sealed:/, ''),
}

export function testCloudSyncConfigEncryptsTheTokenAndPreservesItAcrossOrdinaryEdits(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-sync-config-'))
  const filePath = path.join(root, 'cloud-sync.json')
  try {
    const saved = saveCloudSyncConfig(filePath, cipher, {
      enabled: false,
      baseUrl: 'https://atlas-sync.example.com',
      libraryId: 'library-1',
      localLibraryId: 'local-library-1',
      token: 'plain-secret-token',
    })
    assert(saved.token === 'plain-secret-token', '主进程保存后必须能立即使用令牌')
    const raw = fs.readFileSync(filePath, 'utf8')
    assert(!raw.includes('plain-secret-token'), '配置文件不得出现明文令牌')

    saveCloudSyncConfig(filePath, cipher, {
      enabled: true,
      baseUrl: 'https://atlas-sync.example.com',
      libraryId: 'library-1',
      localLibraryId: 'local-library-1',
    })
    const reloaded = loadCloudSyncConfig(filePath, cipher)
    assert(reloaded?.enabled === true, '普通配置修改必须持久化')
    assert(reloaded?.token === 'plain-secret-token', '未提交新令牌时必须保留旧令牌')
    assert(reloaded?.localLibraryId === 'local-library-1', '云同步连接必须绑定创建它的本地资料库')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export function testClearingCloudSyncConfigRemovesTheCredentialFile(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-sync-config-clear-'))
  const filePath = path.join(root, 'cloud-sync.json')
  try {
    saveCloudSyncConfig(filePath, cipher, {
      enabled: false,
      baseUrl: 'https://atlas-sync.example.com',
      libraryId: 'library-1',
      localLibraryId: 'local-library-1',
      token: 'plain-secret-token',
    })
    clearCloudSyncConfig(filePath)
    assert(!fs.existsSync(filePath), '清除配置后不得残留加密凭据文件')
    assert(loadCloudSyncConfig(filePath, cipher) === null, '清除后读取必须返回空配置')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export function testLegacyUnboundCloudConfigIsPausedUntilTheCurrentLibrarySavesItAgain(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-sync-config-v1-'))
  const filePath = path.join(root, 'cloud-sync.json')
  try {
    fs.writeFileSync(filePath, JSON.stringify({
      version: 1,
      enabled: true,
      baseUrl: 'https://atlas-sync.example.com',
      libraryId: 'library-1',
      encryptedToken: cipher.encrypt('legacy-token').toString('base64'),
    }), 'utf8')
    const migrated = loadCloudSyncConfig(filePath, cipher)
    assert(migrated?.enabled === false, '无法证明本地资料库归属的旧连接必须默认暂停')
    assert(migrated?.localLibraryId === '', '旧连接必须等待用户在当前资料库中重新绑定')
    assert(migrated?.token === 'legacy-token', '迁移不得丢失系统加密保存的同步令牌')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}
