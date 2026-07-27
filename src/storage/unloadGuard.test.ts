import { shouldPreventAppUnload } from '@/storage/unloadGuard'

function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message) }

export function testPendingDraftAlonePreventsWindowUnload(): void {
  assert(shouldPreventAppUnload(false, true), 'drafts=1 时必须阻止 beforeunload')
  assert(!shouldPreventAppUnload(false, false), '没有持久化变化或草稿时不得误阻止')
}
