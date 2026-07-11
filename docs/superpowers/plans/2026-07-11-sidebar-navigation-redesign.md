# Sidebar Navigation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有固定“快捷”侧栏升级为四个稳定核心模块 + 可混排“我的空间”，同时实现现场恢复、单一激活态、桌面管理器和移动端底栏。

**Architecture:** 以 `display.sidebarWorkspaceItems` 作为唯一持久化配置；纯函数层统一负责迁移、目标解析、计数与路由匹配，桌面侧栏和移动导航只消费解析结果。核心模块通过扩展后的工作区记忆恢复现场，自定义条目始终实时解析并精确直达；编辑器只维护本地草稿，点击“完成”时一次性替换 Store 配置。

**Tech Stack:** React 18、TypeScript、React Router 6、Zustand、Lucide React、现有 CSS、现有 Node/Vite 回归测试运行器、Playwright QA 脚本。

## Global Constraints

- 全部文件使用 UTF-8 无 BOM，保留中文字符。
- 不新增第三方依赖；拖拽使用原生 React drag events，键盘排序必须完整可用。
- 四个核心模块固定且不可配置；“我的空间”最多 8 个常驻项，超出项进入 `overflow`。
- `display.sidebarPins` 只作为旧数据读取源，新 UI 不再写入。
- 不复制保存视图、策略、案例视图的名称或路由；始终保存引用并实时解析。
- 任意页面最多一个强选中项；精确自定义条目优先于核心模块。
- 每个任务完成后先执行任务内验证，再提交；不得混入无关格式化或重构。

## File Responsibility Map

| File | Responsibility |
|---|---|
| `src/lib/sidebarWorkspace.ts` | 新模型、迁移、规范化、去重、常驻上限、四类目标解析、激活态判定、目标计数 |
| `src/lib/workbenchTrades.ts` | 从 URL 查询解析分面，并复用页面同一口径计算可见交易 |
| `src/lib/tradeFilters.ts` | `DisplayPrefs` 持久化结构与工作区记忆规范化 |
| `src/lib/workspaceViews.ts` | 今日/交易/案例工作区归属、记忆校验和默认回退 |
| `src/lib/tradeRoute.ts` | 详情来源路由与稳定滚动锚点状态 |
| `src/hooks/useTradeReturnAnchor.ts` | 打开详情前记录、返回列表后恢复交易锚点 |
| `src/shortcuts/useListContextSync.ts` | 同步三类工作区最近现场 |
| `src/store/useStore.ts` | 原子替换 `sidebarWorkspaceItems` 的唯一 Store 动作 |
| `src/components/Sidebar.tsx` | 桌面侧栏布局、核心模块、常驻条目和管理入口 |
| `src/components/sidebar/SidebarWorkspaceEditor.tsx` | 本地编辑草稿、排序、移除、撤销、完成/取消 |
| `src/components/sidebar/SidebarTargetPicker.tsx` | 分组搜索、添加与 placement 切换 |
| `src/components/sidebar/SidebarWorkspace.css` | 桌面“我的空间”、编辑器与选择面板样式 |
| `src/components/MobileNavigation.tsx` | 五项底栏、“更多”抽屉与移动全屏管理入口 |
| `src/components/MobileNavigation.css` | 移动底栏、抽屉、安全区和 44px 命中区 |
| `src/components/ui/AppFrame.tsx` | 同时挂载桌面侧栏和移动导航插槽 |
| `src/components/ui/AppFrame.css` | 桌面/移动布局切换，移除横向滚动侧栏模式 |
| `src/App.tsx` | 注入移动导航，并为三视图打开详情传递来源锚点 |
| `src/views/ListView.tsx` | 列表详情来源锚点与返回恢复 |
| `src/views/BoardView.tsx` | 看板卡片稳定锚点与返回恢复 |
| `src/views/TableView.tsx` | 表格行稳定锚点与返回恢复 |
| `src/views/DetailView.tsx` | 返回时传递来源锚点并执行有效回退 |
| `src/lib/importExport.ts` | 通过 `normalizeDisplay` 完成新配置导入/导出兼容 |
| `src/regression.test.ts` | 模型、路由、计数、迁移、导入导出回归测试 |
| `scripts/qa-sidebar-navigation.mjs` | 桌面、键盘、移动端与响应式浏览器验收 |
| `package.json` | 增加定向 QA 命令 `qa:sidebar` |

