import { AsyncGeneration } from '@/lib/asyncGeneration'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testAsyncGenerationInvalidatesStaleCallbacksAcrossErrorAndRetry(): void {
  const generation = new AsyncGeneration()
  let receipt: 'saving' | 'error' | 'saved' = 'saving'
  const first = generation.begin()
  generation.invalidate()
  receipt = 'error'
  assert(!generation.isCurrent(first), '错误回执必须使旧 callback 失效')
  if (generation.isCurrent(first)) receipt = 'saved'
  assert(receipt === 'error', 'error-during-flush 后迟到 success 不得覆盖 receipt')
  const retry = generation.begin()
  assert(generation.isCurrent(retry), '新退出周期必须拥有当前代次')
  if (generation.isCurrent(retry)) receipt = 'saved'
  assert(receipt === 'saved', 'retry 周期必须能够独立推进到 saved')
  const newer = generation.begin()
  assert(!generation.isCurrent(retry) && generation.isCurrent(newer), '新周期必须屏蔽旧周期迟到 success')
}
