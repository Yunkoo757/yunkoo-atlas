import type {
  MetadataSyncPullRequest,
  MetadataSyncPushRequest,
  MetadataSyncTransport,
} from '@/sync/metadataSync'
import type { RemoteSyncOperation, SyncEntityType, SyncOperationKind } from '@/sync/types'
import {
  sha256Hex,
  type AssetSyncTransport,
  type RemoteAssetMetadata,
  type SyncAsset,
} from '@/sync/assetSync'

interface HttpTransportConfig {
  baseUrl: string
  token: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  assetTimeoutMs?: number
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`云同步响应 ${label} 格式无效`)
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`云同步响应缺少 ${field}`)
  }
  return value
}

function requiredInteger(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`云同步响应字段 ${field} 无效`)
  }
  return parsed
}

function redact(message: string, secret: string): string {
  return message.split(secret).join('[credential]')
}

export class HttpMetadataSyncTransport implements MetadataSyncTransport, AssetSyncTransport {
  private readonly baseUrl: string
  private readonly token: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly assetTimeoutMs: number

  constructor(config: HttpTransportConfig) {
    const url = new URL(config.baseUrl)
    const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol !== 'https:' && !(localhost && url.protocol === 'http:')) {
      throw new Error('云同步地址必须使用 HTTPS')
    }
    if (!config.token.trim()) throw new Error('云同步令牌不能为空')
    this.baseUrl = url.href.replace(/\/$/, '')
    this.token = config.token.trim()
    this.fetchImpl = config.fetchImpl ?? fetch
    this.timeoutMs = config.timeoutMs ?? 15_000
    this.assetTimeoutMs = config.assetTimeoutMs ?? 120_000
  }

  private async perform<T>(
    pathname: string,
    init: RequestInit,
    consume: (response: Response) => Promise<T>,
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...init.headers,
        },
        signal: controller.signal,
      })
      if (!response.ok) {
        const raw = (await response.text()).slice(0, 500)
        const safe = redact(raw, this.token)
        throw new Error(`云同步请求失败（${response.status}）：${safe || '无响应内容'}`)
      }
      return await consume(response)
    } catch (error) {
      if (controller.signal.aborted) throw new Error('云同步请求超时，请检查网络后重试')
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(redact(message, this.token))
    } finally {
      globalThis.clearTimeout(timeout)
    }
  }

  private async request(pathname: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.perform(pathname, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, async (response) => record(await response.json(), '内容'))
  }

  async registerLibrary(libraryId: string, epoch: number): Promise<boolean> {
    const result = await this.request('/v1/libraries/register', { libraryId, epoch })
    if (typeof result.created !== 'boolean') throw new Error('云同步资料库注册响应格式无效')
    return result.created
  }

  async libraryExists(libraryId: string, epoch: number): Promise<boolean> {
    const result = await this.request('/v1/libraries/status', { libraryId, epoch })
    if (typeof result.exists !== 'boolean') throw new Error('云同步资料库检查响应格式无效')
    return result.exists
  }

  async getLibraryState(libraryId: string): Promise<{ epoch: number; ready: boolean } | null> {
    const result = await this.request('/v1/libraries/epoch', { libraryId, epoch: 0 })
    if (typeof result.exists !== 'boolean') throw new Error('云同步资料库 epoch 响应格式无效')
    if (!result.exists) return null
    if (typeof result.ready !== 'boolean') throw new Error('云同步资料库就绪状态无效')
    return { epoch: requiredInteger(result.epoch, 'epoch'), ready: result.ready }
  }

  async getLibraryEpoch(libraryId: string): Promise<number | null> {
    return (await this.getLibraryState(libraryId))?.epoch ?? null
  }

  async resetLibrary(libraryId: string, epoch: number, nextEpoch: number): Promise<void> {
    const result = await this.request('/v1/libraries/reset', {
      libraryId,
      epoch,
      nextEpoch,
      confirm: 'replace',
    })
    if (requiredInteger(result.epoch, 'epoch') !== nextEpoch) {
      throw new Error('云同步资料库重建后的 epoch 不一致')
    }
  }

  async finalizeLibrary(libraryId: string, epoch: number): Promise<void> {
    const result = await this.request('/v1/libraries/finalize', { libraryId, epoch })
    if (result.ready !== true || requiredInteger(result.epoch, 'epoch') !== epoch) {
      throw new Error('云同步资料库未能完成重建')
    }
  }

  async push(request: MetadataSyncPushRequest): Promise<{ acknowledgedOperationIds: string[] }> {
    const result = await this.request('/v1/metadata/push', { ...request })
    if (
      !Array.isArray(result.acknowledgedOperationIds)
      || result.acknowledgedOperationIds.some((operationId) => typeof operationId !== 'string')
    ) {
      throw new Error('云同步上传响应格式无效')
    }
    return { acknowledgedOperationIds: result.acknowledgedOperationIds as string[] }
  }

  async pull(request: MetadataSyncPullRequest): Promise<{
    operations: RemoteSyncOperation[]
    nextCursor: string
    hasMore: boolean
  }> {
    const result = await this.request('/v1/metadata/pull', { ...request })
    if (!Array.isArray(result.operations)) throw new Error('云同步拉取响应格式无效')
    const operations = result.operations.map((value): RemoteSyncOperation => {
      const operation = record(value, 'operation')
      return {
        cursor: requiredString(operation.cursor, 'operation.cursor'),
        opId: requiredString(operation.opId, 'operation.opId'),
        deviceId: requiredString(operation.deviceId, 'operation.deviceId'),
        deviceSeq: requiredInteger(operation.deviceSeq, 'operation.deviceSeq'),
        entityType: requiredString(operation.entityType, 'operation.entityType') as SyncEntityType,
        entityId: requiredString(operation.entityId, 'operation.entityId'),
        kind: requiredString(operation.kind, 'operation.kind') as SyncOperationKind,
        baseRevision: requiredInteger(operation.baseRevision, 'operation.baseRevision'),
        revision: requiredInteger(operation.revision, 'operation.revision'),
        payload: operation.payload ?? null,
        createdAt: requiredString(operation.createdAt, 'operation.createdAt'),
        state: 'pending',
      }
    })
    if (typeof result.hasMore !== 'boolean') throw new Error('云同步响应缺少 hasMore')
    return {
      operations,
      nextCursor: requiredString(result.nextCursor, 'nextCursor'),
      hasMore: result.hasMore,
    }
  }

  async listAssets(
    libraryId: string,
    epoch: number,
    assetIds: string[],
  ): Promise<RemoteAssetMetadata[]> {
    const result = await this.request('/v1/assets/status', { libraryId, epoch, assetIds })
    if (!Array.isArray(result.assets)) throw new Error('云同步附件状态响应格式无效')
    return result.assets.map((value): RemoteAssetMetadata => {
      const asset = record(value, 'asset')
      const sha256 = requiredString(asset.sha256, 'asset.sha256')
      if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('云同步附件校验和无效')
      return {
        id: requiredString(asset.id, 'asset.id'),
        mime: requiredString(asset.mime, 'asset.mime'),
        byteSize: requiredInteger(asset.byteSize, 'asset.byteSize'),
        sha256,
      }
    })
  }

  private assetPath(libraryId: string, epoch: number, assetId: string): string {
    const search = new URLSearchParams({ libraryId, epoch: String(epoch) })
    return `/v1/assets/${encodeURIComponent(assetId)}?${search}`
  }

  async uploadAsset(libraryId: string, epoch: number, asset: SyncAsset): Promise<void> {
    const sha256 = await sha256Hex(asset.bytes)
    await this.perform(this.assetPath(libraryId, epoch, asset.id), {
      method: 'PUT',
      headers: {
        'content-type': asset.mime,
        'x-asset-sha256': sha256,
      },
      body: Uint8Array.from(asset.bytes).buffer,
    }, async (response) => {
      const result = record(await response.json(), 'asset')
      if (requiredString(result.id, 'asset.id') !== asset.id) {
        throw new Error('云同步附件上传响应 ID 不一致')
      }
    }, this.assetTimeoutMs)
  }

  async downloadAsset(
    libraryId: string,
    epoch: number,
    metadata: RemoteAssetMetadata,
  ): Promise<SyncAsset> {
    return this.perform(
      this.assetPath(libraryId, epoch, metadata.id),
      { method: 'GET' },
      async (response) => ({
        id: metadata.id,
        mime: response.headers.get('content-type') || metadata.mime,
        bytes: new Uint8Array(await response.arrayBuffer()),
      }),
      this.assetTimeoutMs,
    )
  }
}
