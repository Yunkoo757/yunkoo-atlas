# Today Workspace Action Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让今日工作台始终只突出一个最高优先级下一步，并在非超限状态下把风险面板收敛为单行摘要。

**Architecture:** 保留 `getTodayWorkflowBuckets` 与现有风险计算作为唯一事实源。今日页用纯函数解析交易队列主动作并直接打开 buckets 中的第一笔记录；风险异常通过 `RiskStatusStrip` 既有 `data-risk-state` 和工作台专用密度类接管视觉优先级，不复制风险状态计算。

**Tech Stack:** React 18、TypeScript、React Router、Zustand、CSS `:has()`、Node 回归测试、Playwright 浏览器测试、Electron 桌面视觉矩阵。

## Global Constraints

- 始终以 UTF-8 无 BOM 读取和保存文件，完整保留中文字符。
- 仅适配 Windows 和 macOS 桌面客户端。
- 不新增手机、iPad、浏览器产品形态或其他平台适配逻辑。
- 不修改风险计算、交易状态、持久化、统计口径和现有队列排序。
- 页面右侧在任何状态下只允许一个主色动作。
- 每个行为改动先写失败测试，确认因缺少目标行为而失败后再实现最小代码。

---

## File Structure

- `src/views/TodayWorkspace.tsx`：解析并执行今日唯一主动作，组织风险与新建交易的动作槽位。
- `src/views/TodayWorkspace.css`：风险状态接管主动作、次级新建交易和工作台风险摘要密度。
- `src/components/RiskStatusStrip.tsx`：接受可选的工作台密度语义，不改变风险数据计算。
- `src/components/RiskStatusStrip.css`：限定在 `.is-workbench` 内的单行摘要与超限展开规则。
- `src/views/TodayWorkspace.design.test.ts`：纯函数优先级和页面视觉契约。
- `src/views/TodayWorkspacePrimaryAction.browser.test.tsx`：真实页面主动作的导航行为与可见层级。
- `src/views/TodayWorkspacePrimaryAction.browser.test.html`：浏览器测试入口。

---

### Task 1: Resolve the Single Trade Workflow Action

**Files:**
- Modify: `src/views/TodayWorkspace.design.test.ts`
- Modify: `src/views/TodayWorkspace.tsx`

**Interfaces:**
- Consumes: `{ active: number; resultPending: number; reviewPending: number }`。
- Produces: `resolveTodayPrimaryAction(counts): { kind: QueueFilter | 'create'; label: string }`。

- [ ] **Step 1: Write the failing priority test**

在 `TodayWorkspace.design.test.ts` 中导入并调用 `resolveTodayPrimaryAction`，使用手工字面量断言：结果优先于复盘，复盘优先于进行中，没有任务时返回新建交易。

- [ ] **Step 2: Verify RED**

Run: `node scripts/run-regression-tests.mjs`

Expected: FAIL，提示 `TodayWorkspace` 尚未导出 `resolveTodayPrimaryAction`。

- [ ] **Step 3: Implement the pure resolver**

在 `TodayWorkspace.tsx` 中加入：

```ts
export function resolveTodayPrimaryAction(counts: {
  active: number
  resultPending: number
  reviewPending: number
}): { kind: QueueFilter | 'create'; label: string } {
  if (counts.resultPending > 0) return { kind: 'resultPending', label: '补齐交易结果' }
  if (counts.reviewPending > 0) return { kind: 'reviewPending', label: '完成交易复盘' }
  if (counts.active > 0) return { kind: 'active', label: '继续当前交易' }
  return { kind: 'create', label: '新建交易' }
}
```

- [ ] **Step 4: Verify GREEN**

Run: `node scripts/run-regression-tests.mjs`

Expected: PASS。

### Task 2: Make the Primary Action Open the Next Record

**Files:**
- Create: `src/views/TodayWorkspacePrimaryAction.browser.test.tsx`
- Create: `src/views/TodayWorkspacePrimaryAction.browser.test.html`
- Modify: `src/views/TodayWorkspace.tsx`

**Interfaces:**
- Consumes: Task 1 的 `resolveTodayPrimaryAction` 和现有 `buckets`。
- Produces: 顶部 `data-today-primary-action`，点击后打开对应 bucket 第一笔交易；无任务时调用现有 `openComposer()`。

