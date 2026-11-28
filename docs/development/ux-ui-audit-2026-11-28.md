# Trader Atlas 前端设计与用户体验全面审查报告

- **审查日期**：2026-11-28
- **审查范围**：基于当前最新构建的真实 Electron 桌面客户端（隔离样本库 `1440×900` 与 `960×640` 双尺寸，共采集核验 **29 个核心页面/弹窗状态 + 10 个重构后设置页**）与前端源码（`src/views/`、`src/components/`、`src/styles/`）联合排查。
- **审查维度**：窗口与标题栏规范、弹窗与浮层设计、空状态体系、信息层级与卡片语言、排版与字体令牌、间距与对齐、副标题与文案标点、窄窗响应式适配。
- **审查原则**：保留 Trader Atlas 既有成熟暗色 LCH 设计系统与低噪工作台气质，聚焦**跨页面一致性断层、真实视觉缺陷与高频操作摩擦**，所有建议均给出精确源码落点与可执行改法。

---

## 一、审查总览与权重分布

当前应用整体已完成高质量的底层 Token 化（零硬编码色值、零裸 `px` 字号泄漏、65/65 设计合同通过，且 10 个核心设置页已完成 Linear / macOS 风格重构）。本轮全应用深度排查共识别出 **16 项可明显提升成熟度与专业感的高 ROI 优化点**：

| 优先级 | 数量 | 核心聚焦问题 |
| --- | --- | --- |
| **P0（高权重）** | 4 项 | 弹窗信息过载与结构混乱、设置二级修复页视觉割裂、空状态 4 套标准并存、窗口标题栏与返回路径不统一 |
| **P1（中权重）** | 7 项 | Toast 遮挡列表数据列、窄窗侧栏用户名被冗余预留压扁、命令面板命名脱节、随机复盘入口缺乏承载面、详情页/周复盘/高频弹窗局部排版摩擦 |
| **P2（低权重）** | 5 项 | 看板边界滚动提示与卡片密度、统计分布横轴可读性、4 处原始字号令牌收敛、全仓引号/省略号/句号微规范统一、快捷键页标题收口 |

---

## 二、P0 高权重问题（建议优先处理）

### P0-1 · `开启新实盘阶段` 与 `数据整理` 弹窗信息失控、文案重复且操作规范不一致

- **位置**
  - `src/components/LiveStageManager.tsx`（L222–L350）、`src/components/LiveStageManager.css`
  - `src/views/settings/DataOrganizationPanel.tsx`（L58–L100）
- **现状与实测问题**
  1. **一弹多责且体量臃肿**：`LiveStageManager` 使用 `size="wide"`（`720×623px`），在同一弹窗内强行混装「预约开启新实盘阶段」「生效条件检查」「历史阶段重命名列表」两套无关流程。
  2. **字面重复与 AI 腔说明**：实测截图呈现 `当前阶段：当前阶段`、`当前阶段 / 当前阶段 · 7月1日 至今`、`历史阶段 / 历史阶段 · 1月1日 — 6月30日` 的机械重复；`阶段名称` 下方出现冗余解释文案 `当前与历史阶段都可自由命名；重命名只改变名称。`。
  3. **条件行视觉凌乱**：`• 计划中 1 笔将保留在原阶段 • 持仓中 2 笔 • 周复盘可稍后补做` 用裸 `•` 横向拼在一行中，且仅中间一段高亮黄色，扫视节奏断裂；右侧 `重命名` 按钮裸浮无边框。
  4. **操作栏规范缺失**：`DataOrganizationPanel` 弹窗首步底部仅有一个禁用的 `预览影响` 按钮，**缺少标准 `取消` 按钮**；弹窗顶部悬浮的 `重新开始实盘记录` 按钮未标明是「一键勾选下方两项」的快捷预设，容易被误解为直接执行的危险操作。
