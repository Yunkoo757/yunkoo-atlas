# Trader Atlas 深色主题颜色、亮度与明暗层级优化规范

> 状态：R0–R4 已通过产品手动复核；最终 Renderer 与完整回归已通过，Electron / Packaged 发布证据等待干净候选提交
> 文档版本：v0.7
> 现状证据基线：`main@2c080c0`
> 诊断基线：R0 工具已生成；V1 候选基线在产品确认方向后按 Commit 锁定
> 审查日期：2026-08-30
> 适用平台：Windows 客户端、macOS 客户端
> 变更类型：全局 Color / Theme Token 校准与语义迁移
> 明确不包含：页面结构、布局、尺寸、业务逻辑、交互流程调整

## 1. 文档目的

本文档把 Trader Atlas 当前深色界面的颜色、亮度与明暗层级问题，整理成可独立审核、可分轮实施、可逐轮回退的设计与工程规范。

实现人员不得仅凭“整体偏暗”直接提高所有背景、文字或边框。每一轮只能改变一条视觉变量链，并使用相同数据、相同页面、相同视口重新截图。只有上一轮通过产品审核后，才能进入下一轮。

本规范优先解决以下问题：

1. 不同页面使用不同的工作区底色，导致页面切换时亮度曲线跳变。
2. 表面语义 Token 已存在，但页面仍大量直接消费基础色或局部 `color-mix()`。
3. 必须扫描的元数据可能落入过弱文字角色，需由选择器清单验证。
4. `border-subtle` 可能被过度用于长期结构边界，需由结构边界清单验证。
5. 不同组件族的 Hover 与 Selected 可能缺少稳定分工，需由状态清单验证。

## 2. 审核结论摘要

### 2.1 核心判断

当前证据不支持“先把全部基础背景调亮”。Trader Atlas 的主要中性底色与本次已观测的 Linear 登录态深色工作区接近，但这只能否定“整体抬亮是第一优先级”，不能证明两套产品已经具有相同的层级质量：

| 角色 | Trader Atlas 当前值 | Linear 单页计算样式近似值 | 当前判断 |
| --- | --- | --- | --- |
| App / Shell | `#09090A` | `#09090A` | 本规范内冻结，不作为首轮调整 |
| Main / Pane | `#121213` | `#121213` | 本规范内冻结，不作为首轮调整 |
| Elevated | `#161617` | `#161617` | 数值不是首要问题 |
| Group | `#1A1A1B` | `#1A1A1B` | 数值不是首要问题 |
| Nav Active | `#232325` | `#232325` | 当前表现清晰、克制 |
| Control Active | `#29292B` | `#29292B` | 当前表现清晰、克制 |

当前最强工作假设是：同一组颜色在部分页面被分配到不同语义位置，且不同组件通过局部混色形成了不一致的亮度曲线。该假设必须由 R1、R2 的固定证据验证，不能在实施前写成既定根因。

### 2.2 本规范采用的策略

1. 第一轮不修改 App、Pane、Elevated、Primary Text 的基础数值。
2. 第一轮先统一页面对 Surface 语义 Token 的消费关系。
3. 第二轮通过文字角色迁移提高可读性，不全局抬高所有文字。
4. 第三轮拆分结构边界和交互状态，再校准 Selected。
5. 第四轮只做跨页面收敛、局部混色治理和平台验证，不再引入新视觉方向。

该顺序用于保证每轮变化都可以归因。如果同时提高背景、文字、边框和状态色，即使最终截图变亮，也无法确认真正有效的因素。

## 3. 已验证的当前状态

### 3.1 证据来源

- 当前代码：`main@2c080c0`。
- 全局设计基线：`design.md`。
- 主题 Token：`src/styles/tokens.css`。
- 旧页面证据：`pnpm qa:desktop-visual` 在 `2c080c0` 生成过完整 Renderer 矩阵；该结果用于证明场景可运行，不作为每次视觉实验的固定成本。
- 外部参照产品的登录态页面（具体地址不写入项目文档）。
- Linear 本地参考资料：`D:\Trader-Atlas-reference-assets\linear-design-2026-08-28`。
- 设计合同：`pnpm qa:design`，当前结果为通过。

### 3.2 证据边界与标记

本文档中的关键诊断结论统一使用以下标签：

| 标签 | 含义 | 可否直接作为改动依据 |
| --- | --- | --- |
| `[A]` | Atlas 代码、计算样式或固定 Fixture 截图中已复现的事实 | 可以，但仍需按轮验证 |
| `[L]` | Linear 已登录网页的 DOM、计算样式或本地调研资料中已观测的事实 | 只能作为关系参照，不能直接复制 |
| `[I]` | 由 `[A]` 与 `[L]` 共同推导的工作假设 | 不可直接定案，必须实验验证 |
| `[P]` | 面向 Atlas 的候选方案或验收提案 | 需产品批准后才可实施 |

证据覆盖范围：

- `[L]` 当前只覆盖 Linear 的登录态 All issues 页面及已保存参考资料；未覆盖完整的弹窗、编辑器、Hover、Focus、Disabled 和所有密度状态。
- Linear 当前网页证据来自 Chrome、DPR 约 1.75；Atlas 最终目标是 Windows/macOS Electron 客户端，跨产品截图不能直接做色度学比较。
- Linear 的 DOM 与最终计算样式可用于核对表面关系；截图只用于观察信息分布和光学感受，不作为 Atlas 像素匹配目标。
- 下表中的 Linear Hex 是计算样式经色彩转换后的近似 sRGB，不是从压缩截图中吸色所得。
- Atlas 与 Linear 当前相同的部分底色是 Atlas 已有基线；Linear 只用于佐证“整体抬亮不是优先实验”。

### 3.3 证据账本

| 编号 | 结论 | 标签 | 覆盖范围 | 置信度 | 复现方式 |
| --- | --- | --- | --- | --- | --- |
| E-01 | 看板根使用 App 色，列表根使用 Pane 色 | `[A]` | `/board`、`/list` | 高 | 核对 `BoardView.css:7`、`ListView.css:27` 与 `getComputedStyle` |
| E-02 | 当前 25 场景旧矩阵已生成 150 张且无 Console/Page Error | `[A]` | 旧场景清单 × 6 视口 | 高 | 读取现有 renderer report；仅作为旧基线 |
| E-03 | Atlas 与 Linear 已观测页的核心底色接近 | `[A]+[L]` | 单个 Linear 页面、Atlas 固定页 | 中 | 比较计算样式，不比较截图抗锯齿像素 |
| E-04 | 工作区底色错位是看板割裂的最强候选因素 | `[I]` | 列表/看板切换 | 中 | R1 单变量改动前后对照 |
| E-05 | 文字角色错配是“偏闷”的候选因素 | `[I]` | 编号、日期、周期、说明 | 中 | R0 选择器清单 + R2 计算样式与人工对照 |
| E-06 | 中性局部混色可能形成私有亮度曲线 | `[I]` | 47 个 CSS 文件 | 低至中 | R0 对 178 项先分类，禁止直接用总数下结论 |
| E-07 | 交易多选明确不改变整行底色 | `[A]` | 交易列表 | 高 | `src/components/trades/TradeList.css:335-343` 与 `src/components/trades/TradeRowPresentation.browser.test.tsx:173-184` |
| E-08 | 当前场景清单缺少案例看板 | `[A]` | 自动视觉矩阵 | 高 | 核对 `scripts/desktop-visual-scenarios.mjs` |
| E-09 | Linear 已观测列表使用少量高亮锚点与稳定 Metadata 灰，而非普遍加粗 | `[L]` | All issues 已保存 DOM / 计算样式证据 | 高 | 主标题约 `13px / 500 / L100`；编号、日期、标签约 `12–13px / 450 / L61.8` |
| E-10 | Atlas 当前 Strong、Metadata、Faint 的数值及列表常用 `450/500` 字重已接近 Linear 的已观测角色 | `[A]+[L]` | Token 与交易列表、侧栏固定选择器 | 高 | 对照 `tokens.css`、`TradeList.css`、`Sidebar.css` 与 Linear 参考证据；该事实不证明角色分配已经正确 |
| E-11 | Atlas 高频信息可能集中落在 Metadata L62 与 Context L56 的窄区间 | `[I]` | 列表、侧栏及其他高密度页 | 中 | R0 按选择器和内容语义核验，不能用仓库级引用次数或截图直方图直接定案 |

### 3.4 当前中性色阶

| 语义 | Token | 当前 LCH | 近似 Hex |
| --- | --- | ---: | --- |
| App / Shell | `--bg-app` | `L2.6 C0.4 H272` | `#09090A` |
| Pane | `--bg-surface` | `L5.52 C0.4 H272` | `#121213` |
| Inset | `--bg-inset` | 混合值 | `#141415` |
| Elevated / Control | `--bg-elevated` | `L7.32 C0.85 H272` | `#161617` |
| Tertiary | `--color-bg-tertiary` | `L8.22 C1.3 H272` | `#17181A` |
| Group | `--surface-group` | `L9.35 C0.85 H272` | `#1A1A1B` |
| Floating | `--surface-floating` | 约 `L9.92` | `#1B1B1C` |
| Hover | `--bg-hover` | `L10.15 C0.6 H272` | `#1C1C1D` |
| Generic Selected | `--bg-selected` | `L10.8 C0.85 H272` | `#1D1D1E` |
| Nav Active | `--surface-nav-active` | `L13.85 C1.3 H272` | `#232325` |
| Control Active | `--surface-control-active` | `L16.7 C1 H272` | `#29292B` |

### 3.5 当前文字阶梯

| 角色 | Token | 当前值 | 对 `#121213` 的近似对比度 | 当前结论 |
| --- | --- | --- | ---: | --- |
| Strong | `--text-content-strong` | `L98` / `#F9F9FA` | `17.79:1` | 不应继续提高 |
| Supporting | `--text-content-supporting` | `L88` / `#DCDDDE` | 高于正文要求 | 不应继续提高 |
| Body | `--text-secondary` | `L70` / `#AAABAD` | `8.15:1` | 正常 |
| Metadata | `--text-content-metadata` | `L62` / `#959698` | `6.32:1` | 适合编号、日期、周期、计数 |
| Context | `--text-content-context` | `L56` / `#868688` | `5.15:1` | 只适合真正次要的解释信息 |
| Faint | `--text-content-faint` | `L38` / `#59595B` | 约 `2.5–3.0:1` | 只适合非必要信息 |
| Disabled | `--text-disabled` | `L34` / `#4F5052` | 约 `2–3:1` | 只能用于禁用状态 |

