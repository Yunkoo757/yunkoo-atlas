# Atlas 互动教学站（独立站）

> 状态：已完成首版互动教学路径。
> 日期：2026-09-06
> 范围：独立于桌面客户端的 Windows / macOS 桌面浏览器教学站；不改 `src/` 产品代码。

Trader Atlas 的互动说明书网站。本目录与桌面客户端隔离，包含教学站实现、研究和资源。

## 任务边界

- **做**：任务地图、循序渐进的互动教学、产品实景对照、核心模块说明和本地教学进度。
- **借**：TikHub 官网的版型、区块节奏、玻璃质感、特殊文字处理。
- **不借**：TikHub 的配色、字体、品牌色、API 产品信息架构。
- **必须沿用**：Atlas 现有设计令牌与产品语义，来源是 `src/styles/tokens.css` 与仓库根目录 `design.md`。
- **平台**：网站按 Windows / macOS 桌面浏览器设计。不做手机、平板或其它端适配。

## 本目录

| 路径 | 内容 |
| --- | --- |
| `research/tikhub-reference.md` | TikHub 官网的版型、质感、文字效果拆解 |
| `research/atlas-constraints.md` | Atlas 令牌、产品信息架构、网站必须遵守的约束 |
| `research/open-questions.md` | 开工前需要你拍板的问题 |

## 本版包含

- 10 个章节、40 个教学步骤。
- 主线闭环：认识 Atlas、记录交易、补充详情、完成复盘、沉淀案例、读懂统计、周期与随机复盘。
- 分支模块：模拟盘、错过机会、随记、今日工作台、风险、数据维护、回收站、设置与桌面效率。
- Windows / macOS 平台快捷键切换、章节搜索、刷新恢复和教学进度重置。
- 严格复用 `src/styles/tokens.css` 与 `design.md` 的 Atlas 语义 token。

## 本地预览

在仓库根目录执行：

```powershell
python -m http.server 4174 --bind 127.0.0.1 --directory atlas-docs-site
```

然后打开 `http://127.0.0.1:4174/index.html`。

内容检查：

```powershell
node atlas-docs-site/verify.mjs
```