- **推荐优化方案**
  1. **瘦身 `LiveStageManager`**：
     - 当 `currentStage.name === '当前阶段'` 时，Eyebrow 改为 `当前生效`（避免 `当前阶段：当前阶段`）；列表行副标题仅显示时间范围 `7月1日 至今` / `1月1日 – 6月30日`（删去重复的阶段名）。
     - 删除 `当前与历史阶段都可自由命名；重命名只改变名称。` 这类纯解释副标题；将 `重命名` 统一为 `ui-btn ui-btn-ghost ui-btn-sm` 或悬停铅笔图标按钮。
     - 将单行 `•` 条件改为紧凑的结构化状态芯片或两行清单，仅高亮真正阻断切换的项（如 `持仓中 2 笔`），并将「阶段重命名」收为弹窗内次级折叠区或独立的轻量管理入口。
  2. **对齐 `DataOrganizationPanel` 弹窗规范**：
     - 首步 Footer 补齐标准 `[取消]` + `[预览影响]` 双按钮布局（与全应用其他 `ModalShell` 保持一致）。
     - 将 `重新开始实盘记录` 改为更明确的预设条（如 `快速预设：重新开始实盘记录（同时勾选下方两项）` 或置于勾选组标题右侧的 ghost 链接）。

---

### P0-2 · 设置二级修复子页（`风险数据修复`、`待归属记录`）仍沿用旧版平铺分隔线语言，与主设置体系割裂

- **位置**
  - `src/views/settings/RiskDataRepairView.tsx`、`src/views/settings/RiskDataRepairView.css`（L33–L88）
  - `src/views/StageOwnershipRepairView.tsx`、`src/views/StageOwnershipRepairView.css`（L19–L101）
- **现状与实测问题**
  1. 10 个设置主页面已升级为统一的 `.settings-group` + `.settings-card`（`--surface-elevated` 分组卡片）与 `680px` 单列轨道，但从 `风险管理` 点进 `风险数据修复` 或从 `数据` 点进 `待归属记录` 时，界面骤然退回旧版透明背景 + 密集横线平铺列表。
  2. `RiskDataRepairView` 仍使用宽轨（`920px`），导致左侧问题标题与右侧 `1 项 >` 相距过远；且 `.risk-repair-row-title strong`（L77）泄漏原始字号变量 `font-size: var(--fs-sm)`（14px）。
  3. `StageOwnershipRepairView` 的顶部统计框 `.stage-ownership-total`、内层 `.stage-ownership-recommendation` 与 `.stage-ownership-period-correction` 使用三套互不统一的边框/圆角规则，视觉噪音大。
- **推荐优化方案**
  1. 两页均切入统一的 `.settings-group` + `.settings-card` 视觉容器：
     - `RiskDataRepairView` 收束为 `settings-page--form`（或 `760px` 内卡片容器），将「优先处理」「补全数据」「历史缺口」「补录历史规则」各装入独立 `.settings-card`，行内统一 `padding: var(--sp-3) var(--sp-4)` 与 `--surface-row-hover`。
     - 将 `.risk-repair-row-title strong` 的 `var(--fs-sm)` 替换为语义令牌 `var(--type-list-primary-size)`。
  2. `StageOwnershipRepairView` 的待处理记录每条封装为清晰 `.settings-card`，推荐修复方案作为卡片内置高亮条，手动调整作为卡片底栏 `.settings-card-disclosure` 展开。

---

### P0-3 · 全应用空状态（Empty State）存在 4 套不统一的垂直定位、图标与引导规范

- **位置**
  - `src/components/EmptyState.tsx`、`src/components/EmptyState.css`（L1–L66）
  - `src/views/QuickNotesView.css`（L12–L26、L177–L179）
  - `src/views/TradeTrashView.tsx` / `src/views/TrashView.css`
  - `src/views/WeeklyReviewView.tsx`（年度趋势空态）
- **现状与实测问题**
  实测 5 个真实空态页面，呈现 4 种完全不同的视觉表现：
  - **`回测项目`、`导入数据健康`**：垂直居中 + 92×72 托盘线框插画 + 标题 + 主按钮（视觉最舒适）。
  - **`随记`（`13-notes-1440.png`）**：带插画，但内容被顶在视口上方 ~20% 处，下方留下约 650px 纯黑死区（原因是 `.quick-notes-workspace.is-empty` 在网格行高与 `.quick-notes-empty` 高度传递上未占满剩余高度）。
  - **`回收站`（`16-trash-1440.png`）**：无插画且直接贴在页面最顶部 ~10% 处（`variant="missing"` / `filtered` 命中了 `.empty.is-missing { height: auto; min-height: 180px; }`），空荡感强烈。
  - **`周期复盘 · 年度趋势`（`10-weekly-trend-1440.png`）**：裸左对齐纯文字（`还没有完成的周复盘 / 完成一篇周复盘后，这里会记录你的年度进度。`），无图标、无卡片承载、无「去写本周复盘」引导按钮。
