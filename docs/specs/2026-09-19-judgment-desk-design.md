# Atlas 判断台 — 设计工作稿

> **状态：未定稿。** 本文是讨论底稿，不是实现依据。
> 已确认的决策与未决问题分开记录；未决问题见第 7 节。
> 建立日期：2026-09-19。来源：Product Spec v0.1 + 仓库侦察。

## 0. 落稿前必须记录的两件事

### 0.1 项目建过「判例库」，并已移除

| 提交 | 内容 |
| --- | --- |
| `24f9aecc` | 判例库一期：独立数据模型（9 个内置纠纷类型 + 生命周期/裁决推导）、侧栏「复盘↔判例」Tab、判例列表页、详情面板、新建判例弹窗、缩略图全屏预览 |
| `eaf36326` | 判例库二期 |
| `44a0c194`（2026-07-11） | **删除** `src/data/case.ts`、`CaseList.tsx`、`CaseDetail.tsx`、`NewCaseModal.tsx`、`docs/case-library-product-design.md`（997 行）。71 文件改动，-5858 行。提交信息：「清理旧独立案例库页面」 |

墓碑字段仍保留在快照里：`src/storage/types.ts:86-89` 的 `cases?` 与 `disputeTypes?`，
`src/storage/persistedKeys.ts:3` 把它们列为 `DeprecatedPersistedSnapshotKey`。

**对本次设计的含义**：Product Spec v0.1 实质是「判例库三期」。上一代被移除的原因是它建立了**第二套案例存储 + 第二套案例页面**。本次设计必须避免重复该形态。

### 0.2 现在不存在独立的案例实体

`src/data/trades.ts:11` `TradeKind = 'live' | 'paper' | 'case'`，`src/data/trades.ts:144-147` `CaseTrade = TradeBase & { tradeKind: 'case' }`。

**「案例」就是一条 `tradeKind: 'case'` 的记录**，与实盘、模拟盘共用同一张表。界面上的名字是**「案例库」**（`/review-cases`），不是「判例库」。

## 1. 定位

在既有交易/案例之上加一层**结构判断训练**：反复对同一结构做「是 / 否 / 不确定」的二值判断，用分歧收敛规则边界。

它**不拥有任何图片**：图片永远归来源记录所有。

## 2. 已确认的决策

| # | 决策 | 结论 |
| --- | --- | --- |
| 1 | Case 来源 | 独立训练池；来源含**交易日志**、**案例库**、**任意截图位置** |
| 2 | 任意截图的含义 | **两种都要**：Atlas 内部任意截图位置 + 外部行情（TradingView 等） |
| 3 | 训练池存什么 | **只存引用**，不自持图片副本。外部行情由判断台后台自动落一条最小案例承接 |
| 4 | 入口 | **独立一级模块**（侧栏第 7 项），有意识更新治理断言 |
| 5 | Scenario 定义 | **自由命名 + 建议值**（不强制结构化枚举） |
| 6 | 判断对错配色 | **中性 + accent**，不复用 `--pos` / `--neg` |

### 决策 3 的落地方式

| 来源 | 落地 |
| --- | --- |
| 交易日志 | 引用该 trade 的 id |
| 案例库 | 引用该 case 的 id（case 也是 trade） |
| Atlas 内部任意截图位置 | 同上，引用所在记录 |
| 外部行情 | 后台自动落一条最小案例：`tradeKind:'case'`、`entry:0`、`size:0`、`pnl:null`、正文含该图 |

外部行情的落法**完全复刻既有形态** `src/lib/reviewComposer/caseDraft.ts:24-68`（`buildComposerReviewCase`），不是新发明。用户侧仍是一步：贴图 → 选场景 → 是/否 → 原因 → 保存。

### 决策 6 的依据