---

### Task 1: 建立“我的空间”持久化模型与旧数据迁移

**Files:**
- Create: `src/lib/sidebarWorkspace.ts`
- Modify: `src/lib/tradeFilters.ts`
- Modify: `src/store/useStore.ts`
- Modify: `src/regression.test.ts`

**Consumes:** `SidebarNavId`、`DEFAULT_SIDEBAR_PINS`、旧 `display.sidebarPins`。

**Produces:** `SidebarTarget`、`SidebarWorkspaceItem`、规范化函数，以及 Store 的原子替换动作。

- [ ] **Step 1: 写出失败的迁移和规范化测试**

在 `src/regression.test.ts` 新增并导出：

```ts
export function testSidebarWorkspaceMigratesLegacyPinsWithoutLosingOrder(): void {
  const display = normalizeDisplay({ sidebarPins: ['missed', 'active', 'paper'] })
  assert(
    display.sidebarWorkspaceItems.map((item) => item.target.kind === 'system' ? item.target.id : '').join(',') ===
      'missed,active,paper',
    'legacy sidebar pins should migrate in their original order',
  )
}

export function testSidebarWorkspaceNormalizesDuplicatesAndPinnedOverflow(): void {
  const items = normalizeSidebarWorkspaceItems([
    ...Array.from({ length: 9 }, (_, index) => ({
      id: `item-${index}`,
      target: { kind: 'saved-view', viewId: `view-${index}` },
      placement: 'pinned',
      order: index,
    })),
    {
      id: 'duplicate',
      target: { kind: 'saved-view', viewId: 'view-0' },
      placement: 'overflow',
      order: 99,
    },
  ])
  assert(items.filter((item) => item.placement === 'pinned').length === 8, 'only eight items may remain pinned')
  assert(items.length === 9, 'overflow migration must not silently delete the ninth item')
}
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm test`

Expected: TypeScript 构建失败，提示 `normalizeSidebarWorkspaceItems` 或 `sidebarWorkspaceItems` 尚不存在。

- [ ] **Step 3: 实现最小领域模型**

在 `src/lib/sidebarWorkspace.ts` 定义：

```ts
export type SidebarTarget =
  | { kind: 'system'; id: SidebarNavId }
  | { kind: 'saved-view'; viewId: string }
  | { kind: 'strategy'; strategyId: string }
  | { kind: 'case-view'; scope: Exclude<ReviewCaseScope, 'all'> }

export type SidebarWorkspaceItem = {
  id: string
  target: SidebarTarget
  placement: 'pinned' | 'overflow'
  order: number
}

export const MAX_PINNED_SIDEBAR_ITEMS = 8

export function sidebarTargetKey(target: SidebarTarget): string
export function normalizeSidebarWorkspaceItems(value: unknown): SidebarWorkspaceItem[]
export function migrateSidebarPins(pins: readonly SidebarNavId[]): SidebarWorkspaceItem[]
```

规范化顺序固定为：校验目标 → 按 `order` 和输入顺序稳定排序 → 按 `sidebarTargetKey` 去重 → 重写连续 `order` → 将第 9 个及以后 `pinned` 改为 `overflow`。未知系统 id、空引用和非法案例 scope 丢弃，合法失效引用保留给管理器显示。

- [ ] **Step 4: 接入 DisplayPrefs 与 Store 单一写入动作**

在 `src/lib/tradeFilters.ts`：

