# Trader Atlas Logo 重构设计

日期：2026-08-21

## 目标

为 Trader Atlas 这款面向 Windows 与 macOS 的 Electron 交易日志桌面应用，生成 10 个定制化、可缩小识别的 IP Logo 候选。候选用于先行评审；用户选定后，再接入项目现有的统一图标生成链路。

## 产品语境

- Trader Atlas 记录交易、复盘、风险管理与绩效阶段。
- 产品已有深色微靛视觉基调，品牌焦点色为 `#5e6ad2`，主背景为 `#12141a`，文字高亮为 `#e8eaf6`。
- 当前主图标为几何化 “TA”，生成源文件是 `build/icon.svg`。
- `scripts/generate-app-icon.mjs` 已负责从 `build/icon.svg` 生成网页 favicon、Windows `.ico`、macOS `.png`、Electron 运行时图标及 NSIS 安装器资源。
- 仓库中的 `ip-logo-svg/` 是用户现有的未跟踪候选资产，本次不覆盖、不删除。

## 视觉方向

1. **A 小猫头鹰观察员** — 代表盘面洞察与复盘 — 圆头、宽面盘、从下角探出。
2. **B 小海龟守护者** — 代表风险纪律与稳定执行 — 圆壳、低重心、短而厚的四肢。
3. **C 小狐狸领航员** — 代表方向判断与策略切换 — 大圆耳、软脸型、单侧圆润尾形。

## 候选批次

- 共 10 张独立的 1:1 方形图片，不制作 contact sheet。
- A1–A4 为猫头鹰，B1–B3 为海龟，C1–C3 为狐狸。
- 每张图从左下或右下角出现角色，左下与右下各 5 张；禁止默认居中或底部居中。
- 每张图严格使用两种主体色加一种背景色；背景使用 Trader Atlas 深靛黑，主体色围绕品牌靛紫、雾白、盈利绿与星标金组合。
- 角色保持 4–7 个大形状、粗圆轮廓、最多一个主要识别特征、简单眼睛与必要时的微小嘴巴，保证缩小至 32×32 仍可辨识。
- 生成提示只描述方形角色图像，不出现 logo、品牌标记、应用图标或图标素材等用途词；不添加文字、水印、额外主体、场景、边框或装饰。
- 每个候选只生成一次并完整保留，不自动筛除、重绘或后处理。

## 选定后的接入方案

用户选定候选后，根据选定角色的轮廓与颜色重绘为简洁、可维护的 SVG 主图，并写入 `build/icon.svg`。随后运行现有 `pnpm icons:app`，由既有脚本同步生成：

- `public/favicon.svg`
- `public/favicon-32.png`
- `public/apple-touch-icon.png`
- `public/icon.png`
- `build/icon.png`
- `build/icon.ico`
- `build/installerSidebar.bmp`
- `build/installerHeader.bmp`

不改变 `package.json` 当前的 Windows 与 macOS 图标路径；产品适配范围仍仅限 Windows 与 macOS，不新增手机端、iPad 端、浏览器端或其他平台支持，也不修改现有图标生成脚本的职责边界。`public/` 下的 favicon 与 PNG 只是当前桌面渲染和构建流程所需的既有资源。

## 验收标准

- 10 张候选均可单独预览、名称与方向一一对应。
- 候选整体与 Trader Atlas 深色微靛桌面界面有明确关联，同时每个方向有可区分的角色隐喻。
- 用户选定后，选定 Logo 能通过现有图标生成脚本产出 Windows、macOS、favicon 与安装器资源。
- 生成与接入过程不覆盖 `ip-logo-svg/` 现有未跟踪文件。
