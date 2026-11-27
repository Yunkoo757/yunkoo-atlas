import { createRoot } from 'react-dom/client'
import { ProfileSettingsPanel } from './ProfileSettingsPanel'
import { replaceLibraryInStore } from '@/lib/snapshotStore'
import { createEmptyPersistedSnapshot } from '@/storage/emptySnapshot'
import { disablePersistWrites, enablePersistWrites, setPreFlushCallback } from '@/storage/persist'
import { useStore } from '@/store/useStore'

declare global {
  interface Window { __profileSettingsOwnershipTest?: Promise<void> }
}

async function waitFor(check: () => boolean): Promise<void> {
  const end = performance.now() + 3000
  while (!check()) {
    if (performance.now() > end) throw new Error('资料设置未进入预期状态')
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }
}

async function run(): Promise<void> {
  const root = createRoot(document.getElementById('root')!)
  const original = useStore.getState()
  let fail!: (reason: Error) => void
  let started = false
  try {
    const snap = createEmptyPersistedSnapshot()
    snap.profile = { avatarId: 'mint', displayName: '原资料', legacyCashCurrencyAssumption: null }
    replaceLibraryInStore(snap)
    enablePersistWrites()
    setPreFlushCallback(() => {
      started = true
      return new Promise<void>((_, reject) => { fail = reject })
    })
    root.render(<ProfileSettingsPanel />)
    const input = () => document.querySelector<HTMLInputElement>('[aria-label="显示名称"]')
    await waitFor(() => input()?.value === '原资料')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), '同名用户')
    input()!.dispatchEvent(new Event('input', { bubbles: true }))
    const save = () => document.querySelector<HTMLButtonElement>('.profile-name-row button')
    await waitFor(() => save()?.disabled === false)
    save()!.click()
    await waitFor(() => started)
    replaceLibraryInStore({ ...snap, profile: { ...snap.profile, displayName: '同名用户' } })
    setPreFlushCallback(async () => { throw new Error('旧库回滚不应提交') })
    fail(new Error('隔离测试的旧保存失败'))
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    if (useStore.getState().profile.displayName !== '同名用户') throw new Error('旧保存失败回滚了新资料库的同名用户')
    if (input()?.value !== '同名用户' || save()?.textContent?.trim() !== '保存') throw new Error('新资料库仍携带旧保存状态')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), '未提交草稿')
    input()!.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => save()?.disabled === false)
    replaceLibraryInStore(snap)
    await waitFor(() => input()?.value === '原资料')
  } finally {
    disablePersistWrites()
    setPreFlushCallback(null)
    root.unmount()
    useStore.setState(original)
  }
}

window.__profileSettingsOwnershipTest = run()
