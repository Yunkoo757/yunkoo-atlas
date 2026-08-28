# Linear 前端设计逆向分析

分析日期：2026-08-28  
范围：已登录的 Linear 真实工作区、Linear 官网、2026 UI Refresh 官方文章、公开登录页、当前生产客户端 CSS。

> 本报告的分析重心已经调整为登录后的真实工作区。工作区的详细布局、列表密度、信息层级、文案与 token 复原见 [WORKSPACE_ANALYSIS.md](./WORKSPACE_ANALYSIS.md)。后续章节保留官网与公开资料，作为交叉验证和品牌层补充。

## 一句话结论

Linear 的辨识度不主要来自黑色背景、紫蓝强调色或大圆角，而来自一套克制的注意力分配机制：高信息密度、小字号、少量层级、低对比分隔、明确的动词文案，再用极少数高对比元素标出当前任务。

## 证据边界

- 高置信：已登录真实工作区的 DOM、ARIA、计算样式、字段顺序和主题变量；官方文章明示的设计原则；生产 CSS 中的字体与字号 token。
- 中置信：当前 viewport 之外的响应式行为，以及没有直接展示的组件状态。
- 未覆盖：浅色主题、窄屏断点和完整 hover/focus/disabled 状态矩阵。

## 1. 视觉策略

Linear 2026 refresh 的两个核心原则是：

1. 不让未赢得注意力的元素争夺注意力。导航、辅助信息和非当前状态主动后退；主工作区前进。
2. 结构应被感知，而不是被看见。减少分隔线、降低边框对比、软化转角，用间距和表面对比表达分组。

具体表现：侧栏更暗、非激活文字更弱、tab 更紧凑、图标更小且更少、取消无必要的彩色图标底、边界更柔和。整体不是“极简”，而是“高密度但低噪声”。

## 2. 文字策略

### 营销站

- 首屏先给品类定义，再给受众：`The product development system for teams and agents`。
- 副标题只补充用途与时代背景，不重复标题：planning / building / AI era。
- 一级章节按工作流命名：`Intake and integrations`、`Planning and monitoring`、`AI and automations`、`Build, review, and ship`。
- 功能标签优先使用稳定的产品名词：Projects、Documents、Pulse、Initiatives。
- 文案节奏是“结果 → 工作方式 → 细节”，很少用泛化的营销形容词。

### 产品界面

- 任务路径使用直接动词：Continue、Log in、Create、Copy、Open。
- 导航和筛选尽量使用名词短语；状态文字承担信息，不再叠加装饰。
- 主要操作与辅助说明明确分层。公开登录页中，四个动作都保持同一语法结构，底部帮助文案只有一句。
- 文案本身是布局的一部分：标签短、扫描快，适配 12–15px 的高密度界面。

## 3. 字体与字号

### 产品端生产 token

| Token | 值 | 用途判断 |
|---|---:|---|
| `--font-regular` | Inter Variable + 系统字体回退 | UI 与正文 |
| `--font-monospace` | Berkeley Mono + 系统等宽回退 | 代码、ID、技术数据 |
| `--font-size-micro` | 11px | 极弱元数据 |
| `--font-size-mini` | 12px | 分组标签、紧凑辅助信息 |
| `--font-size-small` | 13px | 控件、导航、列表主力字号 |
| `--font-size-regular` | 15px | 正文、编辑器默认字号 |
| `--font-size-large` | 18px | 小标题、对话框标题 |
| `--font-size-title3` | 20px | 页面三级标题 |
| `--font-size-title2` | 24px | 页面二级标题 |
| `--font-size-title1` | 36px | 少量强标题 |

字重 token：300 / 450 / 500 / 600 / 700。关键点是正文默认值为 450，而不是常见的 400；Linear 用 450 与 500 做细微层级，不频繁跳到粗体。

编辑器标题更克制：H1 22px、H2 19px、H3 17px；说明产品内标题并不追求营销站式的戏剧性。

### 公开页面实测

| 场景 | 字号 / 行高 | 字重 | tracking |
|---|---|---:|---:|
| 首页 Hero | 64 / 64px | 510 | -1.408px |
| 文章页标题 | 48 / 48px | 590 | -1.056px |
| 文章正文 | 17 / 27.2px | 400 | normal |
| 文章小节标题 | 24 / 31.92px | 590 | -0.288px |
| 官网导航 | 13 / 19.5px | 400 | normal |
| 登录页标题 | 18px / normal | 500 | normal |
| 登录页按钮 | 13px / normal | 500 | normal |

Linear 在大标题上采用负字距与紧行高，在正文上使用约 1.6 的行高；这是“标题像物体、正文像阅读”的明确分工。

## 4. 尺寸、圆角与密度