- **推荐优化方案**
  1. 在 `EmptyState.css` 中明确区分两类空态契约：
     - **整页空态**（`first-use`、`empty-page`、`complete`）：统一 `flex: 1; min-height: 100%; justify-content: center; padding-bottom: 8vh;`（光学垂直居中偏上 4%–6%），统一展示轻图标/插画 + 标题 + 最多一行精简说明 + 可选主行动按钮。
     - **局部/筛选空态**（`filtered`）：紧凑居中（`min-height: 220px`）+「重置筛选」主操作。
  2. 修复 `QuickNotesView` 空态容器高度（`.quick-notes-workspace.is-empty { height: 100%; }`），确保 `随记` 空态光学居中。
  3. `TradeTrashView` 空态改为整页光学居中 + 轻量垃圾桶/收件箱线性图标，副标题精简为 `已删除的记录会保留 30 天，到期后自动清理`。
  4. `WeeklyReviewView` 的 `年度趋势` 空态接入统一的 `EmptyState` 组件，并补上 `前往本周复盘` 引导按钮。

---

### P0-4 · 窗口标题栏（`WindowTitlebar`）图标、副标题与子页返回路径规范不统一

- **位置**
  - `src/components/WindowTitlebar.tsx`（L70–L78、L133–L141）
  - `src/views/ImportDataHealthView.tsx`（Topbar `subtitle="核对历史导入日期"` + 页面内第二行 `← 返回历史实盘`）
  - `src/views/WeeklyReviewView.tsx`（年度趋势内裸浮 `< 本周复盘`）
- **现状与实测问题**
  1. **顶栏副标题孤例**：全应用仅 `ImportDataHealthView` 在 `Topbar` 传入了 `subtitle="核对历史导入日期"`，使原生窗口标题栏突然多出一截灰色副标题，破坏所有页面统一的标题栏节奏。
  2. **顶栏图标显隐规则漏项**：`WindowTitlebar.tsx` L76 的 `moduleRoot` 判断漏掉了 `trade-trash` 和 `import-data-health`，导致左侧栏明明展开时，`回收站` 和 `导入数据健康` 仍在标题栏显示图标，而其他 8 个一级入口均隐藏图标。
  3. **子页面返回按钮存在 3 套位置**：
     - `交易详情`：返回在窗口顶栏左侧（`← 交易日志`）；
     - `风险数据修复` / `待归属记录`：返回在内容区标题正上方（`← 返回风险管理`）；
     - `导入数据健康` 与 `年度趋势`：在窗口顶栏下方又多出一行无边框或半边框子工具栏放 `← 返回历史实盘` / `< 本周复盘`，浪费 40px 垂直空间且箭头样式不统一（`←` vs `<`）。
- **推荐优化方案**
  1. 统一窗口标题栏规则：**只呈现页面标题（折叠侧栏或进入二级对象时补图标），不承载 `subtitle`**。移除 `ImportDataHealthView` 的 `Topbar subtitle`，必要说明收进页面头部轻副标题。
  2. 补齐 `WindowTitlebar.tsx` 中 `trade-trash`、`import-data-health` 的图标显隐逻辑，保持与 `settings`、`notes`、`backtests` 完全一致。
  3. 统一全应用子页面返回契约与箭头图标（统一使用 `ChevronLeft` 或 `ArrowLeft`，不要混用 `<` 与 `←`）：
     - 独立全屏子视图（`交易详情`、`年度趋势`、`导入数据健康`）：返回入口统一落在窗口顶栏或统一 44px 子顶栏左侧；
     - 设置内二级子页（`风险数据修复`、`待归属记录`）：统一保留在 `.settings-page` 内容首行上方，与 `h1` 左对齐。

---

## 三、P1 中权重问题（高频工作台质感与操作摩擦）

