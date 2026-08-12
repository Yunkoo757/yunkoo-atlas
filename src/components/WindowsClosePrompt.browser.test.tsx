import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WindowsClosePrompt } from '@/App'
import type { WindowsCloseChoice } from '@/types/journalBridge'

declare global {
  interface Window {
    __windowsClosePromptBrowserTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const root = createRoot(rootElement)
  let selection: { choice: WindowsCloseChoice; remember: boolean } | null = null

  function Harness() {
    const [remember, setRemember] = useState(false)
    return (
      <WindowsClosePrompt
        remember={remember}
        onRememberChange={setRemember}
        onChoose={(choice) => { selection = { choice, remember } }}
      />
    )
  }

  root.render(<Harness />)
  await nextFrame()
  await nextFrame()

  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
  const remember = document.querySelector<HTMLInputElement>('input[type="checkbox"]')
  const hide = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === '隐藏到托盘')
  const quit = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === '彻底退出')
  assert(dialog && remember && hide && quit, '关闭说明必须提供完整选择与记住选项')
  assert(!dialog.querySelector('[aria-label="关闭"]'), '首次关闭说明不得无选择地消失')
  for (let index = 0; index < 10 && document.activeElement !== hide; index += 1) {
    await nextFrame()
  }
  assert(document.activeElement === hide, '默认焦点必须落在可恢复的隐藏到托盘动作')

  remember.click()
  await nextFrame()
  hide.click()
  assert(selection?.choice === 'tray' && selection.remember, '必须提交选择及记住状态')

  root.unmount()
}

window.__windowsClosePromptBrowserTest = run()
