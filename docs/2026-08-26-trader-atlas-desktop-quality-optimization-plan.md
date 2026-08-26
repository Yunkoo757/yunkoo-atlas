# Trader Atlas 桌面端质感优化执行方案

> 状态：已复核，待实施
> 修订日期：2026-08-26
> 产品平台：Windows、macOS 桌面客户端
> UI 视觉祖先：`0aad5ae`
> 参考：用户提供的 Trader Atlas 与 Linear 桌面截图、当前 `design.md`、现有代码与自动化合同

## 1. 执行结论

本轮不重做信息架构，不复制 Linear 的顶部标签页，也不新增视觉风格。要解决的是当前界面中真实存在的四类问题：文字解释过多、同一行焦点过多、控件与元数据形态过近、页面间表面与状态合同不一致。

实施采用“证据冻结 → 列表试点 → 用户验收 → 分页推广 → 双平台原生验收”五步。任何阶段未通过，只回退该阶段的独立提交，不把未验证规则扩散到后续页面。

| 阶段 | 主要产物 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| Phase 0 | 不可覆盖的基线证据、历史回归门禁、性能与无障碍基线 | 当前代码门禁全绿 | 基线可追溯到 `0aad5ae`，新合同可复现且无脏树混入 |
| Phase 1 | 共用列表试点、Windows 候选 EXE | Phase 0 完成 | 自动化全绿，用户确认“更安静且信息不丢失” |
| Phase 2 | 顶部控制与侧栏收敛 | Phase 1 通过 | 控件层级清楚，筛选记忆与日/周/月限额不回归 |
| Phase 3 | 详情、统计、复盘、设置、辅助列表逐页推广 | Phase 2 通过 | 每张执行卡独立通过，不出现结构性改动 |
| Phase 4 | renderer、Electron、packaged 与人工签收证据 | 视觉与代码冻结 | Windows x64、macOS arm64/x64 原生证据完整 |

发布裁决采用 fail-closed：任一 P0 门禁失败即停止，不允许用“本机看起来正常”、更新截图或放宽断言代替修复。

## 2. 根因与优先级

| 权重 | 问题 | 当前表现 | 用户影响 | 本轮处理 |
| --- | --- | --- | --- | --- |
| P0 | 结果真值与展示状态未对齐 | `—`、`未成交`、零值、单一结果口径和缺失值混用 | 用户无法判断数据是真实为零、尚未产生还是待补 | 以 `resolveTradeTruth()` 与 `resultSource` 建立逐槽位矩阵 |
| P0 | 行内视觉焦点过多 | 品种、方向、策略、时段、错误、复盘、盈亏同时高亮 | 扫读路径断裂，列表显重 | 固定阅读顺序、标签优先级与颜色预算 |
| P0 | ARIA 模型混用 | 列标题是 `row/columnheader`，数据区却是 `list` | 屏幕阅读器无法建立稳定结构 | 统一为 `list/listitem`，视觉列标题退出无障碍树 |
| P0 | 基线和候选证据会互相覆盖 | 视觉脚本默认清理固定输出目录；Electron 拒绝脏树 | 无法证明改动前后差异来自哪个提交 | 增加显式输出根目录与证据 manifest |
| P0 | 历史高频回归没有阻断 | 筛选记忆、阶段归属、详情返回、风险限额、快速记录仅靠手测 | 重启或快捷键后再次丢状态 | 建立专门 browser 合同并纳入每阶段门禁 |
| P1 | 控件层级与文案不克制 | 选择器、快捷视图、筛选和解释句互相重复 | 看一眼能懂的内容仍要读一遍 | 删除重复解释，保留方向、状态、动作与数据口径 |
| P1 | 窄桌面合同自相矛盾 | 960px 验收要求保留结果，现有 CSS 却隐藏现金盈亏与策略 | 小窗口丢失关键决策信息 | 锁定 960–1920px 列降级表 |
| P1 | 视觉 QA 只覆盖默认静态态 | 120 张截图不含焦点、筛选、Tooltip、隐私、失败恢复 | 状态问题可能在默认截图之外漏掉 | 新增 12 个状态关键帧包 |
| P1 | 性能与对比度只有主观描述 | “无明显卡顿”“看起来清楚”无法复现 | 虚拟列表和弱文字可能悄悄退化 | 固定 10k fixture、计算色对比和原生辅助功能验收 |

## 3. 已有基础与事实来源

本轮复用以下现有能力，不新建设计系统：

- `src/styles/tokens.css`：四层表面、文字角色、语义色、焦点、尺寸与动效令牌。
- `src/styles/global.css`：全局焦点、滚动条、减少动效与字体合同。
- `src/components/trades/TradeList.css`：44px 交易行、36px 分组条、28px 列标题及共享网格。
- `src/lib/tradeTruth.ts`：执行状态、结果口径、完整性与冲突的唯一业务真值。
- `src/components/ui/`：现有按钮、筛选、选择器、Tooltip、菜单和空状态组件。
- `design.md`：桌面平台、层级、语义色稀缺、连续上下文、渐进呈现与数据可信原则。
- 24 个桌面路由 × 5 个尺寸的 renderer/Electron 视觉矩阵，以及 packaged 运行脚本。

事实优先级固定为：业务真值/数据模型 → `tokens.css` → `global.css` → 通用组件 → 页面样式 → 自动化测试 → `design.md` → 本方案。实现发现冲突时先修订方案，不允许让 CSS 文案反推业务状态。

## 4. 范围与非目标

### 4.1 本轮范围

- 共用交易、案例、错过机会列表及其状态、标签、结果和虚拟化合同。
- 页面顶部范围、快捷视图、筛选与显示控制的视觉层级。
- 侧栏选中态、计数、风险摘要和滚动表面。
- 详情、统计、周期复盘、随机复盘、设置和仍在活跃路由中的辅助列表。
- Windows 与 macOS 的鼠标、键盘、焦点、屏幕阅读器、减少动效、高对比和高 DPI 表现。

### 4.2 明确不做