### 3.6 当前代码使用统计

以下统计基于 `src/**/*.css`：

| 项目 | 当前引用次数 | 结论 |
| --- | ---: | --- |
| `--surface-app` | 1 次，包含定义 | 页面基本没有实际消费 |
| `--surface-pane` | 2 次，包含定义 | 页面基本没有实际消费 |
| `--surface-inset` | 2 次，包含定义 | 页面基本没有实际消费 |
| `--surface-floating` | 2 次，包含定义 | 页面基本没有实际消费 |
| `--bg-app` | 14 次 | 页面仍直接绑定基础层 |
| `--bg-surface` | 67 次 | 页面仍直接绑定基础层 |
| `--bg-elevated` | 59 次 | 组件仍直接绑定基础层 |
| `--text-primary` | 200 次 | 正常高频 |
| `--text-secondary` | 190 次 | 正常高频 |
| `--text-tertiary` | 262 次 | 使用面积过大 |
| `--text-muted` | 87 次 | 与 Tertiary 语义重叠 |
| `--text-quaternary` | 36 次 | 需确认是否只用于非必要信息 |
| `--border-subtle` | 211 次 | 被过度用作长期结构边界 |
| `--border-divider` | 7 次 | 结构边界语义没有被充分使用 |
| `color-mix()` | 224 次 | 其中 Token 文件外 178 次，分布在 47 个 CSS 文件 |

以上次数包含定义和真实消费的混合统计，只能作为风险信号。`qa:design` 通过只证明组件没有大量写入裸 Hex，并不证明组件使用了正确的语义角色。R0 必须生成选择器级清单后，才能确定实际迁移量。

### 3.7 截图中的可量化差异

在 `1600×1000` 截图中排除 244px 侧栏后：

| 页面 | 主区域最主要底色 | 占比 | 结论 |
| --- | --- | ---: | --- |
| 交易日志列表 | `#121213` | `85.41%` | 工作区使用 Pane 层 |
| 设置·显示 | `#121213` | `89.27%` | 工作区使用 Pane 层 |
| 看板 | `#09090A` | `61.30%` | 错误使用 App / Shell 层 |
| 看板 | `#121213` | `33.62%` | 卡片与局部区域使用 Pane 层 |

在当前颜色范围内，工作区底色语义不一致是看板与列表割裂的最强候选因素；该结论不排除字体渲染、内容密度和局部状态曲线的影响。

### 3.8 外部审核意见吸收决议

外部审核提出“背景接近但局部对比、高亮锚点和信息层级不同”的判断，与当前代码和 Linear 本地证据总体一致；但其截图统计口径、Token 映射与字重处方不能直接作为实施依据。正式决议如下：

| 外部意见 | 决议 | 规范化解释 |
| --- | --- | --- |
| 两边核心背景接近，不应先整体调亮 | 采纳 | 以 DOM 计算样式和 Atlas Token 为证据；跨产品整图平均亮度只作描述，不作为门槛 |
| 高频内容可能挤在中灰区 | 作为 `[I]` 工作假设采纳 | R0 必须逐个记录内容语义、resolved color、背景和对比度，再决定 R2 迁移 |
| Linear 的清晰感来自少量更亮锚点与更弱次级内容 | 采纳其角色分配原则 | 只比较角色关系，不复制 Linear 的 Hex、亮像素比例或组件实现 |
| Atlas 一级文字应统一继续提亮 | 拒绝 | Atlas Strong 已为 `L98 / #F9F9FA`，交易品种、月份等关键锚点已解析为 Strong；继续提亮不是当前证据支持的方向 |
| 正文 `400→500`、标题 `500→600` | 拒绝作为全局方案 | Linear 已观测普通列表同样以 `450/500` 为主；Atlas 也已采用该区间。字重只能在颜色角色验证后另立 Typography 诊断 |
| 二级文字不动、三级文字统一压暗 | 拒绝这种 Token 名称级批处理 | 日期、周期、编号等虽然可能叫 Tertiary，却属于必须扫描的 Metadata；解释、占位和溢出计数才允许进入 Context/Faint |
| 用整图平均亮度和高亮像素占比证明方案 | 降级为辅助证据 | 结果受裁剪、缩放、内容量、抗锯齿与平台渲染影响；必须记录 ROI 和方法，且不得单独决定 Pass/Fail |

因此，本规范吸收的不是“更亮、更粗”这一表面处方，而是“扩大语义角色之间的有效动态范围、减少高频内容在相邻中灰角色中的错误拥挤”。实施顺序仍为：先测量真实分配，再迁移角色，最后才判断是否存在独立的字体渲染问题。

## 4. 待验证的工作假设与优先级

| 优先级 | 工作假设 | 证据性质 | 用户感知 | 验证轮次 |
| --- | --- | --- | --- | --- |
| P0 | 看板与列表的 Pane 语义错位造成主要亮度跳变 | `[A]` 文件与计算样式事实；影响程度为 `[I]` | 页面切换时突然变暗 | R1 |
| P0 | 部分必须扫描的信息可能使用了过弱文字角色 | 349 次仅为 `[A]` 风险信号，具体内容为 `[I]` | 文字可见但需要额外集中注意力 | R0 清单 + R2 |
| P1 | 长期结构边界可能过度依赖 `border-subtle` | 211 对 7 的计数为 `[A]` 风险信号 | 面板、列、卡片与分组边界易混 | R3 |
| P1 | 不同组件族的 Hover/Selected 可能错误共用绝对底色 | Token 与消费者关系为 `[A]`；感知影响为 `[I]` | 状态差异不稳定 | R0 状态清单 + R3 |
| P1 | Surface 语义层没有统领页面 | 语义 Surface 消费量为 `[A]` | 页面形成私有层级 | R1 |
| P2 | 178 个局部混色中可能存在中性私有曲线 | 总数为 `[A]`；中性子集尚未知 | 同类组件强度可能不一致 | R0 分类 + R4 |

R2、R4 在对应清单冻结前不得批准实施。引用次数不能替代“选择器 → 内容语义 → 当前计算颜色 → 承载表面 → 目标角色”的逐项证据。

## 5. 保持不变的内容

以下内容当前没有证据证明存在问题，不得在本计划中顺手调整：

- `--bg-app`、`--bg-surface`、`--bg-elevated` 的基础数值。
- Strong、Supporting、Body 的文字数值。
- 盈利、亏损、警告、待处理、方向等业务语义色。
- 品牌 Accent 和键盘 Focus 色相。
- 字体、字号、字重、行高、字距。
- 列表行高 44px / 48px 设置。
- 页面轨道、侧栏宽度、卡片尺寸、圆角和间距。
- 现有导航 Active 和分段 Control Active 的亮度数值。
- 页面结构、交互逻辑、路由、数据和快捷键。

## 6. 全局设计护栏

### 6.1 表面护栏

基础表面和组件状态必须分开建模，禁止把 App、Pane、Card、Menu、Nav、Control、Focus 排成一条全局绝对亮度曲线。

基础表面关系：

```text
App / Shell < Pane < Elevated / Card < Group / Floating
```

Atlas 产品护栏：

- Shell → Pane：`ΔL 2–4`。
- Pane → Elevated / Card：`ΔL 1.5–3`；表面差不足时可以由克制边界补足。
- Pane → Group：`ΔL 3–6`。
- Inset 是“嵌入/内凹”语义，当前数值位于 Pane 与 Elevated 之间，但不参与组件状态推导。
- Floating 是独立浮层基面，不使用页面行 Hover 的绝对值推导其菜单状态。
- 中性表面 Chroma 不高于 2，同组 Hue 漂移不超过约 3°。
- 本计划内 `--bg-app` 与 `--bg-surface` 完全冻结；任何基础值调整必须另立新规范并相对 R0 基线累计计算，不能按轮重置额度。

上述 `ΔL`、Chroma 与 Hue 范围是 Atlas 的过程控制建议，不是 WCAG 标准，也不是 Linear 的验收真值。

### 6.2 组件局部状态护栏

每个组件族必须以自己的 Rest 承载面计算状态关系：

| 组件族 | Rest 承载面 | Hover | Persistent Selected / Active | 备注 |
| --- | --- | --- | --- | --- |
| Pane List Row | Pane / Transparent | `--surface-row-hover` | 仅真实持久选择才使用专用 Token | 交易多选保持透明，不映射整行 Selected |
| Board Card | Elevated | 专用 Card Hover 或经批准的状态叠加层 | 默认无持久 Selected | 不直接套用 Menu/Nav 状态 |
| Floating Menu | Floating / Transparent | `--surface-menu-hover` 候选 | `--surface-menu-selected` 候选 | 必须按 Floating 实际合成背景测量 |
| Sidebar Nav | App / Transparent | `--surface-nav-hover` | `--surface-nav-active` | 保持现有数值，R3 仅验证 |
| Segmented Control | Elevated / Control | `--surface-control-hover` | `--surface-control-active` | 依靠背景 + 文字两种线索 |

状态硬规则：

- Hover 与持久 Selected/Active 不得使用同一语义 Token。
- 交易列表多选继续依靠 Checkbox/Indicator；不得因为本规范新增整行亮底。
- 键盘当前行继续使用 Hover 面与独立内描边，不等同于业务选中。
- Pressed 是瞬态反馈，可以通过边界或深度表达，不要求绝对亮度高于 Hover。
- Persistent Selected/Active 必须同时拥有背景、文字、图标或边界中的至少两种线索。
- Focus 是可叠加在任一 Rest/Hover/Selected 状态上的正交 Indicator，不参与中性表面 L 值排序。

### 6.3 文字护栏

