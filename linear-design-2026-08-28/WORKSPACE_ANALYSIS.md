# Linear 真实工作区前端设计分析

分析对象：`https://linear.app/yunkoo/team/YUN/all`  
取证方式：直接控制用户已登录的 Chrome，读取真实 DOM、ARIA 结构、计算样式、CSS 自定义属性和当前视觉状态。没有使用用户截图进行尺寸或颜色推断，也没有修改 Linear 数据。

## 结论

Linear 工作区的核心不是“暗色＋圆角”，而是把复杂信息压进一套非常稳定的密度系统：244px 导航侧栏、两层页面工具栏、36px 状态分组头、44px Issue 行；再用 12px 元数据、13px 主内容、极低色度的 LCH 灰阶和少量状态色控制注意力。

界面里同时存在优先级、Issue ID、状态、标题、子任务、标签、项目、负责人和日期，但每行真正突出显示的只有 Issue 标题。其余信息始终存在，却通过字号、字重、亮度和位置主动后退。

## 1. 本次真实运行环境

| 项目 | 实测值 |
|---|---:|
| 页面标题 | `Yunkoo › All issues` |
| HTML 主题类 | `dark` |
| CSS viewport | 2195 × 1010 |
| devicePixelRatio | 1.75 |
| 已解析根变量 | 390 个 |
| 生产样式表 | `https://static.linear.app/client/assets/style-DDtm6ZIF.css` |

当前 viewport 只代表本次浏览器窗口，不是 Linear 固定断点。

## 2. 真实页面骨架

```text
nav：244px
└── workspace / favorites / personal / teams

main：viewport - 244px - 8px
├── location bar：Yunkoo › Issues
├── view bar：Active / Backlog / All issues / custom views / tools
└── grouped issue list
    ├── 36px group header
    └── 44px issue rows
```

### 主导航

- `--sidebar-width: 244px`，DOM 中的 `<nav>` 实测宽度也是 244px。
- 一级侧栏行高 28px、圆角 8px。
- 当前收藏项 `All issues` 的背景是 `lch(13.845% 1.3 272)`，其他条目保持透明。
- 常规侧栏内容从 x=12px 开始，团队子导航从 x=31px 开始，用 19px 的缩进表达作用域。
- 分组标题 `Workspace` 使用 12px / 500；普通导航项以 13px / 500 为主。

### 主工作面板

- `<main>` 从 x=244px、y=8px 开始，右侧同样保留约 8px 外边距。
- 背景为 `--color-bg-primary: lch(5.52% 0.4 272)`，对应当前暗色基础背景 `#121213`。
- 圆角为 12px。
- 边框实测为约 `0.571429px`，在 DPR 1.75 下正好接近一个设备像素，说明 Linear 使用的是视觉 hairline，而不是粗重的标准 1 CSS px 分隔线。
- location bar 与 view bar 各自约占 44px：前者回答“我在哪里”，后者回答“我正在看哪个视图”。

## 3. 列表与组件尺寸

| 组件 | 实测高度 | 圆角 | 其他 |
|---|---:|---:|---|
| 侧栏导航行 | 28px | 8px | 当前项使用实色背景 |
| View pill | 28px | 9999px | 左右 padding 10px |
| 状态分组头 | 36px | 8px | 内部 gap 8px |
| Issue 行 | 44px | 8px | 整行是可点击 `<a>` |
| 元数据标签 | 24px | 48px | 左右 padding 8px |
| 主面板 | 966px（当前窗口） | 12px | 四周保留应用壳间距 |

状态分组头实测背景为 `lch(9.232% 0.85 272)`。它与主背景只有很小的明度差，结构主要靠表面变化和圆角被“感觉到”，而不是靠明显边框被“看到”。

## 4. Issue 行的信息架构

真实 DOM 中每条 Issue 是一个 `display: grid` 的整行链接，固定高度 44px。视觉顺序为：

```text
优先级 → Issue ID → 状态 → 标题 → 子任务/父级 → 标签/项目 → 负责人 → 日期
```

以 `YUN-3 Connect your tools` 为例：

| 字段 | 字号 | 字重 | 颜色/字距 |
|---|---:|---:|---|
| Issue ID `YUN-3` | 13px | 450 | `lch(61.803% 1.2 272)`；tracking -0.26px |
| 标题 `Connect your tools` | 13px | 500 | `lch(100% 0 272)` |
| 子任务 `0/1` | 12px | 450 | `lch(61.803% 1.2 272)` |
| 标签 `导航1` | 12px | 450 | 同上 |
| 标签 `Bug/Feature/Improvement` | 12px | 450 | 同上，颜色由小圆点承担 |
| 日期 `Jun 6` | 12px | 450 | 同上 |