### P1-1 · 底部 Toast 通知在右下角直接遮挡列表最末行的结果与日期列

- **位置**：`src/components/Toast.css`（L1–L35）、`src/styles/tokens.css`（`--toast-inset`）
- **现状**：实测 `01-list-1440.png`、`03-board-1440.png` 中，系统自动清理回收站触发的右下角 Toast（`已永久清空 1 笔过期回收站记录`）正好覆盖列表最末行的 `周期 / R 倍数 / 日期` 核心数据列，且未见明显关闭按钮，造成阅读阻断。
- **推荐优化方案**
  1. 将 `.toast-host` 位置调整为 **底部水平居中**（`left: 50%; transform: translateX(-50%);`）或 **主内容区底部居中**（避开最右侧固定数值列与最左侧侧栏），且与批量操作条保持自动避让（已有 `body:has(.batch-action-bar.is-floating)` 机制可直接沿用）。
  2. 为所有非持久 Toast 默认缩短停留时长（2.5s–3s），并在 `TradeList` / `BoardView` 滚动底部预留 `48px` 安全留白，确保末行完整可读。

---

### P1-2 · 窄桌面窗口（`960×640`）左侧栏头部为已移除的搜索按钮保留 60px 占位，导致用户名过早截断

- **位置**：`src/components/Sidebar.css`（L45–L49）
- **现状**：实测 `27-list-960.png`、`28-detail-960.png`、`29-dashboard-960.png` 中，侧栏头部用户名 `桌面视觉样本` 在 208px 窄侧栏下被截断为仅 3 个字（`桌面视...`）。源码排查发现 `.sb-header .menu-root` 仍写死 `max-width: calc(100% - 60px)`——这是早期搜索按钮还在侧栏头部时的历史遗留，如今右侧仅有 1 个 28px 新建按钮，白白浪费了 32px。
- **推荐优化方案**
  - 将 `.sb-header .menu-root` 改为 `flex: 1 1 auto; min-width: 0; max-width: none;`，依赖 `.sb-header` 的 Flex 布局与 `.sb-header-actions { flex-shrink: 0; }` 自动让出恰好 28px+gap 的空间，在 `960×640` 下可多显示 2–3 个完整汉字。

---

### P1-3 · 命令面板（`CommandPalette`）占位符年份过时、设置项名称与新版设置脱节、组合键帽粘连

- **位置**：`src/components/CommandPalette.tsx`（L244–L262 & input placeholder）、`src/components/CommandPalette.css`
- **现状**：实测 `21-cmdk-1440.png` 暴露 3 处明显失调：
  1. 输入框占位符为 `搜索交易、日期（如 202405）、跳转视图...`——示例停留在 2024 年且使用了英文 `...`；
  2. 底部 `设置` 分组仍显示旧名称 `管理策略`、`键盘快捷键`、`导入/导出数据`，而新版设置侧栏已统一为 `策略`、`快捷键`、`数据`；
  3. 组合快捷键 `⇧N` 挤在单个 `<kbd>` 内，视觉拥挤，而快捷键设置页已采用 `⇧` + `N` 独立双键帽。
- **推荐优化方案**
  1. 占位符精简为 `搜索交易、日期或命令…`（去掉过时年份，统一中文省略号）。
  2. 命令面板 `设置` 分组直接使用 `SETTINGS_SECTIONS` 的正式标签（`策略` / `快捷键` / `数据`），把旧称呼放进 `keywords` 保留搜索兼容。
  3. 复用 `ShortcutKeycaps` 或按修饰键拆分渲染 `<kbd>`，与快捷键设置页保持一致的键帽光学间距。

---

### P1-4 · `随机复盘`开始页无卡片容器漂浮于黑底，且池总数与可复盘数口径缺乏解释