- Primary：对主要背景至少 `12:1`，为 Atlas 产品护栏。
- Supporting / Body：至少 `7:1`，为 Atlas 产品护栏。
- 必须扫描的 11–13px Metadata：目标至少 `5.5:1`，硬下限 `4.5:1`；`4.5:1` 为正常文字无障碍下限，`5.5:1` 是针对 Windows 小字号中文的 Atlas 目标。
- Context：如果仍需正常阅读，至少 `4.5:1`。
- Faint / Disabled 可低于 `4.5:1`，但不得承载唯一的日期、金额、状态、周期或操作说明。
- 验收必须读取浏览器最终 resolved RGB，并在实际 Pane、Elevated、Floating 上完成 Alpha 合成；不得直接用 LCH 的 L 推算 WCAG 对比度。
- 截图抗锯齿像素不得作为文字对比度输入。
- 若关键主文字已经解析为 Strong、无祖先透明度、对比度满足本节门槛，却仍被判断为“灰、软、糊”，不得继续提高 Strong；应转入平台字体、真实回退字体、合成字重和栅格化诊断。
- 层级判断必须在固定页面、固定 ROI 或单行语义内部完成：Identity、Metadata、Context、Faint 分别比较；不得用全仓 Token 次数或整张截图的亮像素直方图替代局部角色判断。

### 6.4 Border 护栏

- 纯结构 Hairline：与相邻表面对比约 `1.05–1.2:1`，这是低干扰视觉范围，不是无障碍通用标准。
- 已有填充、形状或其他识别线索的交互控件，默认边界可以约 `1.2–1.5:1`。
- 如果 Border 是识别控件边界的唯一线索，不得仅以 `1.2–1.5:1` 作为通过条件，必须增加更强边界或其他可辨认线索。
- Focus Indicator：与相邻颜色至少 `3:1`，属于非文本界面组件的硬下限。
- 若容器与背景已有足够表面差，优先减弱或移除结构 Border，不同时使用亮表面、亮边框和阴影。
- Windows/macOS 要求结构线连续、无断裂、无周期性虚化，同一缩放下同类 Divider 光学粗细一致；允许 1 CSS px 在 125%/150% 缩放下覆盖 1–2 个设备像素。

### 6.5 测量规则

- `ΔL` 只用于 Token 之间的感知梯度设计，不用于替代 WCAG 对比度。
- `x:1` 对比度统一使用 sRGB 相对亮度算法；半透明前景、边框和浮层必须先与实际背景合成。
- 页面根、卡片、菜单和状态颜色以 `getComputedStyle` 的 resolved 值为硬证据。
- 截图像素占比、直方图和 ROI 只作为诊断指标；如使用，必须记录裁剪区域、遮罩、颜色容差和视口，不能单独决定 Pass/Fail。
- 跨 Linear 与 Atlas 的截图不做 ΔE 或像素级验收；只比较角色关系、信息分布和状态分工。

## 7. 目标 Token 语义模型

### 7.1 Surface 角色

第一轮以“改语义引用”为主，基础数值保持不变。

| 目标 Token | 目标值 | 唯一职责 | 禁止用途 |
| --- | --- | --- | --- |
| `--surface-app` | `var(--bg-app)`，L2.6 | 应用壳、侧栏、Pane 外部背景 | 页面主工作区、看板画布 |
| `--surface-pane` | `var(--bg-surface)`，L5.52 | 所有页面的主工作区 | 卡片、控件、浮层 |
| `--surface-inset` | `var(--bg-inset)`，约 `#141415` | 次级侧栏、评分格、内嵌证据区 | 独立浮层、持久选中 |
| `--surface-elevated` | 新别名，`var(--bg-elevated)`，L7.32 | 看板卡片、独立对象卡片 | 页面根背景、普通控件 |
| `--surface-group` | 现有值，L9.35 | 月份条、看板状态头、分组带 | 普通卡片主体 |
| `--surface-floating` | 现有值，约 L9.92 | 菜单、Popover、Toast、命令面板 | 页面固定内容 |

新增 `--surface-elevated` 的理由：它会服务看板卡片和独立对象卡片，具备跨页面复用价值；普通控件继续使用现有 `--surface-control`，避免两个语义二选一。

### 7.2 Text 角色

第二轮不改变基础 LCH 数值，先迁移引用。

| 目标角色 | Token | 当前值 | 必须用于 | 禁止用于 |
| --- | --- | --- | --- | --- |
| Strong | `--text-content-strong` | L98 | 页面标题、品种、关键结果 | 全部正文 |
| Supporting | `--text-content-supporting` | L88 | 重要辅助内容、Hover 强内容 | 普通元数据 |
| Body | `--text-secondary` | L70 | 正文、主要说明、普通操作 | Disabled |
| Metadata | `--text-content-metadata` | L62 | 编号、日期、周期、计数、稳定标签 | 占位符 |
| Context | `--text-content-context` | L56 | 可弱化解释、上下文补充 | 唯一状态、金额、日期 |
| Faint | `--text-content-faint` | L38 | 装饰符号、非必要占位 | 正常业务内容 |
| Disabled | `--text-disabled` | L34 | 确实不可用的交互 | 普通次级信息 |

`--text-muted` 和 `--text-tertiary` 继续保留兼容，但新代码不得用这两个模糊名称决定内容亮度。稳定内容必须选择 Metadata 或 Context。

### 7.3 Border 角色

第三轮先改引用关系，现有数值保持不变。

| 目标角色 | Token | 当前值 | 目标用途 |
| --- | --- | --- | --- |
| Internal | `--border-subtle` | L9.84 | 卡片内部、同一组件内的低优先分隔 |
| Structural | `--border-divider` | L12.4 | Pane、设置侧栏、看板列、长期结构边界 |
| Interactive | `--border-default` | L14.16 | 卡片、字段、普通可交互控件 |
| Strong | `--border-strong` | L16.32 | Hover、当前操作对象、强边界 |
| Focus | `--field-border-focus` / Focus Token | Accent 混合 | 键盘焦点，至少 3:1 |

### 7.4 Hover / Selected 角色

第三轮按组件族治理状态，不再预设一套通用的绝对 Hover/Selected 值：

| Token | 本规范状态 | 说明 |
| --- | --- | --- |
| `--surface-row-hover` | 保持现值并验证 | Pane 列表行与键盘当前行；不得用于 Floating Menu |
| `--surface-row-selected` | 保留兼容，不修改 | 当前无需要整行亮底的合法生产消费者；不得绑定交易多选 |
| `--surface-card-hover` | R0 审计后决定是否新增 | 仅当现有 Card Hover 无法稳定表达时引入 |
| `--surface-menu-hover` | Atlas 候选，R3 A/B 后锁定 | 基于 Floating 合成背景校准，不能复用绝对 Row Hover |
| `--surface-menu-selected` | Atlas 候选，存在真实持久选择时才引入 | 必须区别于 Menu Hover，并配合文字/图标线索 |
| `--surface-nav-hover / active` | 保持现值并验证 | 只服务 App Shell 上的导航状态 |
| `--surface-control-hover / active` | 保持现值并验证 | 只服务 Control 承载面上的分段选择 |

不得直接全局提高 `--bg-selected`。该 Token 当前同时被编辑器、菜单、周复盘、设置、选择器和对话框消费。第三轮必须先建立真实消费者清单，再按 Row、Menu、Control 等语义迁移；不存在合法消费者时不新增 Token，也不为“完整性”制造状态。

## 8. 分轮实施规范

## R0：证据工具与轻量诊断基线

### 目标

先补齐可执行的测量工具、场景和审计清单，并建立可覆盖的轻量诊断基线。R0 不修改任何生产颜色值。发布级不可变基线不再阻塞视觉探索，只在轮次候选获批或最终发布时生成。

### 当前状态

- [x] 旧证据 SHA 已记录：`2c080c0`。
- [x] 26 场景 × 6 视口，共 156 张 Renderer 可运行性检查已通过。
- [x] 完整矩阵 Console Error、Page Error、非预期 Overflow 均为 0。
- [x] 当前 `pnpm qa:design` 通过。
- [x] `/review-cases/board` 已进入自动场景。
- [x] 页面根、文字角色、局部混色与交互状态清单已可复现生成。
- [x] Renderer 与 Windows Electron 的 9 个确定性交互状态已验证可运行。
- [ ] 当前证据由含未提交变更的工作区生成，只是诊断候选，不是发布签核证据。

### R0 必须交付的工具和清单

1. 在 `scripts/desktop-visual-scenarios.mjs` 增加 `/review-cases/board`；26 场景 × 6 视口作为最终发布矩阵保留，不作为单次实验默认范围。
2. 新增 `scripts/theme-luminance-contract.mjs`，集中声明：
   - 页面与目标选择器；
   - 承载表面；
   - 状态触发方式；
   - 文字语义；
   - 对比度或 resolved-color 断言；
   - Alpha 合成规则和容差。
3. 新增 `scripts/qa-theme-luminance.mjs` 与 `pnpm qa:theme-luminance`，支持 inventory、默认硬门槛和 `--capture-states` 三种模式；状态模式支持 `--runtime renderer|electron|packaged`，输出非零退出码、JSON 报告和确定性状态截图。
4. 生成页面根清单，至少覆盖 `src/views/*.css`、`src/views/settings/*.css`、`src/components/ui/AppFrame.css`；不得只依赖手写文件表。已知遗漏风险包括 `src/views/ImportDataHealthView.css`。
5. 冻结文字迁移清单：

   ```text
   路由 → 选择器 → 内容语义 → 当前 resolved color → 实际承载面 → 当前对比度
   → declared/resolved font-weight → 平台真实字体与字形数 → 合成/回退诊断 → 目标角色
   ```

   固定抽样至少包含：侧栏普通项、激活项和子项；列表表头、月份标题、月份计数、编号、交易品种、周期、日期和标签。Electron Chromium 支持时使用 CDP `CSS.getPlatformFontsForNode` 记录真实平台字体与 glyph count；运行环境不支持时显式记录 `unsupported`，不得伪造字体结论，也不得因此跳过 packaged 截图。

