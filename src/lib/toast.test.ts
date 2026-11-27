import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { createToastStore } from './toast'

export function testToastReplacesInPlaceWithoutStackingIdsOnSameCopy(): void {
  const store = createToastStore()
  store.push('已加入星标')
  const first = store.getVisible().at(-1)!
  assert.equal(first.message, '已加入星标')
  assert.equal(first.id, 1)

  store.push('已加入星标')
  const same = store.getVisible().at(-1)!
  assert.equal(same.message, '已加入星标')
  assert.equal(same.id, 1, '相同文案应只刷新计时，不递增 id，避免无意义重挂')

  store.push('已取消星标')
  const next = store.getVisible().at(-1)!
  assert.equal(next.message, '已取消星标')
  assert.equal(next.id, 2, '不同消息需要独立 id，便于按项更新和撤回')

  store.dismiss()
}

export function testToastDismissClearsVisibleMessage(): void {
  const store = createToastStore()
  store.push('链接已复制')
  store.dismiss()
  assert.equal(store.getVisible().length, 0)
  store.dismiss()
}

export function testCloseCancelledRestoresQueuedActionsAndErrors(): void {
  const store = createToastStore()
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    let undone = false
    const undo = store.push('已移入回收站', { actionLabel: '撤销', onAction: () => { undone = true } })
    const backup = store.push('备份失败', { tone: 'error' })!
    const retry = store.push('图片加载失败', { actionLabel: '重试', onAction: () => {} })
    const waiting = store.push('保存失败', { tone: 'error', dedupeKey: 'save' })
    assert.deepEqual(store.getVisible().map(item => item.id), [undo, backup, retry])

    store.setSuspended(true)
    const lateError = store.push('更新失败', { tone: 'error' })
    assert.equal(store.push('保存仍需重试', { tone: 'error', dedupeKey: 'save' }), waiting)
    assert.equal(store.push('链接已复制'), null)
    store.setSuspended(true)
    mock.timers.tick(10_000)
    assert.deepEqual(store.getVisible(), [])
    store.dismiss(backup)

    store.setSuspended(false)
    mock.timers.tick(4_999)
    store.setSuspended(false)
    const restored = store.getVisible()
    assert.deepEqual(restored.map(item => item.id), [undo, retry, waiting])
    assert.equal(restored[2].message, '保存仍需重试')
    restored[0].onAction?.()
    assert(undone, '取消关闭后原来的撤销仍须可用')
    mock.timers.tick(1)
    assert.deepEqual(store.getVisible().map(item => item.id), [waiting, lateError],
      '重新显示的操作从恢复时开始计时，重复解锁不能延长展示时间')

    store.setSuspended(true)
    store.dismiss()
    store.setSuspended(false)
    assert.deepEqual(store.getVisible(), [], '真正清除队列后不得复活旧错误')
  } finally {
    store.dismiss()
    mock.timers.reset()
  }
}

export function testBottomChromeLockSuppressesToastOverlap(): void {
  const store = createToastStore()
  store.push('备份已验证，正在重启安装更新…')
  assert.equal(store.getVisible().at(-1)?.message, '备份已验证，正在重启安装更新…')

  store.setSuspended(true)
  assert.equal(store.getVisible().length, 0, '锁定底部层必须清掉已有 toast')

  store.push('又一条通知')
  assert.equal(store.getVisible().length, 0, '锁定期间不得再弹出 toast')

  store.setSuspended(false)
  store.push('可以显示了')
  assert.equal(store.getVisible().at(-1)?.message, '可以显示了')
  store.dismiss()
}
