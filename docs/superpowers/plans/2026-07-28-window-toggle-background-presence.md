# F2 显示/隐藏与后台常驻 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Windows 和 macOS 桌面版增加默认 F2、可自定义的系统级窗口显示/隐藏热键，以及关闭到托盘、显式可靠退出的后台常驻能力。

**Architecture:** Electron 主进程新增独立的 `WindowHotkeyService` 和 `WindowPresenceController`，前者拥有系统热键配置与事务注册，后者拥有托盘和窗口显隐状态。渲染层通过受限 IPC 编辑应用外壳配置，并用纯冲突函数保证系统热键不会与资料库内普通快捷键重复。

**Tech Stack:** Electron 43、TypeScript 5.6、React 18、Zustand、Node test runner、现有浏览器回归测试框架。

## Global Constraints

- 所有文本文件必须保存为 UTF-8 无 BOM，保留全部中文字符。
- 默认系统热键为 F2。
- 单键只允许 F1–F10。
- 组合键只允许平台主修饰键、Alt/Option、Shift，加字母、数字或 F1–F10。
- Windows 和 macOS 都必须支持；Web 版本行为不变。
- 点击关闭按钮隐藏到托盘；只有显式退出、更新安装或系统退出才运行 `QuitCoordinator`。
- 不增加开机自启、多窗口、快捷键序列或后台业务任务。
- 系统热键配置保存在 Electron `userData`，不得进入交易资料库、备份或导入导出。
- 托盘不可用时不得隐藏窗口。
- 每个任务遵循测试先失败、最小实现、测试转绿、单独提交。

---

## File Structure

### New files

- `src/lib/windowHotkeyBinding.ts`：共享热键白名单、规范化、IPC 状态类型和 Accelerator 转换。
- `src/lib/windowHotkeyBinding.test.ts`：共享热键契约单元测试。
- `electron/windowHotkey.ts`：版本化配置、原子写入和系统热键事务服务。
- `electron/windowHotkey.test.ts`：服务失败回滚和配置读取测试。
- `electron/windowPresence.ts`：托盘、关闭拦截和窗口显隐控制器。
- `electron/windowPresence.test.ts`：窗口状态机和可靠退出边界测试。
- `src/shortcuts/windowHotkeyConflicts.ts`：系统热键与普通快捷键的纯冲突规则。
- `src/shortcuts/windowHotkeyConflicts.test.ts`：冲突、覆盖和恢复默认测试。
- `src/views/settings/ShortcutKeycaps.tsx`：普通快捷键与系统快捷键共用的键帽渲染。
- `src/views/settings/WindowHotkeySetting.tsx`：系统级快捷键设置行和确认弹层。
- `src/views/settings/WindowHotkeySetting.browser.test.html`：浏览器测试入口。
- `src/views/settings/WindowHotkeySetting.browser.test.tsx`：设置交互浏览器测试。

### Modified files

- `electron/main.ts`：组装两个主进程服务、IPC、第二实例和退出生命周期。
- `electron/preload.ts`：暴露三个最小热键 IPC 方法。
- `electron/quitCoordinator.test.ts`：冻结关闭隐藏与显式退出的接线契约。
- `src/types/journalBridge.ts`：增加共享热键 IPC 类型和方法。
- `src/store/shortcutStore.ts`：增加禁用系统热键冲突动作及安全重置方法。
- `src/views/settings/ShortcutsPanel.tsx`：挂载系统热键区域，并让普通录制拒绝系统热键。
- `src/views/ShortcutsView.css`：系统级说明、注册状态和冲突弹层样式。
- `src/shortcuts/workspaceActions.test.ts`：冻结普通快捷键与系统热键的边界。
- `scripts/quality-scenarios.json`：登记后台常驻和热键恢复场景证据。

---

### Task 1: Shared window-hotkey contract

**Files:**
- Create: `src/lib/windowHotkeyBinding.ts`
- Create: `src/lib/windowHotkeyBinding.test.ts`

