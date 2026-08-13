import assert from 'node:assert/strict'
import { createToastStore } from '@/lib/toast'

export function testToastQueuePreservesErrorsAndDeduplicates(): void {
  const store = createToastStore()
  store.push('保存失败', { tone: 'error', dedupeKey: 'save' })
  store.push('链接已复制', { tone: 'success' })
  store.push('仍然失败', { tone: 'error', dedupeKey: 'save' })
  assert.deepEqual(store.getState().items.map((item) => [item.message, item.tone]), [
    ['仍然失败', 'error'],
    ['链接已复制', 'success'],
  ])
  assert.equal(store.getState().items[0]?.persistent, true)
}

export function testToastQueueCapsAtThreeAndKeepsActions(): void {
  const store = createToastStore()
  const onAction = () => undefined
  store.push('一', { tone: 'info' })
  store.push('二', { tone: 'success' })
  store.push('三', { tone: 'warning' })
  store.push('四', { tone: 'error', actionLabel: '重试', onAction })
  const state = store.getState()
  assert.equal(state.items.length, 3)
  assert.deepEqual(state.items.map((item) => item.message), ['二', '三', '四'])
  assert.equal(state.items[2]?.actionLabel, '重试')
  assert.equal(state.items[2]?.onAction, onAction)
}
