# 侧栏「快捷」区恢复（方案 A）

日期：2026-07-11  
状态：已通过  
相关：`2026-07-10-linear-frontend-rebuild-design.md`（一级导航仍为四模块；本 spec 在其下**增补**二级「快捷」区，不推翻重建 IA）

## 1. 问题

重建后侧栏只渲染 `PRIMARY_NAV`（今日记录 / 交易日志 / 案例记录 / 仪表盘）与底部回收站、设置，中间大片空白。`SECONDARY_NAV`（进行中、星标交易、错过的机会、模拟）与对应路由（`/active`、`/favorites`、`/missed`、`/sim`）仍在代码与命令面板中，但侧栏不可见，用户难以发现「模拟回测」等高频入口。

## 2. 目标

1. 在侧栏恢复常驻「快捷」导航区，至少包含模拟回测入口。
2. 复用现有路由与 `SECONDARY_NAV` / `sidebarPins`，避免新造一套导航模型。
3. 保持重建原则：时间、策略、复杂筛选仍只在列表顶栏，不回流侧栏。

## 3. 非目标（本轮不做）

- 方案 B「我的视图」固定区、方案 C 模块内嵌套展开。
- 侧栏底部「导入 / 命令面板」等动作芯片（搜索、新建已在侧栏顶图标）。
- 新增或改造「编辑侧栏固定项」的设置 UI（数据字段 `display.sidebarPins` 已存在；本轮只按该字段渲染）。
- 把时间 / 策略 / 保存视图再塞回侧栏一级列表。

## 4. 信息架构

自上而下：

1. 顶栏：品牌 / 头像 + 搜索 + 新建（不变）
2. **工作台**：`PRIMARY_NAV` 四项（不变）
3. **快捷**：按 `display.sidebarPins` 顺序渲染对应 `SECONDARY_NAV` 项（本轮新增渲染）
4. spacer（弹性空白）
5. 回收站、设置（不变）

分区标题文案：

- 工作台：保持现有「工作台」
- 快捷：新增「快捷」

快捷项与路由（与现有一致）：

| id（内部） | 侧栏文案 | 路由 |
|---|---|---|
| `active` | 进行中 | `/active` |
| `favorites` | 星标交易 | `/favorites` |
| `missed` | 错过的机会 | `/missed` |
| `paper` | **模拟回测** | `/sim` |

说明：将 `SECONDARY_NAV` 中 `paper` 的 `label` 从「模拟」改为「模拟回测」，侧栏与其它引用 `SECONDARY_NAV.label` 的入口一并统一。命令面板若使用独立文案且已是「模拟回测」，可不动。

## 5. 行为与数据

### 5.1 显示哪些项

- 数据源：`useStore` → `display.sidebarPins`（经 `normalizeSidebarPins`）。
- 默认：`DEFAULT_SIDEBAR_PINS` = `active`、`favorites`、`missed`、`paper`（四项全显）。
- 渲染顺序：严格按 `sidebarPins` 数组顺序；未知 id 已被 normalize 丢弃。
- 若 `sidebarPins` 为空数组：快捷区分区标题与列表均不渲染（避免空分区）；不回退硬编码四项，以免覆盖用户刻意清空的偏好。若产品更希望「空则回退默认」，实现前可再改本条——**本 spec 选定：空则隐藏整区**。

### 5.2 激活态

- 使用现有 `isSidebarNavActive(path, to)`。
- `/sim`、`/sim/board`、`/sim/table` 及旧别名重定向目标均应高亮「模拟回测」。
- 「交易日志」与快捷子路径的激活关系保持现状：进入 `/favorites` 等时，快捷项高亮；一级「交易日志」是否同时高亮以现有 `rememberableWorkspaceKind` / `primaryActive` 逻辑为准，本轮不借机重做工作区记忆。

### 5.3 角标数量

与一级「交易日志」等一致：有数量才显示，`0` 不显示。输入集为未删除交易；计数调用现有 `filterTrades`（及必要时与列表页一致的 `starredIds`），禁止在 Sidebar 内另写一套状态判定。

| 项 | 调用约定（与对应路由页一致） |
|---|---|
| 进行中 | `filterTrades(..., { type: 'active', tradeKind: 'live' }, ...)` |
| 星标交易 | `filterTrades(..., { type: 'starred' }, starredIds)`（默认 `isAccountTrade`，不含案例） |
| 错过的机会 | `filterTrades(..., { type: 'missed' }, ...)` |
| 模拟回测 | `filterTrades(..., { type: 'all', tradeKind: 'paper' }, ...)`（或等价：仅 `tradeKind === 'paper'` 的未删除集） |

### 5.4 视觉

- 沿用现有 `.sb-section` / `.sb-item` / `.sb-section-label` / `.sb-item-count`，与工作台分区视觉一致。
- 不新增彩色强调、左侧竖线或卡片容器。
- 宽度仍为 `244px`；窄屏抽屉行为不变。

## 6. 实现落点（预期）

- 主要：`src/components/Sidebar.tsx`、必要时 `Sidebar.css`
- 数据：`src/lib/sidebarNav.ts`（文案「模拟回测」）
- 测试：扩展或新增 regression，断言快捷区路由集合包含 `/active`、`/favorites`、`/missed`、`/sim`，且时间/策略路径仍不得进入侧栏；一级 `PRIMARY_NAV` 断言保持不变
- 不改：路由表、Sim 页、命令面板（除非为文案一致性的极小改动）

## 7. 验收标准

1. 桌面侧栏在工作台与回收站之间可见「快捷」区，默认含进行中、星标交易、错过的机会、模拟回测。
2. 点击「模拟回测」进入 `/sim`（或等价模拟页），侧栏该项为激活态。
3. 点击其余三项进入对应现有列表页且筛选正确。
4. 顶栏搜索/新建、底部回收站/设置行为不变。
5. 时间、策略不出现在侧栏。
6. 无「导入 / 命令面板」侧栏动作芯片。

## 8. 与重建设计的关系

重建设计规定一级为四模块、筛选进顶栏。本改动是**增补二级快捷目的地**，不是把筛选器搬回侧栏。若后续要把「我的视图」固定进侧栏，另开 spec（方案 B），不在本轮范围。
