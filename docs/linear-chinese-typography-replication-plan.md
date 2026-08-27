# Linear 中文字体复刻优化方案

## 1. 目标

在 Trader Atlas 中复刻 Linear 桌面客户端的中文排版观感，使中文、英文、数字和图标在视觉重量、清晰度、尺寸与层级上保持协调。

本方案仅覆盖：

- Windows 客户端
- macOS 客户端

不考虑手机端、iPad 端、浏览器端或其他平台。

## 2. 当前问题

根据对比截图及现有代码，当前差异主要来自以下方面：

1. 侧栏正文使用 `13px / 400 / 20px`，比 Linear 的观感更细、更弱。
2. 中文没有使用随应用内置的确定字体，而是依赖操作系统回退。
3. `system-ui` 位于显式中文字体之前，中文可能提前被不同系统字体接管。
4. Windows 与 macOS 会分别落到不同的中文字体，字形、字宽和实际字重无法保持一致。
5. 侧栏普通文字使用 `--text-tertiary`，当前明度偏低，进一步放大了“字体偏细”的感觉。
6. 导航文字、标签和辅助说明共用通用字号角色，缺少针对 Linear 风格的导航与 Chip 排版角色。

当前关键代码：

- `src/styles/tokens.css`
- `src/styles/global.css`
- `src/components/Sidebar.css`
- `src/main.tsx`

## 3. 设计结论

本次优化不应直接放大全局字体，也不应把所有中文统一改成粗体。应分别建立导航、标签、辅助信息和正文排版角色。

推荐基准：

| 排版角色 | 字号 | 字重 | 行高 | 用途 |
| --- | ---: | ---: | ---: | --- |
| 导航文字 | 14px | 500 | 20px | 侧栏一级导航、工作区入口 |
| 标签与 Chip | 13px | 500 | 18px | 时段、状态、筛选标签 |
| 辅助信息 | 12px | 400 | 18px | 数量、说明、元数据 |
| 正文 | 15px | 400 | 23px | 页面正文、编辑器内容 |
| 标题 | 20px | 600 | 28px | 页面主标题 |

Linear 风格的核心不是单纯加粗，而是：

- 中文具有稳定的 Medium 字重；
- 普通导航文字拥有足够明度；
- 中文与 Inter 英文的视觉重量接近；
- 不使用人为负字距压缩中文；
- 不依赖不同操作系统的随机字体回退结果。

## 4. 字体方案

### 4.1 推荐方案

继续使用 Inter Variable 渲染拉丁字符、数字和符号，同时内置 `Noto Sans SC Variable` 渲染简体中文。

推荐字体栈：

```css
--font-ui-base:
  "Inter Variable",
  "Noto Sans SC Variable",
  "PingFang SC",
  "Microsoft YaHei UI",
  sans-serif;
```

优点：

- Windows 与 macOS 的中文观感更一致；
- 可以稳定使用真实的 `400`、`500` 和 `600` 字重；
- 避免 `system-ui` 在显式中文字体之前提前接管中文；
- 中文与 Inter 混排时更容易控制视觉重量。

### 4.2 系统字体兜底

当内置中文字体加载失败时：

- macOS 回退到 `PingFang SC`；
- Windows 回退到 `Microsoft YaHei UI`；
- 最后回退到 `sans-serif`。

不建议把苹方随应用分发。苹方适合作为 macOS 系统回退字体，不适合作为 Windows 客户端的内置字体。

### 4.3 字体加载要求

- 字体文件必须随 Electron 应用本地打包；
- 禁止依赖在线字体服务；
- 字体文件、CSS 和源码统一使用 UTF-8；
- 字体加载失败不得造成不可读文本或布局跳动；
- 字体许可证文件应随字体资源一同保留。

## 5. 设计令牌调整

在 `src/styles/tokens.css` 中新增专用排版角色，不直接覆盖全局正文令牌：

```css
:root {
  --type-nav-size: 14px;
  --type-nav-line-height: 20px;
  --type-nav-weight: var(--font-weight-medium);

  --type-chip-size: 13px;
  --type-chip-line-height: 18px;
  --type-chip-weight: var(--font-weight-medium);

  --text-nav-default: lch(62% 1 272 / 1);
  --text-nav-hover: lch(74% 1 272 / 1);
  --text-nav-active: lch(86% 0.8 272 / 1);
}
```

说明：

- 普通导航从当前约 `56%` 明度提升至约 `62%`；
- Hover 态提升至约 `74%`；
- 选中态提升至约 `86%`；
- 不直接修改全局 `--text-tertiary`，避免影响表格、说明文字和其他辅助信息。

## 6. 侧栏优化

在 `src/components/Sidebar.css` 中将导航项切换到专用令牌：

```css
.sb-item {
  font-family: var(--font-ui);
  font-size: var(--type-nav-size);
  font-weight: var(--type-nav-weight);
  line-height: var(--type-nav-line-height);
  letter-spacing: 0;
  color: var(--text-nav-default);
}

.sb-item:hover {
  color: var(--text-nav-hover);
}

.sb-item.is-active {
  color: var(--text-nav-active);
  font-weight: var(--type-nav-weight);
}
```

注意事项：