- **位置**：`src/views/ReviewSessionView.tsx`、`src/views/ReviewSessionView.css`
- **现状**：实测 `11-review-session-start-1440.png` 中，「从复盘池开始」的 6 项列表与底部操作栏完全透明无边界地漂浮在 1440×900 纯黑背景中央，视觉锚点弱；同时池列表显示 `全部内容 45`，左下角却显示 `可随机复盘 44 条 / 全部阶段 · 到期案例`，用户无法直观判断差额的 1 条为何被排除。
- **推荐优化方案**
  1. 用与设置页、统计页同源的卡片承载面（`background: var(--surface-elevated); border: 1px solid var(--border-subtle); border-radius: var(--radius-10);`）将复盘池列表与底部启动栏收束为一张聚焦卡片，每项 hover 使用 `--surface-row-hover`。
  2. 若存在未到期案例或已过滤项，在底部摘要以清晰短语标明口径（如 `到期可复盘 44 / 45 条`）或在 hover tooltip 中解释差额，消除数字疑虑。

---

### P1-5 · `交易详情`与`案例详情`在正文标题、编辑器左基线与右侧属性栏分组上存在细微失衡

- **位置**：`src/views/DetailView.tsx`、`src/views/DetailView.css`（L96–L136、L661–L720）
- **现状**：对照 `06-detail-trade-1440.png`、`07-detail-case-1440.png` 与 `28-detail-960.png`：
  1. `交易详情`在正文上方渲染 `交易复盘`（`h2`），而`案例详情`省去标题直接接 `盘面摘要`，同属详情模板但顶部节奏不一致。
  2. 编辑器外层卡片 + 内层 `盘面摘要` 暗底块形成两层微弱嵌套，导致正文文字左边缘相比标题与下方 `○ 完成复盘` 缩进了约 12px，破坏垂直对齐基线。
  3. 右侧属性栏底部 3 个折叠组（`时间 >`、`标签 · 1 >`、`错误 / 违规 >`）与顶部已展开组（`属性 v`、`交易数据 v`）文字亮度完全相同，且折叠态视觉占比略重。
- **推荐优化方案**
  1. 案例详情与交易详情保持一致的正文起稿头部结构（或两者均取消冗余的 `交易复盘` 大字，仅在需要时用轻工具条呈现模板/字数）。
  2. 去除编辑器外层多余容器 padding 叠套，让 `h1` 标题、上下文元信息、正文首字、`完成复盘`、`+ 添加追记` 严格落在同一左侧垂直基线上。
  3. 右侧属性栏折叠态组标题使用 `color: var(--text-tertiary)`，展开态使用 `color: var(--text-secondary)`，鼠标悬停再提亮至 `--text-primary`，层级一目了然。

---

### P1-6 · `周期复盘`右侧栏分隔缺失、底部 `模式归因` 破坏双栏边界、顶栏完成按钮状态偏弱

- **位置**：`src/views/WeeklyReviewView.tsx`、`src/views/WeeklyReviewView.css`（L1–L76、L223–L253）
- **现状**：实测 `09-weekly-review-1440.png` 与 `30-weekly-960.png`：
  1. 顶栏右侧 `年度趋势`、`待填写`、`完成本周复盘` 视觉重量几乎持平，禁用状态的 `完成本周复盘` 边框与底色反差极低；
  2. 右侧栏 `本周交易` 与 `上次行动` 之间缺少横向分隔线；而原本属于反思填写区的 `模式归因 >` 横跨整个页面底部（与右栏底线形成错位 L 型）；
  3. 富文本编辑器占位符 `写下本周判断，或粘贴截图...` 实测渲染仍为英文 `...`（需核对 TipTap Placeholder 注入源）。
- **推荐优化方案**
  1. 将 `模式归因` 收回左侧 `.wr-writing` 列内部，保证左写右查的双栏垂直分割线干脆利落；在右栏 `.wr-context > section + section` 增加 `border-top: 1px solid var(--border-subtle); padding-top: var(--sp-4);`。
  2. 顶栏 `待填写` 状态文字改为轻微胶囊标签或低噪状态点，与右侧 `完成本周复盘` 按钮拉开视觉层次；满足提交条件后立即切为 `ui-btn-primary` 高亮引导完成。
  3. 统一编辑器占位符为中文省略号 `…`。

---

### P1-7 · `新建交易`与`新建策略`弹窗内控件材质、占位符与选中态语言未完全统一

- **位置**
  - `src/components/TradeComposer.tsx`、`src/components/TradeComposer.css`
  - `src/components/StrategyFormModal.tsx`、`src/components/StrategyFormModal.css`（L58–L102）
