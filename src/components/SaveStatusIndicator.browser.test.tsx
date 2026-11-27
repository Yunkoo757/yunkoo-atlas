import { waitFor } from '../test/browserTiming'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { SaveStatusIndicator } from '@/components/SaveStatusIndicator'
import { getStorage } from '@/storage/provider'
import { pickPersisted } from '@/storage/snapshotProjection'
import {
  disablePersistWrites,
  enablePersistWrites,
  schedulePersist,
  setPreFlushCallback,
} from '@/storage/persist'
import { useSaveStatus } from '@/store/saveStatus'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __saveStatusRecoveryTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
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
    useSaveStatus.getState().setError(new Error("Error invoking remote method 'storage:saveSnapshot': Error: disk full"))
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
    const failure = document.querySelector<HTMLElement>('.save-status-recovery[role="alert"]')
    assert(failure && !failure.textContent?.includes('disk full'), '失败原因不能把顶栏挤成多行')
    assert(failure.getBoundingClientRect().height <= 28, '失败提示必须与同轨道按钮等高')
    retry.focus()
    await waitFor(
      () => document.querySelector('[role="tooltip"]')?.textContent?.trim() === 'disk full',
      '聚焦重试按钮时应可查看具体失败原因',
    )
    retry.click()
    await waitFor(() => useSaveStatus.getState().status === 'saved', '点击重试后没有完成保存')
    root.render(<MemoryRouter><SaveStatusIndicator quiet /></MemoryRouter>)
    await waitFor(() => rootElement.childElementCount === 0, '详情页成功保存不应显示提示或占位')
    useSaveStatus.getState().setSaving()
    await waitFor(() => Boolean(document.querySelector('.save-status.is-saving')), '安静模式仍需呈现保存中状态')
    useSaveStatus.getState().setError(new Error('disk full'))
    await waitFor(() => Boolean(document.querySelector('button[aria-label*="disk full"]')), '安静模式不得隐藏保存失败与重试入口')

  } finally {
    root.unmount()
    disablePersistWrites()
    setPreFlushCallback(null)
    storage.saveSnapshot = originalSaveSnapshot
    useSaveStatus.getState().reset()
  }
}

window.__saveStatusRecoveryTest = run()
