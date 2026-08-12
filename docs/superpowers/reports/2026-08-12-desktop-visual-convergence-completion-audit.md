# 桌面视觉收敛：完成度审计

审计提交：`a536f4a49d68e58881f10e5408ad5246e514826e`

审计日期：2026-08-13（Asia/Hong_Kong）

严格结论：**Windows 已通过；macOS 证据缺失；整体目标保持 ACTIVE。**

## 最终质量门禁

2026-08-13 01:15–01:18（Asia/Hong_Kong）从最终源码提交执行：

| 命令 | 结果 |
|---|---|
| `pnpm check:desktop-visual` | PASS，0 findings |
| `pnpm typecheck` | PASS，renderer 与 Electron TypeScript 工程均通过 |
| `pnpm test` | PASS，identity、quality node、全部 regression/browser、governance execution 均通过 |
| `pnpm build:app` | PASS；交易日志 247.2/249.0 KB，周复盘 363.0/390.6 KB，年度趋势 460.6/488.3 KB |
| `pnpm qa:electron` | PASS，25/25，健康分 10/10 |
| `pnpm qa:desktop-visual` | PASS，35/35，0 console/page error，0 overflow |
| `pnpm qa:desktop-visual:electron` | PASS，35/35，0 console/page error，0 overflow |
| Windows packaged audit | PASS，54/54，100%/125%/150% |
| `git diff --check` | PASS |
| UTF-8 without BOM | PASS，213 个变更文本文件中 BOM=0 |

测试日志中的 `Persist failed`、revision conflict 和 editor destroyed 输出来自主动故障注入用例；门禁退出码为 0，相关用例验证错误与恢复路径本身。

## VIS-01…VIS-18 严格矩阵

判定规则：`PASS` 必须有直接的双平台证据；renderer-only 或单平台证据不能替代另一平台。因此下表在 Windows 列记录已成立结论，在 macOS 列保留 `UNKNOWN`，总判定不虚报为完成。

| requirement | authoritative source/test | Windows evidence | macOS evidence | verdict |
|---|---|---|---|---|
| VIS-01 字体角色 | `tokens.css`；`desktopVisualTokens.test.ts`；35 张 Electron 图 | 五档窗口正文/数据/元数据/金融数字角色稳定 | 无 macOS Electron 截图 | UNKNOWN (macOS) |
| VIS-02 色彩纪律 | `check-desktop-visual-governance.mjs` | 治理 0 findings；打包态状态色/强调色复核通过 | 无 macOS 实机色彩证据 | UNKNOWN (macOS) |
| VIS-03 表面配方 | `PopoverSurface`、`ModalShell`、`Tooltip` 契约 | 核心页与关闭弹窗直接截图通过 | 无 macOS Electron 截图 | UNKNOWN (macOS) |
| VIS-04 间距令牌 | `tokens.css`；治理扫描 | 960–1920 五档无拥挤/断轨/溢出 | 无 macOS Electron 截图 | UNKNOWN (macOS) |
| VIS-05 命名图标 | `iconSize.ts`；治理扫描 | 无字符图标、无裸数字尺寸 findings | 无 macOS 实机渲染证据 | UNKNOWN (macOS) |
| VIS-06 控件几何/状态 | `DesktopControls.browser.test` | Button/IconButton/Segmented/Field 与三档缩放通过 | 无 macOS 键鼠旅程 | UNKNOWN (macOS) |
| VIS-07 焦点可见/恢复 | `DesktopPopoverKeyboard`、`ModalShell`、`CommandPalette` tests | Ctrl+K、Escape、不可误关闭弹窗、焦点契约通过 | 无 Cmd 键与 macOS 焦点旅程 | UNKNOWN (macOS) |
| VIS-08 分级反馈 | `SaveStatusIndicator.browser.test`；`InlineStatus` | 三档打包态保存错误均显示原因与恢复动作 | 无 macOS 保存错误旅程 | UNKNOWN (macOS) |
| VIS-09 仪表盘层级 | `DashboardHierarchy.design.test`；`DashboardScope.browser.test` | 当前范围 KPI 为首结论，五档 Electron 通过 | 无 macOS Electron 截图 | UNKNOWN (macOS) |
| VIS-10 周复盘层级 | `WeeklyReview*.test` | 页头共轨、事实/评分/完成动作可达，五档通过 | 无 macOS Electron 截图 | UNKNOWN (macOS) |
| VIS-11 详情优先级 | `DetailVisualHierarchy.design.test`；`DetailShortcutNavigation` | 正文优先、属性侧栏受控、短内容无巨量空卡 | 无 macOS Electron 截图 | UNKNOWN (macOS) |
| VIS-12 今日工作台 | `TodayWorkspace.design.test`；`RiskStatusStrip.design.test` | 风险在前、标题随范围、队列列标题；P1 已复验 | 无 macOS Electron 截图 | UNKNOWN (macOS) |
| VIS-13 日志语义 | `TradeList.design.test`；`TradeRowPresentation` | 列对齐、选择/收藏按意图显现；五档无溢出 | 无 macOS Electron 截图 | UNKNOWN (macOS) |
| VIS-14 随机复盘 | `ReviewSession*.browser.test` | 960–1920 短内容和动作距离稳定 | 无 macOS Electron 截图 | UNKNOWN (macOS) |
| VIS-15 桌面密度/宽度 | 固定 visual matrix | 960×640 可用，1920×1080 不过伸；三档 DPI 通过 | 无 Retina/macOS 窗口证据 | UNKNOWN (macOS) |
| VIS-16 原生平台行为 | `windowPresence.test`；`windowBounds.test` | 首次关闭、托盘、文件选择、恢复、菜单、缩放直接通过 | 未验证红色关闭、Dock、Cmd+Q、Cmd 标签 | UNKNOWN (macOS) |
| VIS-17 降噪 | 跨页截图；治理扫描 | 7 页统一层级，无同质卡片与多色导航竞争 | 无 macOS Electron 截图 | UNKNOWN (macOS) |
| VIS-18 回归安全 | 最终质量门禁 | type/test/build/Electron/packaged 全通过 | 未运行 macOS artifact 与实机 Electron | UNKNOWN (macOS) |

## 已实现的双层收敛

1. 系统层：统一字体、颜色、间距、图标尺寸、表面、控件、Popover、Modal 与反馈配方，并用治理脚本阻止裸颜色、未命名图标尺寸、字符图标、移动/触摸产品分支和未定义变量回流。
2. 页面层：重新排序今日工作台、交易日志、交易详情、仪表盘、周复盘、随机复盘和设置页的核心信息，保留高密度但减少等权竞争。

## 剩余完成条件

仅剩 macOS 直接证据，不能由 Windows 或浏览器模拟替代：

- 在 macOS arm64 与 x64 产物可用范围内记录 artifact SHA-256；
- Retina/default scaling 重跑 7 个核心页；
- 验证红色关闭保留 Dock、`Cmd+Q` 退出、菜单/快捷键使用 Cmd、窗口恢复可见；
- 确认不存在 Windows 托盘说明，并复测保存错误/恢复与原生文件选择；
- macOS 全部成立后更新 VIS-01…VIS-18 verdict，再关闭持续目标。
