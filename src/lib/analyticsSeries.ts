export function downsampleSeries<T>(
  values: readonly T[],
  maxPoints: number,
  getValue: (item: T) => number,
): T[] {
  return downsampleIndices(values.length, maxPoints, (index) => getValue(values[index]!))
    .map((index) => values[index]!)
}

export function downsampleIndices(
  length: number,
  maxPoints: number,
  getValue: (index: number) => number,
): number[] {
  if (length <= 0 || maxPoints <= 0) return []
  if (length <= maxPoints) return Array.from({ length }, (_, index) => index)
  if (maxPoints < 4) return [0, length - 1].slice(0, maxPoints)
  const interiorLength = length - 2
  const bucketCount = Math.max(1, Math.floor((maxPoints - 2) / 2))
  const bucketSize = interiorLength / bucketCount
  const selected: number[] = []
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = 1 + Math.floor(bucket * bucketSize)
    const end = 1 + Math.min(interiorLength, Math.floor((bucket + 1) * bucketSize))
    if (end <= start) continue
    let minIndex = start
    let maxIndex = start
    for (let index = start + 1; index < end; index += 1) {
      if (getValue(index) < getValue(minIndex)) minIndex = index
      if (getValue(index) > getValue(maxIndex)) maxIndex = index
    }
    selected.push(minIndex)
    if (maxIndex !== minIndex) selected.push(maxIndex)
  }
  selected.sort((a, b) => a - b)
  return [0, ...selected.slice(0, maxPoints - 2), length - 1]
}