6. 对 Token 文件外的 178 个 `color-mix()` 生成分类清单：
   - Neutral Surface/Text/Border；
   - Business Semantic；
   - 一次性 Optical Calibration Allowlist。
7. 冻结交互状态清单：路由、Fixture、选择器、输入操作、Rest/Hover/Selected/Focus/Disabled、截图名、恢复步骤。
8. 更新 `.github/workflows/desktop-visual-evidence.yml`，让 Windows 每档缩放与 macOS 每个架构写入独立的 Commit 地址化目录，执行对应 Packaged 状态截图并上传同一轮完整目录。
9. 快速实验输出写入可覆盖的 `scratch` 目录；只有产品确认某轮候选后，才要求提交并生成 Commit 地址化候选证据。

### 硬性通过条件

1. 截图使用固定 Fixture，不使用用户实时数据；字体加载完成后再截图。
2. `pnpm qa:theme-luminance` 可独立运行，并输出 resolved color、Alpha 合成、WCAG、字重和平台字体证据。
3. 页面根、文字、混色、状态四份清单均有可复现命令；R2 当前扫描结果为 7 个页面根、822 个文字角色用法、177 个 Token 外局部混色和 9 个状态。
4. 19 个固定 resolved-style 探针能够定位失败对象。目前 15 个通过，4 个 Metadata 候选低于 `5.5:1`，该结果用于 R2 假设验证，不授权全局提亮。
5. `--capture-states --runtime renderer|electron|packaged` 能执行确定性状态取证；R0 只要求 Renderer 可运行，Windows Electron 在轮次候选确认后定向复核，Packaged 留到最终发布门。
6. R1 开始前不要求重新跑 156 张或 macOS；只要求第 9.3 节“快速实验门”通过。

## R1：Surface 语义统一

### 唯一目标

验证并修正页面根 Surface 的语义错位，建立一致的 App → Pane → Elevated / Group / Floating 分工。R1 只改变语义引用，不改变基础色值。

### Token 变更

1. 在 `src/styles/tokens.css` 增加：

   ```css
   --surface-elevated: var(--bg-elevated);
   ```

2. 保持以下基础值不变：

   - `--bg-color`
   - `--color-bg-primary`
   - `--color-bg-secondary`
   - `--color-bg-tertiary`
   - `--color-bg-quaternary`
   - `--popover-bg`

3. `--surface-app / pane / inset / floating / group` 继续引用现有上游值。

### 已知最低修改范围

| 文件 / 位置 | 当前 | 目标 |
| --- | --- | --- |
| `src/components/ui/AppFrame.css:45` | `--bg-surface` | `--surface-pane` |
| `src/views/ListView.css:7,27` | `--bg-surface` | `--surface-pane` |
| `src/views/BoardView.css:7` | `--bg-app` | `--surface-pane` |
| `src/views/BoardView.css:102` | Pane/Elevated 的 92% 局部混色 | `--surface-elevated` |
| `src/views/QuickNotesView.css:6` | `--bg-surface` | `--surface-pane` |
| `src/views/ReviewSessionView.css:7` | `--bg-surface` | `--surface-pane` |
| `src/views/WeeklyReviewView.css:7` | `--bg-surface` | `--surface-pane` |
| `src/views/TrashView.css:6` | `--bg-surface` | `--surface-pane` |
| `src/views/DetailView.css:155` | `--bg-surface` | `--surface-pane` |
| 设置主内容根容器 | 继承或直接使用基础面 | 明确消费 `--surface-pane` |
| `src/views/ImportDataHealthView.css` 等 R0 页面根清单项 | 直接消费基础面 | 按容器角色迁移到 `--surface-*` |

本表只是当前已知最低范围。R1 的完整范围必须来自 R0 页面根清单；如果扫描结果包含更多页面根，必须一并纳入同轮，不允许只修截图里最明显的页面。

### 看板具体结果

```text
App Frame      #09090A  surface-app
Main Workspace #121213  surface-pane
Board Card     #161617  surface-elevated
Group Header   #1A1A1B  surface-group
Card Hover     #1C1C1D  current resolved; R1 unchanged
```

上表的 Hover 行仅记录当前看板卡片 resolved 结果；R1 不修改、也不把卡片绑定到 `--surface-row-hover`。R3 根据 R0 状态清单决定是否引入 `--surface-card-hover` 或状态叠加层。

看板列本身保持透明，不新增大面积列卡片背景；既有卡片只替换语义引用，不新增新的卡片化区域。列结构边界留到 R3 决定。

### R1 禁止项

- 不提高 `#09090A` 或 `#121213`。
- 不修改文字 Token。
- 不修改 Border 强度。
- 不新增阴影、渐变或新的卡片化区域。
- 不调整看板列宽、间距、卡片高度和布局。
- 不清理与中性 Surface 无关的业务色混合。

### R1 验收标准

1. R0 页面根清单中的主工作区 resolved background 全部等于 `--surface-pane`，只有清单中明确标记为 Shell/Floating/Inset 的容器可以例外。
2. `/list`、`/board`、`/review-cases`、`/review-cases/board` 必须有独立 computed-style 硬断言；不能只靠截图看起来接近。
3. 看板卡片 Rest 计算样式等于 `--surface-elevated`，不得继续使用页面级中性混色。
4. `1600×1000` 的颜色占比只保留为诊断报告；必须记录主工作区 ROI、侧栏/App Frame 遮罩和 RGB 容差，不设 `≤5%` 硬门槛。
5. 列表、看板、案例库、设置切换时，Pane resolved color 完全一致。
6. `--bg-app` 与 `--bg-surface` 的定义和值相对 R0 必须为零变化。
7. V0 固定 4 场景 × 2 视口共 8 张通过，无新增溢出、字体错误、Console Error 或 Page Error。
8. 产品认可方向后，提交 R1 并补一次同范围 Windows Electron 定向复核；Candidate 保存到 `candidate/{R1提交SHA}/attempt-1`，报告 `dirty=false`。

### R1 停止 / 回退条件

- 任一页面根计算样式不符合 R0 清单，或基础 App/Pane 数值发生变化。
- 任一自动阈值失败、场景缺图、报告身份不一致，或新增 Console/Page Error、Overflow、字体失败。
- 需要增加页面级 Hex 或新的局部中性混色才能补救。
- 人工审查发现卡片与 Group Header 主次颠倒时，标记该证据为 rejected，不在 R1 内提高文字或 Border 补偿。
- 如果 R1 后仍觉得文字发闷，不得继续提高背景；记录结论并进入 R2 验证文字角色。

## R2：文字角色迁移

### 当前 V0 结果

- [x] 月份分组计数、交易周期、看板列计数与看板卡片编号已从 Context 迁移到 Metadata。
- [x] 风险周期未选项已从 Context 迁移到 Body；已选态保持 Strong。
- [x] 基础文字 Token、字号、字重、字距、背景、布局与交互逻辑均未修改。
- [x] 19 个固定文字探针与页面 Surface 探针全部通过，`failureCount = 0`。
- [x] 6 场景 × 2 视口共 12 张 Renderer 截图通过，Console/Page Error 与非预期 Overflow 均为 0。
- [x] 类型检查、静态设计合同、桌面视觉治理与浏览器回归通过。
- [x] 产品已在实际 Windows 客户端中完成手动复核并同意进入 R3。

### 唯一目标

让必须扫描的信息达到稳定 Metadata 亮度，同时保持 Context、Faint 和 Disabled 的后退能力。

### Token 变更

第一版不修改文字 LCH 值，也不新增第二套同义别名。现有 `--text-content-metadata`、`--text-content-context`、`--text-content-faint` 是唯一 canonical 语义。

`--text-muted` 与 `--text-tertiary` 进入兼容状态：保留现有值，但新代码不得再用模糊名称决定稳定内容的亮度。已有用法必须按 R0 冻结清单逐项判断，不能通过重新定义 Token 一次性改变大量位置。兼容 Token 只有在生产消费者归零且设计合同通过后，才可另行提议删除。

### 信息角色迁移矩阵

下表是审核规则，不是“命中即批量替换”的脚本。每个选择器仍需以 R0 的内容语义和 resolved style 清单为准。

同一高密度列表行内使用以下固定语法：

- Identity：交易品种、页面/分组标题等第一视觉锚点，使用 Strong。
- Scan Metadata：编号、日期、周期、计数、确定状态等完成扫描所必需的信息，使用 Metadata。
- Explanatory Context：说明、来源、占位解释等不影响首次扫描的信息，使用 Context。
- Overflow / Non-essential：`+N`、装饰性补充或可安全忽略的信息，使用 Faint。

不得因为 Metadata 与 Context 只相差 6L，就把所有 Context 批量提升到 Metadata；也不得为了“拉开层级”把必须扫描的信息批量压入 Context/Faint。

| 页面族 | 信息 | 当前常见角色 | 目标角色 |
| --- | --- | --- | --- |
| 交易日志 / 案例库 | TRD/CAS 编号 | List Secondary 或 Tertiary | Metadata |
| 交易日志 / 案例库 | 日期、周期、分组计数 | Tertiary | Metadata |
| 交易日志 / 案例库 | `+N` 溢出计数 | Quaternary | Faint，保持不变 |
| 看板 | 列计数 `.bd-col-count` | Tertiary | Metadata |
| 看板 | 卡片编号 `.bd-card-ref` | Tertiary | Metadata |
| 看板 | 未设置结果 `.bd-card-result` | Tertiary | Context；有数值时使用业务色或 Metadata |
| 交易列表 | 周期 `.trade-row-timeframe` | Tertiary | Metadata / `--list-text-secondary` |
| 交易列表 | 更多标签 `.trade-row-more` | Quaternary | Faint，保持不变 |
| 详情 | 属性名、日期、来源 | Tertiary / Muted | Metadata |
| 详情 | “未设置”、占位说明 | Tertiary / Quaternary | Context 或 Placeholder |
| 统计 | 指标标签、范围、图表轴文字 | Tertiary | Metadata |
| 周复盘 | 日期范围、阶段、评分状态 | Tertiary | Metadata |
| 周复盘 | 方法说明、空态解释 | Tertiary | Context |
| 随记 / 回收站 | 空状态标题 | Tertiary | Body 或 Metadata |
| 随记 / 回收站 | 空状态解释 | Tertiary | Context |
| 设置 | 设置项名称 | Primary / Secondary | 保持 |
| 设置 | 帮助文字 | Tertiary | Context |
| 设置 | 当前值、计数、单位 | Tertiary | Metadata |
| 所有页面 | 禁用按钮与禁用字段 | Disabled | 保持 |