- **现状**：实测 `19-composer-quick-1440.png`、`20-composer-expanded-1440.png`、`24-strategy-modal-1440.png`：
  1. `TradeComposer` 中 `<input>` 表面底色明显暗于同弹窗 `<Select>` 触发器；展开后 `入场价 / 仓位 / 止损价` 连续 3 个无信息量的 `可选` 占位符；`更多信息` 折叠行与上方截图区无轻分割线。
  2. `StrategyFormModal` 底部 `◉ 预览` 栏采用深色矩形背景，未输入策略名时形似禁用输入框；上方「图标选择」用实线亮框表示选中（`.sfm-icon-opt.is-on`），下方「配色选择」用 `outline-offset: 2px` 双环表示选中（`.sfm-color-opt[aria-pressed='true']`），同一弹窗两套选中反馈。
- **推荐优化方案**
  1. 统一 `ModalShell` 内 `<input>` 与 `<Select>` 消费同一套 `--field-bg` / `--field-border` 令牌；将 3 个 `可选` 占位符改为简洁单位/示例提示（或留空，标题已默认非必填），在展开区上方增加 `border-top: 1px solid var(--border-subtle); padding-top: var(--sp-3);`。
  2. `StrategyFormModal` 的预览条增加左侧弱标签（`预览` + 图标与实时策略名），并将图标选中态统一为 `--accent-color` 边框 + `--surface-row-selected` 底色（与设置页 `品种` / `预置头像` 选中态完全同源）。

---

## 四、P2 低权重问题（细节打磨与系统收口）

### P2-1 · 看板视图（`BoardView`）边缘裁切缺少滚动提示，未平仓卡片内部留白不均

- **位置**：`src/views/BoardView.css`（L1–L20、L101–L180）
- **现状**：实测 `03-board-1440.png` 中第 5 列（`保本`）在右边界直接被硬截断；未平仓卡片中 `TRD-136` / `EURUSD 多` / `趋势延续` / `15M` 占满 4 行，每行右半边大面积留白。
- **推荐优化方案**
  1. 将卡片的 `波段级别`（`15M`、`1D`）移至策略同行右侧（`flex; justify-content: space-between`），将未平仓卡片从 4 行收紧为精致的 3 行，同屏多容纳 20%+ 卡片。
  2. 在 `.board-scroll` 右侧可滚动时添加轻盈的边缘渐隐遮罩（或更易察觉的细横向滚动条），提示右侧还有更多状态列。

---

### P2-2 · `统计分析`（`Dashboard`）R 倍数分布横轴刻度粘连，下半区容器层次略弱于上半区

- **位置**：`src/views/Dashboard.tsx`、`src/views/Dashboard.css`（L87、L190–L260）
- **现状**：实测 `08-dashboard-1440.png` 中 `R 倍数分布` 横轴刻度 `-1~-0.5`、`0~0.5`、`1~2` 中 ASCII `~` 与负号紧贴在一起，可读性较弱；且上半区主图表使用了 `--surface-elevated` 精致卡片，下半区 `策略表现` 与 `R 倍数分布` 裸放在 `--surface-pane` 上仅靠竖线分割，视觉层次略显脱节。
- **推荐优化方案**
  1. R 区间横轴标签改用更清晰的数学/交易习惯写法（如 `<-3`、`-1~0` 或 `-1 – -0.5` 带半角空格 / 简洁区间标签），避免 `-1~-0.5` 字符粘连。
  2. 考虑为下半区两块增加同源 `--surface-elevated` 卡片承载（或保持透明但对齐内边距与顶栏间距），与全应用卡片语言呼应。

---

### P2-3 · 仍有 4 处 CSS 消费基础字号变量而非语义 `--type-*` 角色

- **位置**
  - `src/views/settings/RiskDataRepairView.css:77`：`font-size: var(--fs-sm)`
  - `src/views/settings/RiskManagementSettingsPanel.css:37`：`font-size: var(--fs-micro)`
  - `src/views/Dashboard.css:87`：`font-size: var(--font-size-title2)`
  - `src/editor/Editor.css:99, 102`：`font-size: var(--font-size-title3)` / `var(--font-size-large)`
