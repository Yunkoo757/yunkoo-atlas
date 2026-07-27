import { AsyncGeneration } from '@/lib/asyncGeneration'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testAsyncGenerationInvalidatesStaleCallbacksAcrossErrorAndRetry(): void {
  const generation = new AsyncGeneration()
  const first = generation.begin()
  generation.invalidate()
  assert(!generation.isCurrent(first), '错误回执必须使旧 callback 失效')
  const retry = generation.begin()
  assert(generation.isCurrent(retry), '新退出周期必须拥有当前代次')
  const newer = generation.begin()
  assert(!generation.isCurrent(retry) && generation.isCurrent(newer), '新周期必须屏蔽旧周期迟到 success')
}
