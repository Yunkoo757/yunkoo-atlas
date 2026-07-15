import fs from 'node:fs'
import path from 'node:path'
import { writeFileAtomicallySync } from '../library/atomicFile'

export interface CloudSyncCredentialCipher {
  encrypt(plainText: string): Buffer
  decrypt(encrypted: Buffer): string
}

export interface CloudSyncRuntimeConfig {
  enabled: boolean
  baseUrl: string
  libraryId: string
  localLibraryId: string
  token: string
}

interface SaveCloudSyncRuntimeConfig {
  enabled: boolean
  baseUrl: string
  libraryId: string
  localLibraryId: string
  token?: string
}

interface StoredCloudSyncConfig {
  version: 1 | 2
  enabled: boolean
  baseUrl: string
  libraryId: string
  localLibraryId?: string
  encryptedToken: string
}

function normalizedText(value: string, label: string): string {
  const result = value.trim()
  if (!result) throw new Error(`${label}不能为空`)
  return result
}

export function loadCloudSyncConfig(
  filePath: string,
  cipher: CloudSyncCredentialCipher,
): CloudSyncRuntimeConfig | null {
  if (!fs.existsSync(filePath)) return null
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<StoredCloudSyncConfig>
  if (
    (payload.version !== 1 && payload.version !== 2)
    || typeof payload.enabled !== 'boolean'
    || typeof payload.baseUrl !== 'string'
    || typeof payload.libraryId !== 'string'
    || (payload.version === 2 && typeof payload.localLibraryId !== 'string')
    || typeof payload.encryptedToken !== 'string'
  ) throw new Error('云同步配置文件格式无效')
  const token = cipher.decrypt(Buffer.from(payload.encryptedToken, 'base64')).trim()
  if (!token) throw new Error('云同步令牌解密后为空')
  return {
    enabled: payload.version === 2 ? payload.enabled : false,
    baseUrl: normalizedText(payload.baseUrl, '云同步地址'),
    libraryId: normalizedText(payload.libraryId, '云端资料库 ID'),
    localLibraryId: payload.version === 2
      ? normalizedText(payload.localLibraryId!, '本地资料库 ID')
      : '',
    token,
  }
}

export function saveCloudSyncConfig(
  filePath: string,
  cipher: CloudSyncCredentialCipher,
  input: SaveCloudSyncRuntimeConfig,
): CloudSyncRuntimeConfig {
  const previous = loadCloudSyncConfig(filePath, cipher)
  const token = input.token === undefined
    ? previous?.token ?? ''
    : input.token.trim()
  if (!token) throw new Error('云同步令牌不能为空')
  const config: CloudSyncRuntimeConfig = {
    enabled: input.enabled,
    baseUrl: normalizedText(input.baseUrl, '云同步地址'),
    libraryId: normalizedText(input.libraryId, '云端资料库 ID'),
    localLibraryId: normalizedText(input.localLibraryId, '本地资料库 ID'),
    token,
  }
  const stored: StoredCloudSyncConfig = {
    version: 2,
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    libraryId: config.libraryId,
    localLibraryId: config.localLibraryId,
    encryptedToken: cipher.encrypt(config.token).toString('base64'),
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileAtomicallySync(filePath, JSON.stringify(stored), 'utf8')
  if (process.platform !== 'win32') fs.chmodSync(filePath, 0o600)
  return config
}

export function clearCloudSyncConfig(filePath: string): void {
  fs.rmSync(filePath, { force: true })
}
