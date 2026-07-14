const SAFE_ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/

export function isSafeAssetId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ASSET_ID.test(value)
}

export function assertSafeAssetId(value: unknown): asserts value is string {
  if (!isSafeAssetId(value)) {
    throw new Error('附件 ID 格式无效')
  }
}