**Interfaces:**
- Produces: `DEFAULT_WINDOW_HOTKEY`, `WindowHotkeyState`, `WindowHotkeyUpdateResult`, `normalizeWindowHotkeyBinding(value)`, `toElectronAccelerator(binding)`.
- Consumes: `KeyChord` from `src/shortcuts/types.ts`.

- [ ] **Step 1: Write failing whitelist and conversion tests**

```ts
import {
  DEFAULT_WINDOW_HOTKEY,
  normalizeWindowHotkeyBinding,
  toElectronAccelerator,
} from '@/lib/windowHotkeyBinding'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testWindowHotkeyAcceptsFunctionKeysAndModifiedKeys(): void {
  assert(normalizeWindowHotkeyBinding({ key: 'F10' })?.key === 'f10', 'F10 应规范化')
  assert(
    toElectronAccelerator({ mod: true, alt: true, shift: true, key: 'x' }) ===
      'CommandOrControl+Alt+Shift+X',
    '组合键应转换为 Electron Accelerator',
  )
  assert(DEFAULT_WINDOW_HOTKEY.key === 'f2', '默认值应为 F2')
}

export function testWindowHotkeyRejectsUnsafeBareAndSequenceKeys(): void {
  for (const input of [
    { key: 'a' },
    { key: '7' },
    { key: 'f11' },
    { mod: true, key: '' },
    [{ key: 'f2' }],
    { key: 'f2', unexpected: true },
  ]) {
    assert(normalizeWindowHotkeyBinding(input) === null, `应拒绝 ${JSON.stringify(input)}`)
  }
}
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/windowHotkeyBinding.test.ts`

Expected: FAIL because `@/lib/windowHotkeyBinding` does not exist.

- [ ] **Step 3: Implement the complete shared contract**

```ts
import type { KeyChord } from '@/shortcuts/types'

export const DEFAULT_WINDOW_HOTKEY: Readonly<KeyChord> = Object.freeze({ key: 'f2' })

export type WindowHotkeyErrorCode =
  | 'invalid-config'
  | 'invalid-binding'
  | 'registration-unavailable'
  | 'persistence-failed'

export type WindowHotkeyState = {
  binding: KeyChord
  registered: boolean
  errorCode?: 'invalid-config' | 'registration-unavailable'
}

export type WindowHotkeyUpdateResult =
  | { ok: true; state: WindowHotkeyState }
  | { ok: false; errorCode: Exclude<WindowHotkeyErrorCode, 'invalid-config'>; message: string; state: WindowHotkeyState }

const ALLOWED_FIELDS = new Set(['mod', 'alt', 'shift', 'key'])
const FUNCTION_KEY = /^f(?:[1-9]|10)$/
const MODIFIED_KEY = /^(?:[a-z]|[0-9]|f(?:[1-9]|10))$/

export function normalizeWindowHotkeyBinding(value: unknown): KeyChord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((field) => !ALLOWED_FIELDS.has(field))) return null
  if (typeof record.key !== 'string') return null
  for (const field of ['mod', 'alt', 'shift'] as const) {
    if (record[field] !== undefined && typeof record[field] !== 'boolean') return null
  }
  const key = record.key.toLowerCase()
  const hasModifier = record.mod === true || record.alt === true || record.shift === true
  if (!(FUNCTION_KEY.test(key) || (hasModifier && MODIFIED_KEY.test(key)))) return null
  return {
    mod: record.mod === true || undefined,
    alt: record.alt === true || undefined,
    shift: record.shift === true || undefined,
    key,
  }
}

export function toElectronAccelerator(binding: KeyChord): string {
  const normalized = normalizeWindowHotkeyBinding(binding)
  if (!normalized) throw new Error('invalid window hotkey binding')
  const parts: string[] = []
  if (normalized.mod) parts.push('CommandOrControl')
  if (normalized.alt) parts.push('Alt')
  if (normalized.shift) parts.push('Shift')
  parts.push(/^f\d+$/.test(normalized.key) ? normalized.key.toUpperCase() : normalized.key.toUpperCase())
  return parts.join('+')
}
```

- [ ] **Step 4: Run test and typecheck**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/windowHotkeyBinding.test.ts && pnpm typecheck`

Expected: PASS with both exported tests and zero TypeScript errors.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/windowHotkeyBinding.ts src/lib/windowHotkeyBinding.test.ts
git commit -m "feat: define system window hotkey contract"
```

