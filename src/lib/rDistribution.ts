export interface RDistributionBucket {
  id: string
  label: string
  count: number
}

type BucketSpec = Omit<RDistributionBucket, 'count'> & {
  includes(value: number): boolean
}

const BUCKETS: readonly BucketSpec[] = [
  { id: 'under--3', label: '< -3', includes: (value) => value < -3 },
  { id: '-3--2', label: '-3 ~ -2', includes: (value) => value >= -3 && value < -2 },
  { id: '-2--1', label: '-2 ~ -1', includes: (value) => value >= -2 && value < -1 },
  { id: '-1--0.5', label: '-1 ~ -0.5', includes: (value) => value >= -1 && value < -0.5 },
  { id: '-0.5-0', label: '-0.5 ~ 0', includes: (value) => value >= -0.5 && value < 0 },
  { id: 'zero', label: '0', includes: (value) => Object.is(value, 0) || Object.is(value, -0) },
  { id: '0-0.5', label: '0 ~ 0.5', includes: (value) => value > 0 && value < 0.5 },
  { id: '0.5-1', label: '0.5 ~ 1', includes: (value) => value >= 0.5 && value < 1 },
  { id: '1-2', label: '1 ~ 2', includes: (value) => value >= 1 && value < 2 },
  { id: '2-3', label: '2 ~ 3', includes: (value) => value >= 2 && value < 3 },
  { id: '3-5', label: '3 ~ 5', includes: (value) => value >= 3 && value < 5 },
  { id: '5-10', label: '5 ~ 10', includes: (value) => value >= 5 && value < 10 },
  { id: '10-plus', label: '≥ 10', includes: (value) => value >= 10 },
]

export function buildRDistribution(values: readonly number[]): RDistributionBucket[] {
  const counts = new Array<number>(BUCKETS.length).fill(0)
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    const bucketIndex = BUCKETS.findIndex((bucket) => bucket.includes(value))
    if (bucketIndex >= 0) counts[bucketIndex] += 1
  }
  return BUCKETS.map(({ id, label }, index) => ({ id, label, count: counts[index] ?? 0 }))
}
