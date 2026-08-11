# Task 5 报告：注册随机复盘快捷键并统一桌面 Q/E

## Status

完成。实现仅面向 Windows/macOS 桌面客户端；未新增 browser/mobile 产品逻辑，未实现 Batch 1 的 `trade.completeAndNext`，未修改 schema。

## TDD：RED / GREEN

### RED 1：注册表、路由、Q/E 与 package gate

先修改/新增契约测试，再运行：

```powershell
node scripts/run-regression-tests.mjs --unit-only src/shortcuts/reviewSessionActions.test.ts src/shortcuts/listActions.test.ts src/shortcuts/workspaceActions.test.ts
node --test scripts/test-discovery.test.mjs
```

预期失败（exit 1）：

- `reviewSession.unfamiliar` 尚未注册。
- 自定义随机复盘绑定无法在 `/review-session` 执行。
- `reviewSession` scope 尚未在 `/review-session` 激活。
- `list.focusPrev` 仍为 E，而不是 Q。
- `package.json#scripts.test` 仍展开 `pnpm qa:risk-management-mobile`。

最小实现后，首次 GREEN 暴露了显式 pathname 在无 `window` 环境下被忽略的真实边界；修正为优先使用调用方 pathname 后，快捷键聚焦测试全部通过。

### RED 2：账户交易 handler

先新增账户交易 handler 契约，再运行：

```powershell
node scripts/run-regression-tests.mjs --unit-only src/shortcuts/reviewSessionActions.test.ts
```

预期失败（exit 1）：`ReviewSessionView` 尚未提供统一引擎的局部 handler 工厂。实现 `createReviewSessionShortcutHandlers()` 并用 `registerShortcutHandlers()` 替换 capture listener 后 GREEN：4/4 通过。

### 全回归发现并收口旧批准表

首次 `pnpm test`/全回归稳定失败于 `src/regression.test.ts::testApprovedShortcutDefaultsMatchProfile`：旧批准表仍冻结 Next=Q、Prev=E，且缺少 5 个新动作。获得机械范围授权后只同步该默认表；复跑对应回归通过。

## 快捷键契约

| Action ID | 默认键 | Scope | 激活页面 |
| --- | --- | --- | --- |
| `reviewSession.unfamiliar` | `1` | `reviewSession` | 仅 `/review-session` |
| `reviewSession.recheck` | `2` | `reviewSession` | 仅 `/review-session` |
| `reviewSession.mastered` | `3` | `reviewSession` | 仅 `/review-session` |
| `reviewSession.skip` | `N` | `reviewSession` | 仅 `/review-session` |
| `reviewSession.back` | `P` | `reviewSession` | 仅 `/review-session` |

- Scope priority 为 50；随机复盘动作通过视图局部 `registerShortcutHandlers()` 注册。
- 已删除 `ReviewSessionView` 的硬编码 capture listener，以及 lib 中的 `reviewSessionKeyAction()`、专属 type/import/test helper；没有保留第二条键盘路径。
- 账户交易的 1/2/3 handlers 被消费但不调用掌握度评估；N/P 仍调用 skip/back。
- 默认 `list.focusPrev=Q`、`list.focusNext=E`；`trade.prev=Q`、`trade.next=E` 保持不变。
- 用户显式绑定仍由 `resolveBinding()` 优先解析；测试覆盖 list 自定义 X、reviewSession.skip 自定义 X，旧默认键不再触发对应动作。未做强制迁移或覆写。

## Package gate

- 仅从 `scripts.test` 删除 `pnpm qa:risk-management-mobile`。
- `scripts['qa:risk-management-mobile'] = 'node scripts/qa-risk-management-mobile.mjs'` 保留，可用于历史诊断。
- 未删除或改写任何历史 mobile 文件，也未重构移动端 UI。

## 范围授权

任务执行中取得两次机械且最小的额外文件授权：

1. `src/lib/reviewSession.test.ts`：仅删除旧 `reviewSessionKeyAction` import、专属 `keyEvent` helper 和旧硬编码键盘测试；统一引擎契约迁移到 `src/shortcuts/reviewSessionActions.test.ts`。
2. `src/regression.test.ts`：仅同步批准默认快捷键表的 Q/E 方向和 5 个随机复盘动作。

## 最终验证

| 命令 | 结果 |
| --- | --- |
| Task 5 指定 8 文件聚焦 unit runner | exit 0，57/57 PASS |
| `node --test scripts/test-discovery.test.mjs` | exit 0，25/25 PASS |
| `node scripts/run-browser-tests.mjs . vite.config.ts` | exit 0；全部 browser fixtures PASS；随机复盘默认及声明 viewport 均 PASS |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0（104.5 秒）；默认链未调用 mobile QA |
| `git diff --check` | exit 0 |
| UTF-8 严格解码与 BOM 检查 | 所有改动文件 UTF-8 有效、无 BOM |

runner contract 输出中的 empty/unknown/stalled fixture `FAIL` 行是 3 个预期失败场景自身的测试数据；Node test 总结为 25 pass / 0 fail。