- [ ] **Step 1: Write the failing browser behavior test**

复用项目浏览器测试装载方式，构造一笔待结果交易和一笔待复盘交易。断言按钮文字为“补齐交易结果”，点击后路由进入待结果交易详情而不是待复盘交易详情。

- [ ] **Step 2: Verify RED**

Run: `node scripts/run-regression-tests.mjs`

Expected: FAIL，页面不存在 `data-today-primary-action`。

- [ ] **Step 3: Render and execute the action**

在 `TodayWorkspace` 中解析 `primaryAction`；当 kind 为 `create` 时调用 `openComposer()`，否则调用 `openTrade(buckets[primaryAction.kind][0])`。保留独立次级“新建交易”，但有队列任务时不使用主色。

- [ ] **Step 4: Verify GREEN**

Run: `node scripts/run-regression-tests.mjs`

Expected: PASS，顶部动作直接打开待结果交易。

### Task 3: Let Risk States Own the Primary Visual Priority

**Files:**
- Modify: `src/views/TodayWorkspace.design.test.ts`
- Modify: `src/views/TodayWorkspace.tsx`
- Modify: `src/views/TodayWorkspace.css`
- Modify: `src/components/RiskStatusStrip.tsx`
- Modify: `src/components/RiskStatusStrip.css`

**Interfaces:**
- Consumes: `.risk-status-period.is-triggered`、`.is-unknown`、`.is-partial`、`.is-unconfigured`、`.is-unreviewed`。
- Produces: `density="workbench"`、工作台唯一风险主动作、非超限单行摘要、超限完整周期详情。

- [ ] **Step 1: Write failing visual contracts**

断言今日页向风险条传入 `density="workbench"`，CSS 存在工作台非超限隐藏 `.risk-status-periods` 的规则、超限恢复三列的规则，以及风险异常隐藏 `data-today-primary-action` 并将新建交易降级的规则。

- [ ] **Step 2: Verify RED**

Run: `node scripts/run-regression-tests.mjs`

Expected: FAIL，提示缺少工作台风险密度和唯一主动作规则。

- [ ] **Step 3: Implement the workbench density and action slot**

给 `RiskStatusStrip` 增加可选 `density?: 'full' | 'workbench'`，默认 `full`；仅在 workbench class 内隐藏普通周期详情，并通过 `:has(.risk-status-period.is-triggered)` 展开。把两个风险恢复链接移入右侧动作槽，使用与 `Button` 一致的 36px 主动作外观；风险异常时隐藏交易队列主动作，并覆盖新建交易为描边层级。

- [ ] **Step 4: Verify GREEN and refactor**

Run: `node scripts/run-regression-tests.mjs`

Expected: PASS。

Run: `pnpm qa:design`

Expected: PASS。

### Task 4: Complete Desktop Verification

**Files:**
- Modify only if a verified regression requires a scoped fix.

**Interfaces:**
- Consumes: Tasks 1–3 的完整页面行为。
- Produces: 自动化、构建与桌面截图证据。

- [ ] **Step 1: Run type and complete behavior verification**

Run: `pnpm typecheck`

Expected: PASS。

Run: `pnpm test`

Expected: PASS，且无 skip/todo。

- [ ] **Step 2: Build the desktop renderer**

Run: `pnpm build`

Expected: PASS，包体预算通过。

- [ ] **Step 3: Run the desktop visual matrix**

Run: `pnpm qa:desktop-visual`

Expected: 全部场景无控制台错误、页面错误或横向溢出。

- [ ] **Step 4: Inspect the today screenshots**

检查 960×640、1280×860、1920×1080 的 `today.png`：右侧只有一个主色动作，正常风险为单行摘要，队列和列标题不遮挡，超限场景仍能看到三周期风险详情。

- [ ] **Step 5: Commit the implementation**

```powershell
git add -- src/views/TodayWorkspace.tsx src/views/TodayWorkspace.css src/views/TodayWorkspace.design.test.ts src/views/TodayWorkspacePrimaryAction.browser.test.tsx src/views/TodayWorkspacePrimaryAction.browser.test.html src/components/RiskStatusStrip.tsx src/components/RiskStatusStrip.css
git commit -m "feat(workbench): focus today on the next action"
```