```ts
export interface DisplayPrefs {
  // existing fields
  sidebarPins: SidebarNavId[]
  sidebarWorkspaceItems: SidebarWorkspaceItem[]
  workspaceMemory?: {
    today?: WorkspaceRouteMemory
    trade?: WorkspaceRouteMemory
    case?: WorkspaceRouteMemory
  }
}
```

`normalizeDisplay` 优先规范化显式 `sidebarWorkspaceItems`；字段缺失时才从 `sidebarPins` 迁移。保留 `sidebarPins` 原值用于兼容，但后续写入动作不修改它。

在 `src/store/useStore.ts` 增加：

```ts
replaceSidebarWorkspaceItems: (items: SidebarWorkspaceItem[]) => void
```

实现必须一次 `set` 完成，并再次调用 `normalizeSidebarWorkspaceItems`。

- [ ] **Step 5: 运行回归与构建确认 GREEN**

Run: `pnpm test && pnpm build`

Expected: 全部 `PASS`，TypeScript 与 Vite 构建成功。

- [ ] **Step 6: 提交**

```bash
git add src/lib/sidebarWorkspace.ts src/lib/tradeFilters.ts src/store/useStore.ts src/regression.test.ts
git commit -m "feat: add sidebar workspace model and migration"
```

---

### Task 2: 统一目标解析、页面计数与单一激活态

**Files:**
- Create: `src/lib/workbenchTrades.ts`
- Modify: `src/hooks/useWorkbenchVisibleTrades.ts`
- Modify: `src/lib/sidebarWorkspace.ts`
- Modify: `src/regression.test.ts`

**Consumes:** `SECONDARY_NAV`、`SavedTradeView[]`、`Strategy[]`、案例工作区内置视图、交易数据与显示偏好。

**Produces:** 日常导航可直接渲染的目标描述、与页面一致的计数、精确/已修改/核心回退选择结果。

- [ ] **Step 1: 写出四类解析、失效与激活态失败测试**

新增 `testSidebarWorkspaceResolvesEveryTargetKindAndKeepsInvalidReferences`、`testSidebarSelectionPrefersExactWorkspaceItemAndMarksModifiedFilters`、`testSidebarTargetCountsMatchWorkbenchFiltering`。覆盖：

- `paper` 系统项解析到 `/sim`，并接受 `/paper`、`/practice` 历史别名输入。
- 保存视图重命名后显示新名称；删除后返回 `invalid: true`。
- 策略删除后日常列表隐藏，管理列表保留。
- 案例 `mistakes` 解析到 `/review-cases/mistakes`。
- 保存视图精确匹配时只有自定义项 active。
- 同一路径叠加额外查询时固定项 active 且 `modified: true`。
- 无自定义精确匹配时回退至 `today | trades | reviewCases | dashboard` 核心项。

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm test`

Expected: 新解析接口不存在或断言失败。

- [ ] **Step 3: 抽取页面和侧栏共享的可见交易计算**

在 `src/lib/workbenchTrades.ts` 实现纯函数：

```ts
export function parseTradeFacets(search: string | URLSearchParams): TradeFacetFilters

export function getWorkbenchVisibleTrades(options: {
  trades: Trade[]
  filter: ListFilter
  starredIds: string[]
  display: DisplayPrefs
  search: string | URLSearchParams
}): Trade[]
```

将 `src/hooks/useWorkbenchVisibleTrades.ts` 改为只读取 Store/URL，并调用上述函数。保留“显式终态筛选覆盖 hideClosed”的现有规则。

- [ ] **Step 4: 实现目标解析和选择状态**

在 `src/lib/sidebarWorkspace.ts` 增加：

```ts
export type ResolvedSidebarWorkspaceItem = {
  item: SidebarWorkspaceItem
  key: string
  label: string
  pathname: string
  search: string
  icon: 'active' | 'favorites' | 'missed' | 'paper' | 'saved-view' | 'strategy' | 'case-view'
  invalid: boolean
}

export function resolveSidebarWorkspaceItem(
  item: SidebarWorkspaceItem,
  sources: { savedViews: SavedTradeView[]; strategies: Strategy[] },
): ResolvedSidebarWorkspaceItem