这里有一个非常关键的策略：标题和 ID 只差一级字重与亮度。Linear 没有把标题做大，而是让其他字段变弱，从而保持密度。

右侧 metadata 不参与标题流式排版，而是被推到行尾并形成稳定列。页面变宽时，中间产生空白；Linear 宁愿保留列的可扫描性，也不让字段随机漂移。

## 5. 字体系统

### 字体栈

```css
--font-regular:
  "Inter Variable", "SF Pro Display", -apple-system,
  BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu,
  Cantarell, "Open Sans", "Helvetica Neue", "Linear Thai", sans-serif;

--font-monospace:
  "Berkeley Mono", "SFMono Regular", Consolas,
  "Liberation Mono", Menlo, Courier, monospace;
```

真实页面的所有已采样节点都使用同一 UI 字体栈。中文不由 Inter 覆盖时会进入操作系统中文无衬线回退，但仍沿用 Linear 的 12/13px 尺度和相同行高。

### 产品字号 token

| Token | 值 |
|---|---:|
| `--font-size-micro` | 11px，按 2px 单位向上取整 |
| `--font-size-mini` | 12px |
| `--font-size-small` | 13px |
| `--font-size-regular` | 15px |
| `--font-size-large` | 18px |
| `--font-size-title3` | 20px |
| `--font-size-title2` | 24px |
| `--font-size-title1` | 36px |

### 字重 token

```text
light 300 / normal 450 / medium 500 / semibold 600 / bold 700
```

当前 All issues 工作区几乎只使用 450 和 500：

- 450：ID、日期、标签、辅助统计。
- 500：Issue 标题、状态分组、导航和筛选。
- 600/700 没有成为列表常态，从而避免每一行都显得重要。

## 6. 当前暗色主题 token

### 表面

| 实际变量 | 当前值 | 作用 |
|---|---|---|
| `--bg-sidebar-color` | `lch(2.595% 0.4 272)` | 应用壳和侧栏，预设值 `#09090A` |
| `--color-bg-primary` | `lch(5.52% 0.4 272)` | 主工作表面，约 `#121213` |
| `--color-bg-secondary` | `lch(7.32% 0.85 272)` | 次级表面 |
| `--color-bg-tertiary` | `lch(8.22% 1.3 272)` | 更高一层表面 |
| `--color-bg-quaternary` | `lch(9.345% 0.85 272)` | 小型控件/分组 |
| 当前侧栏选择 | `lch(13.845% 1.3 272)` | `All issues` 选中行 |
| 当前 view 选择 | `lch(16.706% 0.979 272)` | 选中的 `All issues` pill |

所有中性表面的 hue 都固定在 272，chroma 只有 0.4–1.3。它们不是绝对无色灰，而是一套非常轻微的冷灰。

### 文字

| 变量 | 当前值 | 用途 |
|---|---|---|
| `--color-text-primary` | `lch(100% 0 272)` | Issue 标题和当前选择 |
| `--color-text-secondary` | `lch(90.451% 1.2 272)` | 页面标题、重要辅助信息 |
| `--color-text-tertiary` | `lch(61.803% 1.2 272)` | ID、日期、标签、未选筛选 |
| `--color-text-quaternary` | `lch(36.975% 1.2 272)` | 最弱图标和占位内容 |

Linear 的正文层级主要由 L 值变化实现，chroma 与 hue 基本保持不动。因此整页不会因不同灰色带有不同色偏而显脏。

### 边框与焦点

```css
--color-border-primary:   lch(9.84% 1.48 272);
--color-border-secondary: lch(14.16% 1.48 272);
--color-border-tertiary:  lch(16.32% 1.48 272);
--focus-ring-color: #5e69d1;
--focus-ring-outline: 1px solid #5e69d1;
```

标签容器使用主背景＋tertiary border，而不是彩色填充。Bug、Feature、Improvement 的红、紫、蓝只出现在小圆点中。

## 7. 筛选与选择状态