---

### Task 2: Transactional main-process hotkey service

**Files:**
- Create: `electron/windowHotkey.ts`
- Create: `electron/windowHotkey.test.ts`

**Interfaces:**
- Consumes: Task 1 shared contract.
- Produces: `FileWindowHotkeyStorage` plus `WindowHotkeyService.initialize()`, `.getState()`, `.update(binding)`, `.reset()`, `.dispose()`.

Use this constructor boundary in production and tests:

```ts
export interface WindowHotkeyRegistrar {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export interface WindowHotkeyStorage {
  load(): Promise<{ kind: 'missing' } | { kind: 'invalid' } | { kind: 'valid'; binding: KeyChord }>
  save(binding: KeyChord): Promise<void>
}

export class WindowHotkeyService {
  constructor(private readonly dependencies: {
    registrar: WindowHotkeyRegistrar
    storage: WindowHotkeyStorage
    onToggle: () => void
  }) {}
}
```

- [ ] **Step 1: Write service rollback tests**

Create injected fake registrar and storage tests that prove this exact order:

```ts
export async function testWindowHotkeyRegistrationFailureKeepsOldBinding(): Promise<void> {
  const calls: string[] = []
  const service = createServiceFixture({ calls, rejectedAccelerator: 'Alt+X' })
  await service.initialize()
  const result = await service.update({ alt: true, key: 'x' })
  assert(!result.ok, '被占用热键必须失败')
  assert(calls.join('|') === 'register:F2|register:Alt+X', '失败前不得注销旧键或保存配置')
  assert(service.getState().binding.key === 'f2', '旧绑定必须保留')
}

export async function testWindowHotkeyPersistenceFailureRollsBackCandidate(): Promise<void> {
  const calls: string[] = []
  const service = createServiceFixture({ calls, failSave: true })
  await service.initialize()
  const result = await service.update({ mod: true, key: 'k' })
  assert(!result.ok, '保存失败必须失败')
  assert(
    calls.join('|') === 'register:F2|register:CommandOrControl+K|save:CommandOrControl+K|unregister:CommandOrControl+K',
    '保存失败只能注销候选键',
  )
}
```

`createServiceFixture` must instantiate the public constructor above. Its storage `load()` returns `{ kind: 'valid', binding: { key: 'f2' } }`; its registrar appends `register:<accelerator>` and `unregister:<accelerator>`; its storage appends `save:<accelerator>` before optionally throwing.

- [ ] **Step 2: Run focused service tests and verify RED**

Run: `node scripts/run-regression-tests.mjs --unit-only electron/windowHotkey.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement strict versioned storage**

Use this public configuration shape and strict parser:

```ts
type WindowHotkeyConfig = { version: 1; binding: KeyChord }

function parseConfig(value: unknown): WindowHotkeyConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((field) => field !== 'version' && field !== 'binding')) return null
  if (record.version !== 1) return null
  const binding = normalizeWindowHotkeyBinding(record.binding)
  return binding ? { version: 1, binding } : null
}
```

`FileWindowHotkeyStorage.save()` must write `${path}.tmp-${process.pid}`, open and sync the file, close it, then `rename` over the destination. Cleanup the exact temporary path in `finally`; never recursively delete a directory.

- [ ] **Step 4: Implement the registration transaction**

```ts
export class WindowHotkeyService {
  async update(input: unknown): Promise<WindowHotkeyUpdateResult> {
    const candidate = normalizeWindowHotkeyBinding(input)
    if (!candidate) return this.failure('invalid-binding', '不支持这个系统级快捷键')
    const nextAccelerator = toElectronAccelerator(candidate)
    if (nextAccelerator === this.currentAccelerator) return { ok: true, state: this.getState() }
    if (!this.registrar.register(nextAccelerator, this.onToggle)) {
      return this.failure('registration-unavailable', '快捷键已被系统或其他程序占用')
    }
    try {
      await this.storage.save(candidate)
    } catch {
      this.registrar.unregister(nextAccelerator)
      return this.failure('persistence-failed', '快捷键配置保存失败')
    }
    const previous = this.currentAccelerator
    this.binding = candidate
    this.currentAccelerator = nextAccelerator
    this.registered = true
    this.startupError = undefined
    if (previous) this.registrar.unregister(previous)
    return { ok: true, state: this.getState() }
  }

