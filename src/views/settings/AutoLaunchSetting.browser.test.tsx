import { createRoot, type Root } from 'react-dom/client'
import type { AutoLaunchState } from '@/types/journalBridge'
import { useToast } from '@/lib/toast'
import '@/styles/tokens.css'
import '@/styles/global.css'
import { DisplaySettingsPanel } from './DisplaySettingsPanel'

declare global {
  interface Window {
    __autoLaunchSettingTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (condition()) return
    await nextFrame()
  }
  throw new Error(message)
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const originalBridge = window.journalBridge
  let root: Root | null = null
  let state: AutoLaunchState = { supported: true, enabled: false }
  const writes: boolean[] = []

  try {
    Reflect.deleteProperty(window, 'journalBridge')
    root = createRoot(rootElement)
    root.render(<DisplaySettingsPanel />)
    await nextFrame()
    assert(!document.querySelector('[data-auto-launch-setting]'), 'Web 环境不得显示系统开机启动设置')
    root.unmount()
    root = null

    Object.defineProperty(window, 'journalBridge', {
      configurable: true,
      value: {
        isElectron: true,
        platform: 'darwin',
        getWindowState: async () => null,
        getAutoLaunchState: async () => state,
        setAutoLaunchEnabled: async (enabled: boolean) => {
          writes.push(enabled)
          state = { supported: true, enabled }
          return state
        },
      } as unknown as Window['journalBridge'],
    })
    useToast.getState().dismiss()
    root = createRoot(rootElement)
    root.render(<DisplaySettingsPanel />)
    await waitFor(
      () => document.querySelector('[data-auto-launch-setting]') !== null,
      'Electron 设置页未显示开机启动设置',
    )
    const toggle = document.querySelector<HTMLButtonElement>(
      '[data-auto-launch-setting] [role="switch"]',
    )
    assert(toggle, '缺少开机启动开关')
    await waitFor(() => !toggle.disabled, '系统状态读取完成后开关仍被禁用')
    assert(toggle.getAttribute('aria-checked') === 'false', '开关未反映系统关闭状态')
    assert(toggle.textContent?.includes('登录 macOS 后自动打开 Trader Atlas'), 'macOS 文案不正确')

    toggle.click()
    await waitFor(() => toggle.getAttribute('aria-checked') === 'true', '开关未采用写入后的系统状态')
    assert(writes.length === 1 && writes[0] === true, '开关未向主进程提交启用设置')
    assert(useToast.getState().message === '已开启开机自动启动', '成功状态缺少明确回执')
  } finally {
    root?.unmount()
    useToast.getState().dismiss()
    if (originalBridge) {
      Object.defineProperty(window, 'journalBridge', { configurable: true, value: originalBridge })
    } else {
      Reflect.deleteProperty(window, 'journalBridge')
    }
  }
}

window.__autoLaunchSettingTest = run()
