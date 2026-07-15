import { downsampleSeries } from '@/lib/analyticsSeries'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testDownsampleSeriesPreservesBoundariesAndExtrema(): void {
  const input = Array.from({ length: 10_000 }, (_, index) => ({ index, value: Math.sin(index / 10) }))
  input[4_321]!.value = -100
  input[7_654]!.value = 100
  const result = downsampleSeries(input, 600, (item) => item.value)
  assert(result.length <= 600, 'visible series must remain within the requested cap')
  assert(result[0]?.index === 0 && result.at(-1)?.index === 9_999, 'first and last points must be preserved')
  assert(result.some((item) => item.index === 4_321) && result.some((item) => item.index === 7_654), 'local/global extrema must survive sampling')
}