  reset(): Promise<WindowHotkeyUpdateResult> {
    return this.update(DEFAULT_WINDOW_HOTKEY)
  }

  dispose(): void {
    if (this.currentAccelerator) this.registrar.unregister(this.currentAccelerator)
    this.currentAccelerator = null
    this.registered = false
  }
}
```

`initialize()` must distinguish missing config from invalid config, preserve the invalid file, attempt the selected binding once, and return `registered: false` instead of throwing when registration is unavailable.

- [ ] **Step 5: Run service tests and Electron typecheck**

Run: `node scripts/run-regression-tests.mjs --unit-only electron/windowHotkey.test.ts && pnpm typecheck`

Expected: PASS; failure tests show the old accelerator is never unregistered.

- [ ] **Step 6: Commit**

```powershell
git add electron/windowHotkey.ts electron/windowHotkey.test.ts
git commit -m "feat: persist and register window toggle hotkey"
```

---

### Task 3: Window presence and tray controller

**Files:**
- Create: `electron/windowPresence.ts`
- Create: `electron/windowPresence.test.ts`

**Interfaces:**
- Produces: `createElectronTrayFactory()` plus `WindowPresenceController.initialize()`, `.attachWindow(window)`, `.show()`, `.hide()`, `.toggle()`, `.dispose()`.
- Consumes: injected `ensureWindow`, `createTray`, `requestQuit`, `showDock`, and `hideDock` dependencies.

- [ ] **Step 1: Write state-machine tests**

```ts
export function testFocusedWindowTogglesToHiddenWithoutQuit(): void {
  const fixture = createPresenceFixture({ visible: true, focused: true })
  fixture.controller.initialize()
  fixture.controller.toggle()
  assert(fixture.calls.join('|') === 'tray:create|window:hide|dock:hide', '聚焦窗口应隐藏')
  assert(!fixture.calls.includes('quit'), '隐藏不得请求退出')
}

export function testBackgroundOrMinimizedWindowIsRestoredAndFocused(): void {
  const fixture = createPresenceFixture({ visible: true, focused: false, minimized: true })
  fixture.controller.initialize()
  fixture.controller.toggle()
  assert(
    fixture.calls.join('|').includes('window:restore|dock:show|window:show|window:focus'),
    '后台最小化窗口应恢复并聚焦',
  )
}

export function testTrayFailureFallsBackToReliableClose(): void {
  const fixture = createPresenceFixture({ trayFailure: true })
  fixture.controller.attachWindow(fixture.window)
  fixture.window.emitClose()
  assert(fixture.calls.includes('quit'), '没有托盘时关闭必须走可靠退出')
  assert(!fixture.calls.includes('window:hide'), '没有托盘时不得隐藏')
}
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node scripts/run-regression-tests.mjs --unit-only electron/windowPresence.test.ts`

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Implement the controller with injected shell adapters**

```ts
export class WindowPresenceController {
  private tray: PresenceTray | null = null
  private disposed = false

  initialize(): boolean {
    try {
      this.tray = this.dependencies.createTray({
        toggle: () => this.toggle(),
        show: () => this.show(),
        hide: () => this.hide(),
        quit: () => { void this.requestQuitAndRecover() },
      })
      this.refreshTrayMenu()
      return true
    } catch (error) {
      this.dependencies.reportError('tray-create-failed', error)
      this.tray = null
      return false
    }
  }

  toggle(): void {
    const window = this.dependencies.ensureWindow()
    if (window.isVisible() && window.isFocused() && !window.isMinimized()) this.hide()
    else this.show()
  }

  show(): void {
    const window = this.dependencies.ensureWindow()
    if (window.isMinimized()) window.restore()
    this.dependencies.showDock()
    window.show()
    window.focus()
    this.refreshTrayMenu()
  }

