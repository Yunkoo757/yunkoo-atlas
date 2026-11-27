import assert from 'node:assert/strict'
import { mock } from 'node:test'
import {
  isBottomChromeLocked,
  lockBottomChrome,
  toast,
  unlockBottomChrome,
  useToast,
} from './toast'

function resetToast() {
  unlockBottomChrome()
  useToast.getState().dismiss()
  useToast.setState({ id: 0, message: null, actionLabel: null, onAction: null })
}

export function testToastReplacesInPlaceWithoutStackingIdsOnSameCopy(): void {
  resetToast()
  toast('已加入星标')
  const first = useToast.getState()
  assert.equal(first.message, '已加入星标')
  assert.equal(first.id, 1)

  toast('已加入星标')
  const same = useToast.getState()
  assert.equal(same.message, '已加入星标')
  assert.equal(same.id, 1, '相同文案应只刷新计时，不递增 id，避免无意义重挂')

  toast('已取消星标')
  const next = useToast.getState()
  assert.equal(next.message, '已取消星标')
  assert.equal(next.id, 2, '换文案必须换 id，保证面板重挂且同一时刻只有一张')

  resetToast()
}

export function testToastDismissClearsVisibleMessage(): void {
  resetToast()
  toast('链接已复制')
  useToast.getState().dismiss()
  assert.equal(useToast.getState().message, null)
  resetToast()
}

export function testCloseCancelledRestoresQueuedActionsAndErrors(): void {
  resetToast()
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    let undone = false
    const undo = toast('已移入回收站', { actionLabel: '撤销', onAction: () => { undone = true } })
    const backup = toast('备份失败', { tone: 'error' })!
    const retry = toast('图片加载失败', { actionLabel: '重试', onAction: () => {} })
    const waiting = toast('保存失败', { tone: 'error', dedupeKey: 'save' })
    assert.deepEqual(useToast.getState().items.map(item => item.id), [undo, backup, retry])

    lockBottomChrome()
    const lateError = toast('更新失败', { tone: 'error' })
    assert.equal(toast('保存仍需重试', { tone: 'error', dedupeKey: 'save' }), waiting)
    assert.equal(toast('链接已复制'), null)
    lockBottomChrome()
    mock.timers.tick(10_000)
    assert.deepEqual(useToast.getState().items, [])
    useToast.getState().dismiss(backup)

    unlockBottomChrome()
    mock.timers.tick(4_999)
    unlockBottomChrome()
    const restored = useToast.getState().items
    assert.deepEqual(restored.map(item => item.id), [undo, retry, waiting])
    assert.equal(restored[2].message, '保存仍需重试')
    restored[0].onAction?.()
    assert(undone, '取消关闭后原来的撤销仍须可用')
    mock.timers.tick(1)
    assert.deepEqual(useToast.getState().items.map(item => item.id), [waiting, lateError],
      '重新显示的操作从恢复时开始计时，重复解锁不能延长展示时间')

    lockBottomChrome()
    useToast.getState().dismiss()
    unlockBottomChrome()
    assert.deepEqual(useToast.getState().items, [], '真正清除队列后不得复活旧错误')
  } finally {
    resetToast()
    mock.timers.reset()
  }
}

export function testBottomChromeLockSuppressesToastOverlap(): void {
  resetToast()
  toast('备份已验证，正在重启安装更新…')
  assert.equal(useToast.getState().message, '备份已验证，正在重启安装更新…')

  lockBottomChrome()
  assert.equal(isBottomChromeLocked(), true)
  assert.equal(useToast.getState().message, null, '锁定底部层必须清掉已有 toast')

  toast('又一条通知')
  assert.equal(useToast.getState().message, null, '锁定期间不得再弹出 toast')

  unlockBottomChrome()
  toast('可以显示了')
  assert.equal(useToast.getState().message, '可以显示了')
  resetToast()
}