- 不新增 Linear 式顶部浏览器标签、历史按钮、多窗口或中键标签模型。
- 不更改左侧导航结构、页面路由、数据模型、Store、Schema、SQLite、备份或附件生命周期。
- 不改变 244/208/56px 侧栏宽度、28×28 搜索/记录按钮、44px 行高、36px 分组条和现有列顺序。
- 不把交易日志改成 Linear 的业务状态分组，也不复制 Linear 的业务颜色。
- 不新增渐变、玻璃拟态、厚阴影、光晕、装饰图表或连续循环动画。
- 不为手机、iPad、浏览器或其他平台新增产品适配；浏览器只作为测试运行器。
- 已移除的“今日工作台”不重新设计；`/today-record` 只作为兼容入口验证，不恢复为新的可见页面体系。
- 不直接用候选 EXE 写入生产资料库；人工验收只使用已验证备份生成的独立副本。
- 不把信息删除当作降噪。允许折叠，但鼠标、键盘和辅助技术必须能读取完整内容。

## 5. 锁定的设计与交互合同

### 5.1 信息架构与阅读顺序

```text
侧栏：账户 / 搜索 / 新建
  └─ 主要导航与风险限额（日 / 周 / 月）

主窗格：页面身份
  └─ 范围与视图控制
      └─ 快捷筛选与筛选入口
          └─ 列标题
              └─ 月份分组
                  └─ 交易行：身份 → 上下文 → 结果 → 日期/动作
```

列表首屏只允许三个阅读锚点：

1. 品种、方向与状态，回答“这是什么交易”。
2. 盈亏与 R，回答“结果如何”。
3. 策略与最高优先级异常，回答“为什么值得看”。

编号、日期、时段、普通标签和说明文字必须退后。页面标题、选中控件和内容区不得重复说同一件事。

### 5.2 四层表面

| 层级 | token | 用途 | 禁止 |
| --- | --- | --- | --- |
| L0 | `--surface-app` | 窗口底色、侧栏外壳 | 承载正文列表 |
| L1 | `--surface-pane` | 主窗格、普通行默认底色 | 再嵌套大面积卡片 |
| L2 | `--surface-inset` / `--surface-group` | 月份组条、局部输入或证据区 | 每条记录常驻填充 |
| L3 | `--surface-floating` | 菜单、Tooltip、弹层 | 页面常驻底色 |

同一状态不得同时使用背景、描边和阴影三种手段。普通行默认无常驻边框与阴影；hover、selected、focus 只各承担一个职责。

### 5.3 行内上下文排序与颜色预算

- 策略是独立上下文锚点，不计入普通标签名额；在 960px 及以上保持可见并允许截断。
- 其余上下文统一按：错误标签 → 案例/复盘分类 → 交易时段 → 普通标签排序；同类别保持原始顺序。
- 1440px 及以上最多展示 2 个上下文标签；1280–1439px 最多 1 个；960–1279px 全部折叠为统一 `+N`。
- `+N` 统计所有未展示上下文，Tooltip 与无障碍说明按同一顺序列出完整内容，不再分别生成多个 `+N`。
- 每行最多 2 组高显著语义色。计数组：结果/结果冲突为第一组，错误标签为第二组；星标在前两组已占满时降为低明度金色。品种小图标品牌色和方向短文本不计入，但不得扩成底色。
- 盈亏、错误、风险、星标的强度顺序固定为：结果冲突/风险触线 > 亏损/错误 > 盈利 > 星标 > 普通标签。

### 5.4 逐槽位结果真值矩阵

展示判定顺序固定为：`resolveTradeTruth()` → `resolveTradeResultSource()` → `isTradeResultAuthorityConsistent()` → PnL/R 分槽展示 → 隐私覆盖。禁止从格式化文字、颜色或单个 `null` 推断整条记录是否完整。

| 执行/口径 | 现金槽 | R 槽 | 行级状态与可访问说明 |
| --- | --- | --- | --- |
| `planned` / `open` | 视觉留空，`not-applicable` | 视觉留空，`not-applicable` | “尚未产生交易结果” |
| `missed` | `未成交`，`missed` | 有潜在 R 时显示 `value/zero`，否则 `not-applicable` | “错过机会，未成交”；潜在 R 明确读作“潜在” |
| closed + `pnl` | 显示真实金额，含 `$0` | 视觉留空，`not-collected` | “以现金盈亏为结果口径；未采集 R 倍数” |
| closed + `r` / `price` | 视觉留空，`not-collected` | 显示真实 R，含 `0.0R` | “以 R/价格为结果口径；未采集现金结果” |
| closed + `imported` | 显示真实金额，含 `$0` | 显示真实 R，含 `0.0R` | “导入结果，现金与 R 均可用” |
| closed + 历史未声明口径 | 由有限值推断 `pnl/imported` 后显示 | 由有限值推断 `r/imported` 后显示 | 合法单一结果不得被标记为缺失 |
| closed + 无有效口径/两槽均缺 | 只在现金槽显示一次低权重 `待补`，`missing` | 视觉留空，`missing` | “已结束，结果数据待补充” |
| authority/声明/指标冲突 | 保留已有原值，取消正负色 | 保留已有原值，取消正负色 | 结果区只增加一个低饱和“结果冲突”；不得改写原值或假装已解决 |
| 隐私模式 | `****`，`masked` | 继续显示真实 R 或其正常空态 | “现金结果已隐藏”；不得遮蔽 R、结果状态或冲突 |

可测试输出固定为：

- 每个结果槽：`data-value-state="not-applicable|not-collected|missed|missing|zero|masked|value|conflict"`。
- 每行：`data-result-source="pnl|r|price|imported|inferred-pnl|inferred-r|inferred-imported|none|invalid"`。
- 每行：`data-result-integrity="complete|incomplete|conflict"`。
- fixture：planned、open、missed-with-r、missed-without-r、pnl-only、r-only、price、imported、历史推断、双零、两槽缺失、未知币种、声明/指标冲突、指标互相冲突、privacy。

