import { HttpMetadataSyncTransport } from '@/sync/httpTransport'
import { sha256Hex } from '@/sync/assetSync'
import type { SyncOutboxOperation } from '@/sync/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function pending(): SyncOutboxOperation {
  return {
    opId: 'op-1', deviceId: 'device-a', deviceSeq: 1,
    entityType: 'workspace', entityId: 'tags', kind: 'upsert',
    baseRevision: 0, revision: 1, payload: { tagPresets: ['A'] },
    createdAt: '2026-07-15T00:00:00.000Z', state: 'pending',
  }
}

export async function testHttpTransportRegistersPushesAndPullsWithoutLeakingItsToken(): Promise<void> {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const responses: unknown[] = [
    { created: true },
    { acknowledgedOperationIds: ['op-1'] },
    {
      operations: [{ ...pending(), opId: 'remote-41', deviceId: 'device-b', cursor: '41' }],
      nextCursor: '41',
      hasMore: false,
    },
  ]
  const transport = new HttpMetadataSyncTransport({
    baseUrl: 'https://atlas-sync.example.com',
    token: 'private-sync-token',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  const created = await transport.registerLibrary('library-1', 1)
  const pushed = await transport.push({
    libraryId: 'library-1', epoch: 1, deviceId: 'device-a', operations: [pending()],
  })
  const pulled = await transport.pull({
    libraryId: 'library-1', epoch: 1, deviceId: 'device-a', afterCursor: '40', limit: 500,
  })

  assert(created, '首次注册必须明确返回云端资料库已创建')
  assert(pushed.acknowledgedOperationIds.join(',') === 'op-1', '必须只移除服务端确认的 outbox')
  assert(pulled.operations[0]?.cursor === '41', '游标必须以字符串保留')
  assert(pulled.nextCursor === '41' && !pulled.hasMore, '拉取必须保留游标和分页状态')
  assert(calls[0]?.url.endsWith('/v1/libraries/register'), '注册端点错误')
  assert(calls[1]?.url.endsWith('/v1/metadata/push'), '上传端点错误')
  assert(calls[2]?.url.endsWith('/v1/metadata/pull'), '拉取端点错误')
  assert(
    new Headers(calls[0]?.init?.headers).get('authorization') === 'Bearer private-sync-token',
    '同步请求必须携带主进程保存的令牌',
  )
}

export async function testHttpTransportRedactsCredentialsFromServerErrors(): Promise<void> {
  const transport = new HttpMetadataSyncTransport({
    baseUrl: 'https://atlas-sync.example.com',
    token: 'private-sync-token',
    fetchImpl: async () => new Response('private-sync-token rejected', { status: 401 }),
  })
  let message = ''
  try {
    await transport.registerLibrary('library-1', 1)
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  assert(message.includes('401'), '错误必须保留可诊断的 HTTP 状态码')
  assert(!message.includes('private-sync-token'), '错误不得泄漏同步令牌')
}

export async function testHttpTransportChecksExistingLibrariesWithoutCreatingThem(): Promise<void> {
  let pathname = ''
  const transport = new HttpMetadataSyncTransport({
    baseUrl: 'https://atlas-sync.example.com',
    token: 'private-sync-token',
    fetchImpl: async (url) => {
      pathname = new URL(String(url)).pathname
      return new Response(JSON.stringify({ exists: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  const exists = await transport.libraryExists('library-1', 1)
  assert(!exists, '不存在的云端资料库必须返回 false')
  assert(pathname === '/v1/libraries/status', '连接新设备前只能调用无副作用的检查端点')
}

export async function testHttpTransportPreservesExactAssetBytesInBothDirections(): Promise<void> {
  const original = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255])
  const sha256 = await sha256Hex(original)
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const transport = new HttpMetadataSyncTransport({
    baseUrl: 'https://atlas-sync.example.com',
    token: 'private-sync-token',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init })
      const pathname = new URL(String(url)).pathname
      if (pathname === '/v1/assets/status') {
        return Response.json({ assets: [{
          id: 'asset-1', mime: 'image/png', byteSize: original.byteLength,
          sha256,
        }] })
      }
      if (init?.method === 'PUT') {
        return Response.json({
          created: true, id: 'asset-1', mime: 'image/png',
          byteSize: original.byteLength, sha256,
        })
      }
      return new Response(original, { headers: { 'content-type': 'image/png' } })
    },
  })

  const assets = await transport.listAssets('library-1', 1, ['asset-1'])
  await transport.uploadAsset('library-1', 1, {
    id: 'asset-1', mime: 'image/png', bytes: original,
  })
  const downloaded = await transport.downloadAsset('library-1', 1, assets[0]!)

  assert(assets[0]?.id === 'asset-1', '附件状态必须保留远端元数据')
  const uploadedBytes = new Uint8Array(await new Response(calls[1]?.init?.body).arrayBuffer())
  assert(
    uploadedBytes.every((value, index) => value === original[index]),
    '上传请求体必须保留全部原始字节',
  )
  assert(
    new Headers(calls[1]?.init?.headers).get('x-asset-sha256') === sha256,
    '附件上传必须携带本机校验和',
  )
  assert(downloaded.mime === 'image/png', '下载必须保留原始 MIME')
  assert(downloaded.bytes.every((value, index) => value === original[index]), '下载不得改变任一字节')
}

export async function testHttpTransportCanExplicitlyReplaceACloudLibraryEpoch(): Promise<void> {
  const calls: string[] = []
  const transport = new HttpMetadataSyncTransport({
    baseUrl: 'https://atlas-sync.example.com',
    token: 'private-sync-token',
    fetchImpl: async (url) => {
      const pathname = new URL(String(url)).pathname
      calls.push(pathname)
      return Response.json(pathname.endsWith('/epoch')
        ? { exists: true, epoch: 3, ready: true }
        : { reset: true, epoch: 4 })
    },
  })
  const epoch = await transport.getLibraryEpoch('library-1')
  await transport.resetLibrary('library-1', epoch!, epoch! + 1)
  assert(epoch === 3, '替换前必须读取云端权威 epoch')
  assert(calls.join(',') === '/v1/libraries/epoch,/v1/libraries/reset', '替换只能调用显式恢复端点')
}