`design.md:126-128` 规定 `--pos` 只表达「盈利、完成、正向结果」，`--neg` 只表达「亏损、错误、危险操作」。
`src/styles/tokens.css:346-347`：`--pos: lch(72% 45 152)` 注释「盈利绿」，`--neg: lcl(66% 58 28)` 注释「亏损红」。
Product Spec §9 要求「正确答案只评价是否符合结构定义，不评价后续行情是否赚钱」，与盈亏色语义直接冲突。

## 3. 数据模型

```ts
interface JudgmentScenario {
  id: string
  name: string          // 「4H iBOS」
  question?: string     // 「这里是否构成有效的 4H iBOS？」
  rule?: string         // 当前规则，纯文本，按 §18 不做版本管理
  createdAt: number
  updatedAt: number
}

interface JudgmentItem {
  id: string
  scenarioId: string
  sourceTradeId: string   // 指向任意 tradeKind
  imageAssetId?: string   // 可选：指向来源记录正文里的某张图
  expectedAnswer: 'yes' | 'no'
  explanation?: string
  createdAt: number
  updatedAt: number
}

interface JudgmentRecord {
  id: string
  itemId: string
  scenarioId: string
  answer: 'yes' | 'no' | 'uncertain'
  createdAt: string
}
```

## 4. 对 Product Spec v0.1 的三处修改

### 4.1 删除 `Judgment.correct`，改为派生

v0.1 §12 把 `correct` 存为字段。但 §18 允许随时修改规则与标准答案；一旦 `expectedAnswer` 变更，历史 `correct` 立即陈旧且无法修正。

改为只存 `answer`，`correct` 由 `answer === expectedAnswer` 现算。

副作用即期望行为：**修改标准答案后，历史判断按新标准重新解读。**

### 4.2 拆分「分歧」与「训练优先级」

v0.1 §22 的 `isDisagreement` 使「错一次即永久分歧」，与 §13「多次判断一致则降低优先级」互相冲突。

拆分为两个独立概念：

- **分歧 = 永久属性**：曾答错 / 曾不确定 / 出现过两种以上答案。记录「该案例曾让你动摇」，不被后续正确抹掉。
- **优先级 = 动态权重**：最近连续正确则降权。

§22 的判定逻辑原样保留，§13 落到权重上。代价：训练项需要记录「最近 N 次结果」。

### 4.3 `imageAssetId` 是引用，不是副本

一条来源记录的正文可能含多张图，训练项需指认练哪一张。它只是 assetId 字符串，图仍在来源记录正文内 —— **资产 GC 白名单零改动**。

## 5. 既有资产复用清单（含证据）

### 可直接复用，无需新建

| 需求 | 复用对象 | 位置 |
| --- | --- | --- |
| 图片缩放 / 平移 / 复位 | `ImageLightbox`，**已完整实现** | `src/components/ImageLightbox.tsx:107-122`（滚轮缩放 + 光标锚定）、`:171-205`（Pointer Events 平移）、`:215-219`（双击复位） |
| 灯箱变换数学 | `zoomLightboxAtCursor` / `panLightboxView` / `lightboxViewTransform` | `src/lib/lightboxView.ts:70/92/96` |
| 灯箱键盘 | `image.prev` / `image.next` / `image.close` / `image.reset` | `src/shortcuts/actions.ts:302-332` |
| 图片右键菜单 | **零接入**，`ImageActions` 已全局 capture `contextmenu` | `src/components/ImageActions.tsx:65` |
| 资产引用格式 | `assetUrl(id)` / `parseAssetId(src)` / `journal-asset://` | `src/storage/assets.ts:8-23` |
| 渲染取 URL | `adapter.getAssetObjectUrl(id)` | `src/storage/adapter.ts:51` |
| 案例到期 / 间隔重复 | `nextReviewAt` + `isReviewCaseDue()` + `buildReviewAssessmentPatch()` | `src/lib/reviewSession.ts:330-347`、`:85-131` |
| 会话冻结轮次 + 精确撤销 | `ReviewSessionSnapshot`（`ids` / `cursor` / `assessments` / `assessmentActionIds`） | `src/lib/reviewSession.ts:64-81` |
| 会话存储分层 | 轮次放 `sessionStorage`，过滤器放 `localStorage`，按 libraryId 隔离 | `src/lib/reviewSession.ts:435-441` |
| 全新持久化实体样板 | `quickNotes` 的完整注册链 | 见下节 |
| 外部行情落案例 | `buildComposerReviewCase` | `src/lib/reviewComposer/caseDraft.ts:24-68` |
| 结构组合的稳定签名 | `engine.signature(s)` | `src/lib/reviewComposer/scenario.js` |