  hide(): void {
    const window = this.dependencies.getWindow()
    if (!this.tray || !window || window.isDestroyed()) return
    window.hide()
    this.dependencies.hideDock()
    this.refreshTrayMenu()
  }
}
```

`attachWindow` must prevent the close event only when exit is not authorized and a tray exists. Otherwise it calls injected `requestQuit()` and never leaves an unrecoverable hidden window. `requestQuitAndRecover()` calls `show()` when the result is not ok.

- [ ] **Step 4: Run tests and typecheck**

Run: `node scripts/run-regression-tests.mjs --unit-only electron/windowPresence.test.ts && pnpm typecheck`

Expected: PASS for focused, background, minimized, hidden, missing-window, tray-failure and quit-failure cases.

- [ ] **Step 5: Commit**

```powershell
git add electron/windowPresence.ts electron/windowPresence.test.ts
git commit -m "feat: manage tray-backed window presence"
```

---

### Task 4: Wire Electron lifecycle and secure IPC

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/journalBridge.ts`
- Modify: `electron/quitCoordinator.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 services.
- Produces: working `window-hotkey:get`, `window-hotkey:set`, `window-hotkey:reset` IPC and tray-backed application lifecycle.

- [ ] **Step 1: Add failing lifecycle contract assertions**

Extend `electron/quitCoordinator.test.ts` with these assertions:

```ts
assert(main.includes('new WindowPresenceController'), '主进程必须组装窗口常驻控制器')
assert(main.includes('new WindowHotkeyService'), '主进程必须组装系统热键服务')
assert(main.includes("ipcMain.handle('window-hotkey:set'"), '热键更新必须经过主进程 IPC')
assert(!main.includes("quitCoordinator.request('close')\n  })\n}"), '窗口 close 不得无条件退出')
assert(preload.includes("ipcRenderer.invoke('window-hotkey:set'"), 'preload 必须只暴露窄 IPC')
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `node scripts/run-regression-tests.mjs --unit-only electron/quitCoordinator.test.ts`

Expected: FAIL on missing controllers and IPC.

- [ ] **Step 3: Extend the bridge types and preload**

Add to `JournalBridge`:

```ts
getWindowHotkey(): Promise<WindowHotkeyState>
setWindowHotkey(binding: KeyChord): Promise<WindowHotkeyUpdateResult>
resetWindowHotkey(): Promise<WindowHotkeyUpdateResult>
```

Add matching preload methods using only `ipcRenderer.invoke`; do not expose `globalShortcut`, `Tray`, filesystem paths or Electron objects.

- [ ] **Step 4: Assemble services in `electron/main.ts`**

Use these lifecycle rules in the actual wiring:

```ts
let windowPresence: WindowPresenceController | null = null
let windowHotkey: WindowHotkeyService | null = null

function ensureMainWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  if (!mainWindow) throw new Error('main window could not be created')
  return mainWindow
}

// inside app.whenReady()
windowPresence = new WindowPresenceController({
  getWindow: () => mainWindow,
  ensureWindow: ensureMainWindow,
  isExitAuthorized: () => gracefulExitAuthorized,
  requestQuit: () => quitCoordinator.request('quit'),
  createTray: createElectronTrayFactory({
    getImage: getTrayImage,
    isMac: process.platform === 'darwin',
  }),
  showDock: () => { void app.dock?.show() },
  hideDock: () => { app.dock?.hide() },
  reportError: (code, error) => logDiagnostic('error', code, error),
})
windowPresence.initialize()
windowHotkey = new WindowHotkeyService({
  registrar: globalShortcut,
  storage: new FileWindowHotkeyStorage(
    path.join(app.getPath('userData'), 'window-hotkey.json'),
  ),
  onToggle: () => windowPresence?.toggle(),
})
await windowHotkey.initialize()
```

`getTrayImage()` must load the existing packaged or development app icon with `nativeImage.createFromPath`, reject an empty image, resize it to tray dimensions, and call `setTemplateImage(true)` on macOS. `createElectronTrayFactory()` must create the `Tray`, set the tooltip, attach Windows click-to-toggle, and rebuild the context menu from the controller-provided callbacks.

