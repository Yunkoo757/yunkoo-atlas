# 判例库模块 — 产品设计文档

> **版本**: 1.0  
> **最后更新**: 2026-06-21  
> **状态**: 现行实现 (Tauri + React + Vite)  
> **用途**: 本文件为迁移参考文档，描述判例库的完整产品设计、交互逻辑和技术原型

---

## 目录

1. [产品概述](#1-产品概述)
2. [核心数据模型](#2-核心数据模型)
3. [业务推导逻辑](#3-业务推导逻辑)
4. [UI 布局 & 组件树](#4-ui-布局--组件树)
5. [状态管理](#5-状态管理)
6. [交互流程](#6-交互流程)
7. [设计系统 & Design Tokens](#7-设计系统--design-tokens)
8. [CSS 类名体系](#8-css-类名体系)
9. [存储 & 持久化](#9-存储--持久化)
10. [完整文件清单](#10-完整文件清单)

---

## 1. 产品概述

### 1.1 定位

判例库是交易复盘系统中的核心模块之一（与"交易记录"并列），用于**结构化记录和裁决交易信号案例**。用户截取技术分析图表，标注纠纷类型、给出初始判决，经复盘后确认最终裁决，形成可检索、可统计、可对比的判例知识库。

### 1.2 核心工作流

```
截图采集 → 快速录入 → 列表浏览/筛选 → 详情复盘/裁决 → 对比分析 → 知识沉淀
```

### 1.3 双轴状态模型

判例同时存在于两个正交维度：

| 维度 | 取值 | 语义 |
|---|---|---|
| **Lifecycle** (生命周期) | `待验证` / `已裁决` / `已废弃` | 判例当前处理阶段 |
| **Outcome** (裁决结果) | `正例` / `反例` / `误判` / `模糊` / `待验证` | 判例最终质量结论 |

两个维度由系统根据 `CaseData` 字段自动推导，无需用户手动维护。

---

## 2. 核心数据模型

### 2.1 CaseData — 判例数据荷载

```typescript
type CaseData = {
  // === 必填字段（快速录入） ===
  images: CaseImage[];                    // 至少一张截图
  disputeTypeId: string;                  // 引用 DisputeType.id
  initialVerdict: string;                 // 初始判决：类型选项之一 或 '暂不确定'
  confidence: 30 | 50 | 70 | 90;          // 初判信心度（四档按钮）

  // === 复盘补充字段 ===
  finalVerdict?: string;                  // 最终裁决：'仍无法裁决' | '废弃' | 类型选项之一
  note?: string;                          // 单行笔记
  tags?: string[];                        // 轻量标签
  star?: boolean;                         // 标记为典型案例
  recheck?: boolean;                      // 需要复看

  // === 关联字段 ===
  linkedTradeIds?: string[];              // 关联的交易记录 ID（反向链接）

  // === 通用字段 ===
  bodyMarkdown?: string;                  // 富文本正文
  comments?: CaseComment[];               // 评论列表
  customFields?: Record<string, unknown>; // 扩展字段
};
```

### 2.2 CaseImage — 截图

```typescript
interface CaseImage {
  fileId: string;     // 图片存储 ID
  label?: string;     // 可选的图片标签
  order: number;      // 排序序号
}
```

### 2.3 CaseComment — 评论

```typescript
interface CaseComment {
  id: string;
  bodyMarkdown: string;
  createdAt: number;
  deviceId?: string;
}
```

### 2.4 DerivedCase — 推导状态

```typescript
type CaseLifecycle = '待验证' | '已裁决' | '已废弃';
type CaseOutcome  = '正例' | '反例' | '误判' | '模糊' | '待验证';

interface DerivedCase {
  lifecycle: CaseLifecycle;
  outcome: CaseOutcome;
}
```

### 2.5 DisputeType — 纠纷类型（判例分类体系）

```typescript
interface DisputeType {
  id: string;               // 唯一标识，如 'dt_ibos_4h'
  name: string;             // 显示名，如 '4H iBOS 是否成立'
  options: string[];        // 裁决选项，如 ['是', '不是']
  positiveOption: string;   // 哪个选项算"成立/正例"
  builtin: boolean;         // 是否为内置类型
}
```

**9 个内置纠纷类型**:

| ID | 名称 | 选项 | 正例选项 |
|---|---|---|---|
| `dt_ibos_4h` | 4H iBOS 是否成立 | 是 / 不是 | 是 |
| `dt_ibos_1h` | 1H iBOS 是否成立 | 是 / 不是 | 是 |
| `dt_ibos_15m` | 15m iBOS 是否成立 | 是 / 不是 | 是 |
| `dt_rev_liq` | 4H 结构反转 vs 流动性猎取 | 结构反转 / 流动性猎取 | 结构反转 |
| `dt_cx_sx` | 复杂回调 vs 简单回调 | 复杂回调 / 简单回调 | 复杂回调 |
| `dt_bos` | BOS 是否有效 | 有效 / 无效 | 有效 |
| `dt_idm` | IDM 是否标准 | 标准 / 不标准 | 标准 |
| `dt_bos_below` | 是否破 BOS 下方流动性 | 破 / 未破 | 破 |
| `dt_other` | 其他纠纷 | 是 / 否 | 是 |

### 2.6 CaseFilter — 判例过滤器

```typescript
interface CaseFilter {
  lifecycle?: CaseLifecycle;   // 按生命周期过滤
  outcome?: CaseOutcome;       // 按裁决结果过滤
  star?: boolean;              // 仅典型案例
  recheck?: boolean;           // 仅需复看
  disputeTypeId?: string;      // 按纠纷类型过滤
  special?: string;            // 特殊过滤：'lowconf-pos' = 低置信但成立
  text?: string;               // 全文搜索
}
```

### 2.7 CaseListItem — 列表展示项（视图层）

```typescript
interface CaseListItem {
  id: string;
  data: CaseData;
  derived: DerivedCase;
  updatedAt: number;
}
```

### 2.8 SyncRecord 通用记录信封

```typescript
interface SyncRecord<D> {
  id: string;                              // UUID
  schemaVersion: number;
  updatedAt: Millis;
  deletedAt: Millis | null;                // 软删除
  deviceId: string;
  fieldClock: Record<string, Millis>;      // 字段级时钟（冲突解决）
  history: HistoryEntry[];                 // 变更历史
  data: D;                                 // CaseData / TradeData
}
```

---

## 3. 业务推导逻辑

### 3.1 生命周期推导 `deriveCaseLifecycle`

```
无 finalVerdict          → '待验证'
finalVerdict === '废弃'  → '已废弃'
其他                      → '已裁决'
```

### 3.2 裁决结果推导 `deriveCaseOutcome`

| 条件 | 结果 | 说明 |
|---|---|---|
| 无 `finalVerdict` | `待验证` | 尚未裁决 |
| `finalVerdict === '仍无法裁决'` | `模糊` | 无法判断 |
| `finalVerdict === '废弃'` | `待验证` | 废弃不计入统计 |
| initial == positive 且 final == positive | `正例` | 初始判断正确 |
| initial ≠ positive 且 final == positive | `正例` | 复查后修正为正确 |
| initial == positive 且 final ≠ positive | `误判` | 初始判断被推翻 |
| initial ≠ positive 且 final ≠ positive | `反例` | 始终判断为不成立 |

### 3.3 裁决结果到 UI 色调映射

| Outcome | CSS 类 | 色系 | 语义 |
|---|---|---|---|
| `正例` | `is-positive` | 绿色 | 判断正确 |
| `反例` | `is-negative` | 红色 | 判断为否 |
| `误判` | `is-misjudge` | 黄色/暖黄 | 判断被推翻 |
| `模糊` | `is-vague` | 灰色 | 无法判断 |
| `待验证` | `is-pending` | 蓝色 | 待处理 |

### 3.4 优先级映射（Linear 对齐）

判例库没有独立的 `priority` 字段，通过 `star` 和 `recheck` 组合推导：

| 优先级 | 映射逻辑 | 显示 |
|---|---|---|
| `urgent` | star && recheck | 紧急 |
| `high` | star only | 高 |
| `medium` | recheck only | 中 |
| `low` / `none` | 两者皆无 | 无 |

### 3.5 字段校验规则

**阻断性错误**（阻止保存）:
- 缺少 `disputeTypeId`
- 缺少 `initialVerdict`
- 无截图 / 截图无 `fileId`
- 缺少 `confidence` 或值不在 `[30, 50, 70, 90]`

**警告**（不阻止）:
- 初始/最终裁决不在纠纷类型的选项列表中
- 判例被标记为废弃
- 初始为"暂不确定"但最终有明确裁决

---

## 4. UI 布局 & 组件树

### 4.1 整体布局结构

```
┌──────────────────────────────────────────────────────┐
│  Topbar (全局搜索 + 模块切换)                        │
├──────────┬───────────────────────────────────────────┤
│ Sidebar  │  Content Area                             │
│          │  ┌─────────────────────────────────────┐  │
│  • Trade │  │  TagBar (标签筛选 Chips)            │  │
│  • Case  │  │  ┌───────────────────────────────┐  │  │
│    - 全部│  │  │ ViewToolbar (分组/排序/属性)   │  │  │
│    - 待验│  │  ├───────────────────────────────┤  │  │
│    - 已裁│  │  │ Filter Chips (活跃筛选条件)    │  │  │
│    - 正例│  │  ├───────────────────────────────┤  │  │
│    - 反例│  │  │ CaseList                     │  │  │
│    - 误判│  │  │  ├─ Group: 待验证 (N)         │  │  │
│    - 模糊│  │  │  │  ├─ CaseCard              │  │  │
│    - 低置│  │  │  │  ├─ CaseCard              │  │  │
│    - 典型│  │  │  ├─ Group: 已裁决 (M)         │  │  │
│    - 复看│  │  │  │  └─ ...                   │  │  │
│    - 类型│  │  │  └─ Group: 已废弃 (K)         │  │  │
│          │  │  └───────────────────────────────┘  │  │
│          │  │  BatchBar (批量操作栏)              │  │
│          │  └─────────────────────────────────────┘  │
│          │                                           │
│          │  [Panel 模式时右侧叠加 DetailPanel]       │
└──────────┴───────────────────────────────────────────┘

浮层:
  • NewCaseModal (快速录入弹窗)
  • IssueContextMenu (右键菜单)
  • IssueSubmenu (子菜单浮层)
  • FilterMenuPopover (筛选弹出)
  • DisplayOptionsPopover (显示选项弹出)
  • LabelsSubmenu (标签选择浮层)
  • CaseCompare (多案例对比)
```

### 4.2 组件清单

| 组件 | 文件 | 用途 |
|---|---|---|
| `App` | `App.tsx` | 全局状态管理、路由、事件协调 |
| `CaseList` | `CaseList.tsx` | 判例列表渲染（分组 + 卡片） |
| `CaseCard` | `CaseList.tsx` (内部) | 单条判例行 |
| `CaseDetail` | `CaseDetail.tsx` | 判例详情（Panel / Page 双模式） |
| `NewCaseModal` | `NewCaseModal.tsx` | 快速录入弹窗 |
| `CaseCompare` | `CaseCompare.tsx` | 多案例对比视图 |
| `DisplayOptionsPopover` | `LinearMenus.tsx` | 视图选项弹出（分组/排序/属性） |
| `FilterMenuPopover` | `LinearMenus.tsx` | 筛选菜单弹出（含二级子菜单） |
| `IssueContextMenu` | `LinearMenus.tsx` | 右键上下文菜单 |
| `IssueSubmenu` | `LinearMenus.tsx` | 右键子菜单（状态/优先级/项目/日期/复制） |
| `LabelsSubmenu` | `LinearMenus.tsx` | 标签选择器 |

### 4.3 CaseCard 行布局

判例卡片为 5 列 Grid 行 (`case-row notion-row`)：

```
Grid: 22px  minmax(0, 1fr)  88px  74px  24px
      ├─勾选  ├─标题区      ├─状态 ├─日期 ├─删除

┌────┬──────────────────────────────────┬──────────┬──────────┬────┐
│ ☐  │ 判 CAS-A1B  ● 4H iBOS 是否成立  │ ● 已裁决 │ Jun 21   │  × │
│    │  典型 复看  正例  70% 2图 4H    │          │          │    │
│    │  4H结构正确，BOS有效确认         │          │          │    │
├────┼──────────────────────────────────┼──────────┼──────────┼────┤
│ ☐  │ 流 CAS-C2D  ● 结构反转vs流动性  │ ◐ 待验证 │ Jun 20   │  × │
│    │  误判  70%                      │          │          │    │
│    │  疑似流动性猎取，需复看          │          │          │    │
└────┴──────────────────────────────────┴──────────┴──────────┴────┘
```

**列说明**:

| 列 | 宽度 | 内容 |
|---|---|---|
| 勾选框 | 22px | hover 或 selmode 时显示 |
| 标题区 | 1fr | 类型首字母图标 + ID + 状态圆点 + 类型名 + 标签 Chips + 笔记行 |
| 状态列 | 88px | 生命周期状态点 + 文字 |
| 日期列 | 74px | 最近更新日期 |
| 删除 | 24px | hover 时显示 × 按钮 |

**标题区子元素**（可配置显隐）:

| 属性 ID | 显示内容 | 说明 |
|---|---|---|
| `id` | `CAS-A1B` 格式 | 取 UUID 前 3 位大写 |
| `status` | 状态圆点 (class `issue-state-ring`) | 按 outcome 着色 |
| `priority` | "典型" / "复看" 标签 + 结果行内 Chip | star/recheck 和 outcome chip |
| `labels` | 标签 Chips: 置信度% + 图片数 + 首标签 | `property-chip` 样式 |
| `created` / `dueDate` | 日期显示在裁决列 | — |
| `project` | 类型名 | 即 disputeType.name |

### 4.4 分组方式

| 分组 key | 分组依据 | 分组标签 |
|---|---|---|
| `status` (默认) | `derived.lifecycle` | 待验证 / 已裁决 / 已废弃 |
| `date` | `updatedAt` 相对于当前时间 | 今日 / 本周 / 本月 / 更早 |
| `result` | `derived.outcome` | 正例 / 误判 / 反例 / 模糊 / 待验证 |
| `instrument` | `disputeType.name` | 纠纷类型名 |
| `model` | `disputeType.name` | 同 instrument（判例语境下相同） |
| `none` | 不分组的 flat list | 全部 |

**分组头部行**包含: 折叠箭头 + 组名 + 数量 + 统计 Chips（正例数·绿 / 误判数·黄）

### 4.5 排序方式

| 排序 key | 排序依据 |
|---|---|
| `priority` | 优先级 urgent > high > medium > low > none |
| `created` | 创建时间倒序 |
| `updated` | 更新时间倒序 |
| `instrument` | 纠纷类型名字母序 |
| `result` | 裁决结果正例优先 |
| `manual` | 保持原始顺序 |

---

## 5. 状态管理

### 5.1 全局状态变量（App 级别）

```typescript
// === 模块 ===
module: Module                       // 'trade' | 'case'

// === 判例数据 ===
caseRecs: SyncRecord<CaseData>[]    // 从存储中加载的所有判例
caseFilter: CaseFilter              // 侧边栏过滤器状态
caseSearch: string                  // 搜索框文本
caseTagFilter: Set<string>          // 标签 Chips 选中的标签
caseDetailId: string | null         // 当前展开的判例详情 ID
caseTags: string[]                  // 可用标签列表 (预设 + 使用中 + 用户新增)
caseModalOpen: boolean              // 新建判例弹窗

// === Linear 视图选项（持久化到 localStorage） ===
linearViewMode: 'list' | 'board'   // 列表 / 看板
linearGrouping: LinearGrouping     // 分组方式
linearOrdering: LinearOrdering     // 排序方式
linearSubGrouping: string          // 子分组
displayProperties: Set<string>     // 启用的显示属性列
displaySwitches: Record<string, boolean>  // 开关项 (completed, subIssues, nested, emptyGroups)

// === 筛选 ===
linearAppliedFilters: LinearAppliedFilter[]  // 芯片式活跃筛选
linearFilterQuery: string          // 筛选菜单搜索
linearLabelQuery: string           // 标签菜单搜索

// === 浮层 ===
toolbarMenu: ToolbarMenuState | null    // 当前打开的工具栏弹出
issueMenu: IssueMenuState | null        // 当前打开的右键菜单
labelsMenuOpen: boolean                 // 标签子菜单
issueSubmenu: IssueSubmenuKind | null   // 活跃的子菜单类型

// === 其他 ===
disputeTypes: DisputeType[]        // 纠纷类型列表
compareIds: string[] | null        // 对比模式下的选中 ID
loaded: boolean                    // 首次加载完成标志
```

### 5.2 派生数据（useMemo）

| 变量 | 说明 |
|---|---|
| `liveCases` | 过滤已删除的判例 |
| `allCaseTags` | 预设标签 ∪ 实际使用的标签 |
| `caseItems` | 原始记录 → CaseListItem[]（附加 derived 推导） |
| `effectiveCaseFilter` | caseFilter + caseSearch → 完整过滤器 |
| `filteredCases` | 应用所有过滤器后的判例列表 |
| `sortedCases` | 按 linearOrdering 排序后的判例 |
| `activeLinearFilters` | 当前模块的活跃筛选 Chips |

### 5.3 视图选项持久化

```
localStorage key: "traderjournal_linear_view_options"

存储内容:
{
  mode: 'list' | 'board',
  grouping: 'status' | 'date' | 'instrument' | 'model' | 'result' | 'none',
  ordering: 'priority' | 'created' | 'updated' | 'instrument' | 'result' | 'manual',
  subGrouping: string,
  properties: string[],
  switches: { completed, subIssues, nested, emptyGroups }
}
```

启动时读取，每次变更通过 `useEffect` 自动写入。

### 5.4 标签持久化

```
localStorage key: "traderjournal_case_tags"

存储: string[]  (JSON 序列化)
预设: ['4H','1H','15m','iBOS','BOS','IDM','流动性猎取','结构反转','复杂回调','简单回调','no IDM','误判','典型案例','高价值案例']
```

当判例使用某个新标签时，自动追加到列表末尾。

### 5.5 活跃详情持久化

```
localStorage key: "traderjournal_active_detail"
存储: { module: 'case', id: string } | null
```

---


## 6. 交互流程

### 6.1 新建判例 (NewCaseModal)

```
触发: 全局快捷键 Ctrl+V (粘贴截图) | 拖入图片 | 点击 + 按钮

流程:
  1. 用户粘贴/拖入截图 → 弹窗出现
  2. 选择纠纷类型 (下拉列表)
  3. 选择初始裁决 (类型选项按钮组 + 暂不确定)
  4. 选择信心度 (30% / 50% / 70% / 90%)
  5. 按 Enter 或点击 Save → 创建判例并关闭
```

**设计原则**: 3 秒完成录入，最小化摩擦。字段全部为必填，不允许空白保存。

### 6.2 判例筛选

支持三层筛选，逐层叠加：

```
第1层: 侧边栏导航 (固定视图)
  └─ 全部 → lifecycle/outcome/star/recheck → 纠纷类型

第2层: TagBar Chips (快速切换)
  └─ 全部判例 / 待验证 / 已裁决 / 误判 + 自定义标签

第3层: FilterMenu + 芯片 (精细筛选)
  └─ Status / Outcome / Labels / Instrument / Model / Result
```

### 6.3 右键菜单 (IssueContextMenu)

```
触发: 右键点击 CaseCard

菜单结构:
┌─────────────────────────┐
│ Status              ▸  │  → IssueSubmenu (待验证/已裁决/已废弃)
│ Priority            ▸  │  → IssueSubmenu (Urgent/High/Medium/Low/None)
│ Assignee            ▸  │  (判例暂无分配人)
│ Due date            ▸  │  → IssueSubmenu (Today/Tomorrow/Week/Clear)
│ Labels              ▸  │  → LabelsSubmenu (搜索 + 选择 + 新建)
│ Project             ▸  │  → IssueSubmenu (纠纷类型列表)
├─────────────────────────┤
│ More properties...     │
├─────────────────────────┤
│ Create related...      │
│ Mark as...             │
├─────────────────────────┤
│ Copy                 ▸ │  → IssueSubmenu (Title/ID/Summary)
│ Convert to...          │
│ Open in detail         │
├─────────────────────────┤
│ Favorite               │
│ Subscribe              │
│ Remind me              │
├─────────────────────────┤
│ Delete                 │  (红色)
└─────────────────────────┘
```

### 6.4 更改判例状态 (applyIssueStatus)

| 操作 | 效果 |
|---|---|
| 设为"待验证" | 删除 `finalVerdict`，保留 `note` |
| 设为"已裁决" | 设置 `finalVerdict = initialVerdict` |
| 设为"已废弃" | 设置 `finalVerdict = '废弃'` |

### 6.5 更改优先级 (applyIssuePriority)

| 优先级 | 操作 |
|---|---|
| urgent | star=true, recheck=true |
| high | star=true, recheck=false |
| medium | star=false, recheck=true |
| low | star=false, recheck=false, 清除优先级标签 |
| none | star=false, recheck=false, 清除优先级标签 |

### 6.6 更改 Due Date (applyIssueDueDate)

通过标签机制实现（前缀 `Due:`）:

| 选项 | 添加标签 | 清除标签 |
|---|---|---|
| Today | `Due:今天` | 清除所有 `Due:` 前缀标签 |
| Tomorrow | `Due:明天` | 同上 |
| This week | `Due:本周` | 同上 |
| Clear | — | 同上 |

### 6.7 批量操作 (BatchBar)

```
触发: 勾选任意 CaseCard 的复选框

显示: 固定在底部居中的浮动栏
  [已选 N]  [对比]  [裁决▾]  [+标签]  [☆]  [废弃]  [取消]

- 对比: ≥2 个选中时激活 → CaseCompare
- 裁决: 下拉选择 (是/不是/仍无法裁决/废弃) → 批量设置 finalVerdict
- +标签: promptDialog → 批量添加标签
- ☆: 批量加星标
- 废弃: confirmDialog → 批量废弃
```

### 6.8 判例对比 (CaseCompare)

```
展示方式: 按 outcome 分列
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ 正例     │ 反例     │ 误判     │ 模糊     │ 其他     │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│ [缩略图] │ [缩略图] │ [缩略图] │          │          │
│ 是 → 是  │ 否 → 否  │ 是 → 否  │          │          │
│ 70% 4H   │ 50% 1H   │ 90% 15m │          │          │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

### 6.9 判例详情 (CaseDetail) — 双模式

**Panel 模式**（默认）:
右侧滑出面板，包含: 截图条 / 裁决区 / 字段编辑 / 标签 / 关联交易 / 历史 / 删除

**Page 模式** (Linear 风格):
全页布局 — 左侧正文编辑区 + 右侧 Inspector 属性面板
Inspector 卡片: Properties / Verdict / Labels / Flags / Relations / Danger

### 6.10 删除判例

```
软删除: rec.deletedAt = Date.now()
提示: Toast "已删除"，带撤销按钮（5 秒有效）
撤销: rec.deletedAt = null
```

---

## 7. 设计系统 & Design Tokens

### 7.1 色彩体系 (LCH 色彩空间)

**基础色**:

| Token | LCH 值 | 用途 |
|---|---|---|
| `--bg` | `lch(1.82% 0 272)` | 最深层背景 |
| `--sidebar` | `var(--bg)` | 侧边栏 = 背景色 |
| `--panel` | `lch(4.52% 0.3 272)` | 面板背景 |
| `--surface-0` | `lch(7.22% 0.75 272)` | 输入框/控件背景 |
| `--surface-2` | `lch(9.02% 2.1 272)` | 卡片/二级表面 |
| `--surface-3` | `lch(11.27% 3 272)` | 悬浮表面 |
| `--surface-raised` | `lch(13.16% 1.38 272)` | 抬起表面 |
| `--card` | `lch(9.02% 2.1 272)` | 卡片背景 |
| `--card-hover` | `lch(11.27% 3 272)` | 卡片悬停 |
| `--active` | `lch(10.82% 1.35 272)` | 激活态 |
| `--active-hover` | `lch(13% 1.5 272)` | 激活悬停 |

**文字色**:

| Token | LCH 值 | 层级 |
|---|---|---|
| `--text` | `lch(90.35% 1.15 272)` | 正文 |
| `--text-strong` | `lch(100% 0 272)` | 强调 (纯白) |
| `--muted` | `lch(61.399% 1.15 272)` | 次级 |
| `--faint` | `lch(36.308% 1.15 272)` | 弱化 |
| `--ghost` | `lch(23.536% 0.9 272)` | 极弱 |

**边框色**:

| Token | LCH 值 | 透明度 | 用途 |
|---|---|---|---|
| `--border` | `lch(13.16% 1.38 272)` | 1 | 标准边框 |
| `--border-soft` | `lch(13.16% 1.38 272)` | 0.55 | 柔和边框 |
| `--border-strong` | `lch(15.32% 1.38 272)` | 1 | 强调边框 |
| `--border-subtle` | `lch(8.84% 1.38 272)` | 1 | 极弱分割线 (Linear 对齐) |

**语义色**:

| Token | LCH 值 | 语义 |
|---|---|---|
| `--green` | `lch(68% 56 150)` | 成功/正例 |
| `--red` | `lch(62% 58 28)` | 错误/反例 |
| `--yellow` | `lch(80% 80 85)` | 警告/误判 |
| `--blue` | `lch(50% 70 267)` | 信息/待验证 |
| `--warm-yellow` | `lch(72% 42 82)` | 暖黄色/星标 |

**行级语义色** (判例专用):

| Token | 用途 |
|---|---|
| `--row-positive: lch(68% 30 150)` | 正例行色 |
| `--row-negative: lch(66% 34 28)` | 反例行色 |
| `--row-warning: lch(72% 34 82)` | 误判行色 |
| `--row-pending: lch(68% 28 272)` | 待验证行色 |

**状态对 (背景/前景)**:

| Token | 背景 | 前景 | 用于 |
|---|---|---|---|
| `--status-green-*` | `lch(38% 26 150 / .12)` | `lch(66% 27 150)` | 正例 |
| `--status-red-*` | `lch(40% 34 28 / .12)` | `lch(64% 32 28)` | 反例 |
| `--status-yellow-*` | `lch(56% 36 82 / .11)` | `lch(72% 34 82)` | 误判 |
| `--status-blue-*` | `lch(43% 28 272 / .12)` | `lch(66% 24 272)` | 待验证 |

**标签色 (session/tag)**:

| Token | LCH 背景 | LCH 前景 | 用途 |
|---|---|---|---|
| `--tag-london-*` | `lch(16% 4 264 / .45)` | `lch(68% 22 264)` | 伦敦时段 |
| `--tag-ny-*` | `lch(16% 5 54 / .42)` | `lch(70% 26 54)` | 纽约时段 |
| `--tag-asia-*` | `lch(16% 5 160 / .42)` | `lch(68% 24 160)` | 亚盘时段 |
| `--tag-tf-*` | `lch(14% 2 272 / .52)` | 混合 muted | 时间框架 |
| `--tag-signal-*` | `lch(15% 5 306 / .42)` | `lch(67% 24 306)` | 信号 |
| `--tag-user-*` | `lch(14% 4 232 / .40)` | `lch(66% 16 232)` | 用户标签 |

**Chip 控件色**:

| Token | 用途 |
|---|---|
| `--chip-on-bg: lch(12.234% .879 272)` | Chip 开启 |
| `--chip-off-bg: lch(6.449% .493 272)` | Chip 关闭 |
| `--control-bg: lch(16.091% .943 272)` | 控件背景 |
| `--control-border: lch(20.72% 1.83 272)` | 控件边框 |
| `--segment-on-bg: lch(17.634% 1.329 272)` | 分段控件激活 |

**Popover 色**:

| Token | 用途 |
|---|---|
| `--popover-bg: lch(9.92% .75 272)` | Popover 背景 |
| `--popover-border: lch(18.56% 1.83 272)` | Popover 边框 |
| `--popover-text: lch(90.895% 1.375 272)` | Popover 正文 |
| `--popover-muted: lch(63.582% 1.375 272)` | Popover 次级 |
| `--popover-faint: lch(46% 1.25 272)` | Popover 弱化 |
| `--popover-hover: lch(15.32% 1.38 272 / .56)` | Popover 悬停 |

**阴影**:

| Token | 用途 |
|---|---|
| `--shadow-card` | 卡片悬停阴影 |
| `--shadow-popover` | Popover 浅阴影 (3 层) |
| `--shadow-popover-deep` | Popover 深阴影 (5 层) |
| `--shadow-fab` | FAB 按钮阴影 |
| `--focus-ring` | 聚焦环 (蓝紫色外发光) |
| `--focus-ring-soft` | 柔和聚焦环 |
| `--focus-ring-inset` | 内嵌聚焦环 |

### 7.2 排版

| Token | 值 | 用途 |
|---|---|---|
| `--font-sans` | Inter Variable, SF Pro, Segoe UI, PingFang SC, Microsoft YaHei | 无衬线字体栈 |
| `--font-mono` | JetBrains Mono, SF Mono, Cascadia Code | 等宽字体 |
| `--font-weight-normal` | 450 | Linear 标准字重 |
| `--font-size-regular` | .9375rem (15px) | 正文字号 |
| `--font-size-13` | 13px | 小号文本 |
| `--font-size-11` | 11px | 极小文本 |

### 7.3 圆角

| Token | 值 | 用途 |
|---|---|---|
| `--radius` | 8px | 通用 |
| `--radius-sm` | 6px | 小元素 (chip/输入框) |
| `--radius-xs` | 4px | 极小 (kbd 标签) |
| `--radius-md` | 12px | 卡片/面板 |
| `--radius-lg` | 16px | 大号 |
| `--radius-full` | 9999px | 药丸形 |

### 7.4 动效

| Token | 用途 |
|---|---|
| `--transition-fast: 80ms` | 即时反馈 (hover / focus) |
| `--speed-quickTransition: 60ms` | Linear 快过渡 |
| `--speed-highlightFadeOut: 300ms` | 高亮淡出 |
| `--speed-highlightFadeIn: 160ms` | 高亮淡入 |
| `--speed-regularTransition: 80ms` | 常规过渡 |
| `--ease-standard` | 标准缓动函数 |

---

## 8. CSS 类名体系

### 8.1 判例行 (`case-row`)

```
.case-row, .trade-row (grid 基类)
  ├── .notion-row (共享 hover 行为)
  │   └── &:hover → lch(8.9% .65 272 / .44)
  ├── .case-row.selected (选中态 — indigo 光晕)
  ├── .case-check (18px 复选框，hover/body.selmode 时显示)
  ├── .row-symbol (类型首字母块 17px)
  │   ├── .is-positive (绿底)
  │   ├── .is-negative (红底)
  │   ├── .is-misjudge (黄底)
  │   ├── .is-vague (灰底)
  │   └── .is-pending (蓝底)
  ├── .case-title-copy (标题区 flex 列)
  │   ├── .database-title-line (标题行 flex 行)
  │   │   ├── .case-id (CAS-XXX ID)
  │   │   ├── .issue-state-ring (状态圆点 16px)
  │   │   ├── .row-title (类型名)
  │   │   ├── .case-flag.is-star (典型标签)
  │   │   ├── .case-flag.is-recheck (复看标签)
  │   │   ├── .property-chip.case-outcome-inline (结果行内 Chip)
  │   │   └── .case-tags-cell (标签区)
  │   │       ├── .property-chip.t-tf (置信度%)
  │   │       ├── .property-chip.is-ghost (图片数)
  │   │       └── .property-chip.t-user (标签)
  │   └── .database-note-line (笔记行)
  ├── .notion-status (状态列)
  │   ├── .status-dot (6px 着色圆点)
  │   └── 生命周期文字
  ├── .case-verdict-cell (日期列)
  │   └── .row-meta (日期)
  └── .row-action (删除按钮 ×, hover 显示)
```

### 8.2 分组行

```
.list-group-row.database-group-row.case-group-row (sticky)
  ├── .group-title
  │   ├── .group-caret (折叠箭头)
  │   └── 组名 + 数量
  ├── .group-summary
  │   ├── .summary-chip.is-green (正例计数)
  │   └── .summary-chip.is-yellow (误判计数)
  └── .group-add (+ 按钮)
```

### 8.3 Property Chips 通用样式

```
.property-chip (通用 Chip，高 20px，药丸形)
  ├── .is-positive (绿)
  ├── .is-negative (红)
  ├── .is-misjudge (黄)
  ├── .is-pending (蓝)
  ├── .is-vague (灰)
  ├── .is-ghost (透明虚边)
  ├── .t-tf (时间框架)
  ├── .t-user (用户标签)
  └── .t-signal (信号标签)
```

### 8.4 视图容器

```
.linear-viewbar (视图工具栏)
  ├── .view-tabbar-group (按钮组)
  ├── .view-tabbar-labels (标签 Chips)
  ├── .view-tabbar-spacer (弹性间距)
  └── .view-toolbar
      └── .view-toolbar-btn (圆形工具栏按钮)

.linear-filter-chips (活跃筛选 Chip 条)
  └── .linear-filter-chip (单个筛选 Chip)

.list-stack (列表容器)
  └── .linear-list-group (单个分组)
```

### 8.5 批量操作

```
.batchbar (固定底部居中，毛玻璃效果)
  .batch-actions (按钮组)
```

### 8.6 详情面板

```
.detail-panel (右侧滑出面板)
  ├── .detail-header
  ├── .detail-body
  │   ├── .image-strip (截图条)
  │   ├── .verdict-section (裁决区)
  │   ├── .field-row (字段行)
  │   ├── .detail-chip (Chip 按钮)
  │   └── .detail-input (输入框)
  └── .detail-footer

.linear-issue-layout (Page 模式全页布局)
  ├── .issue-main (正文编辑区)
  └── .issue-inspector (右侧属性面板)
```

### 8.7 过渡与动效类

所有交互元素统一使用标准缓动 + 语义化时长 Token：

- hover/active 过渡: `var(--transition-fast)` 或 `var(--speed-quickTransition)`
- 缓动函数: `var(--ease-standard)`
- 高亮淡出: `var(--speed-highlightFadeOut)`
- 高亮淡入: `var(--speed-highlightFadeIn)`

---

## 9. 存储 & 持久化

### 9.1 存储架构

```
┌──────────────────────────────────────┐
│           App Layer                  │
├──────────────────────────────────────┤
│  RecordStore<CaseData>               │
│  ├── TauriFsStore (桌面端 — 文件系统) │
│  └── IdbStore    (浏览器 — IndexedDB)│
├──────────────────────────────────────┤
│  ImageStore                          │
│  └── IdbImageStore (IndexedDB)       │
├──────────────────────────────────────┤
│  DisputeTypeStore                    │
│  └── IdbDisputeTypeStore (IndexedDB) │
│      └── 初始化: 9 个 BUILTIN_TYPES  │
└──────────────────────────────────────┘
```

### 9.2 localForage / localStorage 键值表

| Key | 类型 | 内容 |
|---|---|---|
| `traderjournal_case_tags` | `string[]` (JSON) | 判例标签列表 |
| `traderjournal_linear_view_options` | `LinearViewOptionsState` (JSON) | 视图选项 |
| `traderjournal_active_detail` | `{ module, id } \| null` (JSON) | 当前打开的详情 |
| `traderjournal_default_module` | `'trade' \| 'case'` | 默认模块（无活跃详情时） |
| `traderjournal_workspace_appearance` | `WorkspaceAppearance` (JSON) | 工作区外观设置 |

### 9.3 记录存储 API (RecordStore)

```typescript
{
  put(module: Module, rec: SyncRecord<CaseData>): Promise<void>    // 保存/更新
  list(module: Module): Promise<SyncRecord<CaseData>[]>            // 列出全部
  del(module: Module, id: string): Promise<void>                   // 软删除 (设置 deletedAt)
  get(module: Module, id: string): Promise<SyncRecord<CaseData> | undefined>  // 单条查询
}
```

**软删除**: `deletedAt` 设为当前时间戳，数据保留。列表查询自动过滤 `deletedAt != null`。

### 9.4 字段级时钟 (乐观更新 + 冲突解决)

每个字段有独立的 `fieldClock` (Millis 时间戳):

```typescript
function touch<D>(rec, field, value, at, source):
  1. 检查 fieldClock(field) <= at （通过）
  2. 设置 data[field] = value
  3. 设置 fieldClock[field] = at
  4. 附加 history entry
```

这允许在详情面板中乐观更新字段，同时通过比较时钟值来安全合并多端同步的写入。

### 9.5 图片存储

- **存储**: IndexedDB (`IdbImageStore`)
- **格式**: 原始二进制 blob
- **引用**: `CaseImage.fileId` → `ImageStore.get(fileId)`
- **关联**: 通过 `CaseData.images` 数组关联

---

## 10. 完整文件清单

### 10.1 核心类型 & 逻辑 (`core/src/`)

| 文件 | 内容 |
|---|---|
| `case.ts` | CaseData, DisputeType, DerivedCase, CaseImage, CaseComment, CaseLifecycle, CaseOutcome |
| `case-derive.ts` | deriveCaseLifecycle(), deriveCaseOutcome(), deriveCase() |
| `case-validate.ts` | validateCase() — 字段级校验，返回 ValidationIssue[] |
| `record.ts` | SyncRecord<D> 通用记录信封 |
| `case-derive.test.ts` | 推导逻辑的单元测试 |

### 10.2 UI 组件 (`app/src/`)

| 文件 | 内容 |
|---|---|
| `App.tsx` | 全局状态、所有 handler、模块切换、筛选/分组/排序逻辑 (~1600 行) |
| `CaseList.tsx` | CaseList + CaseCard + CaseFilter 类型 + groupCaseRows + 批量操作栏 |
| `CaseDetail.tsx` | 判例详情 (Panel / Page 双模式) |
| `NewCaseModal.tsx` | 快速录入弹窗 |
| `CaseCompare.tsx` | 多案例对比视图 |
| `LinearMenus.tsx` | DisplayOptionsPopover + FilterMenuPopover + IssueContextMenu + IssueSubmenu + LabelsSubmenu |

### 10.3 样式 & 设计 (`app/src/`)

| 文件 | 内容 |
|---|---|
| `tokens.css` | 全部 Design Token (~195 行) |
| `styles.css` | 全局样式 + 判例专用样式 |
| `theme.ts` | JS 颜色常量 C + OTAG 映射 |

### 10.4 存储 (`app/src/storage/`)

| 文件 | 内容 |
|---|---|
| `select.ts` | 存储后端选择 (Tauri vs IndexedDB) |
| `disputeTypes.ts` | 纠纷类型持久化 + 9 内置类型初始化 |
| `modelPresets.ts` | 入场模型预设 |
| `*.ts` | 其他存储适配器 |

---

## 附录 A: 判例标签预设

```
4H, 1H, 15m, iBOS, BOS, IDM, 流动性猎取, 结构反转,
复杂回调, 简单回调, no IDM, 误判, 典型案例, 高价值案例
```

## 附录 B: Linear 视图选项默认值

```json
{
  "mode": "list",
  "grouping": "status",
  "ordering": "priority",
  "subGrouping": "none",
  "properties": ["id", "status", "assignee", "priority", "project", "dueDate", "labels", "created"],
  "switches": {
    "completed": false,
    "subIssues": true,
    "nested": false,
    "emptyGroups": false
  }
}
```

## 附录 C: 快捷键

| 快捷键 | 操作 |
|---|---|
| `Ctrl+V` | 粘贴截图 → 打开 NewCaseModal |
| `Ctrl+K` | 聚焦搜索框 |
| `Esc` | 关闭弹窗/浮层/详情 |
| `Enter` | 确认/保存 |
