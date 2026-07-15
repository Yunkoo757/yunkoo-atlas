import {
  runAssetSyncCycle,
  sha256Hex,
  type AssetSyncRepository,
  type AssetSyncTransport,
  type SyncAsset,
} from '@/sync/assetSync'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function createHarness(input: {
  local?: SyncAsset
  remote?: SyncAsset
}): {
  repository: AssetSyncRepository
  transport: AssetSyncTransport
  uploads: SyncAsset[]
  imports: SyncAsset[]
} {
  const uploads: SyncAsset[] = []
  const imports: SyncAsset[] = []
  const repository: AssetSyncRepository = {
    listReferencedAssetIds: async () => ['asset-1'],
    getAsset: async () => input.local ?? null,
    importAsset: async (asset) => { imports.push(asset) },
  }
  const transport: AssetSyncTransport = {
    listAssets: async () => input.remote ? [{
      id: input.remote.id,
      mime: input.remote.mime,
      byteSize: input.remote.bytes.byteLength,
      sha256: await sha256Hex(input.remote.bytes),
    }] : [],
    uploadAsset: async (_libraryId, _epoch, asset) => { uploads.push(asset) },
    downloadAsset: async () => {
      if (!input.remote) throw new Error('remote asset missing')
      return input.remote
    },
  }
  return { repository, transport, uploads, imports }
}

export async function testAssetSyncUploadsOriginalLocalBytesWhenCloudIsMissing(): Promise<void> {
  const local = { id: 'asset-1', mime: 'image/png', bytes: new Uint8Array([0, 1, 255, 4]) }
  const harness = createHarness({ local })
  const result = await runAssetSyncCycle(harness.repository, harness.transport, 'library-1', 1)
  assert(result.uploadedCount === 1 && result.downloadedCount === 0, '本机原图必须补传到云端')
  assert(harness.uploads[0]?.bytes === local.bytes, '上传过程不得转码或复制成有损内容')
}

export async function testAssetSyncDownloadsEveryReferencedCloudAssetForOfflineUse(): Promise<void> {
  const remote = { id: 'asset-1', mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) }
  const harness = createHarness({ remote })
  const result = await runAssetSyncCycle(harness.repository, harness.transport, 'library-1', 1)
  assert(result.downloadedCount === 1 && result.missingCount === 0, '云端原图必须下载到本机离线库')
  assert(harness.imports[0]?.bytes === remote.bytes, '离线导入必须保留下载到的原始字节')
}

export async function testAssetSyncNeverOverwritesSameIdWithDifferentBytes(): Promise<void> {
  const local = { id: 'asset-1', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }
  const remote = { id: 'asset-1', mime: 'image/png', bytes: new Uint8Array([4, 5, 6]) }
  const harness = createHarness({ local, remote })
  let message = ''
  try {
    await runAssetSyncCycle(harness.repository, harness.transport, 'library-1', 1)
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  assert(message.includes('asset-1') && message.includes('冲突'), '不同原图必须形成显式冲突')
  assert(harness.uploads.length === 0 && harness.imports.length === 0, '冲突不得覆盖任一端内容')
}
