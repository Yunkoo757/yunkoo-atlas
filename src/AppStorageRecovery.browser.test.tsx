import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { STORAGE_RECOVERY_REQUIRED_EVENT } from './lib/storageRecovery'
import type { JournalBridge } from './types/journalBridge'
import './styles/tokens.css'
import './styles/global.css'

declare global {
  interface Window {
    __appStorageRecoveryTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await frame()
  }
  throw new Error(message)
}

function button(label: string): HTMLButtonElement | null {
  return [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((item) => item.textContent?.trim() === label) ?? null
}

async function run(): Promise<void> {
  const host = document.getElementById('root')
  assert(host, 'missing root')
  const root = createRoot(host)
  const originalBridge = window.journalBridge
  try {
    root.render(<App />)
    await waitFor(
      () => document.documentElement.dataset.uiSettled === '1',
      'App bootstrap must settle before recovery injection',
    )

    let recoveryCalls = 0
    const failureMessage = '主进程无法重新打开资料库：fixture'
    Object.defineProperty(window, 'journalBridge', {
      configurable: true,
      value: {
        isElectron: true,
        platform: 'win32',
        recoverStorage: async () => {
          recoveryCalls += 1
          return { ok: false, code: 'reopen-failed', message: failureMessage }
        },
      } as unknown as JournalBridge,
    })
    window.dispatchEvent(new CustomEvent(
      STORAGE_RECOVERY_REQUIRED_EVENT,
      { detail: '磁盘提交结果不确定，已锁定旧 storage' },
    ))

    await waitFor(() => button('重新打开资料库') !== null, '恢复页必须提供真实主进程恢复 CTA')
    button('重新打开资料库')!.click()
    await waitFor(() => recoveryCalls === 1, '点击 CTA 必须调用主进程 storage 恢复 IPC')
    await waitFor(
      () => document.body.textContent?.includes(failureMessage) === true,
      '主进程未能启动恢复时必须保留恢复页并显示 typed failure',
    )
    assert(button('重新打开资料库') !== null, '恢复失败后必须允许用户重试，不能 renderer-only reload')
  } finally {
    root.unmount()
    Object.defineProperty(window, 'journalBridge', {
      configurable: true,
      value: originalBridge,
    })
  }
}

window.__appStorageRecoveryTest = run()
