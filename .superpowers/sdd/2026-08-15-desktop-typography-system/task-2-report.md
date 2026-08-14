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

## Fix Round 1/5

- RED：selector 级合同精确比较属性值后，`today-focus-eyebrow` 的 `letter-spacing` 以 `0.02em` 对 `0` 失败；该中文“行动队列”眉标不属于全大写微标签。合同还覆盖 Board 时间周期、Sidebar 中文分区和 `rp-note` 的完整角色度量。
- GREEN：`.today-focus-eyebrow`、`.bd-card-timeframe` 与 `.sb-section-label` 的字距均为 `0`；`.bd-card-timeframe` 继续显式使用 `--numeric-tabular`；`.rp-note` 采用完整 Row `13/20` 映射。
- 测试：原先的全文件禁词扫描已替换为 selector 级属性值精确比较，并验证交易行、月份分组标题的 canonical Row 角色。剩余 `0.02em` 规则必须同时是 Caption 并带 `text-transform: uppercase`。
- 几何：本轮只修改 `letter-spacing` 与 `line-height`，未修改月份分组、任何 box metric 或虚拟列表常量。

## Fix Round 2/5

- RED：恢复九文件范围的负向合同并改用真实内容 allowlist 后，`.sb-editor-group-header h3` 因未批准的 `0.02em` 明确失败；其渲染内容为中文“常驻侧栏/更多”。
- GREEN：`.sb-editor-group-header h3` 与 `.sb-target-group h4` 均使用 `letter-spacing: 0`，并删除对中文无效的 `text-transform: uppercase`。后者的分组标签同样均为中文。
- 测试：完整九文件清单重新覆盖 `700`、`620`、`1px`、`0.04em` 四项禁值；原 selector 级正向角色合同仍保留。`0.02em` 只接受 `path + selector + 内容源 + 拉丁大写内容` 的显式 allowlist，本轮 allowlist 为空，因此所有残留 0.02em 均会失败。
- 几何：仅删除无效文本转换并归零字距，未改月份分组或任何 box metric。

## Fix Round 3/5

- RED：allowlist 内容 helper 的基线规则错误接受纯数字 `2026`，新增 fail-closed 样例因此失败。
- GREEN：allowlist 内容必须匹配受控 ASCII 微标签字符集且至少含一个 `A-Z`；`2026`、`15/30`、中文和中英混排均被拒绝。
- 归属证明：未来例外条目必须提供 CSS `path + selector`、`renderSourcePath`、同一 JSX 元素中含该 `className` 与精确文本的 `renderedJsx`。测试先校验 JSX 的 selector/text 绑定，再校验完整片段真实存在于该 render source，未再使用宽泛的文本包含判断。
- 生产视觉与月份分组均未修改；九文件负向合同和 selector 正向角色合同保持不变。

## Integration Fix Round 4/5

- RED：`TodayWorkspace.design.test.ts` 的旧 `font-size: 13px` 字面合同在 canonical token 迁移后失败；收紧为 Row 13/20 后，明确发现队列 Tab 缺少 Row 20px 行高。
- GREEN：在已授权的 `.today-queue-tabs button`、`.today-focus .empty-btn`、`.today-stats-link` 添加 `line-height: var(--type-row-line-height)`，未修改字号、height/min-height、padding、display 或布局。
- 合同：三个控件分别保留 32px/36px 最小几何并精确断言 Row 13/20；`.today-stats-sub` 断言 Metadata 12/16，`.today-stats-title` 断言批准的 Section title/semibold 层级，避免将所有控件归并为同一角色。
- 月份分组与其他生产文件未改动。
