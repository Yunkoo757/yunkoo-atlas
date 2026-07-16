import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { SaveStatusIndicator } from '@/components/SaveStatusIndicator'
import { getStorage } from '@/storage'
import {
  disablePersistWrites,
  enablePersistWrites,
  pickPersisted,
  schedulePersist,
  setPreFlushCallback,
} from '@/storage/persist'
import { useSaveStatus } from '@/store/saveStatus'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'

declare global {
  interface Window {
    __saveStatusRecoveryTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5000
  while (performance.now() < deadline) {
    if (condition()) return
    await waitForFrame()
  }
  throw new Error(message)
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const storage = getStorage()
  const originalSaveSnapshot = storage.saveSnapshot.bind(storage)
  const root = createRoot(rootElement)

  disablePersistWrites()
  setPreFlushCallback(null)
  useSaveStatus.getState().reset()
  storage.saveSnapshot = async () => {}

  try {
    enablePersistWrites()
    schedulePersist(pickPersisted(useStore.getState(), useShortcutStore.getState().bindings))
    useSaveStatus.getState().setError(new Error('disk full'))
    root.render(
      <MemoryRouter>
        <SaveStatusIndicator />
      </MemoryRouter>,
    )

    await waitFor(
      () => Boolean(document.querySelector('button[aria-label*="disk full"]')),
      '保存失败状态没有呈现具体原因与重试操作',
    )
    const retry = document.querySelector<HTMLButtonElement>('button[aria-label*="disk full"]')
    const recovery = document.querySelector<HTMLAnchorElement>('a[href="/settings/data"]')
    assert(retry, '保存失败后必须提供一键重试')
    assert(retry.textContent?.includes('重试'), '保存失败后必须提供一键重试')
    assert(recovery?.textContent?.includes('数据与备份'), '保存失败后必须提供数据恢复入口')

    retry.click()
    await waitFor(() => useSaveStatus.getState().status === 'saved', '点击重试后没有完成保存')
  } finally {
    root.unmount()
    disablePersistWrites()
    setPreFlushCallback(null)
    storage.saveSnapshot = originalSaveSnapshot
    useSaveStatus.getState().reset()
  }
}

window.__saveStatusRecoveryTest = run()