export function resolveSidebarSelection(options: {
  pathname: string
  search: string
  items: ResolvedSidebarWorkspaceItem[]
}): {
  activeWorkspaceItemId?: string
  activePrimaryId?: PrimarySidebarNavId
  modifiedWorkspaceItemId?: string
}

export function countSidebarTarget(
  target: ResolvedSidebarWorkspaceItem,
  context: SidebarCountContext,
): number | undefined
```

精确匹配比较规范化路径和排序后的完整查询；“已修改”要求目标查询是当前位置查询的真子集。系统、策略、案例和保存视图的计数都先解析为页面同一 `ListFilter + search`，再调用 `getWorkbenchVisibleTrades`。

- [ ] **Step 5: 运行回归与构建确认 GREEN**

Run: `pnpm test && pnpm build`

Expected: 所有目标解析、计数和激活态测试通过，现有三视图筛选测试不回归。

- [ ] **Step 6: 提交**

```bash
git add src/lib/workbenchTrades.ts src/hooks/useWorkbenchVisibleTrades.ts src/lib/sidebarWorkspace.ts src/regression.test.ts
git commit -m "feat: resolve sidebar targets and active state"
```

---

### Task 3: 扩展核心模块现场记忆与详情滚动锚点

**Files:**
- Modify: `src/lib/workspaceViews.ts`
- Modify: `src/lib/tradeFilters.ts`
- Modify: `src/shortcuts/useListContextSync.ts`
- Modify: `src/lib/tradeRoute.ts`
- Create: `src/hooks/useTradeReturnAnchor.ts`
- Modify: `src/App.tsx`
- Modify: `src/views/ListView.tsx`
- Modify: `src/views/BoardView.tsx`
- Modify: `src/views/TableView.tsx`
- Modify: `src/views/DetailView.tsx`
- Modify: `src/components/trades/TradeRow.tsx`
- Modify: `src/regression.test.ts`

**Consumes:** 当前路由、三视图规范化路径、详情来源交易 id。

**Produces:** 今日/交易/案例现场恢复，以及列表/看板/表格返回后的稳定交易锚点。

- [ ] **Step 1: 写出失败的现场和详情返回测试**

扩展现有 `testWorkspaceNavRemembersLastQuickView` 与 `testTradeDetailReturnRemembersListView`，覆盖：

```ts
assert(rememberableWorkspaceKind('/today-record/table') === 'today', 'today table belongs to today workspace')
assert(
  resolveWorkspaceNavTarget('today', { pathname: '/today-record/board', search: '?session=london' }).pathname ===
    '/today-record/board',
  'today workspace restores mode and filters',
)
```

并断言 `tradeDetailNavState` 保存 `anchorTradeId`，`resolveTradeDetailReturn` 在来源失效时按交易类型回退。

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm test`

Expected: `WorkspaceKind` 不接受 `today`，详情状态缺少锚点。

- [ ] **Step 3: 扩展工作区记忆**

将 `WorkspaceKind` 改为 `'today' | 'trade' | 'case'`；新增 `isTodayWorkspaceEntryPath`，并使 `rememberableWorkspaceKind` 优先识别 `/today-record` 的 list/board/table 变体。`resolveWorkspaceNavTarget` 对每类分别验证，损坏记忆回退：

- today → `/today-record`
- trade → `/list`
- case → `/review-cases`

`useListContextSync` 按当前 kind 写入 `{ pathname, search }`。`resolveWorkspaceNavTarget` 接收当前 `strategies` 作为可选校验源：若交易工作区记忆指向已删除的 `/strategy/:id`，或现有记忆不再属于对应工作区，则回退默认页；同步 hook 随后通过 `setDisplay` 清除该项损坏记忆，避免下次继续命中。

- [ ] **Step 4: 建立稳定滚动锚点协议**

扩展 `TradeDetailFrom`：

