# F2 显示/隐藏与后台常驻设计

## 1. 背景与目标

Trader Atlas 当前是单实例 Electron 应用。主窗口关闭时会进入 `QuitCoordinator`，依次完成渲染层刷新、验证备份和退出提交，随后真正结束进程。应用目前没有系统托盘，也没有由 Electron 主进程注册的系统级快捷键；现有快捷键只在渲染窗口获得键盘事件时生效。

本功能要把桌面应用改成用户手动启动后可后台常驻的应用，并提供默认 F2 的系统级“显示/隐藏 Trader Atlas”快捷键。用户可以在现有快捷键设置页修改该热键。窗口隐藏后，热键、托盘和第二实例启动都能可靠地重新显示现有主窗口。

## 2. 已确认范围

### 2.1 功能范围

- Windows 和 macOS 均支持系统托盘、后台常驻和系统级显示/隐藏热键。
- 默认热键为 F2。
- 单键允许 F1–F10。
- 组合键允许平台主修饰键（Windows 为 Ctrl，macOS 为 Command）、Alt/Option、Shift，加字母、数字或 F1–F10。
- 不允许裸字母、裸数字、仅修饰键或连续按键序列。
- 点击窗口关闭按钮时隐藏到托盘，不退出进程。
- 托盘菜单提供显示或隐藏主窗口以及“彻底退出”。
- 彻底退出、更新安装和系统退出继续使用现有可靠退出协调器。
- 应用由用户手动启动；本期不增加开机自动启动。

### 2.2 明确不做

- 不支持多窗口。
- 不支持连续按键序列作为系统热键。
- 不增加后台定时业务任务。
- 不把系统热键写入交易资料库、资料库备份或导入导出文件。
- 不改变 Web 版本行为。
- 不以静默替代键规避操作系统热键冲突。

## 3. 核心设计原则

1. **主进程拥有外壳状态。** 托盘、窗口显隐和 `globalShortcut` 全部由 Electron 主进程控制，渲染进程只通过窄 IPC 读取和申请修改配置。
2. **外壳配置与交易数据解耦。** 系统热键写入 Electron `userData`，不依赖资料库能否打开、切换或恢复。
3. **隐藏不是退出。** 隐藏窗口不运行退出备份，也不销毁渲染进程；现有自动保存和正在执行的安全操作继续运行。
4. **退出仍然 fail-closed。** 真正退出必须经过 `QuitCoordinator`。退出失败时恢复并聚焦主窗口，让用户看到错误。
5. **热键更新具有事务语义。** 新热键没有真实注册并持久化成功前，旧热键始终可用。
6. **始终保留托盘兜底。** 即使保存的系统热键在启动时被其他程序占用，用户仍可通过托盘恢复窗口和修改设置。

## 4. 架构

### 4.1 `WindowPresenceController`

新增 Electron 主进程模块 `electron/windowPresence.ts`，唯一负责：

- 创建、更新和销毁 `Tray`；
- 处理主窗口 `show`、`hide` 和 `toggle`；
- 拦截未经授权的窗口关闭并改为隐藏；
- Windows 托盘点击和跨平台托盘菜单；
- macOS Dock 的显示与隐藏；
- 第二实例、系统热键和应用 `activate` 的统一窗口唤回；
- 将托盘“彻底退出”转交给注入的可靠退出回调。

控制器不读取资料库，不直接实现保存或备份，也不自行调用强制退出。它依赖以下边界：

```ts
interface WindowPresenceDependencies {
  getWindow(): BrowserWindow | null
  ensureWindow(): BrowserWindow
  requestQuit(): Promise<{ ok: boolean }>
  getTrayImage(): Electron.NativeImage
}
```

显隐规则固定为：

- 窗口可见且已聚焦：`toggle()` 隐藏窗口。
- 窗口隐藏：`toggle()` 显示并聚焦窗口。
- 窗口最小化：先恢复，再显示并聚焦。
- 窗口可见但未聚焦：显示并聚焦，不隐藏。
- 窗口不存在但应用仍处于 ready：创建主窗口后显示。

该规则避免用户在其他软件中按热键时，因为 Trader Atlas 仍在后台可见而意外把它隐藏。

Windows 下托盘图标单击执行 `toggle()`，右键打开菜单。macOS 遵循菜单栏惯例，单击打开菜单；菜单中的“显示 Trader Atlas”或“隐藏 Trader Atlas”根据当前状态动态变化。两端菜单都包含分隔线和“彻底退出”。

托盘图标从现有应用图标生成 `NativeImage`：Windows 使用适配托盘尺寸的彩色图标；macOS 对缩放后的图像启用 template image，使其跟随浅色或深色菜单栏。无法获得非空图像时视为托盘创建失败，不启用隐藏行为。

macOS 隐藏窗口时调用 `app.dock.hide()`，恢复窗口时先调用 `app.dock.show()`。Windows 不修改任务栏配置；隐藏窗口后自然从任务栏消失。

### 4.2 `WindowHotkeyService`

新增 Electron 主进程模块 `electron/windowHotkey.ts`，负责：

