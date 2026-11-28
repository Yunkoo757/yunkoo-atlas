import {
  isStorageCutoverInteractionLocked,
  lockStorageCutoverInteraction,
} from '@/storage/cutover'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

async function run(): Promise<void> {
  let shortcutRuns = 0
  const shortcut = () => { shortcutRuns += 1 }
  window.addEventListener('keydown', shortcut)

  const root = document.getElementById('root')!
  const portal = document.getElementById('portal')!
  const inRoot = root.appendChild(document.createElement('button'))
  const inPortal = portal.appendChild(document.createElement('button'))
  root.setAttribute('aria-busy', 'false')
  const unlock = lockStorageCutoverInteraction()
  const nested = lockStorageCutoverInteraction()
  assert(isStorageCutoverInteractionLocked(), 'cutover 必须暴露锁定状态')
  assert(root.getAttribute('aria-busy') === 'true', '写入期间应标记主工作区正忙')
  const latePortal = document.body.appendChild(document.createElement('button'))
  for (const button of [inRoot, inPortal, latePortal]) {
    button.focus()
    assert(document.activeElement !== button, '切库期间已打开或后来挂载的控件都不能取得焦点')
  }
  portal.inert = true
  document.getElementById('root')?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
  )
  assert(shortcutRuns === 0, '切库期间全局撤销/新建快捷键不得修改 store')

  unlock()
  unlock()
  latePortal.focus()
  assert(document.activeElement !== latePortal, '仅归还外层锁时仍需冻结')
  nested()
  latePortal.focus()
  assert(document.activeElement === latePortal, '最后释放的锁应恢复可交互状态')
  assert(portal.inert, '弹层在切库期间设置的独立冻结状态应保留')
  assert(root.getAttribute('aria-busy') === 'false', '应恢复原有忙碌标记')
  assert(!isStorageCutoverInteractionLocked(), 'cutover 完成后必须释放锁定状态')
  document.getElementById('root')?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
  )
  assert(shortcutRuns === 1, '释放后快捷键必须恢复')
  document.body.inert = true
  const previouslyInert = lockStorageCutoverInteraction()
  previouslyInert()
  assert(document.body.inert, '预先冻结的文档仍应冻结')
  document.body.inert = false
  portal.inert = false
  latePortal.remove()
  window.removeEventListener('keydown', shortcut)
}

declare global {
  interface Window {
    __storageCutoverTest?: Promise<void>
  }
}

window.__storageCutoverTest = run()