- 首页内嵌产品演示中，主导航/列表按钮多为 28px 高、13px 字号、8px 圆角。
- 分组标签约 24px 高、12px 字号、14px 行高。
- 官网顶栏按钮约 32px 高，左右 12px 内边距，使用 pill 圆角。
- 登录页主操作统一 44px 高、左右 18px 内边距、`9999px` pill 圆角。
- 生产 CSS 中可见的常用局部圆角集中在 4 / 6 / 8 / 10px；pill 单独使用 `--radius-rounded: 9999px`。

因此它并非“所有东西都大圆角”。工作区内部以 6–8px 为主，只有身份明确的独立动作或胶囊控件才使用 pill。

## 5. 色彩与主题 token

### 官方机制

2024 年官方说明：主题不再为每套主题手工维护 98 个值，而是输入三个原语——base color、accent color、contrast——再用 LCH 生成 surfaces、texts、icons、controls 的语义别名。Contrast 也是无障碍高对比主题的入口。

2026 refresh 的内部颜色工具进一步允许调整 token 的 hue / chroma / lightness，并把结果以 JSON 导入 Figma。当前 StyleX 架构中，组件使用 `stylex.defineVars()` token 作为占位符，ThemeProvider 在运行时按作用域注入主题规则。

### 当前公开页面的可验证值

| 角色 | Light | Dark |
|---|---|---|
| 基础背景 | `#F9F9FA` | `#121213` |
| 侧栏背景 | `#EFEFF0` | `#09090A` |
| 基础边界 | `#E2E2E2` | `#212224` |
| 次级控件表面 | `#FEFEFF` | `#1C1C1D` |
| 主文本（登录页实测） | `#2F2F31` | CSS token `#E2E3E5` 用于暗色标签 |
| 弱文本 | `#5B5B5D` | `#97979A` |
| 强调 / focus | `#6D78D5` | 同主题角色动态生成 |
| 弱边框 | `#00000016` | `#FFFFFF22` |

品牌公开色为 Mercury White `#F4F5F8` 与 Nordic Gray `#222326`；品牌主色被描述为低饱和蓝，通常保留给背景，不应在产品 UI 中到处使用。

### 可复用的语义层

不应复制当前构建产物中的 `--sx-*` 哈希名。值得复用的是角色结构：

```text
color.bg.primary / secondary / tertiary / quaternary
color.text.primary / secondary / tertiary / quaternary
color.border.primary / secondary / tertiary
color.control.primary / hover / selected
color.accent / focus / selection
surface.background / foreground / panel / dialog / modal
```

## 6. 前端实现架构

- 当前客户端生产 CSS 已从 styled-components 迁往 StyleX；样式与组件共置，生成主要发生在构建期。
- StyleX 提供确定性的合并、类型化变量和组件样式契约，并刻意限制从外部“隔空重写”组件。
- Linear 同时保留了运行时主题能力：组件写语义 token，ThemeProvider 把哈希后的 CSS 变量映射到当前主题。
- 官方所说的“此前没有 formal design system”不等于没有 token 或共享组件；更准确的理解是：已有主题系统和组件库，但过去缺少严格、统一、可由工具强制的样式契约。StyleX 迁移正在补齐这一层。

## 7. 如果要复刻 Linear 的方法

1. 先建立注意力层级，不先挑颜色。规定主任务、辅助导航、元数据、分隔结构各自的亮度级别。
2. 产品 UI 以 13px 控件、15px 正文、18–24px 局部标题为主；36px 只留给极少数页面标题。
3. 正文字重用 450，交互与标题用 500/600；不要把所有重要信息都加粗。
4. 用 6–8px 做常规容器与工作区控件，pill 只给独立动作、状态或筛选。
5. 主题只暴露 base / accent / contrast 等少量原语，再生成语义角色；组件禁止直接引用任意色值。
6. 文案以动词和名词短语为主；每个页面先回答“这是什么”，再回答“它能帮我做什么”。
7. 边框只负责必要的空间关系，其余结构交给间距、表面层级和对比度。

## 8. 复现证据

- `linear-client.css`：616,268 bytes；SHA-256 `BB327E62F5DE30B3E2BB7376C9E8926C5F159400D9BDA2FAB023C1E9F86D272E`
- `linear-design-evidence.json`：三个页面的字体、计算样式、CSS 自定义属性、网络资源；SHA-256 `487057AF23A42BCB5B48786064949CD0F03A7AFDB0F83C2361D09222EDC81554`
- `home-desktop.png`、`design_refresh-desktop.png`、`app_login-desktop.png`：1440px 宽桌面截图。
- `inspect_linear.py`：可复现实测脚本。

## 官方资料

- https://linear.app/now/behind-the-latest-design-refresh
- https://linear.app/now/how-we-redesigned-the-linear-ui
- https://linear.app/now/styling-linear-for-the-future-stylex
- https://linear.app/brand
- https://linear.app/docs/account-preferences