- 读取和校验 `userData/window-hotkey.json`；
- 将共享的 `KeyChord` 转换为 Electron Accelerator；
- 注册、替换和注销系统热键；
- 原子保存版本化配置；
- 返回可展示但不包含敏感数据的稳定错误码；
- 在应用退出时释放注册。

配置格式为：

```json
{
  "version": 1,
  "binding": {
    "key": "f2"
  }
}
```

文件必须以 UTF-8 无 BOM 写入。保存采用同目录临时文件、刷新文件内容和原子替换。配置结构采用严格白名单：顶层只允许 `version` 与 `binding`，binding 只允许 `mod`、`alt`、`shift` 与 `key`。缺失文件表示使用默认 F2；损坏、包含未知字段、未知版本或非法绑定时记录诊断并回退到默认 F2，不覆盖原损坏文件，直到用户成功保存新设置。

Accelerator 转换规则：

- `mod` 转为 `CommandOrControl`；
- `alt` 转为 `Alt`；
- `shift` 转为 `Shift`；
- 字母键转为大写 Accelerator token；
- 数字保持原值；
- `f1` 至 `f10` 转为 `F1` 至 `F10`。

更新事务按以下顺序执行：

1. 规范化并校验候选绑定；
2. 候选与当前绑定一致时返回当前状态，不重复注册；
3. 保持旧热键有效，尝试注册候选热键；
4. 注册失败则返回 `registration-unavailable`，不修改文件和旧注册；
5. 注册成功后原子保存候选配置；
6. 保存失败则注销候选热键，保留旧注册和旧文件，返回 `persistence-failed`；
7. 保存成功后注销旧热键，并把候选标记为当前热键。

首次启动没有旧注册且默认或已保存热键被占用时，服务保留配置但状态为未注册。它不选择替代热键；托盘作为恢复入口。

### 4.3 IPC 与共享类型

`electron/preload.ts` 在现有 `JournalBridge` 上增加三个最小方法：

```ts
type WindowHotkeyState = {
  binding: KeyChord
  registered: boolean
  errorCode?: 'registration-unavailable' | 'invalid-config'
}

type WindowHotkeyUpdateResult =
  | { ok: true; state: WindowHotkeyState }
  | {
      ok: false
      errorCode: 'invalid-binding' | 'registration-unavailable' | 'persistence-failed'
      message: string
      state: WindowHotkeyState
    }

getWindowHotkey(): Promise<WindowHotkeyState>
setWindowHotkey(binding: KeyChord): Promise<WindowHotkeyUpdateResult>
resetWindowHotkey(): Promise<WindowHotkeyUpdateResult>
```

IPC handler 必须重新校验渲染层传入的完整对象，不接受数组、额外的序列结构、空 key 或白名单外按键。渲染层不能直接调用 `globalShortcut`、读写配置文件或操作托盘。

### 4.4 设置页与冲突协调

现有“键盘快捷键”页顶部新增独立的“系统级快捷键”分组，包含：

- “显示/隐藏 Trader Atlas”动作名称；
- 当前键帽；
- “系统级，会在其他软件中生效”说明；
- 注册状态；
- 点击录制和恢复默认操作；
- 注册失败时的行内错误和 toast。

该动作不进入资料库的 `shortcutBindings` 持久化集合。界面复用现有 `KeyChord`、键帽格式和按键录制交互，但通过独立 IPC 读写外壳配置。

系统热键与应用内快捷键必须满足以下不变量：一个活动系统热键不能同时作为活动应用内快捷键。

- 设置系统热键时，检查全部有效应用内绑定，不按页面 scope 放宽冲突。
- 存在冲突时列出动作名称并显示确认弹层。
- 用户取消时不调用主进程，也不改变任何绑定。
- 用户确认后先让主进程完成系统热键事务；主进程失败时不清空应用内绑定。
- 主进程成功后清空冲突的应用内绑定，并展示被清空的动作名称。
- 修改普通快捷键撞到系统热键时拒绝保存，提示先修改系统热键。
- 恢复全部普通快捷键时，任何与当前系统热键重合的默认动作继续写入 `null` 覆盖，不能重新制造冲突。
- 应用启动并完成快捷键水合后执行一次冲突协调；历史资料库若带有冲突绑定，系统热键优先，冲突的应用内动作被置为禁用并进入正常持久化队列。

Web 版本没有 `JournalBridge`，因此不渲染系统级快捷键分组，也不改变现有普通快捷键行为。

## 5. 生命周期与状态流

### 5.1 启动

```text
app ready
  → 初始化诊断与 IPC
  → 创建 WindowHotkeyService 并读取配置
  → 创建 WindowPresenceController 与 Tray
  → 尝试注册已保存热键
  → 创建并显示主窗口
  → 渲染层读取热键状态并协调普通快捷键冲突
```

热键注册失败不阻断应用启动，也不阻断资料库打开。

### 5.2 隐藏与唤回

```text
窗口关闭按钮
  → close 事件 preventDefault
  → 不调用 QuitCoordinator
  → 保留 BrowserWindow 和 renderer
  → 隐藏窗口与 macOS Dock

系统热键 / 托盘显示 / 第二实例 / macOS activate
  → 恢复最小化状态
  → 显示 Dock（macOS）
  → show
  → focus
```