`createWindow()` must call `windowPresence?.attachWindow(mainWindow)` after state tracking. `second-instance` and `activate` call `windowPresence.show()`. Remove the old unconditional close-to-quit listener. Keep `window-all-closed` and `before-quit` as true-exit safety nets.

Register IPC handlers after service creation. Every handler returns a fail-closed result when the service is not ready. In `will-quit`, call both `.dispose()` methods exactly once.

- [ ] **Step 5: Make exit failures visible**

At the start of `reportExitError`, call `windowPresence?.show()` before sending `app:close-save-error`. This preserves the existing receipt and makes hidden-window failures visible.

- [ ] **Step 6: Run focused and platform safety tests**

Run: `node scripts/run-regression-tests.mjs --unit-only electron/quitCoordinator.test.ts electron/windowHotkey.test.ts electron/windowPresence.test.ts && pnpm test:electron-safety:platform`

Expected: PASS; existing quit, update-install and forced safety contracts remain green.

- [ ] **Step 7: Commit**

```powershell
git add electron/main.ts electron/preload.ts electron/quitCoordinator.test.ts src/types/journalBridge.ts
git commit -m "feat: wire global hotkey and tray lifecycle"
```

---

### Task 5: Enforce system-versus-local shortcut conflicts

**Files:**
- Create: `src/shortcuts/windowHotkeyConflicts.ts`
- Create: `src/shortcuts/windowHotkeyConflicts.test.ts`
- Modify: `src/store/shortcutStore.ts`
- Modify: `src/shortcuts/workspaceActions.test.ts`

**Interfaces:**
- Consumes: current `SHORTCUT_ACTIONS`, `resolveBinding`, `bindingKey` and active system `KeyChord`.
- Produces: `findWindowHotkeyConflicts`, `disableWindowHotkeyConflicts`, and store actions that preserve the conflict invariant.

- [ ] **Step 1: Write failing conflict tests**

```ts
export function testSystemHotkeyConflictsAcrossAllShortcutScopes(): void {
  const conflicts = findWindowHotkeyConflicts({ mod: true, key: 'k' }, {})
  assert(conflicts.some((item) => item.id === 'global.commandPaletteMod'), '系统键必须跨 scope 冲突')
}

export function testResetDefaultsKeepsSystemConflictDisabled(): void {
  const next = bindingsAfterResetWithWindowHotkey({ key: 'f' })
  assert(next['list.toggleFilters'] === null, '恢复默认不能抢占系统热键')
}
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node scripts/run-regression-tests.mjs --unit-only src/shortcuts/windowHotkeyConflicts.test.ts`

Expected: FAIL because conflict helpers do not exist.

- [ ] **Step 3: Implement pure conflict helpers**

```ts
export function findWindowHotkeyConflicts(
  binding: KeyChord,
  bindings: Record<string, ShortcutBinding | null>,
): Array<{ id: string; label: string }> {
  const target = bindingKey(binding)
  return SHORTCUT_ACTIONS.flatMap((action) => {
    const active = resolveBinding(action.id, bindings)
    return active && bindingKey(active) === target ? [{ id: action.id, label: action.label }] : []
  })
}

export function disableWindowHotkeyConflicts(
  binding: KeyChord,
  bindings: Record<string, ShortcutBinding | null>,
): { bindings: Record<string, ShortcutBinding | null>; clearedLabels: string[] } {
  const conflicts = findWindowHotkeyConflicts(binding, bindings)
  const next = { ...bindings }
  for (const conflict of conflicts) next[conflict.id] = null
  return { bindings: next, clearedLabels: conflicts.map((conflict) => conflict.label) }
}
```

- [ ] **Step 4: Add store methods without persisting the system binding**

Add:

```ts
disableConflictsWithWindowHotkey(binding: KeyChord): string[]
resetAllBindingsForWindowHotkey(binding: KeyChord): string[]
```

Both methods update only ordinary `bindings`. They must never add `app.toggleWindow` or the system binding to `bindingsForPersist()`.

- [ ] **Step 5: Run shortcut tests and typecheck**