```ts
export type TradeDetailFrom = {
  pathname: string
  search?: string
  anchorTradeId?: string
}
```

`src/hooks/useTradeReturnAnchor.ts` 提供：

```ts
export function rememberTradeReturnAnchor(from: TradeDetailFrom): void
export function useTradeReturnAnchor(): void
export function tradeReturnLocationState(anchorTradeId?: string): { restoreTradeId?: string }
```

打开详情时同时写 `sessionStorage`（key 由规范化 `pathname + search` 构成），以支持浏览器后退；返回目标的 location state 优先携带 `restoreTradeId`。恢复 hook 在内容渲染后查找 `[data-trade-id="..."]` 并调用 `scrollIntoView({ block: 'center' })`，成功后清理一次性状态。

- [ ] **Step 5: 接入三视图和详情页**

- `ListView`、`TableView`、`App.tsx` 的 `BoardView onOpen` 调用 `tradeDetailNavState({ pathname, search, anchorTradeId: trade.id })`。
- `TradeRow` 已有 `data-trade-id`，保持不变。
- `BoardView` 的卡片与 `TableView` 的 `<tr>` 增加 `data-trade-id={trade.id}`。
- 三个视图调用 `useTradeReturnAnchor()`。
- `DetailView` 的两个返回 `Link` 和删除后的 `navigate` 均传递 `tradeReturnLocationState(from?.anchorTradeId)`。

- [ ] **Step 6: 运行回归与构建确认 GREEN**

Run: `pnpm test && pnpm build`

Expected: 工作区和详情回归通过，三个视图类型检查成功。

- [ ] **Step 7: 提交**

```bash
git add src/lib/workspaceViews.ts src/lib/tradeFilters.ts src/shortcuts/useListContextSync.ts src/lib/tradeRoute.ts src/hooks/useTradeReturnAnchor.ts src/App.tsx src/views/ListView.tsx src/views/BoardView.tsx src/views/TableView.tsx src/views/DetailView.tsx src/components/trades/TradeRow.tsx src/regression.test.ts
git commit -m "feat: restore workspace and detail return context"
```

---

### Task 4: 重构桌面侧栏消费统一导航模型

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/Sidebar.css`
- Create: `src/components/sidebar/SidebarWorkspace.css`
- Modify: `src/regression.test.ts`

**Consumes:** `resolveSidebarWorkspaceItem`、`resolveSidebarSelection`、`countSidebarTarget`、三类工作区记忆。

**Produces:** 固定“工作台” + 最多八项“我的空间”的桌面导航，以及唯一强选中态。

- [ ] **Step 1: 写出桌面导航契约的失败测试**

将旧 `testSecondarySidebarQuickNavMatchesApprovedArchitecture` 改为兼容迁移测试，并新增静态导航契约：默认配置包含四个系统目标、核心模块顺序不变、解析结果只返回前 8 个 `pinned` 日常项、失效项不进入日常项。

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm test`

Expected: 当前 Sidebar 仍直接消费 `resolvePinnedSecondaryNav`，新日常解析断言失败。

- [ ] **Step 3: 重写 Sidebar 数据准备层**

`Sidebar` 从 Store 读取 `display.sidebarWorkspaceItems`、`savedTradeViews`、`strategies`、交易与星标；通过纯函数一次计算：

- 四个核心入口 href。
- 有效 `pinned` 条目。
- 每项 count。
- 唯一 active / modified 标识。

组件不得自行拼接保存视图或策略路由。核心 `today`、`trades`、`reviewCases` 使用工作区记忆；`dashboard` 固定 `/dashboard`。

- [ ] **Step 4: 实现桌面视觉与可访问状态**

将“快捷”改为“我的空间”，标题右侧放置 `···` 管理按钮，列表末尾提供“添加或管理”。CSS 保持 244px 和 28–30px 行高；`.is-active` 只有一处强背景，`.is-modified` 使用小圆点并附带屏幕阅读文本“当前条件已修改”。隐藏失效日常项，不渲染空计数。

