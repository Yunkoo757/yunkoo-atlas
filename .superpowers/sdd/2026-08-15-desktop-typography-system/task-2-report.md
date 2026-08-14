# Task 2 报告：桌面壳层与交易工作台字体映射

## 状态

已完成。提交信息为 `style: align shell and trade typography`；最终提交 SHA 见任务交接回报。

## 变更文件

- `src/lib/typographySystem.design.test.ts`
- `src/components/Sidebar.css`
- `src/components/sidebar/SidebarWorkspace.css`
- `src/components/Topbar.css`
- `src/components/trades/TradeList.css`
- `src/components/trades/QuickViewBar.css`
- `src/components/RowPreviews.css`
- `src/views/TodayWorkspace.css`
- `src/views/BoardView.css`
- `src/views/ListView.css`

`src/views/WorkbenchPerformance.design.test.ts` 原有的冻结几何合同已精确覆盖 `--trade-group-height: 36px`、`HEADER_CONTENT_HEIGHT = 36`、`HEADER_TOP_GAP = 8` 和 `HEADER_HEIGHT = HEADER_CONTENT_HEIGHT + HEADER_TOP_GAP`，因此未为形式上的文件改动重复或削弱该合同。

## RED / GREEN

- RED：新增 shell 字体合同后，focused regression 明确失败于 `SidebarWorkspace.css` 的 `letter-spacing: 1px`；失败原因是新角色层级禁止该扩张字距。
- GREEN：导航和行采用 Row，列、计数与辅助数据采用 Metadata，微标签采用 Caption；标题采用 Section/Page/Financial 角色。所有硬编码 500/600/700 权重改为 canonical weight token，业务数据使用 `--numeric-tabular`。
- 月份分组标题改为 Row `13px / 20px / 600` 的 token 映射；未改动月份栏和虚拟列表的任何 box metric。

## 验证

- `node scripts/run-regression-tests.mjs --unit-only src/lib/typographySystem.design.test.ts src/views/WorkbenchPerformance.design.test.ts`：RED 已观察。
- `node scripts/run-regression-tests.mjs --unit-only src/views/WorkbenchPerformance.design.test.ts src/lib/typographySystem.design.test.ts`：PASS（12/12）。
- `pnpm typecheck`：PASS。
- `git diff --word-diff=porcelain -- src/components/trades/TradeList.css src/views/WorkbenchPerformance.design.test.ts`：TradeList 仅有文字/数值变体声明变更；几何测试文件无变更。
- 暂存后执行 `git diff --cached --check`：PASS。

## 关注点

- `WorkbenchPerformance.design.test.ts` 的 36px/8px/44px 合同在本任务开始前已存在且通过；没有将 `36px` 复制到 `TradeList.css`，避免把 canonical geometry token 硬编码回生产样式。
- 未触碰 `height`、`min-height`、`padding`、`grid-template-columns`、`top`、`transform` 或虚拟列表常量。范围仅面向 Windows 与 macOS 桌面端。