### R2 文件范围

- `src/styles/tokens.css`
- `src/components/trades/TradeList.css`
- `src/views/BoardView.css`
- `src/views/DetailView.css`
- `src/views/Dashboard.css`
- `src/views/WeeklyReviewView.css`
- `src/views/ReviewSessionView.css`
- `src/views/QuickNotesView.css`
- `src/views/TrashView.css`
- `src/views/settings/*.css`
- 必要的共享 UI 样式，不涉及布局变更

实际文件范围由 R0 文字迁移清单生成；本表仅为已知最低范围。未出现在清单中的选择器不得顺手修改。

### R2 验收标准

1. R0 清单内所有唯一编号、日期、周期、金额、R 倍数、状态、阶段和操作说明不得解析为 Faint 或 Disabled。
2. 必须扫描的 11–13px Metadata 在其真实 Pane、Elevated、Floating 背景完成 Alpha 合成后，对比度均 `≥5.5:1`。
3. 正常可读 Context 对比度 `≥4.5:1`。
4. `--text-primary`、`--text-content-supporting`、`--text-secondary` 的定义和值相对 R0 为零变化。
5. R0 冻结的每个迁移项都必须记录“保留 / 迁移 / 例外理由”，清单不得有未决项；不以全仓引用总数下降作为唯一验收。
6. 空状态标题至少为 Metadata，不得与解释文字使用相同亮度。
7. `pnpm qa:theme-luminance` 必须输出每个选择器的 resolved foreground、resolved background、合成结果、WCAG 对比度和 Pass/Fail。
8. V0 固定 6 场景 × 2 视口共 12 张通过；本轮页面中标题、正文、Metadata、Context 至少形成四个可辨认层级。
9. 产品认可方向后，提交 R2 并补一次同范围 Windows Electron 定向复核；Candidate 保存到 `candidate/{R2提交SHA}/attempt-1`，报告 `dirty=false`。
10. 固定列表选择器的 Identity 必须解析为 Strong，Scan Metadata 必须解析为 Metadata；不得以全局提高字重或提高 Strong 数值制造通过结果。

### R2 停止 / 回退条件

- 任一清单项未决、任一对比度硬门槛失败或报告未记录实际合成背景。
- 任一新增 Console/Page Error、Overflow、字体失败、缺图或报告身份不一致。
- 为提高可读性修改字号、字重、布局或全局抬高文字 Token。
- 人工审查发现 Metadata 与正文无法区分时，将该候选证据标记为 rejected；不得继续把正文推向纯白。
- 如果 Metadata 已达到 `5.5:1` 仍显模糊，应停止提高颜色并单独登记字体渲染问题，不在本计划内补偿。
- 任意 `font-family`、`font-size`、`font-weight`、`letter-spacing` 变更均视为越界；如 R0 证明存在真实字体回退或合成字重问题，必须另立 Typography 规范并在本计划完成后单独评审。

## R3：Border 与交互状态

### 当前 V0 结果

- [x] 看板列、设置侧栏、详情属性栏与随记分栏四条长期结构边界已迁移至 `--border-divider`；普通卡片内边界与业务色边界未调整。
- [x] 看板卡片、Floating Menu / Select 已建立独立 Card / Menu Hover、Pressed 与 Persistent Selected 语义；未改变基础 App、Pane、Elevated 与 Row Hover 数值。
- [x] 侧栏状态探针已改为测量真正承载背景的父行；风险周期禁用 Fixture 已剥离错误继承的 Selected 状态。
- [x] 9 个确定性交互状态全部通过实际计算样式与 Token 语义匹配检查，`failureCount = 0`。
- [x] 6 场景 × 2 视口共 12 张 Renderer 截图通过，Console/Page Error 与非预期 Overflow 均为 0。
- [x] 全局亮度清单覆盖 7 个页面根、823 个文字角色、176 个 Token 外局部混色和 9 个状态；Surface / Text 全部通过。
- [x] 类型检查、静态设计合同、桌面视觉治理、状态合同单测与完整浏览器回归通过。
- [x] 产品已在实际 Windows 客户端中完成手动复核并同意进入 R4。

### 唯一目标

让结构边界稳定可感知，并为每个组件族建立独立的 Rest、Hover、Persistent Selected/Active 与 Focus 语义。

### Border 迁移

| 对象 | 当前常见 Token | 目标 Token |
| --- | --- | --- |
| App Frame 外框 | `--border-chrome` / Subtle | 保持 Chrome；只在缩放验证失败时评估 Divider |
| 设置侧栏与正文分界 | `--border-subtle` | `--border-divider` |
| 看板列分隔 | `--border-subtle` | `--border-divider` |
| 详情属性栏分界 | `--border-subtle` | `--border-divider` |
| 随记左右栏分界 | `--border-subtle` | `--border-divider` |
| 周复盘历史栏分界 | 已使用 Divider | 保持 |
| 卡片内部行分隔 | `--border-subtle` | 保持 |
| 看板卡片外边界 | `--border-subtle` | 条件项：R1 后跨平台仍无法分离时才升为 `--border-default`；否则保持 |
| 输入框默认边界 | `--field-border` | 保持派生 Token |
| 输入框 Hover | `--field-border-hover` | 保持 Strong |
| 浮层边界 | `--popover-border` | 保持浮层专用边界 |

### 状态迁移

| 组件族 | Rest | Hover | Persistent Selected / Active |
| --- | --- | --- | --- |
| 侧栏 | Transparent | `--surface-nav-hover` | `--surface-nav-active` + Active Text/Icon |
| 交易列表行 | Transparent | `--surface-row-hover` | 多选保持 Transparent + Checkbox/Indicator；不得新增整行 Selected |
| 看板卡片 | `--surface-elevated` | 经 R0 清单验证的 Card Hover | 不新增无业务意义的 Selected |
| Floating 菜单项 | Transparent on Floating | `--surface-menu-hover` 候选 | 仅真实持久选择使用 `--surface-menu-selected` 候选；键盘 Focus 独立 |
| 分段控件 | `--surface-control` | `--surface-control-hover` | `--surface-control-active` + Primary Text |
| 字段 | `--field-bg` | `--field-bg-hover` | Focus 使用独立 Focus Border/Shadow |

### R3 Token 变更

1. `--surface-row-selected` 与 `--bg-selected` 均保持现值，进入兼容审计；本规范不预设 L13.2。
2. R0 状态清单证明 Floating Menu 存在独立状态需求后，R3 才允许新增 `--surface-menu-hover`；存在真实持久选择时才允许新增 `--surface-menu-selected`。
3. Menu 候选值必须在固定 Fixture 上做 A/B，分别记录 Floating Rest、Hover、Selected 的 resolved 合成色和 Windows/macOS 截图；产品通过后才锁精确值。
4. Nav、Control、Row 只能消费各自语义 Token；不得用 Generic Selected 完成新迁移。
5. `--border-subtle / divider / default / strong` 的基础数值第一版保持不变。
6. 如果跨平台验证证明某类 Border 不连续或无法辨认，必须另列“对象、当前 resolved 色、背景、失败截图、候选值”；单轮调整上限 `≤1 L`，并重跑 R3 全证据。该额度不能用于 App/Pane。

### R3 验收标准

1. R0 状态清单中每个组件族都有独立 resolved-style 断言；不得用一套绝对 L 区间覆盖全部承载面。
2. 存在 Persistent Selected/Active 的组件至少拥有背景与文字/图标/边界中的两种线索；Hover 与 Persistent 状态不得共用语义 Token。
3. 交易多选的整行背景保持透明；`TradeRowPresentation.browser.test.tsx` 的既有合同继续通过。
4. 看板列、设置侧栏、详情属性栏和随记分栏使用 `--border-divider`；看板卡片边界是否升级必须有 R1 后证据。
5. `border-subtle` 不再承担清单中已确认的长期结构边界。
6. Focus Indicator 与相邻表面对比度 `≥3:1`，并能叠加于 Rest/Hover/Selected，不改变几何尺寸。
7. Disabled 不承载正常业务信息。
8. Renderer 的本轮定向场景与第 9.4 节 9 个固定状态通过；产品认可方向后补一次 Windows Electron 同状态复核。
9. Windows 100%/125%/150% 与 macOS x64/arm64 Retina 的完整结构线检查属于 R4 最终发布门，不阻塞 R3 内部试验。
10. Candidate 证据保存到 `candidate/{R3提交SHA}/attempt-1`，Renderer 与 Windows Electron 报告身份一致且 `dirty=false`。

### R3 停止 / 回退条件

- 任一平台、缩放、自动阈值、既有交易多选合同或必审状态失败。
- 任一状态缺图、报告身份不一致，或新增 Console/Page Error、Overflow、字体失败。
- 页面出现满屏网格线、所有卡片被统一升框，或必须依赖阴影/发光才能解释普通状态。
- 人工审查认为 Border 比 Metadata 更抢眼，或 Hover/Selected/Focus 同时争夺注意力时，标记当前候选 rejected；不得通过压暗文字补偿。

## R4：局部混色收敛与最终验证

### 当前 V0 结果

