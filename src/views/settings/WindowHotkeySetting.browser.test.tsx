import { createRoot, type Root } from 'react-dom/client'
import { chordKey } from '@/shortcuts/chords'
import type { KeyChord } from '@/shortcuts/types'
import type { WindowHotkeyState, WindowHotkeyUpdateResult } from '@/lib/windowHotkeyBinding'
import { useShortcutStore } from '@/store/shortcutStore'
import { useToast } from '@/lib/toast'
import { ShortcutsPanel } from '@/views/settings/ShortcutsPanel'

declare global {
  interface Window {
    __windowHotkeySettingTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function screenText(): string {
  return document.body.textContent ?? ''
}

async function eventually(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
  throw new Error(message)
}

function clickButton(label: string): void {
  const button = [...document.body.querySelectorAll('button')]
    .find((item) => item.textContent?.trim() === label)
  assert(button, `找不到按钮：${label}`)
  button.click()
}

async function recordSystemChord(init: KeyboardEventInit): Promise<void> {
  const button = document.querySelector<HTMLButtonElement>('[data-window-hotkey-capture]')
  assert(button, '缺少系统快捷键录制按钮')
  await eventually(() => !button.disabled, '系统快捷键录制按钮仍处于忙碌状态')
  button.click()
  await eventually(() => button.getAttribute('aria-pressed') === 'true', '系统快捷键未进入录制状态')
  window.dispatchEvent(new KeyboardEvent('keydown', {
    ...init,
    bubbles: true,
    cancelable: true,
  }))
}

async function recordOrdinaryChord(actionLabel: string, init: KeyboardEventInit): Promise<void> {
  const button = [...document.querySelectorAll<HTMLButtonElement>('.shortcuts-capture')]
    .find((item) => item.getAttribute('aria-label')?.startsWith(`${actionLabel}，`))
  assert(button, `找不到普通快捷键录制按钮：${actionLabel}`)
  button.click()
  await eventually(() => button.getAttribute('aria-pressed') === 'true', '普通快捷键未进入录制状态')
  window.dispatchEvent(new KeyboardEvent('keydown', {
    ...init,
    bubbles: true,
    cancelable: true,
  }))
}

type DeferredUpdate = {
  promise: Promise<WindowHotkeyUpdateResult>
  resolve: (result: WindowHotkeyUpdateResult) => void
}

type DeferredState = {
  promise: Promise<WindowHotkeyState>
  resolve: (state: WindowHotkeyState) => void
}

function deferredUpdate(): DeferredUpdate {
  let resolve!: DeferredUpdate['resolve']
  const promise = new Promise<WindowHotkeyUpdateResult>((done) => { resolve = done })
  return { promise, resolve }
}

function deferredState(): DeferredState {
  let resolve!: DeferredState['resolve']
  const promise = new Promise<WindowHotkeyState>((done) => { resolve = done })
  return { promise, resolve }
}

async function renderPanel(rootElement: HTMLElement): Promise<Root> {
  const root = createRoot(rootElement)
  root.render(<ShortcutsPanel />)
  await eventually(() => screenText().includes('键盘快捷键'), '快捷键设置页未渲染')
  return root
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const originalBridge = window.journalBridge
  const originalBindings = useShortcutStore.getState().bindings
  let root: Root | null = null

  try {
    Reflect.deleteProperty(window, 'journalBridge')
    useShortcutStore.setState({ bindings: {} })
    root = await renderPanel(rootElement)
    assert(!document.querySelector('[data-window-hotkey-setting]'), 'Web 设置页不应显示系统热键')
    const webResetAll = document.querySelector<HTMLButtonElement>('.shortcuts-reset-all')
    const webCapture = document.querySelector<HTMLButtonElement>('.shortcuts-table button.shortcuts-capture')
    assert(webResetAll && !webResetAll.disabled, 'Web 恢复全部默认不应等待 Electron 系统键')
    assert(webCapture && !webCapture.disabled, 'Web 普通快捷键录制不应被 Electron loading 锁定')
    root.unmount()
    root = null

    const calls: string[] = []
    let state: WindowHotkeyState = {
      binding: { key: 'f2' },
      registered: false,
      errorCode: 'registration-unavailable',
    }
    const pendingGet = deferredState()
    let nextSet: 'success' | 'failure' | DeferredUpdate = 'success'
    let nextReset: 'success' | 'failure' | DeferredUpdate = 'success'
    const hotkeyBridge = {
      isElectron: true as const,
      getWindowHotkey: () => pendingGet.promise,
      setWindowHotkey: async (binding: KeyChord): Promise<WindowHotkeyUpdateResult> => {
        calls.push(`ipc:set:${chordKey(binding)}`)
        if (typeof nextSet !== 'string') return nextSet.promise
        if (nextSet === 'failure') {
          return {
            ok: false,
            errorCode: 'registration-unavailable',
            message: '该按键当前无法注册',
            state,
          }
        }
        state = { binding, registered: true }
        return { ok: true, state }
      },
      resetWindowHotkey: async (): Promise<WindowHotkeyUpdateResult> => {
        calls.push('ipc:reset')
        if (typeof nextReset !== 'string') return nextReset.promise
        if (nextReset === 'failure') {
          return {
            ok: false,
            errorCode: 'registration-unavailable',
            message: '默认系统快捷键当前无法注册',
            state,
          }
        }
        state = { binding: { key: 'f2' }, registered: true }
        return { ok: true, state }
      },
    }
    Object.defineProperty(window, 'journalBridge', {
      configurable: true,
      value: hotkeyBridge as Window['journalBridge'],
    })

    useShortcutStore.setState({ bindings: { 'global.commandPaletteMod': null } })
    root = await renderPanel(rootElement)
    await eventually(() => Boolean(document.querySelector('[data-window-hotkey-setting]')), 'Electron 设置页应显示系统热键')
    const loadingStatus = document.querySelector('[role="status"]')
    const loadingResetAll = document.querySelector<HTMLButtonElement>('.shortcuts-reset-all')
    const loadingCaptures = [...document.querySelectorAll<HTMLButtonElement>(
      '.shortcuts-table button.shortcuts-capture',
    )]
    const loadingRestores = [...document.querySelectorAll<HTMLButtonElement>(
      '.shortcuts-table button.shortcuts-action[aria-label^="恢复"]',
    )]
    assert(loadingStatus?.textContent?.includes('正在读取'), '系统键加载期间必须显示可访问状态')
    assert(loadingResetAll?.disabled, '系统键加载期间恢复全部默认必须禁用')
    assert(loadingResetAll.title.includes('正在读取系统快捷键'), '恢复全部默认必须解释禁用原因')
    assert(loadingCaptures.length > 0, '测试夹具缺少普通快捷键录制入口')
    assert(loadingCaptures.every((button) => button.disabled), '系统键加载期间普通录制入口必须禁用')
    assert(
      loadingCaptures.every((button) => button.getAttribute('aria-label')?.includes('正在读取系统快捷键')),
      '普通录制入口必须用 aria-label 解释禁用原因',
    )
    assert(loadingRestores.length > 0, '测试夹具缺少单项恢复入口')
    assert(loadingRestores.every((button) => button.disabled), '系统键加载期间单项恢复必须禁用')
    assert(
      loadingRestores.every((button) => button.title.includes('正在读取系统快捷键')),
      '单项恢复必须用 title 解释禁用原因',
    )
    const loadingBindings = JSON.stringify(useShortcutStore.getState().bindings)
    loadingResetAll.click()
    loadingCaptures[0].click()
    loadingRestores[0].click()
    window.dispatchEvent(new KeyboardEvent('keydown', {
      ctrlKey: true,
      key: 'k',
      bubbles: true,
      cancelable: true,
    }))
    assert(
      JSON.stringify(useShortcutStore.getState().bindings) === loadingBindings,
      '系统键加载期间尝试操作不得修改普通 bindings',
    )

    pendingGet.resolve(state)
    await eventually(() => screenText().includes('当前未注册'), '未注册系统热键状态未显示')
    assert(screenText().includes('系统级，会在其他软件中生效'), '必须解释全局影响')
    assert(document.querySelector('[role="status"]'), '注册结果必须使用可访问状态语义')
    await eventually(
      () => !loadingResetAll.disabled &&
        loadingCaptures.every((button) => !button.disabled) &&
        loadingRestores.every((button) => !button.disabled),
      '系统键状态加载完成后普通绑定入口未解锁',
    )
    useToast.getState().dismiss()
    await recordOrdinaryChord('新建交易', { key: 'F2' })
    await eventually(
      () => useToast.getState().message === '该按键已用于显示/隐藏 Trader Atlas，请先修改系统快捷键',
      '系统键加载完成后普通录制保护未生效',
    )
    assert(!('global.newTrade' in useShortcutStore.getState().bindings), '普通录制不得抢占已加载的 F2 系统键')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await eventually(
      () => !document.querySelector('.shortcuts-capture[aria-pressed="true"]'),
      'F2 冲突后普通快捷键录制状态未退出',
    )
    useShortcutStore.setState({ bindings: {} })

    const pendingSuccess = deferredUpdate()
    nextSet = pendingSuccess
    await recordSystemChord({ ctrlKey: true, key: 'k' })
    await eventually(
      () => document.querySelector('[role="dialog"]')?.textContent?.includes('命令面板（Ctrl+K）') === true,
      '确认弹层应列出冲突动作',
    )
    assert(calls.length === 0, '确认冲突前不得调用 IPC')
    assert(useShortcutStore.getState().bindings['global.commandPaletteMod'] !== null, '确认冲突前不得清空普通绑定')
    clickButton('确认覆盖')
    await eventually(() => calls[0] === 'ipc:set:mod+k', '确认后应先调用系统热键 IPC')
    assert(useShortcutStore.getState().bindings['global.commandPaletteMod'] !== null, 'IPC 成功前不得清空冲突')
    state = { binding: { mod: true, key: 'k' }, registered: true }
    pendingSuccess.resolve({ ok: true, state })
    await eventually(
      () => useShortcutStore.getState().bindings['global.commandPaletteMod'] === null,
      'IPC 成功后才清空冲突',
    )

    useShortcutStore.setState({ bindings: { 'global.commandPaletteMod': null } })
    useToast.getState().dismiss()
    await recordOrdinaryChord('命令面板（Ctrl+K）', { ctrlKey: true, key: 'k' })
    await eventually(
      () => useToast.getState().message === '该按键已用于显示/隐藏 Trader Atlas，请先修改系统快捷键',
      '普通录制撞系统键时必须给出拒绝原因',
    )
    assert(useShortcutStore.getState().bindings['global.commandPaletteMod'] === null, '普通录制撞系统键时不得修改状态')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await eventually(
      () => !document.querySelector('.shortcuts-capture[aria-pressed="true"]'),
      '普通快捷键录制状态未退出',
    )

    useShortcutStore.setState({ bindings: { 'global.commandPaletteMod': { alt: true, key: 'x' } } })
    useToast.getState().dismiss()
    clickButton('恢复全部默认')
    await eventually(
      () => useShortcutStore.getState().bindings['global.commandPaletteMod'] === null,
      '恢复默认必须保留系统热键冲突为禁用',
    )
    assert(useToast.getState().message?.includes('系统快捷键占用'), '恢复默认必须报告因系统热键占用而保留禁用')

    useShortcutStore.setState({ bindings: {} })
    const callCountBeforeCancel = calls.length
    nextSet = 'success'
    await recordSystemChord({ ctrlKey: true, key: 'k' })
    await eventually(() => screenText().includes('覆盖现有快捷键？'), '取消场景未打开确认弹层')
    clickButton('取消')
    await eventually(() => !screenText().includes('覆盖现有快捷键？'), '取消后确认弹层未关闭')
    assert(calls.length === callCountBeforeCancel, '取消覆盖不得调用 IPC')
    assert(useShortcutStore.getState().bindings['global.commandPaletteMod'] !== null, '取消覆盖不得清空普通绑定')

    clickButton('恢复默认')
    await eventually(() => calls.at(-1) === 'ipc:reset', '系统快捷键恢复默认未调用 IPC')
    useShortcutStore.setState({ bindings: {} })
    useToast.getState().dismiss()
    nextSet = 'failure'
    await recordSystemChord({ ctrlKey: true, key: 'k' })
    await eventually(
      () => document.querySelector('[role="dialog"]')?.textContent?.includes('命令面板（Ctrl+K）') === true,
      '失败场景未识别普通快捷键冲突',
    )
    clickButton('确认覆盖')
    await eventually(() => useToast.getState().message === '该按键当前无法注册', 'IPC 失败原因未显示')
    assert(useShortcutStore.getState().bindings['global.commandPaletteMod'] !== null, 'IPC 失败绝不能清空普通绑定')
    assert(screenText().includes('已注册'), 'IPC 失败后应显示桥接层返回的当前状态')

    await eventually(() => !document.querySelector('[role="dialog"]'), '系统键设置失败后确认弹层未关闭')
    useShortcutStore.setState({ bindings: { 'global.newTrade': { key: 'f2' } } })
    useToast.getState().dismiss()
    nextReset = 'success'
    const resetCallsBeforeCancel = calls.filter((call) => call === 'ipc:reset').length
    clickButton('恢复默认')
    await eventually(
      () => document.querySelector('[role="dialog"]')?.textContent?.includes('新建交易') === true,
      '系统恢复默认应先列出 F2 冲突动作',
    )
    assert(
      calls.filter((call) => call === 'ipc:reset').length === resetCallsBeforeCancel,
      '确认 F2 冲突前不得调用 reset IPC',
    )
    assert(
      chordKey(useShortcutStore.getState().bindings['global.newTrade'] as KeyChord) === 'f2',
      '确认 F2 冲突前不得清空普通绑定',
    )
    clickButton('取消')
    await eventually(() => !document.querySelector('[role="dialog"]'), '取消系统恢复默认后弹层未关闭')
    assert(
      calls.filter((call) => call === 'ipc:reset').length === resetCallsBeforeCancel,
      '取消系统恢复默认不得调用 reset IPC',
    )
    assert(
      chordKey(useShortcutStore.getState().bindings['global.newTrade'] as KeyChord) === 'f2',
      '取消系统恢复默认不得修改普通绑定',
    )

    const pendingReset = deferredUpdate()
    nextReset = pendingReset
    clickButton('恢复默认')
    await eventually(() => Boolean(document.querySelector('[role="dialog"]')), '确认系统恢复默认时未重新打开弹层')
    clickButton('确认覆盖')
    await eventually(
      () => calls.filter((call) => call === 'ipc:reset').length === resetCallsBeforeCancel + 1,
      '确认系统恢复默认后应先调用 reset IPC',
    )
    assert(
      chordKey(useShortcutStore.getState().bindings['global.newTrade'] as KeyChord) === 'f2',
      'reset IPC 成功前不得清空 F2 冲突',
    )
    state = { binding: { key: 'f2' }, registered: true }
    pendingReset.resolve({ ok: true, state })
    await eventually(
      () => useShortcutStore.getState().bindings['global.newTrade'] === null,
      'reset IPC 成功后才清空 F2 冲突',
    )

    await eventually(() => !document.querySelector('[role="dialog"]'), '系统恢复默认成功后弹层未关闭')
    useShortcutStore.setState({ bindings: { 'global.newTrade': { key: 'f2' } } })
    useToast.getState().dismiss()
    nextReset = 'failure'
    clickButton('恢复默认')
    await eventually(() => Boolean(document.querySelector('[role="dialog"]')), '系统恢复默认失败场景未打开确认弹层')
    clickButton('确认覆盖')
    await eventually(
      () => useToast.getState().message === '默认系统快捷键当前无法注册',
      '系统恢复默认失败原因未显示',
    )
    assert(
      chordKey(useShortcutStore.getState().bindings['global.newTrade'] as KeyChord) === 'f2',
      'reset IPC 失败绝不能清空 F2 冲突',
    )

    await eventually(() => !document.querySelector('[role="dialog"]'), '系统恢复默认失败后弹层未关闭')
    useShortcutStore.setState({ bindings: { 'global.commandPaletteMod': null } })
    useToast.getState().dismiss()
    nextSet = 'success'
    await recordSystemChord({ ctrlKey: true, key: 'k' })
    await eventually(
      () => document.querySelector('[data-window-hotkey-capture]')
        ?.getAttribute('aria-label')?.includes('Ctrl+K') === true,
      '单项恢复场景未把系统快捷键切换为 Ctrl+K',
    )
    assert(
      useShortcutStore.getState().bindings['global.commandPaletteMod'] === null,
      '单项恢复前普通 Ctrl+K 动作必须保持显式禁用',
    )
    const restoreCommandPalette = document.querySelector<HTMLButtonElement>(
      'button[aria-label="恢复命令面板（Ctrl+K）的默认快捷键"]',
    )
    assert(restoreCommandPalette, '缺少命令面板 Ctrl+K 的单项恢复按钮')
    restoreCommandPalette.click()
    await eventually(
      () => useToast.getState().message === '该按键已用于显示/隐藏 Trader Atlas，请先修改系统快捷键',
      '单项恢复撞系统键时必须给出拒绝原因',
    )
    assert(
      useShortcutStore.getState().bindings['global.commandPaletteMod'] === null,
      '单项恢复不得删除系统键冲突的 null 覆盖',
    )
  } finally {
    root?.unmount()
    useShortcutStore.setState({ bindings: originalBindings })
    useToast.getState().dismiss()
    if (originalBridge) {
      Object.defineProperty(window, 'journalBridge', { configurable: true, value: originalBridge })
    } else {
      Reflect.deleteProperty(window, 'journalBridge')
    }
  }
}

window.__windowHotkeySettingTest = run()