真实值永远原样显示；“待补”只标识真正缺少的事实。冲突样本不得获得正负业务色。直播模式继续遵循当前产品合同：隐藏现金，保留结果状态和 R 倍数；DOM、Tooltip 与无障碍名称不得泄露被遮蔽的现金数值。

### 5.5 唯一无障碍模型

本轮采用 `list/listitem`，不进行完整 grid/table 重构：

- `.trade-list` 是唯一 `role="list"` 容器，提供对象、可见记录数和分组数。
- 视觉列标题使用 `aria-hidden="true"`/presentation，删除孤立的 `row/columnheader` 角色并更新现有设计测试。
- 每个可访问虚拟项恰好对应一个 `listitem`：分组虚拟项自身为 `listitem`；交易虚拟包装层为 presentation，内部 `TradeRowLayout` 为 `listitem`；禁止嵌套 `listitem`。
- `aria-setsize` 与 `aria-posinset` 按当前“可见分组 + 展开交易”计算；折叠动画中的不可见交易同时 `inert`、`aria-hidden="true"` 并退出 Tab 顺序。
- 分组按钮保留 `aria-expanded` 和稳定 id；所属交易行通过 `aria-describedby` 关联月份名称。没有稳定内容容器时不伪造 `aria-controls`。
- 行摘要顺序固定为“状态、编号、品种与方向、策略、完整标签、周期、盈亏、R、日期、星标”。
- `+N`、结果留空原因、隐私、冲突、选择和星标状态直接进入无障碍树，不依赖 Tooltip 是否打开。
- 星标使用 `aria-pressed`；选择由真实 checkbox 的 checked 表达；`listitem` 不使用不受支持的 `aria-selected`。
- 行、checkbox、策略、`+N`、星标按视觉顺序进入 Tab 流；右键菜单同时支持 `Shift+F10`/菜单键，关闭后焦点返回原行。

Windows NVDA 与 macOS VoiceOver 必须能从列表名称进入月份、逐行获知位置与结果，再完成选择、星标、打开和返回。

### 5.6 焦点、选择与动作

- 默认键盘焦点复用全局 `--focus-ring-outline`，在行主操作内侧绘制 2px 定位线，不增加整行填充。
- 不采用未经测量的 1px 例外。用户关闭“增强焦点高光”后，保留全局 1px 键盘定位线，并验证其最终计算对比度 ≥3:1。
- hover 只改变背景；selected 由选择框与 checked 表达；focus 只由定位线表达；三者叠加时仍可区分。
- 虚拟行因滚动、筛选或折叠卸载时，焦点移到最近仍可见的行主操作或分组按钮，不得落到 `body`。
- 勾选框、星标、更多操作只在 hover、focus-within、已选择、已星标或选择模式下出现；键盘路径不得依赖 hover。

### 5.7 960–1920px 桌面降级

以下宽度指应用窗口；低于 960px 不新增产品承诺，只维持现有兼容行为。

| 窗口宽度 | 编号 | 品种/方向 | 策略 | 上下文标签 | 周期 | 现金盈亏 | R | 日期 | 星标 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1440/1600/1920 | 显示 | 显示 | 显示 | 最多 2 个 + `+N` | 显示 | 显示 | 显示 | 显示 | 按意图出现 |
| 1280–1439 | 隐藏 | 显示 | 显示并截断 | 最多 1 个 + `+N` | 显示 | 显示 | 显示 | 显示 | 按意图出现 |
| 960–1279 | 隐藏 | 显示 | 显示并截断 | 只显示统一 `+N` | 显示 | 显示 | 显示 | 视觉隐藏，进入行摘要 | 按意图出现 |

任何目标桌面宽度都不得隐藏现金盈亏或 R。960px 优先牺牲编号、日期视觉列和普通上下文，不牺牲结果、异常、方向与可操作性。五档 fixture 必须断言列的 computed `display/visibility`、标题/行 x 对齐误差 ≤1px、`scrollWidth <= clientWidth + 1`，并保持 44px 行高。

### 5.8 文案减负

- 页面标题只说明页面身份；选中范围、实盘/模拟和筛选条件由控件表达，不在标题后重复拼接说明句。
- 阶段选择器显示 `实盘阶段 1`，去掉控件内重复的“当前 ·”；菜单使用 `实盘阶段 1`、`更早记录`、`全部历史`。
- “模拟盘不计入实盘 KPI”等低频解释从常驻标题移到首次可见帮助或 Tooltip；无障碍描述保留。
- 统计页不再同时展示“数据范围”“当前分析范围”和重复大号范围标题；只保留一个紧邻指标的范围摘要。
- 周期复盘移除标题后的口号式补充；具体任务放在当前步骤或空态。
- 侧栏风险摘要固定显示 `日 2R · 周 5R · 月 10R` 形式，不再重复“当前阶段已设置”。
- 说明文字只在不可逆后果、数据口径、失败恢复和未知风险时常驻。能从标签、控件或布局一眼看懂的句子删除。
- 不用装饰图表或动效填补删文案后的空白；只有已有数据关系比文字更易读时才保留轻量图表。

### 5.9 动效

- 状态颜色、背景或透明度只用现有 `--motion-state`；菜单和面板继续使用已有时长。
- 不新增位移大于 4px、hover 缩放、批量首屏入场或循环动画。
- 状态图标只在真实状态改变时播放一次 220ms pop；首次挂载、筛选和滚动不播放。
- `prefers-reduced-motion: reduce` 下新增动效完全关闭，并保留静态反馈。

## 6. 核心旅程与状态覆盖

### 6.1 阻断级核心旅程