Run: `node scripts/run-regression-tests.mjs --unit-only src/shortcuts/windowHotkeyConflicts.test.ts src/shortcuts/workspaceActions.test.ts && pnpm typecheck`

Expected: PASS; existing ordinary overwrite behavior remains unchanged.

- [ ] **Step 6: Commit**

```powershell
git add src/shortcuts/windowHotkeyConflicts.ts src/shortcuts/windowHotkeyConflicts.test.ts src/store/shortcutStore.ts src/shortcuts/workspaceActions.test.ts
git commit -m "feat: reserve the system window hotkey"
```

---

### Task 6: Build the settings UI and conflict confirmation

**Files:**
- Create: `src/views/settings/WindowHotkeySetting.tsx`
- Create: `src/views/settings/ShortcutKeycaps.tsx`
- Create: `src/views/settings/WindowHotkeySetting.browser.test.html`
- Create: `src/views/settings/WindowHotkeySetting.browser.test.tsx`
- Modify: `src/views/settings/ShortcutsPanel.tsx`
- Modify: `src/views/ShortcutsView.css`

**Interfaces:**
- Consumes: Task 1 bridge types and Task 5 conflict/store actions.
- Produces: Electron-only system hotkey editor with accessible status and confirmation dialog.

- [ ] **Step 1: Add browser tests for visibility and transaction ordering**

The browser fixture must install a fake `window.journalBridge` and assert:

```ts
assert(document.querySelector('[data-window-hotkey-setting]'), 'Electron 设置页应显示系统热键')
assert(screenText().includes('系统级，会在其他软件中生效'), '必须解释全局影响')

// Conflict path
recordChord({ ctrlKey: true, key: 'k' })
assert(screenText().includes('命令面板（Ctrl+K）'), '确认弹层应列出冲突动作')
clickButton('确认覆盖')
await eventually(() => calls[0] === 'ipc:set:mod+k')
assert(useShortcutStore.getState().bindings['global.commandPaletteMod'] === null, 'IPC 成功后才清空冲突')
```

Add a failure variant where `setWindowHotkey` returns `registration-unavailable` and assert the ordinary binding remains active.

- [ ] **Step 2: Run browser test and verify RED**

Run: `node scripts/run-browser-tests.mjs`

Expected: FAIL because the component and setting do not exist.

- [ ] **Step 3: Extract reusable keycap rendering**

Move `ShortcutKeycaps` and `splitChordLabel` from `ShortcutsPanel.tsx` into `src/views/settings/ShortcutKeycaps.tsx`. Export `ShortcutKeycaps` and import it from both setting components. Keep rendered labels and existing ARIA output unchanged.

- [ ] **Step 4: Implement Electron-only setting state**

Core update ordering must be:

```ts
async function applyCandidate(candidate: KeyChord): Promise<void> {
  const conflicts = findWindowHotkeyConflicts(candidate, useShortcutStore.getState().bindings)
  if (conflicts.length > 0) {
    setPending({ candidate, conflicts })
    return
  }
  await commitCandidate(candidate)
}

async function commitCandidate(candidate: KeyChord): Promise<void> {
  const bridge = window.journalBridge
  if (!bridge) return
  setBusy(true)
  const result = await bridge.setWindowHotkey(candidate)
  setBusy(false)
  setState(result.state)
  if (!result.ok) {
    toast(result.message)
    return
  }
  const labels = useShortcutStore.getState().disableConflictsWithWindowHotkey(candidate)
  if (labels.length > 0) toast(`已更新，并覆盖「${labels.join('、')}」`)
  else toast('系统快捷键已更新')
}
```

Use `ModalShell` with title “覆盖现有快捷键？” and footer buttons “取消” and “确认覆盖”. The confirm button calls `commitCandidate`; disable both recording and reset while busy. Display `state.registered ? '已注册' : '当前未注册'` with `role="status"`.

- [ ] **Step 5: Guard ordinary shortcut editing and reset**