- [ ] **Step 5: 运行回归、构建与设计契约**

Run: `pnpm test && pnpm build && pnpm qa:design`

Expected: 全部命令退出码 0，侧栏无旧“快捷”标题和旧直接 pin 解析调用。

- [ ] **Step 6: 提交**

```bash
git add src/components/Sidebar.tsx src/components/Sidebar.css src/components/sidebar/SidebarWorkspace.css src/regression.test.ts
git commit -m "feat: render unified desktop sidebar navigation"
```

---

### Task 5: 实现原地管理器、撤销与目标选择器

**Files:**
- Create: `src/components/sidebar/SidebarWorkspaceEditor.tsx`
- Create: `src/components/sidebar/SidebarTargetPicker.tsx`
- Modify: `src/components/sidebar/SidebarWorkspace.css`
- Modify: `src/components/Sidebar.tsx`

**Consumes:** 当前规范化配置、全部可选目标、`replaceSidebarWorkspaceItems`。

**Produces:** 只在“完成”时持久化的编辑草稿、原生拖拽、完整键盘替代和右侧搜索选择面板。

- [ ] **Step 1: 先在 QA 脚本草稿中定义管理器可观察契约**

创建 `scripts/qa-sidebar-navigation.mjs` 的桌面管理段，先断言以下稳定选择器存在（此时应失败）：

```js
await page.getByRole('button', { name: '管理我的空间' }).click()
await expectVisible(page.getByRole('heading', { name: '管理我的空间' }))
await expectText(page.locator('[data-sidebar-capacity]'), /\d+ \/ 8/)
await expectVisible(page.getByRole('button', { name: '浏览可添加项目' }))
```

脚本使用项目现有 `scripts/qa-*.mjs` 的 Vite 启动与 Playwright 清理模式，不复制新测试框架。

- [ ] **Step 2: 实现本地草稿与完成/取消**

`SidebarWorkspaceEditor` 初始化时深拷贝规范化 items；拖拽、删除、placement 调整只写本地 state。接口固定为：

```ts
type SidebarWorkspaceEditorProps = {
  items: SidebarWorkspaceItem[]
  sources: SidebarTargetSources
  onCommit: (items: SidebarWorkspaceItem[]) => void
  onCancel: () => void
}
```

点击完成仅调用一次 `onCommit(normalizeSidebarWorkspaceItems(draft))`。Escape 放弃草稿；关闭后 `requestAnimationFrame` 将焦点返回打开管理器的按钮。

- [ ] **Step 3: 实现拖拽、键盘排序、删除与撤销**

- 原生 `draggable` + `onDragStart/onDragOver/onDrop` 只改变草稿顺序。
- `Alt + ArrowUp/ArrowDown` 调用同一个 `moveItem` 纯操作。
- `Delete` 移除当前项。
- 编辑器内部显示“已移除 X · 撤销”，撤销恢复原 placement 和 order；不扩展全局 toast API。
- 计数器显示 `pinned.length / 8`；第 9 项自动进入 `overflow`。
- “恢复默认”先显示明确的内联确认文案，再用 `migrateSidebarPins(DEFAULT_SIDEBAR_PINS)` 替换草稿。

- [ ] **Step 4: 实现分组搜索选择器**

`SidebarTargetPicker` 生成四组 catalog：系统快捷、我的视图、策略、案例视图。每个目标只能处于 `pinned | overflow | absent`；选择常驻且已满 8 项时自动设为 `overflow` 并显示说明。搜索匹配实时名称，不匹配失效引用。失效条目只在编辑器列表显示“已失效”，支持删除。

- [ ] **Step 5: 运行定向浏览器检查**

临时 Run: `node scripts/qa-sidebar-navigation.mjs`

Expected: 可以进入编辑、拖动预览、Alt+↓ 排序、Delete 后撤销、Escape 不保存、完成后刷新仍保留、失效条目不出现在日常侧栏。

