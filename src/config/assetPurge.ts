// 已发布版本只接受小写 false 作为紧急关闭值。
export function isAssetPurgeCommitEnabled(flag: string | undefined): boolean {
  return flag !== 'false'
}

export function rendererAllowsAssetPurge(): boolean {
  return isAssetPurgeCommitEnabled(import.meta.env.VITE_ENABLE_ASSET_PURGE_COMMIT)
}