| 旅程 | 用户动作 | 必须保持的结果 | 自动化证据 |
| --- | --- | --- | --- |
| 扫读交易 | 连续浏览 30 行 | 先读品种/结果，再读策略/异常；空值不形成噪点 | 行展示 browser 合同 + 状态关键帧 |
| 筛选记忆 | 设置阶段、实盘/模拟、快捷视图和组合筛选，按 A 离开再返回，并重启应用 | 路径、query、阶段、视图形态和筛选全部恢复 | `src/regression.test.ts` + 新增工作区水合 browser 测试 |
| 详情返回 | 从列表/看板打开详情后返回 | 恢复原范围、筛选、滚动锚点与原行焦点 | `DetailShortcutNavigation.browser.test.tsx` 扩展 |
| 阶段归属 | 保存旧记录的目标阶段并重启 | 已保存记录不再进入“阶段待整理”；仅未归属事实留在队列 | `stageOwnershipRepair.test.ts` + `StageOwnershipRepairView.browser.test.tsx` |
| 风险限额 | 在任意主要工作区和窄桌面查看侧栏 | 日/周/月限额始终可见、可读、可进入风险设置 | 新增 Sidebar 风险摘要 browser 合同 |
| 快速记录 | 不填写一句话、不添加图片直接保存；再模拟持久化失败 | 空内容记录可保存；失败时交易、草稿与已选附件保持可重试，不出现半写入 | `TradeComposerBatch.browser.test.ts` + `tradeComposerCommit.test.ts` |
| 键盘操作 | Tab、选择、星标、筛选、菜单、详情、Escape 返回 | 焦点始终可见且返回合理位置 | 键盘 browser 合同 + NVDA/VoiceOver |

以上任一项失败即停止当前 Phase；不得归类为“与视觉无关”。

### 6.2 状态矩阵

| 组件 | 必须验收的状态 |
| --- | --- |
| 交易行 | default、hover、active、focus-visible、selected、selection mode、starred、context menu、disabled、busy |
| 分组条 | current/recent/archive、expanded/collapsed、sticky、hover add、keyboard focus、empty group |
| 策略与标签 | default、hover preview、focus、长文本、统一 `+N`、Tooltip 打开/碰撞/Escape/焦点返回 |
| 结果区 | planned、open、missed、pnl-only、r-only、price、imported、zero、missing、conflict、privacy |
| 顶部控制 | default、hover、active、selected、focus、disabled、overflow、saving、narrow desktop |
| 筛选器 | none、applied、open、clear、no results、unknown query、restart restore |
| 页面 | data、empty library、current range empty、filtered empty、loading、partial、error、recovery |
| 原生显示 | Windows 100/125/150% DPI、页面缩放 100/125/150%、macOS Retina、提高对比度、减少动效 |

## 7. 文件边界

### 7.1 试点允许修改

| 目的 | 文件 |
| --- | --- |
| 列表表面、网格、断点、焦点与结果样式 | `src/components/trades/TradeList.css` |
| 行内真值、标签聚合和可访问名称 | `src/components/trades/TradeRow.tsx` |
| listitem、位置语义与行壳层 | `src/components/trades/TradeRowLayout.tsx` |
| 列标题退出无障碍树 | `src/components/trades/TradeListColumns.tsx` |
| 虚拟总数、位置、月份关联与焦点恢复 | `src/components/trades/TradeList.tsx` |
| 策略与统一上下文聚合 | `src/components/trades/TradeRowStrategy.tsx`、必要时新增同目录纯函数 |
| 错过机会一致性 | `src/components/trades/MissedOpportunityRow.tsx` |
| 状态图标重量与一次性动效 | `src/components/StatusIcon.tsx`、`src/components/StatusIcon.css` |
| 快捷视图与筛选层级 | `src/components/trades/QuickViewBar.css`、`src/components/ui/FilterBar.css`、`src/components/trades/TradeFilters.css` |

试点坚持 CSS-first，但真值、ARIA、聚合顺序与焦点恢复必须由 TSX/纯函数明确表达，不允许用 CSS 选择器猜业务状态。

### 7.2 复用成立后才允许修改

- `src/styles/tokens.css`：同一新语义被至少两个独立组件消费后才新增 token。
- `src/styles/global.css`：仅用于全局焦点、滚动条、强制高对比或减少动效合同。
- `src/components/ui/AppFrame.css`、`src/components/Sidebar.css`：只处理主面与侧栏层级。
- `src/components/sidebar/SidebarWorkspace.css`：只处理“更多”区的相同偏差。

`src/components/ui/Chip.css` 不作为列表降噪捷径。交互按钮、元数据和状态标签必须保留各自语义。

### 7.3 不可漂移的硬合同

- `--trade-row-height: 44px`
- `--trade-group-height: 36px`
- `--toolbar-chip-height: 28px`
- 分组内容 36px，上下各 4px，虚拟总高 44px
- FilterBar 左右内缩 `0 15px 0 8px`
- 交易行 `inset: 2px 8px` 与 `padding: 0 10px`
- 侧栏导航项 28px、`radius-8`
- 侧栏宽度 244/208px，折叠 56px
- `--accent: #5e6ad2`
- 新间距只使用 `--sp-*` 或已有语义间距；层级只使用语义 z-index

## 8. 分阶段实施

### Phase 0：冻结证据与建立门禁

#### T0.1 不可覆盖的证据工具（P0，M）

1. 先提交本方案，再为 `scripts/qa-desktop-visual.mjs` 增加严格的 `--output-root`；packaged 脚本使用等价的 `ATLAS_PACKAGED_VISUAL_OUTPUT`。
2. 正式证据路径只允许：`test-results/desktop-visual-evidence/<baseline|candidate>/<40位commit>/attempt-N/`。目标已存在即失败；重跑只能创建新的 attempt，不能删除、覆盖、移动或重命名旧证据。
3. renderer 与 Electron 可共用 attempt 根，但分别创建 `renderer/`、`electron/` 和各自 report。日常未指定 output root 时可继续使用现有临时目录。
4. 参数缺失、重复、仓库外路径、错误 commit 层级、已有 runtime/report 均非零退出。
5. 扩展 `scripts/fixtures/desktop-visual-matrix.test.mjs` 与 `scripts/fixtures/packaged-desktop-visual.test.mjs`，锁定越界、覆盖、runtime 共存和 packaged 输出保护。

提交：`test(design): make desktop visual evidence commit-addressable`

#### T0.2 生成干净基线（P0，M）

