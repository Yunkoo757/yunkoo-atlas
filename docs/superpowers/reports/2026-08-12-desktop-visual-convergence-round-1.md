# 桌面视觉收敛：第一轮审计

审计对象：Trader Atlas Windows/macOS 桌面客户端

源码提交：`d84a34f`（初始截图）→ `a536f4a`（修复复测）

审计日期：2026-08-13（Asia/Hong_Kong）

## 范围与方法

- 固定 5 档桌面窗口：960×640、1280×860、1440×900、1600×1000、1920×1080。
- 固定 7 个核心场景：今日工作台、交易日志、交易详情、仪表盘、周复盘、随机复盘、设置/数据。
- 共检查 35 个场景/窗口组合，逐项观察布局、密度、字体、色彩、表面、控件、图标、状态反馈、内容优先级和横向溢出。
- 截图使用隔离 fixture，不读取用户真实资料库。
- 第一轮浏览器渲染用于快速全矩阵检查；缺陷修复后必须在 Electron 和 Windows 打包态复验。

## 结果

| 级别 | 数量 | 结论 |
|---|---:|---|
| P0 | 0 | 未发现阻断核心任务的问题 |
| P1 | 1 | 已修复并完成全矩阵复验 |
| P2 | 0 | 未留下未命名的视觉例外 |

## 缺陷记录

| id | severity | route | viewport | platform | evidence | source owner | fixCommit | retestEvidence |
|---|---|---|---|---|---|---|---|---|
| VIS-R1-001 | P1 | `/today-record`、`/list` | 1280×860、1440×900、1600×1000、1920×1080 | Windows Electron | `.gstack/qa-reports/desktop-visual-convergence/round-1-pre-fix/1280x860/{today,trades}.png`、`1920x1080/{today,trades}.png` | `src/components/trades/TradeList.css` | `a536f4a` | `.gstack/qa-reports/desktop-visual-convergence/electron/{1280x860,1920x1080}/{today,trades}.png`；35/35、0 error、0 overflow |

### VIS-R1-001 根因与修复

共享列模板依赖 `--trade-select-column`，但变量只声明在 `.trade-list`。`TradeListColumns` 与 `.trade-list` 是同级节点，1280px 以上没有命中窄窗回退规则时，标题和交易行的 `grid-template-columns` 失效，导致列重叠。修复将 `--trade-select-column` 与 `--trade-ref-column` 声明移动到 `:where(.trade-list-columns, .trade-row)` 自身作用域，并加入回归断言，确保共享模板不再依赖不存在的祖先继承。

## 第一轮结论

修复后，Windows Electron 的 35 个场景/窗口组合全部无横向溢出，今日工作台与交易日志在 1280–1920px 的编号、交易、策略/标签、周期、盈亏、R 和日期列重新稳定对齐。第一轮没有遗留 P0/P1，也没有发现需要保留为光学例外的系统性 P2。