- [x] 详情属性栏、随记侧栏、周复盘历史栏、随机复盘顶栏与固定评估区已从页面级透明混色迁移至 Pane / Elevated / Floating 语义 Surface。
- [x] 详情与回收站普通行分隔已回到 `--border-subtle`；长期结构分栏继续使用 R3 已确认的 `--border-divider`。
- [x] Command Palette、关闭保存浮层、CSV / Notion 导入区、复盘模板侧栏与快捷键设置已迁移至现有 Surface / Border / Row State Token。
- [x] 当前 155 个 Token 外混色已冻结为 118 个 Business Semantic 与 37 个带理由、负责人、失效条件的 Optical Calibration Allowlist；未决 Neutral 为 0。
- [x] 核心 13 页 × 2 视口共 26 张 Renderer 截图通过；9 个确定性交互状态与全部 Surface / Text 探针通过。
- [x] `pnpm build:app`、类型检查、静态设计合同、桌面视觉治理、亮度合同与完整浏览器回归通过。
- [x] 产品已在实际 Windows 客户端中完成手动复核并批准本轮视觉方向。
- [x] 26 场景 × 6 视口共 156 张最终 Renderer 截图通过，Console Error、Page Error、Overflow、字体与月份分组几何检查均为 0 失败。
- [x] 完整 `pnpm test` 通过：67 个浏览器场景、863 个 UTF-8 文本文件，历史“策略归档导航”深链场景通过。
- [ ] Electron 与 Windows Packaged 100% / 125% / 150% 证据等待干净候选提交；证据系统已按规则拒绝为未提交工作区生成可签核报告。
- [ ] macOS x64 / arm64 Retina Packaged 证据等待最终候选提交与 macOS Runner。

### 唯一目标

消除中性灰阶的页面级私有曲线，并确认 Windows/macOS 的实际客户端表现。

### 处理范围

1. 178 个 Token 文件外 `color-mix()` 只是 R0 分类输入，不是待删除数量。
2. R0 冻结后以 `Neutral N` 表示真正与中性 Surface、Text、Border 相关的子集；R4 只处理这 `N` 项。
3. Accent、盈亏、警告、方向、标签等 Business Semantic 混色保留，除非发现明确对比问题。
4. 能被全局 Token 表达的 Neutral 项必须迁移到 Token；其余只能进入有理由、有负责人、有到期条件的 Optical Allowlist。
5. 真正一次性的光学校准不得复制到第二处。
6. 为页面根 Surface、必要 Metadata、结构 Divider 和组件族状态增加设计合同。

### 新增治理规则

- `scripts/qa-design-contract.mjs` 负责正向合同：语义 Token 必须存在、页面根必须映射、关键组件必须消费正确 Token。
- `scripts/check-desktop-visual-governance.mjs` 负责全源码负向治理：禁止页面根直接使用基础面、禁止新增中性裸值/私有状态混色、禁止 Faint/Disabled 误用。
- 页面根容器不得直接使用 `--bg-app / --bg-surface`，必须使用 `--surface-*`。
- 页面 CSS 不得新增中性 Surface 的任意 Hex/RGB/LCH。
- 页面 CSS 不得新增仅用于制造 Hover/Selected 的中性 `color-mix()`。
- `--text-disabled` 不得用于普通内容选择器。
- 日期、金额、周期、编号、状态选择器不得使用 Faint/Disabled。
- 同一组件族的 Hover 与 Persistent Selected/Active 必须消费不同语义 Token。

### R4 验收标准

1. `pnpm test` 与 `pnpm build:app` 通过。
2. `pnpm qa:design`、`pnpm check:desktop-visual`、`pnpm qa:theme-luminance` 通过。
3. 26 场景 × 6 视口共 156 张 Renderer 报告通过。
4. Electron 报告通过。
5. Windows Packaged 在 100%、125%、150% 三档缩放通过。
6. macOS x64/arm64 Packaged 在 Retina 200% 通过。
7. 13 个核心页面完成产品人工签核。
8. `Neutral N` 全部迁移到语义 Token 或进入有注释的 Allowlist；Business Semantic 项未被误删。
9. 每份历史报告的 Commit 必须匹配其所属轮次 Commit；R4 最终截图、luminance 与 artifact 报告必须匹配最终 HEAD，且 `build.dirty=false`。
10. Packaged 报告包含 artifact、executable、`app.asar` 的身份和哈希。
11. 不存在为了单页通过而新增的局部中性补丁。

### R4 硬停止条件

- 任一自动命令、平台、缩放、必审页面或必审状态失败。
- 任一报告 Commit/dirty/artifact 身份不符合要求。
- 任一 Neutral 项未决、Allowlist 缺少理由，或治理脚本需要页面级例外才能通过。
- 产品未明确签核。

## 9. 固定截图与审核矩阵

### 9.1 核心 13 页

| 页面 | 路由 | 必审内容 |
| --- | --- | --- |
| 交易日志列表 | `/list` | Pane、分组条、Metadata、结果、Hover |
| 交易日志看板 | `/board` | Pane、列、卡片、Divider、Card Hover |
| 案例库列表 | `/review-cases` | 与日志共用的灰阶一致性 |
| 案例库看板 | `/review-cases/board` | 与交易看板共用的灰阶一致性 |
| 交易详情 | `/trade/TRD-131` | 正文区、属性栏、未设置字段、Divider |
| 统计分析 | `/dashboard` | KPI、图表轴、网格、说明文字 |
| 周期复盘 | `/weekly-review` | 历史栏、正文、评分、固定操作区 |
| 随机复盘 | `/review-session` | 大面积空白、选项、主次操作 |
| 随记 | `/notes` | 左右栏、搜索、空状态 |
| 设置·资料 | `/settings/profile` | 导航 Active、字段、帮助文字 |
| 设置·策略 | `/settings/strategies` | 行分隔、计数、Hover、主操作 |
| 设置·风险 | `/settings/risk` | 字段、单位、错误、分段 Selected |
| 回收站 | `/trade-trash` | 低亮度下限、空状态、标题/解释层级 |

### 9.2 固定视口

- 主审查：`1920×1080`。
- 紧凑桌面复核：`1280×860`。
- 最终矩阵：`960×640`、`1280×860`、`1440×900`、`1600×1000`、`1920×1080`、`2560×1440`。

### 9.3 三档验证体系

验证必须与决策阶段匹配，不得把发布证明前置为每次试色的成本。

| 档位 | 触发时机 | 自动范围 | Runtime | 证据策略 |
| --- | --- | --- | --- | --- |
| V0 快速实验门 | 每次单变量调整 | 当前假设相关 2–6 个场景 × `1280×860`、`1920×1080`；同时执行 19 个 resolved-style 探针与静态设计合同 | Renderer | 写入可覆盖 `scratch`，允许 `dirty=true`，目标是快速证伪 |
| V1 轮次候选门 | R1/R2/R3 某方向经人工确认，准备形成候选 | 本轮核心场景双视口；R3 另加 9 个状态截图 | Renderer；产品确认后只补一次 Windows Electron 定向复核 | 候选提交后写入 Commit 地址化目录，要求 `dirty=false` |
| V2 最终发布门 | R4 收口、合并或发布前 | 26 场景 × 6 视口 = 156 张；9 个状态；Windows 100%/125%/150%；macOS arm64/x64 | Renderer + Electron + Windows/macOS Packaged | 不可覆盖，Commit/Artifact 身份一致 |

V0 固定建议范围：

| 轮次 | 场景 | 截图量 |
| --- | --- | ---: |
| R1 Surface | `trades`、`board`、`review-cases`、`review-cases-board` | 8 |
| R2 Text | R1 四场景 + `settings-profile`、`settings-risk` | 12 |
| R3 Border / State | 与实际修改组件对应的 2–6 场景；另跑 Renderer 9 状态 | 4–12 + 9 |
| R4 收口前实验 | 受治理项影响的场景，按清单定向选择 | 不预设全矩阵 |

R0 工具实现后的本机实测：R1 Surface 的 8 张 Renderer 定向截图约 3.4 秒完成，Console/Page Error、Overflow 均为 0。该时间只作为当前机器的效率参考，不设为跨机器硬门槛。

以下规则不可放宽：

- 任一 V0 报告必须声明自身的场景和视口，脚本按声明矩阵检查缺图与重复图。
- V0 失败应直接修正或否定假设，不得靠扩大截图量掩盖失败。
- 单次 CSS/Token 微调不得触发 Windows EXE、macOS 或 156 张矩阵。
- 只有方向已被产品认可，才创建轮次 Commit 和 V1 不可变证据；同一方向内部迭代不要求每次 Commit。
- V2 保留原有严谨度，但原则上只在最终发布前执行一次；若 V2 暴露平台问题，只重跑受影响平台和最终全门，不倒逼每个探索步骤全量验证。

“场景”不等于“独立页面”；其中可以包含 Query、数据状态和设置子页。最终预期数量必须由 scenario manifest 与 viewport manifest 动态计算，禁止在脚本里复制另一份常量。

### 9.4 人工审核范围

- V0：只对当前假设页面做同数据前后 A/B，不要求浏览 13 页。
- V1：R1 审核四个工作区视图；R2 增加设置资料与风险；R3 审核被修改的组件族和 9 个状态。
- V2：核心 13 页双视口复核，并抽查全部 26 个自动场景。

R3 状态截图必须由 R0 状态清单给出确定性 Fixture，不允许执行者临时选择：

| 状态 | 承载路由 | 目标对象 | 固定触发 | 截图要求 |
| --- | --- | --- | --- | --- |
| Row Rest / Hover | `/list` | 第一条稳定交易行 | 固定 Fixture 后 `mouse.move` 到选择器中心 | Rest 与 Hover 各一张 |
| Trade Multi-select | `/list` | 同一交易行 Checkbox | Click Checkbox | 整行保持透明，Indicator 可见 |
| Board Card Hover | `/board` | 第一张稳定卡片 | `mouse.move` | Rest 与 Hover 各一张 |
| Nav Active / Hover | `/review-cases` | 当前导航项与相邻导航项 | 当前项保持 Active，Hover 相邻项 | 同帧可区分 |
| Control Active / Hover | `/settings/risk` | 周期分段控件 | 激活一个项，Hover 相邻项 | Active 与 Hover 各一张 |
| Keyboard Focus | `/settings/profile` | 第一个可编辑字段 | `Tab` 导航，不用鼠标点击代替 | Focus Ring 完整可见 |
| Floating Menu Hover / Selected | `/review-cases/board` | 显示菜单的稳定菜单项 | 打开菜单后 Hover；若存在真实选择再切换 | 记录 Floating 实际背景 |
| Disabled | `/settings/risk` | 固定禁用字段/按钮 Fixture | 由 Fixture 预置 | 不依赖运行时偶发条件 |
| Popover | `/review-cases/board` | 显示/筛选浮层 | 点击固定按钮 | 包含边界、正文、菜单项 |
| Toast | `/list` | 固定 QA-only 事件 | 使用测试专用确定性触发器 | 不依赖偶发业务事件 |

