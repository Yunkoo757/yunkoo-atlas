export interface SyncAsset {
  id: string
  mime: string
  bytes: Uint8Array
}

export interface RemoteAssetMetadata {
  id: string
  mime: string
  byteSize: number
  sha256: string
}

export interface AssetSyncRepository {
  listReferencedAssetIds(): Promise<string[]>
  getAsset(id: string): Promise<SyncAsset | null>
  importAsset(asset: SyncAsset): Promise<void>
}

export interface AssetSyncTransport {
  listAssets(libraryId: string, epoch: number, assetIds: string[]): Promise<RemoteAssetMetadata[]>
  uploadAsset(libraryId: string, epoch: number, asset: SyncAsset): Promise<void>
  downloadAsset(
    libraryId: string,
    epoch: number,
    metadata: RemoteAssetMetadata,
  ): Promise<SyncAsset>
}

export interface AssetSyncResult {
  uploadedCount: number
  downloadedCount: number
  missingCount: number
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes)
  const digest = await crypto.subtle.digest('SHA-256', copy)
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

export async function runAssetSyncCycle(
  repository: AssetSyncRepository,
  transport: AssetSyncTransport,
  libraryId: string,
  epoch: number,
): Promise<AssetSyncResult> {
  const assetIds = [...new Set(await repository.listReferencedAssetIds())]
  const remoteAssets: RemoteAssetMetadata[] = []
  for (let index = 0; index < assetIds.length; index += 500) {
    remoteAssets.push(...await transport.listAssets(
      libraryId,
      epoch,
      assetIds.slice(index, index + 500),
    ))
  }
  const remoteById = new Map(remoteAssets.map((asset) => [asset.id, asset]))
  let uploadedCount = 0
  let downloadedCount = 0
  let missingCount = 0

  for (const id of assetIds) {
    const local = await repository.getAsset(id)
    const remote = remoteById.get(id)
    if (local && remote) {
      const localSha256 = await sha256Hex(local.bytes)
      if (localSha256 !== remote.sha256) {
        throw new Error(`附件 ${id} 内容冲突，已停止同步且未覆盖任一端原图`)
      }
      continue
    }
    if (local) {
      await transport.uploadAsset(libraryId, epoch, local)
      uploadedCount += 1
      continue
    }
    if (remote) {
      const downloaded = await transport.downloadAsset(libraryId, epoch, remote)
      const downloadedSha256 = await sha256Hex(downloaded.bytes)
      if (
        downloaded.id !== remote.id
        || downloaded.bytes.byteLength !== remote.byteSize
        || downloadedSha256 !== remote.sha256
      ) {
        throw new Error(`附件 ${id} 下载校验失败，未写入本地资料库`)
      }
      await repository.importAsset(downloaded)
      downloadedCount += 1
      continue
    }
    missingCount += 1
  }

  return { uploadedCount, downloadedCount, missingCount }
}