- **推荐优化方案**
  - 业务 UI 处的 `--fs-sm` 替换为 `var(--type-list-primary-size)`，`--fs-micro` 替换为 `var(--type-chip-size)`；
  - 在 `tokens.css` 补充正式语义别名 `--type-kpi-hero-size: var(--font-size-title2)` 供 Dashboard 主数字消费，让非编辑器区域 100% 消费语义 `--type-*` 字阶。

---

### P2-4 · 全仓文案标点、引号与副标题句号微规范不统一

- **位置（抽样实证）**
  - **引号混用**：`src/views/ReviewPoolManagerModal.tsx:272`（`删除复盘池“...”？`）、`src/views/QuickNotesView.tsx:443`（`将永久删除“...”`）、`src/views/StageOwnershipRepairView.tsx:417-418` 使用中文弯引号 `“”`；其余绝大多数界面（`StrategiesPanel`、`TagPresetsPanel`、`ReviewTemplatesPanel` 等）使用直角引号 `「」`。
  - **省略号混用**：`CommandPalette`、`WeeklyReviewView` 编辑器等存在英文 `...`；设置页与表单输入框普遍使用中文 `…`。
  - **短副标题句号混用**：部分单句副标题带句末句号（如 `LiveStageManager` 的 `预约下一交易周开启新阶段。`、`TradeTrashView` 的 `记录可在 30 天内恢复...。`），部分不带句号（如 `CsvImportModal`、`DisplaySettingsPanel`、`DataSettingsPanel`）。
- **推荐优化方案**
  建立并在全仓落地统一的 **3 条桌面文案微规范**：
  1. 界面中引用对象名称（策略、标签、复盘池、随记、阶段）**统一使用直角引号 `「」`**；
  2. 所有占位符、加载中状态与打开二级弹窗的按钮**统一使用中文省略号 `…`**；
  3. **单句副标题、表单辅助说明与弹窗单句 `description` 统一不加句末句号**（仅 2 句及以上的完整说明段落保留句号）。

---

### P2-5 · 设置页标题与侧栏标签 1:1 对齐收口

- **位置**：`src/views/settings/ShortcutsPanel.tsx:118`
- **现状**：经过最新重构，10 个设置页中有 9 个页面主标题与左侧导航名称 100% 一致（`资料`/`显示`/`策略`/`风险管理`/`标签`/`品种`/`复盘起稿`/`数据`/`更新`），唯独 `ShortcutsPanel` 仍使用 `键盘快捷键`（侧栏为 `快捷键`）。
- **推荐优化方案**
  - 将 `ShortcutsPanel` 主标题收口为 `快捷键`（同时核对相关测试断言），使全部 10 个设置页的侧栏与页头命名彻底一致。

---

## 五、推荐实施路线图（按 ROI 与改动范围分 3 批落地）

| 批次 | 包含项 | 预计改动面 | 收益 |
| --- | --- | --- | --- |
| **第一批：Quick Wins（改动极小、体感立竿见影）** | `P1-2` 窄窗侧栏用户名释放 32px、`P1-1` Toast 居中避让数据列、`P1-3` 命令面板文案与同步设置名、`P2-3` 清理残留 `--fs-*`、`P2-4` 标点/引号/句号统一、`P2-5` 快捷键标题对齐 | ~10 个小文件 | 消除最扎眼的细节粗糙感与数据遮挡，全仓文案与字体彻底收口 |
| **第二批：系统一致性补齐（中改动、拉齐全站体验）** | `P0-2` 设置二级修复页卡片化、`P0-3` 全应用空状态统一光学居中、`P0-4` 窗口标题栏与返回入口规范统一、`P1-4` 随机复盘入口卡片化 | ~12 个文件 | 消除新旧页面视觉断层，让所有一二级页面都像同一套 Apple/Linear 级系统 |
| **第三批：高频弹窗与核心工作台精修** | `P0-1` `LiveStageManager` 与 `DataOrganizationPanel` 重构、`P1-5` 详情页基线与属性栏精修、`P1-6` 周复盘双栏与状态打磨、`P1-7` 交易/策略弹窗材质统一、`P2-1` 看板紧凑化、`P2-2` 统计 R 刻度优化 | ~14 个文件 | 彻底打通高频复盘与配置流程的最后一层操作摩擦 |