隐藏不改变全屏、窗口大小和位置状态。正在进行的自动保存、导入准备或其他安全操作继续执行。

### 5.3 真正退出

```text
托盘“彻底退出” / 更新安装 / 系统退出
  → QuitCoordinator
  → renderer flush
  → verified backup
  → commit exit
  → 标记 gracefulExitAuthorized
  → 注销系统热键并销毁 Tray
  → 关闭窗口并退出
```

退出失败时取消退出准备，调用 `show()` 恢复并聚焦主窗口，再发送现有 `app:close-save-error` 通知。隐藏状态下发生失败也必须让错误对用户可见。

## 6. 错误处理

| 场景 | 行为 |
| --- | --- |
| 候选热键非法 | 主进程拒绝，不修改旧配置或旧注册 |
| 候选热键被其他程序占用 | 保留旧热键，返回 `registration-unavailable` |
| 配置保存失败 | 注销候选热键，旧热键继续有效 |
| 启动时保存热键被占用 | 应用和托盘正常启动，状态页显示未注册 |
| 配置损坏或版本未知 | 记录诊断，尝试默认 F2，不静默覆盖损坏文件 |
| 托盘图标创建失败 | 记录诊断并保持窗口可见；关闭按钮恢复为可靠退出，避免产生无法唤回的隐藏窗口 |
| 渲染进程崩溃 | 主进程托盘和热键继续工作；唤回窗口后沿用现有崩溃诊断 |
| 可靠退出失败 | 取消退出并显示、聚焦主窗口，展示现有错误收据 |

托盘不可用时绝不允许隐藏窗口，这是后台常驻功能的 fail-safe 边界。

## 7. 测试策略

### 7.1 纯逻辑与服务单元测试

新增测试覆盖：

- F1–F10 单键均通过；
- 带 `mod`、`alt`、`shift` 的字母、数字和功能键组合通过；
- 裸字母、裸数字、修饰键本身、F11 及以上、序列结构失败；
- Windows 与 macOS 共享 Accelerator 转换结果中的 `CommandOrControl` 语义；
- 缺失配置使用 F2；
- 损坏、未知版本和非法配置回退并报告状态；
- 候选注册失败时旧注册和旧文件不变；
- 保存失败时注销候选并保留旧注册；
- 成功时只在候选保存完成后注销旧注册；
- 重复设置相同热键不重复调用注册器。

服务测试使用可注入的注册器和临时目录，不依赖开发机真实全局热键状态。

### 7.2 Electron 主进程测试

新增或扩展主进程契约测试覆盖：

- 未授权 `close` 只隐藏窗口，不调用 `QuitCoordinator`；
- 允许退出后 `close` 能真正销毁窗口；
- 聚焦窗口执行 toggle 会隐藏；
- 未聚焦、隐藏和最小化窗口执行 toggle 会恢复并聚焦；
- 第二实例和 `activate` 使用同一显示路径；
- 托盘退出只调用可靠退出回调；
- 退出失败会重新显示窗口；
- 托盘创建失败时不允许隐藏；
- 真正退出释放热键和托盘资源。

### 7.3 渲染层测试

浏览器测试覆盖：

- Electron 环境显示系统级分组，Web 环境不显示；
- 合法热键录制、非法裸键提示和 Escape 取消；
- 冲突确认前不调用 IPC；
- 主进程更新失败时不清空普通绑定；
- 更新成功后清空全部冲突普通绑定；
- 修改普通快捷键不能覆盖系统热键；
- 恢复全部默认后仍无冲突；
- 未注册状态、恢复默认和错误文本可访问。

### 7.4 双平台人工烟测

Windows：

- F2、Ctrl/Alt/Shift 组合键；
- 窗口聚焦、后台、最小化和隐藏状态；
- 托盘单击、右键菜单和 Explorer 重启后的可恢复性；
- 其他程序占用候选热键；
- 隐藏状态下更新安装与退出失败恢复。

macOS：

- F2 与系统“将 F1、F2 等键用作标准功能键”设置的差异；
- Command/Option/Shift 组合键；
- 菜单栏图标、Dock 隐藏与恢复；
- 应用 `activate`、第二实例和退出失败恢复。

## 8. 验收标准

1. 用户手动启动应用后，默认 F2 能在其他应用获得焦点时显示 Trader Atlas，并在 Trader Atlas 已聚焦时隐藏它。
2. 点击关闭按钮不会结束进程，也不会运行退出备份；托盘能够恢复窗口。
3. 托盘“彻底退出”仍完成现有保存、验证备份和退出提交。
4. 用户能够设置约定范围内的系统级组合键，并在重启后保持。
5. 热键注册或保存失败不会破坏旧热键。
6. 系统热键不会与活动应用内快捷键重复。
7. 托盘不可用时窗口不能进入无法恢复的隐藏状态。
8. Windows 和 macOS 构建、类型检查、现有完整测试及新增测试全部通过。