QA 工具和方案提交后的 HEAD 记为 `baselineEvidenceHead`，UI 视觉祖先仍为 `0aad5ae`。先验证 `0aad5ae..baselineEvidenceHead` 未改动 `src/`、`electron/`、`public/`、`build/`、入口 HTML、依赖与构建配置；不满足时停止，改用独立干净 checkout，不得伪称等价基线。

在干净 checkout 运行去重后的唯一门禁：

```powershell
$env:TZ = 'Asia/Shanghai'
$baselineEvidenceHead = (git rev-parse HEAD).Trim()
$baselineRoot = "test-results/desktop-visual-evidence/baseline/$baselineEvidenceHead/attempt-1"
pnpm test
pnpm qa:design
pnpm qa:workbench
pnpm check:desktop-visual
pnpm build:app
node scripts/qa-desktop-visual.mjs --renderer --output-root $baselineRoot
node scripts/qa-desktop-visual.mjs --electron --output-root $baselineRoot
```

`build:app` 已执行 typecheck；不再额外串联 `qa:ci` 或单跑 typecheck。manifest 必须记录 visual ancestor、build commit、clean-tree、runtime、OS、arch、scale、Node/Electron、fixture seed/checksum、字体、截图路径/SHA-256、错误/溢出和人工签收。失败重跑使用新 attempt。

#### T0.3 历史回归阻断合同（P0，M）

- 扩展 `src/regression.test.ts` 与专门 browser fixture，覆盖 6.1 的筛选记忆、详情返回、阶段归属、风险限额和快速记录。
- `TradeComposerBatch.browser.test.ts` 保持“无一句话/无截图也可保存”，并增加失败后输入与附件仍在、可重试成功。
- `StageOwnershipRepairView.browser.test.tsx` 模拟保存、flush、卸载、重新 hydration，已归属记录不得再次出现。
- `TradeListGroupSpacing.browser.test.html/tsx` 使用 960/1280/1440/1600/1920，fixture 宽度消费 viewport，不再固定 520px。
- 校正 `qa:workbench` 中与当前“上下各 4px”不一致的历史断言；后续每个 Phase 都运行该门禁。

新合同先在本地证明旧实现会因目标差异失败，但红灯不得独立提交。测试与使其变绿的最小实现放在同一任务提交中。

#### T0.4 10k 性能与可访问性基线（P0，M）

固定 10,000 条、60 个月份、全部状态、20 个策略、长中英文、多标签、星标、冲突与隐私 fixture，固定种子。同一 runner 执行 5 次：

- 首行可交互、筛选、星标、选择、折叠相对基线退化 ≤10%。
- 连续滚动帧间隔 p95 ≤33.4ms，且无新增 >100ms long task。
- DOM 行数不超过“可见行 + 双侧 overscan + sticky 必要项”。
- 不新增逐行 Store 订阅、逐行布局读取或每帧全表扫描。
- 顶到底再返回后月份 sticky、滚动锚点和焦点正确。

自动计算最终前景与实际合成背景：正文/有意义元数据 ≥4.5:1；大文字、焦点、控件边界和非文字状态 ≥3:1。覆盖 default、hover、focus、selected、error、disabled、floating、forced-colors；同时记录 Windows NVDA、macOS VoiceOver 与“提高对比度”基线。

### Phase 1：共用列表试点

#### T1.1 表面、文字、ARIA 与焦点（P0，M）

- 普通行回到 L1；分组条使用 L2；列标题只保留弱文字和必要分隔。
- 品种与真实结果为主权重；编号、周期、日期降级。
- 落实 5.5 的 `list/listitem` 和 5.6 的 2px 焦点合同，更新旧的“无可见焦点”“必须 columnheader”断言。
- 同提交补齐 accessibility-tree、焦点高光开/关和虚拟位置测试。

提交：`fix(design): align trade list hierarchy focus and semantics`

#### T1.2 标签聚合与颜色预算（P0，M）

- 落实 5.3 的统一排序、统一 `+N` 和宽度名额。
- Tooltip 支持鼠标、键盘、Escape、焦点返回和视口碰撞；无障碍文本不依赖 Tooltip 是否打开。
- 聚合使用纯函数并测试稳定顺序、重复标签、长文本和 10k fixture；不得增加逐行订阅。

提交：`fix(design): consolidate trade row context hierarchy`

#### T1.3 结果真值与隐私（P0，M）

- 落实 5.4 的逐槽位矩阵与 data state。
- PnL-only、R-only、price、imported 和历史推断口径保留合法值。
- privacy 只遮现金，R 与结果状态继续显示。
- 冲突只提示一次并保留原值，不进入可信绩效聚合。

提交：`fix(design): render trade results from verified truth`

#### T1.4 状态图标与动效（P1，S）

- 状态图标统一 14px 容器、视觉中心和默认明度；业务映射不变。
- 使用固定 SVG mask/像素边界脚本验证可见包围盒差异 ≤2px。
- 首次渲染不播放；真实状态变化只播放一次；减少动效为静态。

提交：`style(design): normalize trade status icon weight`

#### T1.5 Windows 候选 EXE 闸门（P0，M）

```powershell
$env:TZ = 'Asia/Shanghai'
$candidateHead = (git rev-parse HEAD).Trim()
$candidateRoot = "test-results/desktop-visual-evidence/candidate/$candidateHead/attempt-1"
pnpm test
pnpm qa:design
pnpm qa:workbench
pnpm check:desktop-visual
pnpm build:app
node scripts/qa-desktop-visual.mjs --renderer --output-root $candidateRoot
node scripts/qa-desktop-visual.mjs --electron --output-root $candidateRoot
pnpm exec electron-builder --win nsis --x64 --publish never
```

人工资料库流程：先创建备份/导出并验证 → 复制到独立测试目录 → 记录原库、备份、副本路径和校验和 → 设置候选 EXE 只打开副本。候选应用不得写生产资料库。

用户通过条件：连续扫读、筛选、星标、选择、详情返回、阶段归属、风险限额和快速记录全部符合合同。失败时按 T1.1–T1.4 独立回退，禁止进入 Phase 2。

### Phase 2：顶部控制与侧栏收敛

