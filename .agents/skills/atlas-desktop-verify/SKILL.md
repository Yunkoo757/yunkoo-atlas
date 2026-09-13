---
name: atlas-desktop-verify
description: 修改或验收 Trader Atlas 的 Windows/macOS 客户端界面时，核实最新 Electron 界面、隔离数据与视觉证据。
---

# Atlas 桌面界面验收

只处理本轮受影响界面及必要的同类对照；纯文档修改无需启动客户端。

- 实现前阅读 [UI 质量规范](../../../docs/development/ui-quality.md) 的相关门禁，按其设计来源优先级选定轨道、公共组件和同类界面，不在技能内复制设计数值。
- 启动方式与开发命令见 [开发工作流](../../../docs/development/workflow.md)。证据必须来自本轮最新 Electron 主进程与 renderer；浏览器 renderer、旧安装包、类型检查和截图文件存在均不能替代桌面视觉验收。
- 根据本轮功能选择数据量、长文本、交互状态、实际窗口、较小桌面窗口及用户显示缩放；现有路由采集未覆盖的弹窗、输入、校验和完成状态须补充操作验证。

## 按需使用现有采集器

[采集脚本](../../../scripts/qa-desktop-visual.mjs) 的 Electron 模式要求干净工作区和匹配 HEAD 的干净构建；[构建身份校验](../../../scripts/bundle-build-identity.mjs) 是实际判定来源。

```sh
pnpm build:app
pnpm qa:desktop-visual:electron --scenarios trades
```

- 上例仅检查交易列表；按 [场景清单](../../../scripts/desktop-visual-scenarios.mjs) 替换 `--scenarios` 的逗号分隔 ID。`--viewports` 仅接受该清单内的尺寸，不能用自定义缩放冒充用户显示缩放；无需每次运行全场景矩阵。
- 默认输出位于 `test-results/desktop-visual-convergence/`，运行会替换其中的 `electron/`。需要独立临时输出时使用 `--scratch-output-root` 指向本轮专用目录；正式 `--output-root` 的路径与防覆盖要求见 [输出合同](../../../scripts/desktop-visual-output-contract.mjs)，两者互斥。
- 脚本使用临时 `--user-data-dir` 和 `TRADER_ATLAS_LIBRARY`，通过 `createNewLibrary`、`commitImport` 导入 [隔离样例](../../../scripts/fixtures/desktop-visual-seed.mjs)，并在完成后关闭客户端、清理临时库；不得把这次采集称为已留开复核界面。

## 交互自检与交付

- 工作区有未提交修改时，按开发工作流启动最新隔离 Electron，记录实际代码来源并直接检查界面；不得为获取正式采集通过而擅自提交、清理工作区或放宽构建身份校验。临时输出选项不豁免身份校验。
- 查看完整截图，并核实相关 computed style、geometry、溢出、正文滚动与必需操作可达性；将数据量、实际平台、缩放和未覆盖状态写入本轮验证记录。路由截图与默认统计不自动证明全部交互状态合格。
- 自检完成后主动打开并保留最新受影响页面供用户操作。演示写入只用隔离测试资料库，并明确告知用户；按开发工作流核实 `--user-data-dir` 与 `TRADER_ATLAS_LIBRARY` 均已隔离。
- 若启动、导航、隔离或采集失败，保留可用证据，报告具体阻碍及最短手动打开路径；不得把 renderer 结果、缺失的平台/缩放验证或已关闭的窗口报告为桌面验收完成。
