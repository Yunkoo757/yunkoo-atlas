import assert from 'node:assert/strict'
import { createToastStore } from '@/lib/toast'

export function testToastQueuePreservesErrorsAndDeduplicates(): void {
  const store = createToastStore()
  store.push('保存失败', { tone: 'error', dedupeKey: 'save' })
  store.push('链接已复制', { tone: 'success' })
  store.push('仍然失败', { tone: 'error', dedupeKey: 'save' })
  assert.deepEqual(store.getVisible().map((item) => [item.message, item.tone]), [
    ['仍然失败', 'error'],
    ['链接已复制', 'success'],
  ])
  assert.equal(store.getVisible()[0]?.persistent, true)
}

export function testToastQueueCapsAtThreeAndKeepsActions(): void {
  const store = createToastStore()
  const onAction = () => undefined
  store.push('一', { tone: 'info' })
  store.push('二', { tone: 'success' })
  store.push('三', { tone: 'warning' })
  store.push('四', { tone: 'error', actionLabel: '重试', onAction })
  const visible = store.getVisible()
  assert.equal(visible.length, 3)
  assert.deepEqual(visible.map((item) => item.message), ['二', '三', '四'])
  assert.equal(visible[2]?.actionLabel, '重试')
  assert.equal(visible[2]?.onAction, onAction)
  const undoStore = createToastStore()
  const restored: number[] = []
  for (const id of [1, 2]) undoStore.push('已删除', { actionLabel: '撤销', onAction: () => restored.push(id) })
  for (const item of undoStore.getVisible()) item.onAction?.()
  assert.deepEqual(restored, [1, 2], '相同文案的撤销也必须对应两次独立操作')

  const held = undoStore.push('指针停留的通知')!
  undoStore.hold(held, 'pointer', true)
  const before = undoStore.getVisible().map(item => item.id)
  const pending = undoStore.push('加载失败', { tone: 'error', dedupeKey: 'load' })
  undoStore.push('重新加载失败', { tone: 'error', dedupeKey: 'load' })
  undoStore.push('已复制')
  undoStore.push('已保存')
  assert.deepEqual(undoStore.getVisible().map(item => item.id), before, '新回执不可替换撤销或鼠标正在阅读的通知')
  undoStore.dismiss(held)
  assert.equal(undoStore.getVisible().at(-1)?.id, pending, '待处理错误应在空位出现时展示')
  assert.equal(undoStore.getVisible().at(-1)?.message, '重新加载失败', '等待中的同类错误应就地更新')
  undoStore.dismiss(before[0])
  assert.equal(undoStore.getVisible().at(-1)?.message, '已保存', '积压的普通回执只展示最新一条')
  undoStore.dismiss()
  assert.deepEqual(undoStore.getVisible(), [])
}

export function testHiddenToastUpdatesPreserveTheVisibleSnapshot(): void {
  const store = createToastStore()
  for (const key of ['第一条', '第二条', '第三条']) store.push(key, { tone: 'error' })
  const before = store.getVisible()
  let notifications = 0
  const unsubscribe = store.subscribe(() => { notifications++ })
  try {
    const waiting = store.push('等待', { tone: 'error', dedupeKey: 'hidden' })
    assert.equal(store.push('更新等待项', { tone: 'error', dedupeKey: 'hidden' }), waiting)
    assert.equal(store.getVisible(), before, '只修改等待项时应保留同一份可见快照')
    assert.equal(notifications, 0)
    store.dismiss(before[0].id)
    assert.equal(notifications, 1)
    assert.deepEqual(store.getVisible().map(item => item.message), ['第二条', '第三条', '更新等待项'])
    store.setSuspended(true)
    const hidden = store.getVisible()
    store.dismiss(waiting!)
    assert.equal(store.getVisible(), hidden)
    assert.equal(notifications, 2, '挂起期间撤回等待项不应唤醒可见层')
  } finally {
    unsubscribe()
    store.dismiss()
  }
}