每条状态必须在清单中记录恢复步骤，保证后续状态不污染下一张截图。

状态证据固定输出：

```text
test-results/desktop-visual-evidence/{baseline|candidate}/{40位SHA}/attempt-N/states/{runtime-id}/{state-id}.png
test-results/desktop-visual-evidence/{baseline|candidate}/{40位SHA}/attempt-N/states/{runtime-id}/states-report.json
```

## 10. 测试与验证命令

### 10.1 静态设计合同

```powershell
pnpm qa:design
pnpm check:desktop-visual

# V0：可覆盖的快速诊断，不要求干净 Commit
$luminanceRoot = "test-results/theme-luminance/scratch"
pnpm qa:theme-luminance -- --inventory-only --output-root $luminanceRoot
pnpm qa:theme-luminance -- --output-root $luminanceRoot

# R1 只让 Surface 失败阻塞；已知 Text 候选留给 R2
pnpm qa:theme-luminance -- --scope surface --output-root $luminanceRoot
```

`--inventory-only` 生成 page-roots、text-roles、color-mixes、states 四份 JSON；默认模式读取冻结合同并执行 resolved-style、Alpha 合成、WCAG 对比度与状态语义断言。第二次运行必须保留同目录内的四份 inventory JSON，不得先清空输出目录。两种模式都必须支持非零失败退出码。

### 10.2 确定性交互状态

`qa:theme-luminance --capture-states` 读取同一份状态合同、执行固定交互并保存截图与报告。日常 R3 实验先跑 Renderer；方向获批后补一次 Windows Electron；Packaged 仅在 V2 执行：

```powershell
$stateRoot = "test-results/theme-luminance/scratch/states/renderer"
pnpm qa:theme-luminance -- --capture-states --runtime renderer --output-root $stateRoot
```

命令必须生成 `{state-id}.png` 与 `states-report.json`，报告记录 runtime、输入动作、目标选择器、前后 resolved style、恢复结果、Commit 和 `dirty`。Electron 使用 `--runtime electron`；Packaged 使用 `--runtime packaged` 并复用第 10.5/10.6 节的精确产物环境变量。

### 10.3 Renderer 快速实验与完整矩阵

R1 Surface 快速实验：

```powershell
pnpm qa:desktop-visual -- `
  --scratch-output-root test-results/desktop-visual-scratch/surface `
  --scenarios trades,board,review-cases,review-cases-board `
  --viewports 1280x860,1920x1080
```

R2 Text 快速实验：

```powershell
pnpm qa:desktop-visual -- `
  --scratch-output-root test-results/desktop-visual-scratch/text `
  --scenarios trades,board,review-cases,review-cases-board,settings-profile,settings-risk `
  --viewports 1280x860,1920x1080
```

`--scratch-output-root` 可覆盖，专用于 V0；`--scenarios` 与 `--viewports` 只能选择已注册的桌面场景和桌面视口。报告标记 `profile: targeted` 并按自身声明矩阵失败关闭。

V2 最终完整矩阵：

```powershell
$sha = git rev-parse HEAD
$outputRoot = "test-results/desktop-visual-evidence/candidate/$sha/attempt-1"
pnpm qa:desktop-visual -- --output-root $outputRoot
```

输出：

```text
test-results/desktop-visual-evidence/candidate/{40位SHA}/attempt-1/renderer/{viewport}/{scenario}.png
test-results/desktop-visual-evidence/candidate/{40位SHA}/attempt-1/renderer-report.json
```

V1 候选和 V2 最终发布证据使用 Commit 地址化目录。禁止把 `scratch` 或会被下一轮覆盖的 `desktop-visual-convergence` 默认目录作为签核证据。

### 10.4 Electron

```powershell
pnpm build:app
pnpm qa:desktop-visual:electron -- --output-root $outputRoot
pnpm qa:theme-luminance -- --capture-states --runtime electron --output-root "$outputRoot/states/electron"
```

Electron 不属于每次实验的默认命令。V1 只在产品确认候选方向后定向执行一次；V2 再执行完整范围。

### 10.5 Windows Packaged

规范流程以 `.github/workflows/desktop-visual-evidence.yml` 为唯一权威：精确构建 x64 NSIS、安装到隔离临时目录、显式传入产物和可执行文件、运行三档缩放、最后卸载。不得只执行 `pnpm dist:win` 后直接跑 QA。

本地复现必须显式设置以下绝对路径：

```powershell
$sha = git rev-parse HEAD
$visualRoot = "test-results/desktop-visual-evidence/candidate/$sha/attempt-1"
$version = (Get-Content package.json -Encoding UTF8 | ConvertFrom-Json).version
$artifact = (Resolve-Path "release/Trader-Atlas-$version-win-x64.exe").Path
$installRoot = Join-Path $env:TEMP 'trader-atlas-theme-visual-installed'
& $artifact /S "/D=$installRoot"
if ($LASTEXITCODE -ne 0) { throw "NSIS installation failed: $LASTEXITCODE" }

$env:ATLAS_PACKAGED_ARTIFACT = $artifact
$env:ATLAS_PACKAGED_EXECUTABLE = Join-Path $installRoot 'Trader Atlas.exe'
foreach ($scale in @('1', '1.25', '1.5')) {
  $env:ATLAS_PACKAGED_SCALE_FACTOR = $scale
  $scaleId = $scale.Replace('.', '-')
  $runtimeId = "windows-x64-scale-$scaleId"
  $env:ATLAS_PACKAGED_VISUAL_OUTPUT = "$visualRoot/packaged/$runtimeId"
  pnpm qa:desktop-visual:packaged
  if ($LASTEXITCODE -ne 0) { throw "Packaged visual failed at scale $scale" }
  pnpm qa:theme-luminance -- --capture-states --runtime packaged --output-root "$visualRoot/states/$runtimeId"
  if ($LASTEXITCODE -ne 0) { throw "Packaged state evidence failed at scale $scale" }
}
```

卸载步骤必须沿用 workflow 的精确 Uninstaller 流程。产物路径、安装路径或输出路径任一未显式解析时，本地证据无效。

### 10.6 macOS Packaged

必须在真实对应架构的 macOS Runner 或设备执行，Windows 截图不能替代。规范流程仍以 `.github/workflows/desktop-visual-evidence.yml` 为权威：

```bash
sha=$(git rev-parse HEAD)
arch=arm64
pnpm exec electron-builder --mac zip --arm64 --publish never
# x64 必须在对应 x64 Runner 独立构建

export ATLAS_PACKAGED_ARTIFACT="<精确 zip 绝对路径>"
export ATLAS_PACKAGED_EXECUTABLE="<解压后的 Trader Atlas 可执行文件绝对路径>"
export ATLAS_PACKAGED_VISUAL_OUTPUT="test-results/desktop-visual-evidence/candidate/$sha/attempt-1/packaged/macos-$arch"
export ATLAS_PACKAGED_SCALE_FACTOR=2
pnpm qa:desktop-visual:packaged
pnpm qa:theme-luminance -- --capture-states --runtime packaged \
  --output-root "test-results/desktop-visual-evidence/candidate/$sha/attempt-1/states/macos-$arch"
```

`ATLAS_PACKAGED_ARTIFACT` 与 `ATLAS_PACKAGED_EXECUTABLE` 缺一不可；不得以通配符或“最新文件”代替精确产物身份。

平台间不要求像素一致，但必须满足：

- 信息强弱顺序一致。
- Selected / Hover 语义一致。
- 必要 Metadata 对比度达标。
- 细 Border 连续。
- 不因平台字体回退改变信息优先级。

## 11. 必须更新的设计合同

| 文件 | 变更要求 |
| --- | --- |
| `src/lib/desktopVisualTokens.test.ts:91-117` | 新增 `--surface-elevated`；锁定 App/Pane 在本计划内零变化 |
| `src/views/TypographyRoles.browser.test.ts:172-178` | R2 若基础文字值不变则不改；新增 Metadata/Context 选择器计算样式断言 |
| `src/views/BoardView.design.test.ts` | 看板根必须消费 `--surface-pane`；卡片必须消费 `--surface-elevated` |
| `src/views/WorkbenchPerformance.design.test.ts` | 保持虚拟列表性能约束，并锁定交易多选不改变整行底色 |
| `src/views/WeeklyReviewHistory.design.test.ts` | 仅对真实持久选择迁移 Generic Selected，不进行批量替换 |
| `src/components/trades/TradeRowPresentation.browser.test.tsx` | 验证编号、周期、日期使用 Metadata；Hover 使用 Row Hover；多选整行透明 |
| `src/components/Menu.browser.test.tsx`、`src/components/Menu.design.test.ts`、`src/components/ui/DesktopPopoverKeyboard.browser.test.tsx` | 新增 Floating Rest/Hover/Selected/Focus 的 resolved-style 合同 |
| `scripts/theme-luminance-contract.mjs` | R0 新增页面、选择器、承载面、状态、阈值注册表 |
| `scripts/qa-theme-luminance.mjs` | R0 新增 inventory、Alpha 合成、WCAG 对比度、resolved color、跨 runtime 状态截图与 JSON 报告 |
| `scripts/qa-design-contract.mjs` | 增加语义 Token 存在、关键组件映射等正向合同 |
| `scripts/check-desktop-visual-governance.mjs` | 增加基础 Token、中性裸值/混色、Faint/Disabled 误用等负向扫描 |
| `scripts/desktop-visual-scenarios.mjs` | R0 增加 `/review-cases/board`，正式矩阵为 26 场景 |
| `scripts/fixtures/desktop-visual-matrix.test.mjs` | 从 manifest 推导场景数量并锁定案例看板 |
| `.github/workflows/desktop-visual-evidence.yml` | 为各平台/缩放设置 Commit 地址化输出并上传精确目录 |
| `package.json` | R0 注册 `qa:theme-luminance`，不得改变既有脚本语义 |

