function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => [key, canonicalize(record[key])]),
  )
}

export function canonicalRiskJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function canonicalJsonEqual(left: unknown, right: unknown): boolean {
  return left === right || canonicalRiskJson(left) === canonicalRiskJson(right)
}

/** 历史身份按 UTF-16 码元计算；更新编码会改变已导入交易的 ID。 */
export function stableRiskHash(value: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = (hash * prime) & mask
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`
}