## 文件

- `package.json`
- `scripts/test-discovery.test.mjs`
- `src/config/default-profile.json`
- `src/lib/reviewSession.ts`
- `src/lib/reviewSession.test.ts`
- `src/regression.test.ts`
- `src/shortcuts/types.ts`
- `src/shortcuts/actions.ts`
- `src/shortcuts/engine.ts`
- `src/shortcuts/listActions.test.ts`
- `src/shortcuts/workspaceActions.test.ts`
- `src/shortcuts/reviewSessionActions.test.ts`（新增）
- `src/views/ReviewSessionView.tsx`
- 本报告

## 提交与 concerns

- 提交：本报告所在提交，message 为 `fix: align desktop review shortcuts`；最终提交哈希见任务交付消息。
- Concerns：无已知功能问题。完整 browser runner 仍执行仓库历史 viewport fixtures，这不扩展产品适配范围；显式 mobile QA 脚本仍按要求保留但不再属于默认桌面 `test` 门禁。

## Fix round 1/5：动态提示与统一事件保护

### 审查修复

- 删除 `ASSESSMENT_OPTIONS` 的静态 `key` 字段以及按钮内硬编码的 `1/2/3/N/P`。
- `ReviewSessionItem` 分别通过 `useShortcutHint()` 解析 `reviewSession.unfamiliar/recheck/mastered/skip/back`；自定义绑定同步更新可见 `<kbd>`、`aria-keyshortcuts` 和 aria-label。
- 禁用绑定时不渲染旧 `<kbd>`，不保留 `aria-keyshortcuts`，aria-label 明确显示“未设置快捷键”。案例 skip 使用“跳过”标签覆盖，账户交易仍使用“下一条”。
- `handleShortcutKeydown()` 在任何动作匹配前统一拒绝 `defaultPrevented`、`repeat`、`isComposing` 和 `keyCode === 229`，并清理可能存在的序列缓冲。

### RED / GREEN

RED（基于 `9615c33`）：

```powershell
node scripts/run-regression-tests.mjs --unit-only src/shortcuts/reviewSessionActions.test.ts
# exit 1：repeat/defaultPrevented/isComposing/keyCode 229 仍会执行 skip

# 通过 runBrowserRegressionTests 精确请求 ReviewSession browser stable test ID
# exit 1：自定义 unfamiliar=X 后可见提示仍为 1
```

GREEN：

| 命令 | 结果 |
| --- | --- |
| `node scripts/run-regression-tests.mjs --unit-only src/shortcuts/reviewSessionActions.test.ts src/shortcuts/listActions.test.ts src/shortcuts/workspaceActions.test.ts` | exit 0，22/22 PASS |
| ReviewSession browser stable test ID（默认 + 4 个声明 viewport） | exit 0，5/5 PASS |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0（97.4 秒） |

### 本轮文件、提交与 concerns

- `src/shortcuts/engine.ts`
- `src/shortcuts/reviewSessionActions.test.ts`
- `src/views/ReviewSessionView.tsx`
- `src/views/ReviewSession.browser.test.tsx`
- 本报告
- 提交：窄修复 commit，message 为 `fix: honor review shortcut state`；最终提交哈希见任务交付消息。
- Concerns：无已知问题。事件保护是统一引擎级安全契约，会阻止所有 scope 对已消费、重复或输入法组合事件的处理；这与旧随机复盘 helper 的既有保护一致。未修改 Batch 1、schema 或 mobile 产品功能。

## Fix round 2/5：保留评估后果的 accessible name

### RED / GREEN

先在 `src/views/ReviewSession.browser.test.tsx` 增加默认、自定义与禁用三态契约，再精确运行 ReviewSession browser stable test ID。

- RED（exit 1）：默认“还没掌握”按钮的 aria-label 只有 `还没掌握（1）`，没有保留可见后果“3 天后再看”。
- GREEN：评估按钮统一用 `option.label + option.hint` 作为提示 label override，再由 `useShortcutHint()` 附加当前快捷键或“未设置快捷键”；aria-label 覆盖子内容，因此标签和后果只朗读一次。
- 自定义 X：`还没掌握，3 天后再看（X）`，并同步 `aria-keyshortcuts=X`。
- 禁用：`还没掌握，3 天后再看（未设置快捷键）`，不渲染旧 `<kbd>`，不保留 `aria-keyshortcuts`。

| 命令 | 结果 |
| --- | --- |
| ReviewSession browser stable test ID（默认 + 4 个声明 viewport） | exit 0，5/5 PASS |
| `pnpm typecheck` | exit 0 |

### 本轮文件、提交与 concerns

- `src/views/ReviewSessionView.tsx`
- `src/views/ReviewSession.browser.test.tsx`
- 本报告
- 提交：窄修复 commit，message 为 `fix: preserve review assessment context`；最终提交哈希见任务交付消息。
- Concerns：无已知问题。未修改 engine、registry、Batch 1、schema 或 mobile 产品功能。
