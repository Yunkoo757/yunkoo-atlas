import assert from 'node:assert/strict'
import { toast, useToast } from './toast'

function resetToast() {
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
