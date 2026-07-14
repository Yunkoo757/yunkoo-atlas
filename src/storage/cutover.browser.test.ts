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

  const unlock = lockStorageCutoverInteraction()
  assert(isStorageCutoverInteractionLocked(), 'cutover 必须暴露锁定状态')
  assert(document.getElementById('root')?.hasAttribute('inert'), '应用根节点必须冻结')
  assert(document.getElementById('portal')?.hasAttribute('inert'), 'body portal 也必须冻结')
  document.getElementById('root')?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
  )
  assert(shortcutRuns === 0, '切库期间全局撤销/新建快捷键不得修改 store')

  unlock()
  assert(!isStorageCutoverInteractionLocked(), 'cutover 完成后必须释放锁定状态')
  document.getElementById('root')?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
  )
  assert(shortcutRuns === 1, '释放后快捷键必须恢复')
  window.removeEventListener('keydown', shortcut)
}

declare global {
  interface Window {
    __storageCutoverTest?: Promise<void>
  }
}

window.__storageCutoverTest = run()