`ShortcutsPanel` owns the loaded active system binding. Before calling ordinary `assignBinding`, compare it with the system binding; on equality show `该按键已用于显示/隐藏 Trader Atlas，请先修改系统快捷键` and leave state unchanged. “恢复全部默认” calls `resetAllBindingsForWindowHotkey(activeBinding)` and reports defaults kept disabled because of the reservation.

Render `<WindowHotkeySetting onStateChange={setWindowHotkeyState} />` only when `window.journalBridge?.isElectron` is true.

- [ ] **Step 6: Run browser, shortcut, design and accessibility-adjacent tests**

Run: `node scripts/run-browser-tests.mjs && node scripts/run-regression-tests.mjs --unit-only src/shortcuts/windowHotkeyConflicts.test.ts src/shortcuts/workspaceActions.test.ts && pnpm qa:design`

Expected: PASS; Web fixture has no system setting, Electron fixture covers success, conflict, cancellation, failure and reset.

- [ ] **Step 7: Commit**

```powershell
git add src/views/settings/ShortcutKeycaps.tsx src/views/settings/WindowHotkeySetting.tsx src/views/settings/WindowHotkeySetting.browser.test.html src/views/settings/WindowHotkeySetting.browser.test.tsx src/views/settings/ShortcutsPanel.tsx src/views/ShortcutsView.css
git commit -m "feat: add system window hotkey settings"
```

---

### Task 7: Governance, full verification, and platform handoff

**Files:**
- Modify: `scripts/quality-scenarios.json`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: complete quality evidence and a clean implementation branch ready for live Windows/macOS smoke testing.

- [ ] **Step 1: Register stable scenario evidence**

Add these scenario IDs with exact test IDs that exist after Tasks 2 and 3:

```json
{ "id": "E-WINDOW-HOTKEY-ROLLBACK", "testId": "electron/windowHotkey.test.ts#testWindowHotkeyPersistenceFailureRollsBackCandidate", "evidence": ["electron/windowHotkey.test.ts"] },
{ "id": "E-CLOSE-TO-TRAY", "testId": "electron/windowPresence.test.ts#testTrayFailureFallsBackToReliableClose", "evidence": ["electron/windowPresence.test.ts"] }
```

Use the actual exported names unchanged so governance can match execution evidence.

- [ ] **Step 2: Run focused tests from a clean test-results state**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/windowHotkeyBinding.test.ts electron/windowHotkey.test.ts electron/windowPresence.test.ts src/shortcuts/windowHotkeyConflicts.test.ts electron/quitCoordinator.test.ts src/shortcuts/workspaceActions.test.ts
node scripts/run-browser-tests.mjs
```

Expected: every named test PASS and no page error.

- [ ] **Step 3: Run the complete repository verification**

Run:

```powershell
pnpm test
pnpm build:app
git diff --check
```

Expected:

- `pnpm test` exits 0 and governance reports all scenarios and UTF-8 files PASS.
- `pnpm build:app` exits 0 for renderer and Electron typecheck/build and bundle budgets.
- `git diff --check` exits 0.

- [ ] **Step 4: Package a Windows smoke build**

Run: `pnpm exec electron-builder --win nsis --x64 --publish never`

Expected: a non-empty NSIS installer in `release/`; do not publish it.

- [ ] **Step 5: Perform the Windows manual matrix**

Verify in the packaged app:

1. F2 shows from another application and hides only when Trader Atlas is focused.
2. Close button hides to tray without creating an exit backup.
3. Tray click restores; tray “彻底退出” creates the normal verified exit backup.
4. A conflicting candidate hotkey leaves the old hotkey working.
5. Ctrl/Alt/Shift combinations persist across restart.
6. Exit failure reopens the hidden window with the existing failure receipt.

Record the pass/fail result in the final handoff; do not fabricate macOS execution on Windows.

- [ ] **Step 6: Commit governance evidence changes**

```powershell
git add scripts/quality-scenarios.json
git commit -m "test: govern tray and window hotkey recovery"
```

- [ ] **Step 7: Final status check**

Run: `git status --short && git log --oneline -7`

Expected: clean worktree and one focused commit per task. Report macOS packaged smoke as a required CI or macOS-host follow-up, while confirming the macOS type/build contracts passed locally where platform-independent.
