export function downsampleSeries<T>(
  values: readonly T[],
  maxPoints: number,
  getValue: (item: T) => number,
): T[] {
  if (values.length <= maxPoints) return [...values]
  if (maxPoints < 4) return [values[0]!, values[values.length - 1]!].slice(0, maxPoints)
  const interior = values.slice(1, -1)
  const bucketCount = Math.max(1, Math.floor((maxPoints - 2) / 2))
  const bucketSize = interior.length / bucketCount
  const selected: Array<{ index: number; item: T }> = []
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor(bucket * bucketSize)
    const end = Math.min(interior.length, Math.floor((bucket + 1) * bucketSize))
    if (end <= start) continue
    let minIndex = start
    let maxIndex = start
    for (let index = start + 1; index < end; index += 1) {
      if (getValue(interior[index]!) < getValue(interior[minIndex]!)) minIndex = index
      if (getValue(interior[index]!) > getValue(interior[maxIndex]!)) maxIndex = index
    }
    selected.push({ index: minIndex, item: interior[minIndex]! })
    if (maxIndex !== minIndex) selected.push({ index: maxIndex, item: interior[maxIndex]! })
  }
  selected.sort((a, b) => a.index - b.index)
  return [values[0]!, ...selected.slice(0, maxPoints - 2).map((value) => value.item), values[values.length - 1]!]
}