## 12. 文件实施索引

| 文件 | 轮次 | 变更类型 |
| --- | --- | --- |
| `src/styles/tokens.css` | R1–R3 | 增加 Surface 语义；不修改 App/Pane 或 Row Selected 基础值 |
| `src/components/ui/AppFrame.css` | R1 | 主 Pane 改用 Surface 语义 |
| `src/views/ListView.css` | R1 | 页面根改用 Surface 语义 |
| `src/views/BoardView.css` | R1–R3 | 修正 Pane、Card、Divider、Metadata、Hover |
| `src/components/trades/TradeList.css` | R2–R3 | Metadata 和 Row State 迁移 |
| `src/views/DetailView.css` | R1–R3 | Pane、属性栏 Divider、Metadata |
| `src/views/Dashboard.css` | R2–R3 | Metadata、图表边界、状态 |
| `src/views/WeeklyReviewView.css` | R1–R3 | Pane、文字角色、History Selected |
| `src/views/ReviewSessionView.css` | R1–R3 | Pane、文字角色、状态面 |
| `src/views/QuickNotesView.css` | R1–R3 | Pane、分栏 Divider、空状态文字 |
| `src/views/TrashView.css` | R1–R3 | Pane、空状态、列表 Divider |
| `src/views/settings/SettingsLayout.css` | R1–R3 | Pane、设置分栏 Divider |
| `src/views/settings/*.css` | R2–R3 | Metadata、字段、状态 |
| `src/components/Menu.css` 等共享浮层 | R3–R4 | Hover/Selected 语义迁移 |
| `scripts/theme-luminance-contract.mjs` | R0–R4 | 测量注册表与冻结清单 |
| `scripts/qa-theme-luminance.mjs` | R0–R4 | resolved style 与对比度硬门槛 |
| `scripts/desktop-visual-scenarios.mjs` | R0 | 增加案例看板场景 |
| `.github/workflows/desktop-visual-evidence.yml` | R0 | Packaged 证据地址化与产物身份 |
| `scripts/qa-design-contract.mjs` | R4 | 正向设计合同 |
| `scripts/check-desktop-visual-governance.mjs` | R4 | 全源码负向治理 |
| `design.md` | R4 审核通过后 | 将最终确定的规则同步为当前设计基线 |

## 13. 依赖关系与顺序

```text
R0 证据工具 + 轻量诊断基线
   |
   v
R1 Surface 语义统一
   |
   v
R2 Text 角色迁移
   |
   v
R3 Border + 分组件族状态
   |
   v
R4 混色治理 + Windows/macOS 最终验证
```

顺序不能交换：

- 如果先改文字，仍无法判断看板偏暗是文字问题还是 Pane 用错。
- 如果先改 Border，后续 Surface 改动会改变 Border 的实际对比。
- 如果先改 Selected，后续 Surface 改动会改变状态亮度差。
- 如果提前清理所有 `color-mix()`，会造成过大的无关 Diff，无法安全回退。

## 14. 提交、审核与回退策略

### 14.1 提交粒度

每个经产品确认的轮次候选必须是独立 Commit；同一方向内部的 V0 试验不要求逐次 Commit：

```text
test(design): establish theme luminance evidence baseline
style(theme): unify semantic surface hierarchy
style(theme): correct readable text roles
style(theme): calibrate borders and interaction states
refactor(theme): converge neutral color governance
```

不得把多轮压成一个视觉 Commit。

### 14.2 审核节奏

1. 在工作区执行 V0 单变量试验，输出到可覆盖 `scratch`；允许 `dirty=true`。
2. 产品通过小范围 A/B 后，才形成该轮 Candidate Commit，并确认 `dirty=false`。
3. 从 Candidate Commit 执行 V1 定向门槛，生成 Commit 地址化截图与报告；只补一次 Windows Electron 定向复核。
4. R1–R3 不要求每轮构建 EXE 或 macOS 产物；用户需要体验时可单独构建，但不升级为发布门。
5. 产品审核并明确“通过 / 拒绝 / 仅调整本轮”。
6. 产品签核后不得再向该 Candidate Commit 追加代码；修改后创建新 Commit 和新 attempt，只重跑本轮定向范围。
7. R4 最终收口时统一执行 V2：完整 Renderer、Electron、Windows 三档缩放和 macOS 双架构 Packaged。

V0 只记录假设、改动变量、报告路径、场景和人工结论。V1/V2 台账再记录 Commit、`dirty`、产物 SHA256、报告路径、场景/状态、自动结果、批准人和批准时间。

### 14.3 回退

- 单轮失败时保留失败证据并标记 `rejected`，再仅 Revert 对应 Commit。
- 不通过反向补丁继续叠加颜色修正。
- 不使用 `git reset --hard`。
- 如果 R2 失败，保留已通过的 R1，不回退整个项目。
- 如果 R3 失败，优先回退 Border/State，不压暗文字作为补偿。
- 回退后重跑上一轮已通过门槛，证明恢复到上一签核状态。

## 15. 工作量估算

| 轮次 | 主要工作 | 预计工程时间 | 审核时间 |
| --- | --- | ---: | ---: |
| R0 | 场景、测量器、四份清单、轻量诊断基线 | 0.75–1 天 | 0.25 天 |
| R1 | Surface Token 与页面根迁移；8 张定向截图 | 0.5–0.75 天 | 0.25 天 |
| R2 | 文字角色审计与迁移；12 张定向截图 | 0.75–1 天 | 0.25 天 |
| R3 | Border、Hover、Selected；定向页面与 9 状态 | 0.75–1 天 | 0.25 天 |
| R4 | 治理、156 张全矩阵、双平台发布收口 | 1–1.5 天 | 0.5 天 |

视觉探索与实现约 2.75–3.75 个工程日；最终发布门约 1–1.5 个工程日。总计约 3.75–5.25 个工程日，不包含等待 macOS Runner 或产品审核的时间。主要提速来自不再对每次局部调整重复 156 张、EXE 和双平台 Packaged。

## 16. 明确排除范围

- 页面结构、布局、宽度、间距和尺寸调整。
- 新增或删除页面功能。
- 修改路由、快捷键和交互流程。
- 字体替换、字号、字重和字距精修。
- 运行时字体取证属于 R0 诊断，不构成修改字体的授权；任何字体处方必须另立规范。
- 重新设计看板信息架构。
- 重新设计盈亏、风险和方向色板。
- Light Theme。
- 手机、iPad、浏览器产品适配。
- 与颜色层级无关的性能或数据问题。

## 17. 禁止方案

- 给应用根节点增加 `filter: brightness()`。
- 同时提高 App、Pane、Card、Border 和 Text。
- 直接复制 Linear 的单个 Hex、StyleX 哈希变量或 Focus 色。
- 复制 Linear 的整条灰阶、组件角色映射或状态阈值。
- 使用纯白覆盖所有正文。
- 把 `--text-tertiary` 全局重映射到更亮颜色以绕过逐项分类。
- 全局提高 `--border-subtle`，导致两百多个位置同时出现亮线。
- 直接提高 `--bg-selected`，让菜单、编辑器、周复盘和控件一起变化。
- 为单个页面新增新的中性灰 Token。
- 通过阴影、发光、渐变或大面积高饱和填充制造层级。
- 用页面级局部补丁掩盖全局语义问题。

总原则：学习 Linear 的关系、密度和状态分工，不把 Linear 当前单页数值当作 Atlas 的验收真值。

## 18. 产品审核清单

请在实施前逐项确认：

- [x] 同意先完成 R0 测量工具、四份清单和轻量诊断基线，再批准生产颜色试验。
- [x] 同意验证拆为 V0 快速实验、V1 轮次候选、V2 最终发布三档。
- [x] 同意 26×6、Windows 三档缩放与 macOS 双架构只属于 V2，不在每次视觉试验中执行。
- [x] 同意 R0 新增确定性状态截图命令；R3 先跑 Renderer，候选确认后补一次 Windows Electron，Packaged 留到 R4。
- [x] 同意基础 App、Pane 数值在本计划 R0–R4 全程冻结，Elevated 在 R1 保持不变。
- [x] 同意看板主画布由 `--bg-app` 改为 `--surface-pane`。
- [x] 同意看板卡片使用 `--surface-elevated`，不再使用 92% 局部混色。
- [x] 同意 R2 先迁移文字角色，不直接提高全部文字。
- [x] 同意 Metadata 以 `≥5.5:1` 为目标。
- [ ] 同意 `--text-content-metadata/context/faint` 为 canonical；`--text-muted` 与 `--text-tertiary` 进入兼容状态。
- [ ] 同意长期结构边界统一使用 `--border-divider`。
- [ ] 同意看板卡片边界是否升为 `--border-default` 由 R1 后跨平台证据决定，不预先强制。
- [ ] 同意交易多选不改变整行底色，本规范不修改 Row Selected 基础值。
- [ ] 同意 Menu Hover/Selected 只在存在真实消费者且 A/B 通过后新增语义 Token。
- [ ] 同意不直接修改 Generic `--bg-selected`。
- [x] 同意 R1 使用 8 张、R2 使用 12 张定向 Renderer 截图；R3 按组件范围并补 9 个状态。
- [x] 同意同一方向内部 V0 试验不逐次 Commit、不逐次构建 EXE；产品确认候选后再形成独立轮次 Commit。
- [ ] 同意每份报告绑定所属轮次 Commit；最终报告只绑定最终 HEAD，不篡改历史证据。
- [ ] 同意最终必须完成 Windows 三档缩放与 macOS Retina 验证。

## 19. 批准条件

R0 证据工具已获批准并完成，R1–R4 均已通过产品手动复核。最终 Renderer 全矩阵与完整回归已通过；Electron、Windows 三档缩放和 macOS Retina 的可签核发布证据必须在当前改动形成干净候选提交后执行，禁止绕过 Commit / dirty / artifact 身份门。

审核过程中如需修改本规范，应先更新本文档版本和审核清单，不得一边实施一边改变目标。
