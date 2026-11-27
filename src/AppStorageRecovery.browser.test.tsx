import { nextFrame as frame, waitFor } from './test/browserTiming'
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

async function verifyWelcomeReceipts(mode: 'open' | 'create', interrupt = false) {
  const host = document.getElementById('root')!
  const root = createRoot(host)
  const originalBridge = window.journalBridge
  const path = '/isolated/' + 'long-folder-name/'.repeat(12) + 'selected-library'
  const message = '新交易库只能创建在空目录中，请选择空目录或新文件夹'
  let uncertain = false
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let activations = 0
  let recoveries = 0
  const activate = async (selected: string) => {
    assert(selected === path, '欢迎页应提交用户选择的原始目录')
    activations++
    if (uncertain && interrupt) {
      await pending
      return { ok: true, path: selected, snapshot: null } as const
    }
    return uncertain
      ? { ok: false, requiresReload: true, error: '配置已写入但回读未确认' } as const
      : { ok: false, error: message } as const
  }
  const bridge = {
    isElectron: true, platform: 'darwin',
    getLibraryStatus: async () => ({ kind: 'unset' } as const),
    pickLibraryFolder: async () => path,
    createNewLibrary: activate,
    openExistingLibrary: activate,
    recoverStorage: async () => { recoveries++; return { ok: false, code: 'reopen-failed', message: '隔离重开失败' } as const },
  } satisfies Partial<JournalBridge>
  try {
    Object.defineProperty(window, 'journalBridge', { configurable: true, value: bridge })
    root.render(<App />)
    await waitFor(() => button('点击选择目录…') !== null, '未选库时应显示欢迎页')
    button('点击选择目录…')!.click()
    const label = mode === 'create' ? '在此创建新资料库' : '打开已有资料库'
    await waitFor(() => button(label) !== null, '应允许操作所选目录')
    const picker = button(path)!
    await waitFor(() => picker.dataset.textOverflow === 'true', '超长目录应采用公共溢出提示')
    assert(getComputedStyle(picker).overflowX === 'hidden' && getComputedStyle(picker).textOverflow === 'ellipsis',
      '目录内容必须在控件边界内截断')
    picker.focus()
    await waitFor(() => document.querySelector('[role="tooltip"]')?.textContent === path, '键盘聚焦应能读取完整所选路径')
    picker.blur()
    const action = button(label)!
    action.click()
    action.click()
    await waitFor(() => document.querySelector('.welcome-error')?.textContent === message, '普通拒绝应保留实际原因')
    assert(activations === 1 && button(path), '同一次提交只激活一次，拒绝后应保留目录')
    uncertain = true
    action.click()
    if (interrupt) {
      await waitFor(() => activations === 2, '必须先发出选库请求')
      window.dispatchEvent(new CustomEvent(STORAGE_RECOVERY_REQUIRED_EVENT, { detail: '隔离选库期间要求恢复' }))
      await waitFor(() => Boolean(button('重新打开资料库')), '恢复应先接管启动界面')
      release()
      await frame()
      await frame()
      assert(document.body.textContent?.includes('隔离选库期间要求恢复'), '迟到的选库成功不得重新发起已经中止的启动')
    }
    await waitFor(() => button('重新打开资料库') !== null, '配置结果未确认时应进入恢复页')
    assert(!button(label) && !button('选择其他资料库') && !document.querySelector('.sb-primary'), '未确认配置前不得继续选库或进入工作区')
    button('重新打开资料库')!.click()
    await waitFor(() => recoveries === 1 && document.body.textContent?.includes('隔离重开失败') === true, '恢复应经过桌面主进程')
  } finally {
    root.unmount()
    Object.defineProperty(window, 'journalBridge', { configurable: true, value: originalBridge })
  }
}

window.__appStorageRecoveryTest = run().then(async () => {
  await verifyWelcomeReceipts('create')
  await verifyWelcomeReceipts('open')
  await verifyWelcomeReceipts('open', true)
})