#### T2.1 顶部控制与文案（P1，M）

- 快捷视图只有 selected 常驻填充；默认项使用文字层级。
- 筛选入口在 applied/open/focus 时提升，默认时保持可发现但安静。
- 显示模式保持页面级切换，不与筛选 chip 共用同一表面。
- 落实 5.8：删去标题、范围和选择器间的重复说明；不得改变状态、位置、点击区域或记忆逻辑。

提交：`style(design): clarify desktop scope and filter controls`

#### T2.2 侧栏与滚动表面（P1，S）

- 侧栏选中态保持单层填充；普通计数退后；风险摘要保留可读的日/周/月值。
- 全局滚动条消费已有 token；Windows 验证占位宽度，macOS 验证滚动能力而非强求静态 thumb 可见。
- 不改变侧栏宽度、导航顺序、入口位置和风险路由。

提交：`style(design): refine sidebar and scroll surfaces`

### Phase 3：分页面执行卡

每张卡独立审计、提交、截图和回退。只允许调整现有 token 消费、文字、颜色、边框、阴影、圆角和间距；DOM 重构、业务状态、路由、持久化或数据计算自动移出本轮。

#### 卡 A：交易详情

- 文件：`src/views/DetailView.css`、`src/components/trades/TradeDetailLayout.css`
- 第一锚点：品种/方向/结果；第二：截图与正文；第三：属性与来源。
- 允许：减少重复标题与说明，统一正文、图片区、属性区和静态/编辑态层级。
- 不可漂移：返回来源、滚动锚点、原行焦点、编辑草稿、保存状态、图片缩放、危险操作位置。
- 必测：有图/无图、长正文、只读/编辑、saving/saved/failure、来源缺失、960×640。
- 提交：`style(design): align detail surfaces with desktop hierarchy`

#### 卡 B：统计分析

- 文件：`src/views/Dashboard.css`
- 第一锚点：当前范围的关键结论；第二：趋势/图表；第三：口径与样本数。
- 允许：只保留一个范围摘要，收敛指标、图例、数据健康和时间范围控件。
- 不可漂移：统计口径、币种说明、样本数量、下钻 query 和图表数据。
- 必测：有数据、无数据、缺失、冲突、币种排除、正/负/零值、960×640。
- 提交：`style(design): align analytics surfaces with desktop hierarchy`

#### 卡 C：周期复盘与随机复盘

- 文件：`src/views/WeeklyReviewView.css`、`src/views/ReviewSessionView.css`
- 第一锚点：当前步骤/本周结论；第二：评分与证据；第三：历史趋势。
- 允许：删除标题后口号式文案，收敛步骤、评分、证据行、草稿态与完成动作。
- 不可漂移：风险未知/触线强度、会话游标、随机顺序、掌握字段兼容、保存原子性。
- 必测：首次、草稿、完成、风险正常/触线/未知、空池、图片缺失、减少动效。
- 提交：`style(design): align review surfaces with desktop hierarchy`

#### 卡 D：设置与数据健康

- 文件：`src/views/settings/SettingsLayout.css` 及确有偏差的面板 CSS。
- 第一锚点：设置名称与当前值；第二：动作；第三：只在必要时出现的后果说明。
- 允许：删除重复说明，收敛标题、区块、字段、选中行、危险操作和数据健康状态。
- 不可漂移：字段值、自动保存、验证、恢复入口、危险确认、软件更新权限模型。
- 必测：default/hover/focus/disabled/busy/error、长中文、危险操作、窄桌面。
- 提交：`style(design): align settings surfaces and field hierarchy`

#### 卡 E：活跃辅助列表

- 文件：`src/views/TrashView.css`、`src/views/MissedOpportunitiesView.css` 及当前路由实际消费的派生列表 CSS。
- 第一锚点：对象身份/结果；第二：恢复或后续动作；第三：来源范围。
- 允许：清理与共用列表合同冲突的局部覆盖。
- 不可漂移：旧路由翻译、来源范围、恢复/彻底删除、错过机会聚合语义。
- 必测：空库、范围为空、筛选无结果、回收站、三来源错过机会、列表/看板。
- `src/views/TodayWorkspace.css` 只有在路由扫描证明仍被活跃页面消费时才处理；否则不触碰。
- 提交：`style(design): align secondary list surfaces`

每张卡完成后运行相关 browser 测试、五个桌面尺寸默认截图和对应状态关键帧；未通过只回退该卡。

#### T3.2 Token 与重复覆盖收尾（P1，S）

- 新 token 少于两个独立消费者时回收到组件作用域。
- 删除被替代的硬编码颜色、阴影、圆角和 fallback，不保留双轨样式。
- 运行视觉治理检查；禁止新增第五层表面、裸字号和未命名灰阶。

提交：`refactor(design): consolidate desktop visual tokens`

### Phase 4：最终验证与交付

#### T4.1 冻结候选与状态证据（P0，M）

所有实现和测试先提交；candidate checkout 必须干净，证据路径使用 `<candidate-sha>/attempt-N`，且与 baseline 的工具版本、OS、arch、viewport、场景和 seed 一致。

```powershell
$env:TZ = 'Asia/Shanghai'
$candidateHead = (git rev-parse HEAD).Trim()
$candidateRoot = "test-results/desktop-visual-evidence/candidate/$candidateHead/attempt-1"
pnpm test
pnpm qa:design
pnpm qa:workbench
pnpm check:desktop-visual
pnpm build:app
node scripts/qa-desktop-visual.mjs --renderer --output-root $candidateRoot
node scripts/qa-desktop-visual.mjs --electron --output-root $candidateRoot
```

默认矩阵仍为 24 路由 × 5 尺寸 = 120 张/每 runtime，但只证明默认静态态。另建 12 状态 × 960/1440/1920 = 36 张/每 runtime 的状态包：

1. 键盘焦点；2. selected + starred；3. 筛选打开；4. 筛选已生效；5. 筛选无结果；6. `+N` Tooltip；7. 右键菜单边缘碰撞；8. privacy；9. 空资料库；10. 当前范围为空；11. 保存失败且草稿保留；12. 看板默认态。