- 普通态和选中态都可保持 `500`，主要通过颜色和背景区分层级；
- 如果选中态层级仍不够，再单独评估 `600`，不要默认使用粗体；
- 保持中文 `letter-spacing: 0`；
- 保持当前 `28px` 导航行高，先不扩大整体侧栏密度；
- 图标继续使用 `16px`，图标与文字间距建议保持在 `8–9px`。

## 7. 标签与 Chip 优化

标签组件应使用独立角色，避免直接继承侧栏导航字号：

```css
.ui-chip,
.trade-row-tag,
.quick-view-chip {
  font-family: var(--font-ui);
  font-size: var(--type-chip-size);
  font-weight: var(--type-chip-weight);
  line-height: var(--type-chip-line-height);
  letter-spacing: 0;
  font-optical-sizing: auto;
  font-feature-settings: "kern" 1;
}
```

标签的圆角、边框和内边距应单独通过截图校准，不通过增大字体来补偿组件尺寸。

建议初始几何参数：

```css
height: 24px;
padding-inline: 8px;
border-radius: 9999px;
```

## 8. 实施阶段

### 阶段一：低风险视觉校准

1. 新增导航与 Chip 排版令牌。
2. 将侧栏导航从 `13px / 400` 调整为 `14px / 500`。
3. 为侧栏建立专用文字颜色，不改动全局 `--text-tertiary`。
4. 保持现有字体资源和布局，其余变量不变。
5. 在 Windows 开发版中生成第一轮对比截图。

目标：用最小改动解决大部分“偏细、偏暗、偏弱”的问题。

### 阶段二：跨平台字体一致性

1. 引入并本地打包 `Noto Sans SC Variable`。
2. 调整 `--font-ui-base` 的字体顺序。
3. 确认拉丁字符仍由 Inter Variable 渲染。
4. 确认中文由内置中文字体渲染。
5. 检查字体文件是否进入 Windows 和 macOS 安装包。

目标：消除系统回退导致的字形与字重漂移。

### 阶段三：组件级精调

1. 校准侧栏普通态、Hover 态和选中态颜色。
2. 校准 Chip 的高度、横向内边距和边框明度。
3. 检查中文与 `4H`、数字、英文缩写的基线和视觉重量。
4. 检查长中文名称的省略和截断行为。
5. 检查 100%、125%、150% Windows 缩放，以及 macOS Retina 显示。

## 9. 自动化验证

扩展现有桌面视觉检查，至少验证：

```text
导航文字：14px / 500 / 20px
Chip 文字：13px / 500 / 18px
中文字体：Noto Sans SC Variable 或允许的平台兜底字体
拉丁字体：Inter Variable
letter-spacing：0px
font-synthesis：none
```

建议增加以下探针文本：

```text
导航
导航4
纽约盘
4H 波段结构看涨
BTC 纽约盘 +1.25R
```

测试需要覆盖：

- 纯中文；
- 纯英文；
- 中文与数字混排；
- 中文与英文缩写混排；
- 中文与交易数字混排。

## 10. 人工验收标准

### 字体观感

- 中文笔画不再明显弱于 Inter 英文和数字；
- `纽约盘` 不出现纤细、发虚或类似衬线字体的观感；
- 中文在普通态下清晰，但不接近粗体；
- 选中态主要依靠颜色和背景增强，不依赖过度加粗。

### 混排表现

- `4H` 与“波段结构看涨”的视觉重量接近；
- 数字和中文基线协调；
- 中文不会因为字体切换出现明显的上下跳动；
- 同一组件在 Windows 与 macOS 上不产生显著宽度差异。

### 布局表现

- 导航行高、图标和文字保持垂直居中；
- 侧栏密度不因字号调整明显变松；
- 长文本正常省略，不挤压数量或操作按钮；
- Chip 不因字体调整产生高度跳动。

## 11. 风险与处理

### 字体包体积增加

完整简体中文字体会增加安装包体积。应在视觉一致性与包体积之间进行实际测量，不应未经验证裁剪用户可能输入的常用汉字。

### 字体许可证

引入字体前必须确认允许应用内嵌和再分发，并把许可证保留在发行产物中。

### 全局回归

修改全局字体栈可能影响表格、编辑器、弹窗和输入框，因此第一阶段先使用导航专用令牌，第二阶段再替换中文字体来源。

### 字重映射

系统中文字体不一定拥有真实的 `500` 字重。项目已使用 `font-synthesis: none`，所以正式方案应依赖具有可变字重的内置中文字体，而不是依赖浏览器伪粗体。

## 12. 完成定义

满足以下条件后视为完成：

- Windows 与 macOS 客户端均加载预期字体；
- 导航和 Chip 使用独立排版令牌；
- 侧栏导航达到 `14px / 500 / 20px` 基准；
- 中英文混排视觉重量接近 Linear；
- 桌面视觉自动化检查通过；
- Windows 和 macOS 人工截图验收通过；
- 未引入在线字体依赖；
- 所有新增及修改文件保持 UTF-8 无 BOM。

## 13. 推荐执行优先级

1. 侧栏调整为 `14px / 500`。
2. 侧栏文字建立专用颜色令牌，并提升普通态明度。
3. 对比截图确认视觉方向。
4. 内置 Noto Sans SC Variable。
5. 校准标签与 Chip。
6. 完成 Windows 与 macOS 双平台视觉验收。