- [ ] **Step 6: 运行全量回归与构建**

Run: `pnpm test && pnpm build`

Expected: 全部通过。

- [ ] **Step 7: 提交**

```bash
git add src/components/sidebar/SidebarWorkspaceEditor.tsx src/components/sidebar/SidebarTargetPicker.tsx src/components/sidebar/SidebarWorkspace.css src/components/Sidebar.tsx scripts/qa-sidebar-navigation.mjs
git commit -m "feat: add sidebar workspace manager"
```

---

### Task 6: 用五项底栏替换移动端横向侧栏

**Files:**
- Create: `src/components/MobileNavigation.tsx`
- Create: `src/components/MobileNavigation.css`
- Modify: `src/components/ui/AppFrame.tsx`
- Modify: `src/components/ui/AppFrame.css`
- Modify: `src/components/Sidebar.css`
- Modify: `src/App.tsx`
- Modify: `scripts/qa-sidebar-navigation.mjs`

**Consumes:** 与桌面一致的工作区 href、解析后的全部 pinned/overflow 有效项和选择状态。

**Produces:** 390px 下固定底部五项、“更多”抽屉和移动全屏管理器。

- [ ] **Step 1: 扩充失败的移动端 QA 契约**

在 QA 脚本设置 `390 x 844` viewport，断言：桌面 `.sidebar` 不可见；`navigation[name="移动导航"]` 可见；五个按钮名称严格为“今日、交易、案例、仪表盘、更多”；页面 `scrollWidth <= clientWidth`。

- [ ] **Step 2: 扩展 AppFrame 插槽**

```ts
type AppFrameProps = {
  sidebar: ReactNode
  mobileNavigation: ReactNode
  children: ReactNode
}
```

桌面只显示 sidebar，`max-width: 640px` 只显示 mobileNavigation，并为 `.ui-main-frame` 预留底部导航和 `env(safe-area-inset-bottom)` 空间。

- [ ] **Step 3: 实现 MobileNavigation**

四个核心按钮复用桌面相同 href 与 active 规则；“更多”打开底部抽屉，按顺序展示：我的空间全部有效 pinned + overflow、搜索、设置、回收站、管理我的空间。抽屉关闭后焦点回到“更多”。所有操作命中区 `min-height: 44px`。

- [ ] **Step 4: 复用编辑器的移动全屏变体**

从抽屉点“管理我的空间”关闭抽屉并打开全屏编辑器；使用同一 `SidebarWorkspaceEditor` 数据与动作，只通过 className/容器切换布局。移动端不依赖拖拽完成排序，Alt 键以外还显示可点击上移/下移按钮。

- [ ] **Step 5: 删除旧横向滚动样式并运行响应式 QA**

从 `Sidebar.css` 删除移动端 `.sidebar` 横向滚动实现。Run: `node scripts/qa-sidebar-navigation.mjs`

Expected: 1920、1440、900 保持桌面侧栏；390 使用底栏与抽屉；无横向滚动；抽屉与全屏编辑器都可关闭并恢复焦点。

- [ ] **Step 6: 运行回归和构建**

Run: `pnpm test && pnpm build`

Expected: 全部通过。

- [ ] **Step 7: 提交**

```bash
git add src/components/MobileNavigation.tsx src/components/MobileNavigation.css src/components/ui/AppFrame.tsx src/components/ui/AppFrame.css src/components/Sidebar.css src/App.tsx scripts/qa-sidebar-navigation.mjs
git commit -m "feat: add responsive mobile navigation"
```

---

### Task 7: 锁定导入导出、异常恢复与完整浏览器验收

**Files:**
- Modify: `src/lib/importExport.ts`
- Modify: `src/regression.test.ts`
- Modify: `scripts/qa-sidebar-navigation.mjs`
- Modify: `package.json`

**Consumes:** 已完成的新配置、工作区记忆、目标解析与所有 UI。

**Produces:** JSON 往返兼容、损坏配置安全恢复、可重复运行的定向 QA 命令。

