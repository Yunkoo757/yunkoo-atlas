# 桌面视觉收敛：完成度审计

审计提交：`acf03fe18b0966b1beafadedfd7aa9603333c40e`

审计日期：2026-08-13（Asia/Hong_Kong）

严格结论：**Windows 与 macOS arm64/x64 均已通过；双层视觉收敛目标 COMPLETE。**

## 最终质量门禁

| 门禁 | 结果 |
|---|---|
| `pnpm check:desktop-visual` | PASS，0 findings |
| `pnpm typecheck` | PASS，renderer 与 Electron TypeScript 工程均通过 |
| `pnpm test` | PASS，identity、quality node、全部 regression/browser、governance execution 均通过 |
| `pnpm build:app` | PASS；交易日志、周复盘与年度趋势均在 bundle budget 内 |
| `pnpm qa:electron` | PASS，25/25，健康分 10/10 |
| `pnpm qa:desktop-visual` | PASS，35/35，0 console/page error，0 overflow |
| `pnpm qa:desktop-visual:electron` | PASS，35/35，0 console/page error，0 overflow |
| Windows packaged audit | PASS，54/54，100%/125%/150% |
| macOS packaged audit | PASS，arm64 35/35 + x64 35/35，各 9/9 原生检查 |
| Electron Platform Evidence | [Actions 31660837940](https://github.com/Yunkoo757/yunkoo-atlas/actions/runs/31660837940) 四个 job 全绿 |
| `git diff --check` | PASS |
| UTF-8 without BOM | PASS |

测试日志中的 `Persist failed`、revision conflict 和 editor destroyed 输出来自主动故障注入用例；门禁退出码为 0，相关用例验证错误与恢复路径本身。

## macOS 直接证据

证据来自干净提交 `acf03fe18b0966b1beafadedfd7aa9603333c40e`，实际启动 electron-builder 生成的 `.app`，不使用浏览器模拟。GitHub 托管 macOS 虚拟显示器的原生缩放为 1×；证据按实际内容尺寸记录，未把被工作区限制的请求尺寸误报为截图尺寸。

| 架构 | runner / 系统 | package SHA-256 | executable SHA-256 | 视觉结果 |
|---|---|---|---|---|
| arm64 | `macos-26` / Darwin 25.6.0 | `53AB607467805F9F25C25E8C43FCD25050C7911EF0D562CAD6BBB03BE46CA2EA` | `69CB21F64C53C751678957803B2D82D2D5D7F054AFD570267EDA21179CBFF136` | 35 张；0 error；0 overflow；实际高度 608–645 px |
| x64 | `macos-26-intel` / Darwin 25.6.0 | `BD64E2870DFF41711F300FDC536DAF0B755F4C03BB06BFD19F6E5463E5ECD7A1` | `2C50CE097F5B1A244295E69449A6D37EF427D53D51A647F947EA27DC195ECED4` | 35 张；0 error；0 overflow；实际高度 608–927 px |

两架构均直接通过：

- `journalBridge.platform === darwin`，Chromium DPR 与系统显示 scale factor 一致；
- 越界窗口状态恢复到当前工作区内；
- 原生 `showOpenDialog` 被实际调用，保存失败显示原因与两个恢复动作；
- 快捷键设置显示 `⌘K`，原生菜单为 `Quit Trader Atlas` 且加速器为 `CommandOrControl+Q`；
- 关闭最后窗口后应用仍存活、窗口数为 0、Dock 保留，且没有 Windows 关闭/托盘文案；
- 重新激活会创建窗口；Electron 官方与用户 Cmd+Q 等价的 `app.quit()` 路径完成安全退出；
- 隔离 userData 与资料库均位于唯一临时目录，未访问真实资料库，结束后已清理。

## VIS-01…VIS-18 严格矩阵

| requirement | authoritative source/test | Windows evidence | macOS evidence | verdict |
|---|---|---|---|---|
| VIS-01 字体角色 | `tokens.css`；`desktopVisualTokens.test.ts` | 五档窗口角色稳定 | arm64/x64 七页截图直接复核 | PASS |
| VIS-02 色彩纪律 | 视觉治理；跨页截图 | 0 findings；三档缩放复核 | 两架构暗色表面、状态色与强调色一致 | PASS |
| VIS-03 表面配方 | `PopoverSurface`、`ModalShell`、`Tooltip` | 核心页与关闭弹窗通过 | 打包态核心页和保存恢复通过 | PASS |
| VIS-04 间距令牌 | `tokens.css`；治理扫描 | 960–1920 无断轨 | 实际 960–1920 宽度无拥挤/溢出 | PASS |
| VIS-05 命名图标 | `iconSize.ts`；治理扫描 | 无字符图标、裸数字尺寸 | 两架构原生渲染一致 | PASS |
| VIS-06 控件几何/状态 | `DesktopControls.browser.test` | 三档缩放通过 | 原生键鼠旅程与七页状态通过 | PASS |
| VIS-07 焦点可见/恢复 | Popover/Modal/CommandPalette tests | Ctrl+K、Escape、焦点恢复通过 | ⌘K、Escape、关闭/激活通过 | PASS |
| VIS-08 分级反馈 | `SaveStatusIndicator.browser.test` | 保存错误原因与恢复动作通过 | 两架构均为 2 个恢复动作 | PASS |
| VIS-09 仪表盘层级 | Dashboard tests | 当前范围 KPI 为首结论 | 最小/最大工作区人工复核通过 | PASS |
| VIS-10 周复盘层级 | WeeklyReview tests | 页头、事实、评分、完成动作可达 | 最小/最大工作区人工复核通过 | PASS |
| VIS-11 详情优先级 | Detail tests | 正文优先、属性侧栏受控 | 窄窗折叠、宽窗侧栏均清晰 | PASS |
| VIS-12 今日工作台 | Today/Risk tests | 风险在前、队列列标题稳定 | 两架构最小/最大工作区通过 | PASS |
| VIS-13 日志语义 | TradeList tests | 列对齐、选择/收藏按意图显现 | 960 与 1920 列语义稳定 | PASS |
| VIS-14 随机复盘 | ReviewSession tests | 短内容和动作距离稳定 | 两架构最小/最大工作区通过 | PASS |
| VIS-15 桌面密度/宽度 | 固定 visual matrix | 960–1920；100%/125%/150% | 原生工作区裁限按实际尺寸记录并通过 | PASS |
| VIS-16 原生平台行为 | window/lifecycle tests；packaged audit | 托盘、文件选择、恢复、缩放通过 | Dock、关闭、激活、Quit/⌘Q、Cmd 标签通过 | PASS |
| VIS-17 降噪 | 跨页截图；治理扫描 | 七页无同质卡片与多色导航竞争 | 两架构视觉语言一致 | PASS |
| VIS-18 回归安全 | 最终质量门禁 | type/test/build/Electron/packaged 通过 | arm64/x64 artifact 与平台 evidence 全绿 | PASS |

## 已实现的双层收敛

1. 系统层：统一字体、颜色、间距、图标尺寸、表面、控件、Popover、Modal 与反馈配方，并用治理脚本阻止裸颜色、未命名图标尺寸、字符图标、移动/触摸产品分支和未定义变量回流。
2. 页面层：重新排序今日工作台、交易日志、交易详情、仪表盘、周复盘、随机复盘和设置页的核心信息，保留高密度但减少等权竞争。
3. 原生层：Windows 与 macOS 分别采用符合平台习惯的关闭/退出、快捷键、菜单、文件选择、缩放与窗口恢复行为；macOS 应用菜单使用 `Trader Atlas` 产品名。

## 完成判定

自动化矩阵、打包应用原生旅程与最终人工截图审查均未发现新的 P0/P1/P2 视觉问题。当前继续调整只会进入无明确证据支撑的主观微调，因此在本轮停止迭代并将持续目标判定为完成。
