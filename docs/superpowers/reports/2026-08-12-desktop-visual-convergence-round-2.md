# 桌面视觉收敛：第二轮审计

审计提交：`a536f4a49d68e58881f10e5408ad5246e514826e`

审计日期：2026-08-13（Asia/Hong_Kong）

## 新鲜构建与全矩阵

| 证据 | 结果 | 路径 |
|---|---|---|
| Renderer 全矩阵 | 35/35 capture；0 console error；0 page error；0 overflow | `.gstack/qa-reports/desktop-visual-convergence/renderer-report.json` |
| Electron 全矩阵 | 35/35 capture；0 console error；0 page error；0 overflow | `.gstack/qa-reports/desktop-visual-convergence/electron-report.json` |
| Electron 截图 | 5 档窗口 × 7 场景 | `.gstack/qa-reports/desktop-visual-convergence/electron/` |
| Windows 打包态 | 54/54 check；100%/125%/150% | `.gstack/qa-reports/desktop-visual-convergence/packaged-windows/report.json` |

第二轮逐张复核 35 张 Electron 截图，重点重新检查第一轮受影响的今日工作台和交易日志，并覆盖详情、仪表盘、周复盘、随机复盘和数据设置。结果为 0 P0、0 P1、0 新跨页不一致、0 未解释 P2。

## Windows 打包态

- 安装包：`release/Trader-Atlas-1.3.3-win-x64.exe`
- 大小：120,698,848 bytes
- SHA-256：`EE9B61A6411D7DCD6A4ADD020BEB6F2EDA6E6052AE92F19CCD049526B27EFAE4`
- unpacked 可执行文件 SHA-256：`735921D1A605CACDBCC8C8AE25817C28191C3E2DDBABC211BD363B9B076C1AD4`
- 环境：Windows 11 专业工作站版，10.0.26200，x64；AMD Ryzen 9 9950X3D；Electron 43.1.0；Node 24.14.0。
- 所有运行使用临时 `userData` 与临时资料库，运行后清理；未访问真实应用数据。

打包态在 100%、125%、150% 各验证：

- 7 个核心页均无横向溢出；
- 实际 `devicePixelRatio` 分别为 1、1.25、1.5；
- `Ctrl+K` 打开命令面板，Windows 应用菜单为空；
- “打开其他资料库”确实触发原生 `showOpenDialog`；
- 首次关闭显示不可误关闭的 Windows 选择说明，明确“彻底退出/隐藏到托盘/记住选择”；
- 选择隐藏后窗口确实不可见，并可重新显示；
- 模拟保存失败时直接显示原因、“继续使用”和“重试退出”，不是仅靠 Toast；
- 1920×1080 窗口回到较小工作区后完整可见；150% 下 Electron/Windows 有 1 个物理像素 DPI 舍入，落在明确的 1px 边界容差内。

## 视觉结论

- 交易数字、状态色和主要动作形成稳定的第一注意力层；导航图标与弱说明退居次级。
- 960×640 仍可完成核心任务；1920×1080 使用受控内容轨道，没有无意义拉伸。
- 页面级装饰阴影和等权卡片竞争已消除；Popover、Tooltip、Modal、InlineStatus 各自遵循单一配方。
- 今日工作台以风险与行动队列为主；仪表盘以当前分析范围 KPI 为主；周复盘以事实、评分、完成动作为主；详情正文优先于属性；随机复盘保持短内容与动作接近。

## 平台限制

当前执行环境没有 macOS 硬件或 macOS 打包产物，因此不能把 Windows 或 renderer 证据替代 macOS 实机证据。第二轮的 Windows 结论成立，但双平台最终验收仍保持 `UNKNOWN`，持续目标不关闭。