- 未选 `Active` / `Backlog`：12px / 500，背景 `lch(10.149% 0.593 272)`，文字使用 tertiary。
- 已选 `All issues`：12px / 500，背景提高到 `lch(16.706% 0.979 272)`，文字切到 primary。
- pill 高度和内边距完全不变，选择状态只改变亮度，不改变布局。
- 侧栏选中项采用相同逻辑，但使用 8px 常规圆角而不是 pill，以区分“导航位置”和“视图过滤器”。

## 8. 文字策略

### 导航

- 使用稳定产品名词：Inbox、Issues、Projects、Views、Favorites。
- `My issues` 表示所有权，`All issues` 表示范围；词义明确且互不重叠。
- 空间名称与导航对象分开，利用缩进表达个人/团队作用域。

### 列表

- 状态名称只在分组头出现，Issue 行只显示状态图标，避免重复 Todo / Backlog / Done。
- ID、标题和父级分别承担“定位、任务、上下文”，不会混写成一个长标题。
- 可见日期使用 `Jun 6` 这样的短格式；ARIA 名称中保留完整时间 `Created Jun 6, 14:05:48`。
- `Open sub-issue`、`Open project`、`No Priority` 等信息通过无障碍名称补足，视觉界面仍保持短促。
- 新建操作被命名为 `Create new issue`，并同时存在于全局和每个分组语境中。

## 9. DOM 与无障碍策略

真实 DOM 包含：

- `Skip to content` 跳转链接。
- 明确的 `<nav>` 和 `<main>` landmarks。
- 页面标题为 level 2 heading。
- 收藏状态使用 checked switch。
- 分组折叠、新建、筛选和显示设置都有可读 button name。
- 整个 Issue 行是链接，accessible name 串联优先级、ID、标题、标签和日期。

这说明 Linear 的“简洁”不等于删掉语义：视觉上隐藏或压缩的信息，会在 DOM 与 ARIA 中保留。这不是完整无障碍审计结论，但当前页面的基础语义结构较完整。

## 10. 动效 token

```css
--speed-highlightFadeIn: 0s;
--speed-highlightFadeOut: .15s;
--speed-quickTransition: .1s;
--speed-regularTransition: .25s;
--speed-slowTransition: .35s;
```

“进入立即、退出稍缓”是这套界面的触感来源之一：指向和激活必须立即反馈，离开时再用 150ms 柔化变化。

## 11. 当前实现架构

- 当前页面只加载一个生产 CSS bundle。
- 元素类名以大量 `sx-*` 原子类为主，表明当前组件已运行在 StyleX 架构上。
- 根节点解析出 390 个 CSS 自定义属性；其中既有 `--color-*`、`--font-*` 等语义 token，也有 `--sx-*` 哈希变量。
- `html.dark` 选择当前主题，主题值以 LCH 和少量固定 hex 注入。
- 应复用语义角色，不应复制 `--sx-*` 哈希名，因为它们属于构建产物。

## 12. 适合复刻的工作区骨架

```css
:root {
  --sidebar-width: 244px;
  --row-height-sidebar: 28px;
  --row-height-group: 36px;
  --row-height-issue: 44px;

  --radius-control: 8px;
  --radius-panel: 12px;
  --radius-pill: 9999px;

  --font-meta: 12px;
  --font-ui: 13px;
  --font-body: 15px;
  --weight-normal: 450;
  --weight-medium: 500;

  --surface-shell: lch(2.595% 0.4 272);
  --surface-main: lch(5.52% 0.4 272);
  --surface-group: lch(9.232% 0.85 272);
  --surface-selected: lch(13.845% 1.3 272);

  --text-primary: lch(100% 0 272);
  --text-secondary: lch(90.451% 1.2 272);
  --text-tertiary: lch(61.803% 1.2 272);
}
```

上面的尺寸来自真实页面计算样式；变量命名中保留 Linear 已公开在 DOM 中的语义时使用原名，新增的 `row-height-*` 等名称只是便于复刻的重组。

## 13. 证据与边界

- 已覆盖：真实登录态 DOM、当前暗色主题、当前 viewport、Issue 列表、侧栏、筛选、状态分组、计算样式、语义 token。
- 未覆盖：浅色主题、窄屏断点、弹窗、编辑器、完整 hover/focus/disabled 状态矩阵。
- 页面读取期间没有创建、修改、移动或删除任何 Linear 数据。

证据文件：

- `linear-live-workspace-evidence.json`：DOM snapshot、根 token、关键组件计算样式。
- `linear-live-workspace.png`：从当前已登录浏览器直接截取的页面状态。
- `linear-client.css`：当前生产样式 bundle。