### 必须新建（无既有基础）

1. **缩略图与降采样** —— 全库无缩略图字段、无降采样、无虚拟化网格。`electron/library/images.ts` 的 `processImageBuffer` 刻意不重编码（保留截图文字与细线清晰度）。
2. **题面 / 标准答案 / 作答记录 / 判分** —— 完全不存在。
3. **答案的隐藏态** —— 现有 `note` 在复盘会话里直接读出展示，无「作答前隐藏」概念。

### 既有技术约束

| 约束 | 位置 | 影响 |
| --- | --- | --- |
| Object URL **LRU 上限 128 条** | `electronAdapter.ts:11`、`indexedDbAdapter.ts:42` | 缩略图网格超过 128 张会持续击穿缓存，已有 `<img>` 指向被 revoke 的 URL 会裂图 |
| 资产 GC 白名单只有 3 个域 | `assetInventory.ts:16-29`（`trade` / `weeklyReview` / `quickNote`） | 图片记在这三域之外会被判 orphan，进清理候选。本设计因「只存引用」而不受影响 |
| 快照字段完整性编译期断言 | `persistedKeys.ts:39-46` | 漏登记快照字段 → `tsc` 直接失败 |
| `pickPersisted` 是手工列举式 | `src/storage/persist.ts:16-52` | **登记了但没在 `pickPersisted` 赋值 → 字段永远存不进去且不报错**（最易踩的坑） |
| 写入门禁 | `src/storage/persist.ts:55-62` 是唯一落盘入口 | 组件不得直连 storage |

### 三个新实体的持久化注册点

均为**可选字段** → **不必 bump `SCHEMA_VERSION`（当前 13）**，`quickNotes` 是同样先例。

1. `src/storage/types.ts` — `PersistedSnapshot` 加字段
2. `src/storage/persistedKeys.ts:10-37` — 加进 `PERSISTED_SNAPSHOT_FIELDS`
3. `src/storage/snapshotCodec.ts` — `decodeCanonicalSnapshot` 归一化块加默认值
4. `src/storage/snapshotValidation.ts:901+` — `assertValidPersistedSnapshot` 加校验分支
5. `src/storage/persist.ts:16-52` — `pickPersisted` 加映射（**勿漏**）
6. `src/storage/bootstrap.ts:91-126` — 水合时 `useStore.setState`

### 「只存引用」规避的坑

图片挂在来源记录的 `note` 字段，已在 `trade` 域内。**不必碰 `assetInventory.ts:16` 的白名单**，因此不存在「漏注册 → 静默进回收候选」的路径。

代价（需处理的降级态）：
- 训练案例会出现在案例库里，需要一个标记区分「训练来源」，否则案例库会被填满
- 来源记录里的图若被删除，训练项会悬空，需要「图片已移除」的降级态

## 6. 治理与门禁影响

### 6.1 一级导航升为 7 项

`src/regression.test.ts:450-454` 断言：

```ts
PRIMARY_NAV.map((item) => item.id).join(',')
  === 'trades,dashboard,weeklyReview,reviewCases,reviewComposer,reviewSession'
// '核心模块必须收敛为交易日志、统计分析、周期复盘、案例库、复盘组合器和随机复盘'
```

该断言的文案是「核心模块必须**收敛**」，与判例库被移除是同一条产品意图。

