export const SNAPSHOT_REVISION_KEY = 'snapshotRevision'

/** 旧库可能没有修订键；已写入的修订必须能精确比较。 */
export function decodeSnapshotRevision(values: readonly unknown[]): number {
  if (values.length === 0) return 0
  const value = values[0]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('资料库的 snapshotRevision 无效')
  }
  return value
}

export function nextSnapshotRevision(current: number): number {
  if (current === Number.MAX_SAFE_INTEGER) throw new Error('资料库的 snapshotRevision 已达上限')
  return current + 1
}
