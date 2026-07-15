import { buildRDistribution } from '@/lib/rDistribution'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testEveryFiniteRValueEntersExactlyOneBucket(): void {
  const values = [-8, -3, -2.5, -2, -1, -0.5, -0.01, 0, 0.49, 0.5, 1, 2, 3, 5, 9.99, 10, 18]
  const distribution = buildRDistribution(values)

  assert(
    distribution.reduce((sum, bucket) => sum + bucket.count, 0) === values.length,
    'every finite R value must enter exactly one bucket',
  )
  assert(distribution[0]?.label === '< -3', 'values below -3R need their own bucket')
  assert(distribution.some((bucket) => bucket.label === '0' && bucket.count === 1), 'zero R needs an exact bucket')
  assert(distribution.at(-1)?.label === '≥ 10', 'values at or above 10R need their own bucket')
}

export function testRDistributionIgnoresNonFiniteValuesWithoutMovingBoundaries(): void {
  const distribution = buildRDistribution([Number.NaN, Number.POSITIVE_INFINITY, -3, 0, 10])

  assert(
    distribution.reduce((sum, bucket) => sum + bucket.count, 0) === 3,
    'non-finite R values must not enter analytics buckets',
  )
  assert(distribution[0]?.count === 0, '-3R belongs to the -3 to -2 bucket, not the underflow bucket')
}
