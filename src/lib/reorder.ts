export function reorderByKey<T>(
  items: readonly T[],
  sourceKey: string,
  targetKey: string,
  getKey: (item: T) => string,
): T[] {
  if (sourceKey === targetKey) return [...items]
  const fromIndex = items.findIndex((item) => getKey(item) === sourceKey)
  const toIndex = items.findIndex((item) => getKey(item) === targetKey)
  if (fromIndex < 0 || toIndex < 0) return [...items]

  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}