**处理方式**：有意识更新该断言，理由写进提交信息 —— 该断言防止的是**平行的重复模块**（判例库即此类），而判断台不建平行存储，它是在既有案例上加一层训练。

### 6.2 新增一级模块的完整改动清单（9 个文件）

| 文件 | 改动 |
| --- | --- |
| `src/lib/sidebarNavContract.ts` | `PrimarySidebarNavId` 加 id；`PRIMARY_NAV_ITEMS` 加 `{id, to, label}` |
| `src/lib/sidebarNav.ts` | `PRIMARY_NAV_ICONS`（穷尽 Record，TS 强制） |
| `src/App.tsx` | lazy import + Route |
| `src/shortcuts/actions.ts` | `nav.<id>` 动作（`scope: 'navigation'`） |
| `src/config/default-profile.json` | **缺 key 会抛异常**（`src/config/defaultProfile.ts:69-71`） |
| `src/components/CommandPalette.tsx` | `viewNav` 数组加一行 |
| `src/lib/sidebarWorkspace.ts` | `primaryIdForLocation()` 路径映射 |
| `src/regression.test.ts` | **8 处硬编码顺序字符串** |
| `scripts/qa-sidebar-navigation.mjs` | 期望标签数组 |

### 6.3 持久化性能

`scripts/benchmark-persistence.mjs:20-29` 的硬门禁，数据集为 10k / 20k 笔、每笔 2KB 正文：

| 门禁 | 上限 | 当前实测 | 余量 |
| --- | ---: | ---: | ---: |
| Web 20k 保存 p95 | 2500ms | 297.5ms | 8.4× |
| Web 10k 保存 p95 | 1500ms | 146.1ms | 10.3× |
| Electron 20k 保存 p95 | 5000ms | 1074.3ms | 4.6× |
| Electron 10k 保存 p95 | 3000ms | 590.0ms | 5.1× |
| Web 主线程阻塞 | 100ms | 0ms | — |

判断记录量级估算：每天 100 次判断 ≈ 3MB/年，相对已被 40MB 量级占据的快照约 7%。**SLO 不会被击穿**，但主线程阻塞门禁余量为 0，需在发布前实测。

## 7. 未决问题

| # | 问题 | 说明 |
| --- | --- | --- |
| 1 | 分歧/优先级的拆分是否采纳 | 4.2 节的方案待确认 |
| 2 | 「最近 N 次结果」的 N 取值 | 影响 §13 降权与 §17 历史展示 |
| 3 | Scenario 的编辑、删除与级联 | v0.1 只有新建，未定义删除行为 |
| 4 | 训练页的内容轨道定性 | `design.md:91` 禁止新增第五档，`:93` 给「数据工作台」留了全宽口子。训练页 80% 给图，需定性 |
| 5 | 快捷键键位与既有绑定的冲突检查 | v0.1 §19 提 1/2/3 + Space + Esc。需过 `bindingRules.ts` 的冲突检查，且改动默认绑定会牵连浏览器回归 |
| 6 | 缩略图网格方案 | 无缩略图基础 + 128 条 Object URL LRU。需定降采样（渲染进程 canvas 或引入 sharp）与是否需要虚拟化 |
| 7 | 主线程阻塞实测 | 见 6.3 |
| 8 | 训练案例在案例库里的标记方式 | 复用既有 `caseType` 还是新增轻字段 |
| 9 | 图片来源被删除后的降级态 | 需要明确的 UI 表达 |
| 10 | 判断记录是否设上限 | 当前倾向不设 |

## 8. 明确不做（沿用 v0.1 §26）

AI 自动判断结构 / AI 自动生成规则 / 胜率统计 / 收益统计 / RR / 交易评分 / 排行榜 / 学习曲线 / 复杂遗忘曲线 / 自动标签 / 数十种筛选器 / 知识图谱 / 场景组合 / 多步骤考试。

新增一条：**不做判例库式的独立案例存储与独立案例页面**（见 0.1）。
