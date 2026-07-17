# 去掉入场/出场价 + 详情「项目」改「策略」实现计划

> **For agentic workers:** 本会话按 Inline Execution 推进；步骤用 checkbox 跟踪。

**Goal:** 主流程不再录入/展示入场与出场价；平仓只认盈亏/R；详情属性区「项目」改为「策略」。

**Architecture:** UI 与平仓路径下线价格模式；`Trade.entry`/`exit` 与历史 `resultSource: 'price'` 保留兼容；导入 CSV 仍可映射价格列。

**Tech Stack:** React、现有 `prepareTradeClose` / DetailView / TradeCloseDialog、node 测试。

---

## 文件地图

| 文件 | 职责 |
|------|------|
| `src/views/DetailView.tsx` | 去掉入场/出场行；「项目」→「策略」；悬停副标题 |
| `src/components/TradeCloseDialog.tsx` | 去掉「出场价格」模式与出场价输入 |
| `src/lib/tradeClose.ts` | 删除 `price` 平仓分支；关闭补丁不再写 `exit` |
| `src/lib/tradeClose.test.ts` | 删除/改写价格平仓用例 |
| `src/components/NotionImportModal.tsx` | 去掉补点位引导 |
| `src/lib/notionImport.ts` | 警告文案不再强调入场/出场价 |
| `src/views/ListView.tsx` | 帮助文案去掉「入场」 |

### Task 1: 平仓核心去掉 price 模式

**Files:** `src/lib/tradeClose.ts`, `src/lib/tradeClose.test.ts`

- [x] 从 `CloseResultMode` 去掉 `'price'`；`TradeCloseInput` 去掉 `exit`；`TradeClosePatch` 去掉 `exit`；删除 price 分支
- [x] 删除/改写 `tradeClose.test.ts` 中一切 `resultMode: 'price'` 用例；其余 pnl/r 用例去掉 `exit` 字段
- [x] 跑相关单测通过

### Task 2: 平仓弹窗 UI

**Files:** `src/components/TradeCloseDialog.tsx`

- [x] 去掉 RESULT_MODES 的 price、exit state、出场价输入与相关 summary/派生 outcome UI
- [x] 固定手动填写（`resultMode: 'pnl'`），去掉「记录依据」切换

### Task 3: 详情 UI + 文案

**Files:** `src/views/DetailView.tsx`, Notion/List 文案文件

- [x] 去掉入场/出场 `EditableDataRow`
- [x] Section「项目」→「策略」；subtitle「策略项目」→「策略」
- [x] Notion/List 引导文案按规格改

### Task 4: 回归

- [x] `pnpm typecheck` 通过
- [x] 全量单测与浏览器 harness 通过
- [x] 详情页移动端回归通过：无入场/出场价、无日期浮层、保留行内日期编辑
- [x] CSV 无入场/出场价的导入回归通过
- [x] `pnpm qa:release` 通过（含构建、10k 性能与 Electron 数据链路）