#### T4.2 Windows x64 精确 EXE（P0，M）

```powershell
pnpm exec electron-builder --win nsis --x64 --publish never
$version = (Get-Content -Raw -Encoding utf8 package.json | ConvertFrom-Json).version
$artifact = (Resolve-Path "release/Trader-Atlas-$version-win-x64.exe").Path
pnpm qa:final-payload -- --artifact $artifact --arch x64 --output "test-results/final-packaged-artifact/$candidateHead/windows-x64-nsis.json"
```

把精确 EXE 静默安装到新的隔离目录，显式设置 `ATLAS_PACKAGED_ARTIFACT`、`ATLAS_PACKAGED_EXECUTABLE` 与 `ATLAS_PACKAGED_VISUAL_OUTPUT`，分别以 scale 1/1.25/1.5 运行 `pnpm qa:desktop-visual:packaged`。安装、环境变量和卸载边界以 `.github/workflows/desktop-visual-evidence.yml` 为唯一模板。

三个缩放档各 120 张，共 360 张。每份报告必须证明 `platform=win32`、`architecture=x64`、clean build、`realLibraryAccessed=false`，并记录 EXE、可执行文件和 `app.asar` SHA-256。

#### T4.3 macOS 双原生架构（P0，M）

| runner | 原生架构 | 构建命令 |
| --- | --- | --- |
| `macos-26` | arm64 | `pnpm exec electron-builder --mac dmg zip --arm64 --publish never` |
| `macos-26-intel` | x64 | `pnpm exec electron-builder --mac dmg zip --x64 --publish never` |

两个 runner 必须 checkout 同一 candidate commit，验证 `process.arch`，分别完成 Retina scale 2 packaged 视觉矩阵、DMG final payload smoke、ZIP final payload smoke。每份报告记录 artifact、executable、`app.asar` 哈希、runner、arch、commit 与路径。跨架构构建或 Rosetta 不算原生运行证据。

当前 `.github/workflows/desktop-visual-evidence.yml` 的 macOS job 只构建 ZIP，且未执行 DMG/ZIP final payload smoke；应复用 `.github/workflows/release.yml` 已有的双产物构建与 smoke 合同扩展该 job，再将其作为 Phase 4 完成证据。两个架构各 120 张，共 240 张。

#### T4.4 安全人工签收（P0，M）

候选安装包不得直接打开用户正在使用的真实资料库。流程固定为：稳定版立即备份并验证 → 完全退出 → 恢复到新测试目录 → 候选版本只打开副本 → 前后记录交易/策略/附件数量和验证状态 → 异常立即停止 → 退出候选后再处理可丢弃副本。

固定验收任务：

1. 连续扫读 30 行，记录首看对象与结果是否正确。
2. 检查多标签、错误、亏损、星标组合，按颜色预算逐项签收。
3. 检查全部结果口径、隐私、冲突和零值。
4. 完成筛选记忆、阶段归属、快速记录、失败重试与详情返回。
5. 在 960×640、1280×800、1440×900、1600×900、1920×1080 检查列、Tooltip、菜单、滚动和吸顶。
6. Windows 开启强制高对比并用 NVDA；macOS 开启提高对比度并用 VoiceOver。
7. 对 baseline/candidate 每张关键帧写 `pass/fail + 原因 + 审阅人 + 时间`，不得整批盲签。

## 9. 自动化与证据映射

| 风险 | 自动化/证据 |
| --- | --- |
| 行高、组高、吸顶、五档宽度 | `TradeList.design.test.ts`、`TradeListGroupSpacing.browser.test.html/tsx`、`qa:workbench` |
| 标签排序、统一 `+N`、结果真值、焦点 | `TradeRowPresentation.browser.test.tsx` + 纯函数单测 |
| ARIA 树、虚拟位置、月份关系 | 新增列表 accessibility-tree browser 合同 |
| 错过机会一致性 | `MissedOpportunitiesView.browser.test.tsx` |
| 筛选/阶段记忆和详情返回 | `src/regression.test.ts`、新增 hydration browser 测试、`DetailShortcutNavigation.browser.test.tsx` |
| 阶段修复不重复 | `stageOwnershipRepair.test.ts`、`StageOwnershipRepairView.browser.test.tsx` |
| 风险限额可见 | 新增 Sidebar 风险摘要 browser 合同 + 960px 状态帧 |
| 快速记录与失败恢复 | `TradeComposerBatch.browser.test.ts`、`tradeComposerCommit.test.ts` |
| 四层表面与文字角色 | `DesktopSurfaceTypography.design.test.ts`、`DesktopPageRails.design.test.ts` |
| 默认静态矩阵 | `scripts/fixtures/desktop-visual-matrix.test.mjs`、`scripts/qa-desktop-visual.mjs` |
| 状态关键帧 | 新增 desktop visual state pack 脚本与 manifest |
| 10k 性能 | 新增固定种子虚拟列表 benchmark/browser 报告 |
| 安装包真实运行 | `qa-packaged-desktop-visual.mjs`、`run-final-packaged-artifact-smoke.mjs` |

## 10. 量化验收标准

| 指标 | 通过标准 |
| --- | --- |
| 列表几何 | 行 44px、组条 36px、上下各 4px、虚拟总高 44px，误差 ≤1px |
| 列对齐 | 标题与行共享列模板，关键列误差 ≤1px；目标宽度 0 横向溢出 |
| 结果语义 | 全部口径和状态均有双侧 fixture；真实值、零值、缺失、冲突、隐私不混淆 |
| 上下文 | 排序确定；可见数符合断点；统一 `+N` 的鼠标、键盘、辅助技术信息一致 |
| 视觉色彩 | 单行高显著语义色 ≤2 组；普通标签不使用业务色 |
| 交互 | hover、active、focus、selected、disabled、busy 可区分且不叠加多重高亮 |
| 对比度 | 正文/有意义元数据 ≥4.5:1；焦点、控件边界、状态图标 ≥3:1 |
| 可访问性 | `list/listitem` 单一模型；NVDA/VoiceOver 能读总数、位置、分组、结果与动作 |
| 性能 | 10k 操作退化 ≤10%；滚动 p95 ≤33.4ms；无新增 >100ms long task |
| 默认矩阵 | renderer 120/120、Electron 120/120；各自 0 溢出、0 控制台/页面错误 |
| 状态矩阵 | renderer 36/36、Electron 36/36；关键状态逐图签收 |
| 原生产物 | Windows x64 三缩放档；macOS arm64/x64 原生 Retina；身份和哈希匹配当前提交 |
| 信息连续性 | 筛选、阶段归属、返回焦点、风险限额、快速记录在重启/失败路径不回归 |