- [ ] **Step 1: 写出导入导出失败测试**

新增 `testSidebarWorkspaceSurvivesExportImportAndNormalizesInvalidData`：导出包含四类目标的 display，再导入；断言顺序、placement、失效引用均保留，重复目标被去重，第 9 个 pinned 转为 overflow，旧别名最终解析到 `/sim`。

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm test`

Expected: 若当前 merge 绕过规范化则断言失败；若已由 `normalizeDisplay` 覆盖，则该测试直接通过，不做无效生产代码修改。

- [ ] **Step 3: 只在失败时修正导入边界**

确保 `parseDisplay`、`mergeImportPayload`、快照恢复最终都通过 `normalizeDisplay`，不在 `importExport.ts` 再实现一套 sidebar 规范化。导出继续写整个 `display`，无需新 schema 分支。

- [ ] **Step 4: 完成 QA 脚本场景**

脚本按顺序覆盖：

1. 默认四核心 + 四系统我的空间。
2. 添加保存视图、策略、案例视图和第 9 个 overflow。
3. 精确项强选中；附加筛选只出现 modified 圆点。
4. 再点固定项恢复原始查询。
5. 三种工作台模式切换后核心模块恢复 pathname + search + mode。
6. 从列表/看板/表格打开详情，返回后来源交易位于 viewport。
7. 删除保存视图或策略后日常侧栏隐藏、管理器标失效。
8. Escape 取消、完成持久化、焦点返还。
9. 1920、1440、900、390 四个 viewport 无横向溢出。

在 `package.json` 增加：

```json
"qa:sidebar": "node scripts/qa-sidebar-navigation.mjs"
```

- [ ] **Step 5: 运行完整验证矩阵**

Run: `pnpm test && pnpm build && pnpm qa:design && pnpm qa:sidebar`

Expected: 四个命令退出码均为 0；控制台无未捕获错误和 React key/可访问名称警告。

- [ ] **Step 6: 检查占位符和变更边界**

Run: `$patterns = @('TO' + 'DO', 'FI' + 'XME'); rg -n ($patterns -join '|') src scripts/qa-sidebar-navigation.mjs`

Expected: 没有本次新增的占位符。

Run: `git diff --check && git status --short`

Expected: 无空白错误；只包含本计划范围内文件。

- [ ] **Step 7: 提交**

```bash
git add src/lib/importExport.ts src/regression.test.ts scripts/qa-sidebar-navigation.mjs package.json
git commit -m "test: cover sidebar navigation workflows"
```

---

## Final Acceptance Checklist

- [ ] 四个核心模块固定、顺序正确、不可编辑。
- [ ] 四类“我的空间”目标可混排，最多 8 个 pinned，overflow 不丢失。
- [ ] 旧 `sidebarPins` 迁移后顺序不变，新 UI 不再写旧字段。
- [ ] 保存视图和策略实时解析；删除后日常隐藏、管理器标失效。
- [ ] 核心模块恢复今日/交易/案例的 pathname + search + list/board/table。
- [ ] 自定义项精确直达，不合并最近查询。
- [ ] 同一页面只有一个强选中项；额外筛选显示“已修改”圆点。
- [ ] 列表、看板、表格详情返回恢复稳定交易锚点。
- [ ] 管理器支持拖拽、Alt+↑/↓、Delete、Escape、撤销与焦点返还。
- [ ] 移动端为五项底栏 + 更多抽屉 + 全屏管理器，无横向侧栏。
- [ ] JSON 导入导出和损坏配置规范化通过。
- [ ] `pnpm test && pnpm build && pnpm qa:design && pnpm qa:sidebar` 全部通过。

## Execution Choice

计划确认后选择一种执行方式：

1. **Subagent-driven（推荐）**：在当前任务中按 Task 逐项执行，每个任务完成后做规格与代码质量复核。
2. **Inline execution**：由当前代理按顺序直接执行全部任务，并在每个提交点汇报验证结果。