“2 秒内识别”“看起来更安静”只作为人工观察记录，不作为不可复现的自动门禁。最终裁决以行为、几何、计算样式、性能、无障碍树和逐图签收共同决定。

## 11. 风险与回退

| 风险 | 预防 | 回退条件 |
| --- | --- | --- |
| 全局 token 污染 | 列表作用域先验证，两个消费者后才提升 | 任一非目标页出现第五层表面、对比下降或几何变化 |
| 合法结果被误标 | 真值与 resultSource 双重派生，逐槽位 fixture | PnL-only/R-only/price/imported 任一原值被隐藏 |
| 折叠造成信息丢失 | 统一 `+N`、可访问文本、键盘 Tooltip | 任一信息无法由鼠标、键盘或辅助技术读取 |
| 960px 丢关键列 | 固定断点表和 computed display 断言 | 现金盈亏、R、异常或主操作不可见/不可达 |
| 焦点过重或消失 | 2px 全局 ring、关闭增强高光的 1px 对比测试 | 键盘位置不明确或 focus 与 selected 无法区分 |
| 虚拟列表退化 | 固定 10k 基线与订阅/布局审计 | 退化 >10%、p95 超限或出现 long task |
| 证据被覆盖 | commit-addressable root、attempt 与 manifest | baseline/candidate 身份或哈希不匹配 |
| 候选写坏真实库 | 验证备份后只使用独立副本 | 候选连接生产库或副本无法重建 |
| 大提交难回退 | 每任务测试+实现同提交，每页面独立提交 | 一个提交无法单独解释其截图变化 |

## 12. 原子提交顺序

```text
1. test(design): make desktop visual evidence commit-addressable
2. fix(design): align trade list hierarchy focus and semantics
3. fix(design): consolidate trade row context hierarchy
4. fix(design): render trade results from verified truth
5. style(design): normalize trade status icon weight
6. test(design): lock workspace continuity and composer recovery
7. style(design): clarify desktop scope and filter controls
8. style(design): refine sidebar and scroll surfaces
9. style(design): align detail surfaces with desktop hierarchy
10. style(design): align analytics surfaces with desktop hierarchy
11. style(design): align review surfaces with desktop hierarchy
12. style(design): align settings surfaces and field hierarchy
13. style(design): align secondary list surfaces
14. refactor(design): consolidate desktop visual tokens
15. test(design): finalize desktop state performance and accessibility evidence
```

红灯只在本地证明合同有效，不独立提交。每个落地主干的提交必须同时包含对应最小实现并保持相关测试全绿；不得混入数据迁移、发布或无关格式化。

## 13. Implementation Tasks

- [ ] **T0 (P0)**：建立 commit-addressable baseline/candidate、attempt 与 manifest；验证干净 checkout。
- [ ] **T1 (P0)**：以测试+实现完成列表表面、ARIA、焦点、标签聚合、真值、断点和状态图标。
- [ ] **T2 (P0)**：锁定筛选/阶段记忆、详情返回、风险限额和快速记录失败恢复。
- [ ] **T3 (P0)**：构建 Windows 候选 EXE，仅以验证后的资料库副本完成人工试点。
- [ ] **T4 (P1)**：收敛顶部控制、重复文案、侧栏和滚动表面。
- [ ] **T5 (P1)**：按五张页面执行卡独立推广、测试、截图和回退。
- [ ] **T6 (P0)**：完成 10k 性能、对比度、强制高对比、NVDA/VoiceOver 和键盘验证。
- [ ] **T7 (P0)**：完成 Windows x64、macOS arm64/x64 原生 packaged 与 final payload 证据。

## 14. 完成定义

只有同时满足以下条件，才能标记完成：

- Phase 1 Windows 候选 EXE 获得用户确认后才进入全局推广。
- 每个落地主干的提交相关测试全绿，可独立解释和回退。
- baseline/candidate、runtime、平台、架构、缩放和产物哈希全部可追溯。
- 结果展示与 `tradeTruth`/`resultSource` 一致，隐私只遮现金。
- `list/listitem`、键盘、NVDA、VoiceOver、高对比和减少动效全部通过。
- 960–1920px 的现金盈亏、R、异常、风险限额和主操作保持可达。
- 筛选与阶段记忆、详情返回、阶段归属、快速记录及失败重试不回归。
- 信息没有被删除；被折叠内容可由鼠标、键盘和辅助技术完整访问。
- 页面没有新增结构、导航模式、数据模型、第五层表面或非目标平台适配。
- 默认矩阵和状态证据包均逐项人工签收，不能靠整批更新截图通过。

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | ---: | --- | --- |
| Design Review | `/plan-design-review` | 复核视觉层级、状态、边界、无障碍与落地性 | 1 | CLEAR | 方案从 6/10 修订至 9/10；锁定 12 项关键决策，未决策项 0 |
| Eng Review | — | 代码实施前仍需验证架构、数据流与测试成本 | 0 | REQUIRED | 实施前执行，不以本次设计复核替代工程评审 |
| DevEx Review | 历史记录 | 旧提交的桌面发布链路体验审计 | 1 | HISTORICAL CONCERNS | `6cee573` 上为 3/10；仅作风险背景，不代表当前方案或当前 HEAD 的复核结果 |

**VERDICT:** DESIGN CLEARED；ENG REVIEW REQUIRED BEFORE IMPLEMENTATION

NO UNRESOLVED DECISIONS
