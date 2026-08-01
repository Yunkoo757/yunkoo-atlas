# 案例来源正文持续同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 案例持续展示来源交易最近一次成功保存的复盘正文，同时保证案例沉淀正文独立、可编辑且永不被覆盖。

**Architecture:** `Trade.sourceNoteHtml` 保存案例侧的来源正文快照，store 提供唯一案例创建动作并在来源 `updateNote` 事务内级联快照。详情页创建前冲洗草稿，案例详情将只读来源复盘与可编辑案例沉淀分区；统一富文本字段枚举确保 codec、导入导出、归档和附件清理都识别来源快照。

**Tech Stack:** React 18、TypeScript 5.6、Zustand 4、TipTap、IndexedDB/Electron storage adapters、Vite 8、自定义单元与 Playwright 浏览器回归。

## Global Constraints

- 同步固定为来源交易 → 关联案例的持续单向同步，案例不得反向写回来源。
- `sourceNoteHtml?: string` 只保存最近一次成功归一化并写入 store 的来源正文。
- 案例自己的 `note` 始终独立，来源同步不得修改案例 note、标签、掌握状态、评论、活动记录或更新时间语义。
- 新建案例前必须成功执行 `flushNoteDraftToStore(sourceId)`；失败时不创建、不跳转并保留草稿。
- 所有列表、看板和详情入口必须调用同一个 `createReviewCaseFromTrade(sourceId)` store 动作。
- 软删除案例继续接收来源快照；来源删除或彻底清理后保留案例最后快照。
- 历史案例不得被启发式拆分、清空或重写；缺少快照时优先读取仍存在的来源正文。
- `note` 与 `sourceNoteHtml` 中的附件都必须参与校验、重编号、导出、盘点、清理保护和恢复。
- 所有新增和修改文件保持 UTF-8 无 BOM，并完整保留简体中文。

---

## File Map

- Modify: `src/data/trades.ts:69-115` — 增加可选 `sourceNoteHtml` 字段。
- Modify: `src/lib/reviewCases.ts` — 新案例写来源快照，案例沉淀正文置空。
- Create: `src/lib/reviewCases.test.ts` — 锁定构造器不覆盖案例正文的领域合同。
- Modify: `src/store/useStore.ts:296-430,1013-1029,1204-1209` — 增加统一创建动作和来源正文原子级联。
- Create: `src/store/reviewCaseSourceSync.test.ts` — 覆盖创建结果、级联隔离、软删除和来源删除。
- Create: `src/storage/tradeRichText.ts` — 统一枚举/转换每笔交易的 `note` 与 `sourceNoteHtml`。
- Create: `src/storage/tradeRichText.test.ts` — 保证缺失可选字段不被伪造、两个字段都被转换。
- Modify: `src/storage/snapshotValidation.ts:189-227` — 接受可选字符串并拒绝错误类型。
- Modify: `src/storage/snapshotCodec.test.ts`、`src/storage/snapshotValidation.test.ts` — 锁定旧库兼容和新字段保留。
- Modify: `src/storage/assets.ts:213-227`、`src/storage/assetInventory.ts:12-27`、`src/storage/indexedDbAdapter.ts:81-107` — 把来源快照计入引用集合和盘点。
- Modify: `src/storage/migrate.ts:54-76` — 外置两个交易富文本字段中的内嵌图片。
- Modify: `src/lib/importExport.ts:423-434,755-766,878-934` — 校验并重编号两个交易富文本字段。
- Modify: `src/lib/webJournalArchive.ts:601-650` — Web 归档闭包校验扫描来源快照。
- Modify: `src/storage/assets.test.ts`、`src/storage/assetInventory.test.ts`、`src/lib/importExportAssets.test.ts` — 覆盖来源快照附件生命周期。
- Modify: `src/storage/assets.browser.test.html`、`src/storage/IndexedDbAssetGc.browser.test.ts`、`src/lib/webJournalArchive.test.ts` — 覆盖 data URL 外置、协作式引用扫描和 Web 归档闭包。
- Modify: `src/views/ListView.tsx:12,270-278`、`src/views/BoardView.tsx:30,197-205` — 移除重复构造逻辑，调用 store 动作。
- Modify: `src/views/DetailView.tsx:76-84,239-283,497-506,531-533,752-875` — 创建前冲洗草稿，渲染只读来源复盘和可编辑案例沉淀。
- Modify: `src/views/DetailView.css:344-384` — 增加双正文层级和来源只读状态样式。
- Create: `src/views/ReviewCaseSourceSync.browser.test.tsx`
- Create: `src/views/ReviewCaseSourceSync.browser.test.html` — 覆盖立即提炼、失败不创建、后续同步和来源删除快照。

### Task 1: 领域模型与案例构造合同

**Files:**
- Modify: `src/data/trades.ts:90-95`
- Modify: `src/lib/reviewCases.ts:22-63`
- Create: `src/lib/reviewCases.test.ts`

**Interfaces:**
- Consumes: 现有 `Trade` 与 `buildReviewCaseFromTrade(source, options)`。
- Produces: `Trade.sourceNoteHtml?: string`；构造器保证 `sourceNoteHtml === source.note` 且 `note === ''`。

- [ ] **Step 1: 写案例双正文失败测试**

```ts
import type { Trade } from '@/data/trades'
import { buildReviewCaseFromTrade } from '@/lib/reviewCases'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const source = {
  id: 'source-1', ref: 'TRD-1', symbol: 'BTCUSDT', side: 'long', status: 'win',
  conviction: 'medium', strategyId: 'strategy', tags: [], mistakeTags: [],
  reviewStatus: 'reviewed', reviewCategory: 'normal', tradeKind: 'live',
  entry: 100, exit: 110, size: 1, pnl: 10, rMultiple: 1, resultSource: 'imported',
  openedAt: '2026-07-31', closedAt: '2026-07-31', note: '<p>最新来源复盘</p>',
} satisfies Trade

export function testReviewCaseStartsWithSourceSnapshotAndEmptyCaseNote(): void {
  const reviewCase = buildReviewCaseFromTrade(source, { id: 'case-1', ref: 'CAS-1' })
  assert(reviewCase.sourceNoteHtml === source.note, '案例必须保存来源快照')
  assert(reviewCase.note === '', '案例沉淀正文必须独立且初始为空')
  assert(reviewCase.sourceTradeId === source.id, '案例必须保持来源关联')
  assert(!reviewCase.note.includes('来源交易：'), '系统来源行不得混入案例沉淀正文')
}
```

- [ ] **Step 2: 运行测试并确认红灯**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/reviewCases.test.ts`

Expected: FAIL，提示 `sourceNoteHtml` 缺失或案例 `note` 仍包含来源副本。

- [ ] **Step 3: 增加字段并修改构造器**

在 `Trade` 的 `sourceTradeId` 后加入：

```ts
/** 关联来源交易最近一次成功保存的正文快照；仅案例记录使用。 */
sourceNoteHtml?: string
```

删除 `sourceLine`、`escapeHtml` 和拼接 note 的逻辑，构造返回值明确覆盖：

```ts
sourceTradeId: source.id,
sourceNoteHtml: source.note,
note: '',
comments: [],
activities: [],
```

- [ ] **Step 4: 重跑领域测试和类型检查**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/reviewCases.test.ts`

Expected: PASS。

Run: `pnpm typecheck`

Expected: PASS。

- [ ] **Step 5: 提交领域模型**

```powershell
git add -- src/data/trades.ts src/lib/reviewCases.ts src/lib/reviewCases.test.ts
git commit -m "feat: separate case source and insight notes"
```

### Task 2: Store 唯一创建动作与原子级联

**Files:**
- Modify: `src/store/useStore.ts:296-430,1013-1029,1204-1209`
- Create: `src/store/reviewCaseSourceSync.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `buildReviewCaseFromTrade`、`getNextReviewCaseRef`、`Trade.sourceNoteHtml`。
- Produces:
  - `type CreateReviewCaseResult = { status: 'created'; reviewCase: Trade } | { status: 'missing-source' | 'source-is-case' }`
  - `State.createReviewCaseFromTrade(sourceId: string): CreateReviewCaseResult`
  - `updateNote` 的来源级联语义。

- [ ] **Step 1: 写 store 创建和同步失败测试**

测试文件先定义确定性的 fixture 与 store 隔离器：

```ts
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function trade(id: string, overrides: Partial<Trade> = {}): Trade {
  return {
    id, ref: `TRD-${id}`, symbol: 'BTCUSDT', side: 'long', status: 'win',
    conviction: 'medium', strategyId: 'strategy', tags: [], mistakeTags: [],
    reviewStatus: 'reviewed', reviewCategory: 'normal', tradeKind: 'live',
    entry: 100, exit: 110, size: 1, pnl: 10, rMultiple: 1, resultSource: 'imported',
    openedAt: '2026-07-31', closedAt: '2026-07-31', note: '', ...overrides,
  }
}

function withTrades(initial: Trade[], run: () => void): void {
  const previous = useStore.getState()
  try {
    useStore.setState({ trades: initial, undoStack: [], redoStack: [] })
    run()
  } finally {
    useStore.setState(previous)
  }
}
```

随后精确导出以下四个场景：

```ts
export function testStoreCreatesCaseFromCurrentSourceState(): void {
  withTrades([trade('source', { note: '<p>store 最新正文</p>' })], () => {
    const result = useStore.getState().createReviewCaseFromTrade('source')
    assert(result.status === 'created', '来源存在时必须创建案例')
    if (result.status !== 'created') return
    assert(result.reviewCase.sourceNoteHtml === '<p>store 最新正文</p>', '必须读取动作执行瞬间的 state')
    assert(result.reviewCase.note === '', '案例沉淀正文必须为空')
  })
}

export function testSourceNoteCascadesWithoutTouchingCaseOwnedFields(): void {
  const source = trade('source')
  const reviewCase = trade('case', {
    tradeKind: 'case', sourceTradeId: source.id, sourceNoteHtml: '<p>旧来源</p>',
    note: '<p>案例结论</p>', deletedAt: '2026-08-01T00:00:00.000Z',
    masteryState: 'recheck', activities: [{ id: 'a1', kind: 'note', timestamp: '2026-07-31' }],
  })
  withTrades([source, reviewCase], () => {
    useStore.getState().updateNote(source.id, '<p>新来源</p>')
    const updated = useStore.getState().trades.find((item) => item.id === reviewCase.id)!
    assert(updated.sourceNoteHtml === '<p>新来源</p>', '软删除案例也必须同步')
    assert(updated.note === reviewCase.note, '来源同步不得覆盖案例正文')
    assert(updated.masteryState === reviewCase.masteryState, '来源同步不得改掌握状态')
    assert(updated.activities === reviewCase.activities, '来源同步不得创建案例活动')
  })
}

export function testCaseNoteNeverWritesBackOrCascades(): void {
  const source = trade('source', { note: '<p>来源</p>' })
  const first = trade('case-1', {
    tradeKind: 'case', sourceTradeId: source.id, sourceNoteHtml: source.note, note: '<p>旧结论</p>',
  })
  const second = trade('case-2', {
    tradeKind: 'case', sourceTradeId: source.id, sourceNoteHtml: source.note, note: '<p>第二个案例</p>',
  })
  withTrades([source, first, second], () => {
    useStore.getState().updateNote(first.id, '<p>新案例结论</p>')
    const state = useStore.getState()
    assert(state.trades.find((item) => item.id === source.id)?.note === source.note, '案例不得反写来源')
    assert(state.trades.find((item) => item.id === second.id)?.sourceNoteHtml === source.note, '案例不得级联其他案例')
    assert(state.trades.find((item) => item.id === first.id)?.note === '<p>新案例结论</p>', '案例必须保存自己的正文')
  })
}

export function testCreateCaseReturnsExplicitFailures(): void {
  const existingCase = trade('case', { tradeKind: 'case', sourceTradeId: 'source' })
  withTrades([existingCase], () => {
    const beforeMissing = useStore.getState().trades
    assert(useStore.getState().createReviewCaseFromTrade('missing').status === 'missing-source', '缺失来源结果错误')
    assert(useStore.getState().trades === beforeMissing, '缺失来源必须保持 trades 引用')
    const beforeCase = useStore.getState().trades
    assert(useStore.getState().createReviewCaseFromTrade(existingCase.id).status === 'source-is-case', '案例来源结果错误')
    assert(useStore.getState().trades === beforeCase, '案例再次提炼必须保持 trades 引用')
  })
}
```

- [ ] **Step 2: 运行 store 测试并确认红灯**

Run: `node scripts/run-regression-tests.mjs --unit-only src/store/reviewCaseSourceSync.test.ts`

Expected: FAIL，提示 `createReviewCaseFromTrade is not a function`，随后会暴露级联断言失败。

- [ ] **Step 3: 实现唯一创建动作**

在 `State` 之前导出结果类型，并在 `State` 增加动作签名。实现必须在单次 `set` 中读取来源并通过现有 `upsertTradeIntoSlice` 写入：

```ts
createReviewCaseFromTrade: (sourceId) => {
  let result: CreateReviewCaseResult = { status: 'missing-source' }
  set((state) => {
    const source = state.trades.find((trade) => trade.id === sourceId)
    if (!source) return state
    if (source.tradeKind === 'case') {
      result = { status: 'source-is-case' }
      return state
    }
    const reviewCase = buildReviewCaseFromTrade(source, {
      id: crypto.randomUUID(),
      ref: getNextReviewCaseRef(state.trades),
    })
    result = { status: 'created', reviewCase }
    return upsertTradeIntoSlice(state, reviewCase, state.display.tradingDayStartHour)
  })
  return result
},
```

- [ ] **Step 4: 在同一 store 事务实现来源 note 级联**

保留来源交易现有 note 活动合并规则，先取得 `source = s.trades.find(...)`，再一次 map：

```ts
const cascadesToCases = source !== undefined && source.tradeKind !== 'case'
return {
  trades: s.trades.map((trade) => {
    if (trade.id === id) return updateOwnedNoteActivity(trade, note)
    if (
      cascadesToCases &&
      trade.tradeKind === 'case' &&
      trade.sourceTradeId === id &&
      trade.sourceNoteHtml !== note
    ) return { ...trade, sourceNoteHtml: note }
    return trade
  }),
}
```

将现有 1013-1027 行的活动实现提取成文件内私有 helper：

```ts
function updateOwnedNoteActivity(trade: Trade, note: string): Trade {
  if (trade.note === note) return trade
  const now = new Date().toISOString()
  const activities = [...(trade.activities ?? [])]
  const last = activities[activities.length - 1]
  if (last?.kind === 'note') {
    activities[activities.length - 1] = { ...last, timestamp: now }
    return { ...trade, note, activities }
  }
  return appendActivity({ ...trade, note }, { kind: 'note', timestamp: now })
}
```

级联分支不得检查 `deletedAt`，从而覆盖可恢复案例；`source` 不存在时保持整个 `trades` 数组内容不变。

- [ ] **Step 5: 重跑 store 测试及相邻 guard**

Run: `node scripts/run-regression-tests.mjs --unit-only src/store/reviewCaseSourceSync.test.ts src/store/tradeKindGuard.test.ts src/storage/noteDrafts.test.ts`

Expected: 全部 PASS。

- [ ] **Step 6: 提交 store 原子语义**

```powershell
git add -- src/store/useStore.ts src/store/reviewCaseSourceSync.test.ts
git commit -m "feat: synchronize source notes into review cases"
```

### Task 3: Snapshot 合同与历史兼容

**Files:**
- Modify: `src/storage/snapshotValidation.ts:189-227`
- Modify: `src/storage/snapshotValidation.test.ts`
- Modify: `src/storage/snapshotCodec.test.ts`

**Interfaces:**
- Consumes: Task 1 的可选 `Trade.sourceNoteHtml`。
- Produces: 旧 snapshot 缺字段时直接通过；新 snapshot 保留字符串；非字符串明确拒绝。

- [ ] **Step 1: 写 validation 与 codec 失败测试**

在 validation 测试中增加：

```ts
const legacyCase = { ...validTrade, tradeKind: 'case', sourceTradeId: 'source', note: '<p>历史混合正文</p>' }
assert(isValidPersistedTrade(legacyCase), '历史案例缺少 sourceNoteHtml 必须继续有效')
assert(isValidPersistedTrade({ ...legacyCase, sourceNoteHtml: '<p>来源快照</p>' }), '字符串快照必须有效')
assert(!isValidPersistedTrade({ ...legacyCase, sourceNoteHtml: 42 }), '非字符串快照必须拒绝')
```

在 codec 测试中把 case 放进完整 snapshot，JSON 往返后断言 `sourceNoteHtml` 逐字保留，且旧版本 case 不被补写空字段、不改写 `note`。

- [ ] **Step 2: 运行两个测试并确认红灯**

Run: `node scripts/run-regression-tests.mjs --unit-only src/storage/snapshotValidation.test.ts src/storage/snapshotCodec.test.ts`

Expected: validation 对数字字段错误放行，或 codec 合同断言失败。

- [ ] **Step 3: 扩展共享 Trade 验证**

把 `sourceNoteHtml` 加入可选字符串字段循环：

```ts
for (const field of [
  'session', 'timeframe', 'narrative', 'psychology', 'recordedAt',
  'sourceTradeId', 'sourceNoteHtml', 'deletedAt', 'deletedBy',
]) {
  if (value[field] !== undefined && typeof value[field] !== 'string') return false
}
```

不要提升 schema version，不给缺失字段写默认值；当前 codec 已用对象展开保留已验证字段。

- [ ] **Step 4: 重跑 codec、validation 和导入共享验证**

Run: `node scripts/run-regression-tests.mjs --unit-only src/storage/snapshotValidation.test.ts src/storage/snapshotCodec.test.ts src/lib/importExportAssets.test.ts`

Expected: 全部 PASS，历史案例 note 保持原值。

- [ ] **Step 5: 提交 snapshot 合同**

```powershell
git add -- src/storage/snapshotValidation.ts src/storage/snapshotValidation.test.ts src/storage/snapshotCodec.test.ts
git commit -m "test: preserve review case source snapshots"
```

### Task 4: 来源快照附件生命周期

**Files:**
- Create: `src/storage/tradeRichText.ts`
- Create: `src/storage/tradeRichText.test.ts`
- Modify: `src/storage/assets.ts:213-227`
- Modify: `src/storage/assetInventory.ts:12-27`
- Modify: `src/storage/indexedDbAdapter.ts:81-107`
- Modify: `src/storage/migrate.ts:54-76`
- Modify: `src/lib/importExport.ts:423-434,755-766,878-934`
- Modify: `src/lib/webJournalArchive.ts:601-650`
- Modify: `src/storage/assets.test.ts`
- Modify: `src/storage/assets.browser.test.html`
- Modify: `src/storage/assetInventory.test.ts`
- Modify: `src/storage/IndexedDbAssetGc.browser.test.ts`
- Modify: `src/lib/importExportAssets.test.ts`
- Modify: `src/lib/webJournalArchive.test.ts`

**Interfaces:**
- Consumes: Task 1/3 的已验证 Trade 富文本字段。
- Produces:
  - `tradeRichTextEntries(trade): string[]`
  - `mapTradeRichText<T extends TradeRichTextCarrier>(trade: T, transform: (html: string) => string): T`
  - 所有附件路径统一扫描两个字段。

- [ ] **Step 1: 写统一富文本枚举失败测试**

```ts
import { mapTradeRichText, tradeRichTextEntries } from '@/storage/tradeRichText'

export function testTradeRichTextEntriesIncludesOptionalSourceSnapshot(): void {
  assert(tradeRichTextEntries({ note: 'case', sourceNoteHtml: 'source' }).join('|') === 'case|source', '必须枚举两个字段')
  assert(tradeRichTextEntries({ note: 'legacy' }).join('|') === 'legacy', '旧记录不得伪造空来源字段')
}

export function testMapTradeRichTextTransformsOnlyExistingFields(): void {
  const mapped = mapTradeRichText({ note: 'a', sourceNoteHtml: 'b' }, (html) => `x:${html}`)
  assert(mapped.note === 'x:a' && mapped.sourceNoteHtml === 'x:b', '两个字段都必须转换')
  const legacy = mapTradeRichText({ note: 'a' }, (html) => `x:${html}`)
  assert(!('sourceNoteHtml' in legacy), '旧记录不能新增空字段')
}
```

- [ ] **Step 2: 写附件闭包、盘点和重编号失败测试**

在 `tradeRichText.test.ts` 用完整 snapshot 验证引用收集：

```ts
const snapshot = createFullPersistedSnapshotFixture()
const source = snapshot.trades[0]!
snapshot.trades.push({
  ...source,
  id: 'case-source-only',
  ref: 'CAS-SOURCE',
  tradeKind: 'case',
  sourceTradeId: source.id,
  note: '',
  sourceNoteHtml: '<img src="journal-asset://source-only">',
})
assert(collectAssetIdsFromSnapshot(snapshot).includes('source-only'), '来源快照附件必须进入引用集合')
```

在 `assetInventory.test.ts` 复用本文件 `record()`，验证来源附件仍属于 trade domain：

```ts
const snapshot = createFullPersistedSnapshotFixture()
const source = snapshot.trades[0]!
snapshot.trades.push({
  ...source, id: 'case-source-only', ref: 'CAS-SOURCE', tradeKind: 'case',
  sourceTradeId: source.id, note: '', sourceNoteHtml: '<img src="journal-asset://source-only">',
})
const inventory = buildAssetInventory(snapshot, [record('source-only', 'healthy')])
const reference = inventory.referenced.find((item) => item.id === 'source-only')
assert(reference?.domains.join(',') === 'trade', '来源快照必须沿用 trade 富文本域')
assert(!inventory.orphan.some((item) => item.id === 'source-only'), '来源快照附件不得成为 orphan')
```

在 `importExportAssets.test.ts` 复用现有 `trade`、`strategy` 和 `DEFAULT_DISPLAY`：

```ts
const prepared = prepareImportPayloadForCommit({
  version: 3,
  weeklyRiskPreparations: [], riskPolicyVersions: [], monthlyRiskLimits: [], riskOverrideEvents: [],
  trades: [{
    ...trade,
    tradeKind: 'case',
    sourceTradeId: 'source',
    note: '<img src="journal-asset://shared-source">',
    sourceNoteHtml: '<img src="journal-asset://shared-source">',
  }],
  strategies: [strategy], starredIds: [], subscribedIds: [], pinnedStrategyIds: [],
  display: DEFAULT_DISPLAY,
  assets: [{ id: 'shared-source', mime: 'image/png', data: 'aW1hZ2U=' }],
}, () => 'renumbered-source')
assert(prepared.payload.trades[0]?.note.includes('journal-asset://renumbered-source'), '案例正文附件未重编号')
assert(prepared.payload.trades[0]?.sourceNoteHtml?.includes('journal-asset://renumbered-source'), '来源快照附件未重编号')
assert(prepared.assets.length === 1, '共享附件只能生成一个新 ID')
```

在 `webJournalArchive.test.ts` 增加成功与缺失附件闭包：

```ts
export async function testWebArchiveValidatesCaseSourceSnapshotAssets(): Promise<void> {
  const snapshot = createFullPersistedSnapshotFixture()
  const source = snapshot.trades[0]!
  snapshot.trades.push({
    ...source, id: 'case-source', ref: 'CAS-SOURCE', tradeKind: 'case', sourceTradeId: source.id,
    note: '', sourceNoteHtml: '<img src="journal-asset://source-only">',
  })
  const records = [
    ...Object.values(FULL_SNAPSHOT_ASSET_IDS).map((id) => ({ id, mime: 'image/png', data: 'aW1hZ2U=' })),
    { id: 'source-only', mime: 'image/png', data: 'aW1hZ2U=' },
  ]
  const parsed = await parseWebJournalArchive(buildWebJournalArchiveBlob(snapshot, records))
  assert(parsed.snapshot.trades.some((item) => item.sourceNoteHtml?.includes('source-only')), '归档未保留来源附件')
  let rejected = false
  try {
    await parseWebJournalArchive(buildWebJournalArchiveBlob(snapshot, records.slice(0, -1)))
  } catch {
    rejected = true
  }
  assert(rejected, '来源快照附件缺失时必须拒绝归档')
}
```

在 `assets.test.ts` 增加并从 `assets.browser.test.html` import/await：

```ts
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import { externalizeSnapshotNotes } from '@/storage/migrate'

export async function testSourceSnapshotDataImagesAreExternalized(): Promise<void> {
  const snapshot = createFullPersistedSnapshotFixture()
  const source = snapshot.trades[0]!
  snapshot.trades.push({
    ...source, id: 'case-inline-source', ref: 'CAS-INLINE', tradeKind: 'case',
    sourceTradeId: source.id, note: '', sourceNoteHtml: '<img src="data:image/png;base64,QQ==">',
  })
  const externalized = await externalizeSnapshotNotes(snapshot, missingAssetAdapter)
  const html = externalized.trades.find((item) => item.id === 'case-inline-source')?.sourceNoteHtml ?? ''
  assert(html.includes('journal-asset://asset-1'), '来源快照 data URL 必须外置')
  assert(!html.includes('data:image'), '来源快照不得残留内嵌图片')
}
```

在 `IndexedDbAssetGc.browser.test.ts` 增加并从 `run()` await：

```ts
async function testSourceSnapshotAssetIsNotAnOrphan(): Promise<void> {
  const databaseName = `asset-gc-case-source-${crypto.randomUUID()}`
  const storage = new IndexedDbStorageAdapter(databaseName, { assetPurgeCommitEnabled: true })
  await storage.open()
  try {
    const sourceOnlyId = await storage.saveAsset(new Blob(['source-only']), 'image/png')
    const next = createFullPersistedSnapshotFixture()
    const source = next.trades[0]!
    next.trades.push({
      ...source, id: 'case-source-only', ref: 'CAS-SOURCE', tradeKind: 'case',
      sourceTradeId: source.id, note: '',
      sourceNoteHtml: `<img src="journal-asset://${sourceOnlyId}">`,
    })
    await storage.saveSnapshot(next)
    const preview = await storage.previewAssetPurge()
    assert(!preview.candidateIds.includes(sourceOnlyId), '来源快照附件不得被 GC 视为 orphan')
  } finally {
    storage.close()
    await deleteDatabase(databaseName)
  }
}
```

- [ ] **Step 3: 运行定向测试并确认红灯**

Run: `node scripts/run-regression-tests.mjs --unit-only src/storage/tradeRichText.test.ts src/storage/assetInventory.test.ts src/lib/importExportAssets.test.ts src/lib/webJournalArchive.test.ts`

Expected: FAIL，来源快照附件会被漏扫、误判 orphan 或未重编号。

- [ ] **Step 4: 实现统一枚举与同步收集路径**

`src/storage/tradeRichText.ts`：

```ts
export type TradeRichTextCarrier = { note: string; sourceNoteHtml?: string }

export function tradeRichTextEntries(trade: TradeRichTextCarrier): string[] {
  return trade.sourceNoteHtml === undefined ? [trade.note] : [trade.note, trade.sourceNoteHtml]
}

export function mapTradeRichText<T extends TradeRichTextCarrier>(
  trade: T,
  transform: (html: string) => string,
): T {
  return {
    ...trade,
    note: transform(trade.note),
    ...(trade.sourceNoteHtml === undefined
      ? {}
      : { sourceNoteHtml: transform(trade.sourceNoteHtml) }),
  } as T
}
```

然后逐一替换手写 `trade.note` 扫描：

- `collectAssetIdsFromNotes` 与 `collectAssetIdsFromSnapshot` 使用 `flatMap(tradeRichTextEntries)`；
- `RICH_TEXT_ASSET_DOMAINS` 的 trade selector 使用同一 helper；
- cooperative collector 每个 trade 批次把 `tradeRichTextEntries` 全部推入 `htmlEntries`；
- `externalizeAllNotes` 对两个字段异步转换，保持字段缺失语义；
- import/export 的验证数组使用 `flatMap`，rewrite 使用能够异步/同步保留泛型对象字段的局部 mapper；
- Web archive 针对每笔 trade 遍历 `tradeRichTextEntries(trade)`，错误文案仍使用该 trade ref。

`externalizeAllNotes` 的交易分支使用明确的异步转换，不把 Promise 写入 Trade：

```ts
const trades = await Promise.all(snapshot.trades.map(async (trade) => ({
  ...trade,
  note: await externalizeNoteImages(trade.note, adapter),
  ...(trade.sourceNoteHtml === undefined
    ? {}
    : { sourceNoteHtml: await externalizeNoteImages(trade.sourceNoteHtml, adapter) }),
})))
```

`assets.browser.test.html` 必须显式 import 并 await 新增的 `testSourceSnapshotDataImagesAreExternalized`；`IndexedDbAssetGc.browser.test.ts` 在物理库写入 `source-only` 后保存仅由案例来源快照引用的 snapshot，再断言 purge preview 不包含该 ID。

- [ ] **Step 5: 重跑附件与平台测试**

Run: `node scripts/run-regression-tests.mjs --unit-only src/storage/tradeRichText.test.ts src/storage/assetInventory.test.ts src/lib/importExportAssets.test.ts src/lib/webJournalArchive.test.ts src/storage/snapshotCodec.test.ts`

Expected: 全部 PASS。

Run: `node scripts/run-browser-tests.mjs D:\Trader-Atlas D:\Trader-Atlas\vite.config.ts`

Expected: IndexedDB archive、GC、missing recovery 与全部既有浏览器测试 PASS。

- [ ] **Step 6: 提交附件生命周期**

```powershell
git add -- src/storage/tradeRichText.ts src/storage/tradeRichText.test.ts src/storage/assets.ts src/storage/assetInventory.ts src/storage/indexedDbAdapter.ts src/storage/migrate.ts src/lib/importExport.ts src/lib/webJournalArchive.ts src/storage/assets.test.ts src/storage/assets.browser.test.html src/storage/assetInventory.test.ts src/storage/IndexedDbAssetGc.browser.test.ts src/lib/importExportAssets.test.ts src/lib/webJournalArchive.test.ts
git commit -m "fix: retain assets referenced by case source notes"
```

### Task 5: 三入口统一创建与案例详情双正文

**Files:**
- Modify: `src/views/ListView.tsx:12,270-278`
- Modify: `src/views/BoardView.tsx:30,197-205`
- Modify: `src/views/DetailView.tsx:76-84,176-190,239-283,497-506,531-533,752-875`
- Modify: `src/views/DetailView.css:344-384`
- Create: `src/views/ReviewCaseSourceSync.browser.test.tsx`
- Create: `src/views/ReviewCaseSourceSync.browser.test.html`

**Interfaces:**
- Consumes: Task 2 的 `createReviewCaseFromTrade`、Task 4 的附件安全快照。
- Produces: 详情入口强制草稿 flush；案例页“来源复盘”只读、“案例沉淀”可编辑；列表/看板无重复构造器。

- [ ] **Step 1: 写真实详情流程失败测试**

新浏览器 fixture 挂载 `/trade/:id` 的 `DetailView`，使用 `resetNoteDraftsForTests()` 隔离。场景一：

```ts
setNoteDraft(source.id, '<p>刚补充、尚未 idle 保存的复盘</p>')
findButton('更多')?.click()
await waitFor(() => Boolean(findButton('提炼为案例')), '提炼入口未出现')
findButton('提炼为案例')?.click()
await waitFor(() => useStore.getState().trades.some((trade) => trade.tradeKind === 'case'), '案例未创建')
const reviewCase = useStore.getState().trades.find((trade) => trade.tradeKind === 'case')!
assert(reviewCase.sourceNoteHtml === '<p>刚补充、尚未 idle 保存的复盘</p>', '创建前必须冲洗最新草稿')
assert(reviewCase.note === '', '案例沉淀必须为空')
await waitFor(() => document.body.textContent?.includes('来源复盘') ?? false, '案例页缺少来源复盘')
assert(document.querySelector('[aria-label="来源复盘正文"]')?.getAttribute('contenteditable') === 'false', '来源正文必须只读')
assert(document.querySelector('[aria-label="案例沉淀正文"]')?.getAttribute('contenteditable') === 'true', '案例沉淀必须可编辑')
```

场景二与来源清理紧接场景一执行：

```ts
useStore.getState().updateNote(reviewCase.id, '<p>案例自己的结论</p>')
useStore.getState().updateNote(source.id, '<p>创建后的最新来源</p>')
await waitFor(() => document.body.textContent?.includes('创建后的最新来源') ?? false, '来源后续更新未进入只读区')
const syncedCase = useStore.getState().trades.find((trade) => trade.id === reviewCase.id)!
assert(syncedCase.note === '<p>案例自己的结论</p>', '来源同步覆盖了案例沉淀')
useStore.getState().purgeTrade(source.id)
await waitFor(() => document.body.textContent?.includes('原交易已不存在') ?? false, '来源清理状态未显示')
assert(document.body.textContent?.includes('创建后的最新来源'), '来源清理后最后快照必须可读')
```

场景三先卸载并重新挂载失败来源，mock storage 写入失败；测试的 `finally` 必须恢复 `storage.saveAsset`：

```ts
root.unmount()
resetNoteDraftsForTests()
const failedSource = { ...source, id: 'source-failed', ref: 'TRD-FAILED', note: '' }
useStore.setState({ trades: [failedSource] })
const originalSaveAsset = storage.saveAsset.bind(storage)
storage.saveAsset = async () => { throw new Error('fixture asset failure') }
try {
  setNoteDraft(failedSource.id, '<p>保存失败</p><img src="data:image/png;base64,QQ==">')
  root = createRoot(rootElement)
  root.render(
    <MemoryRouter initialEntries={['/trade/TRD-FAILED']}>
      <Routes><Route path="/trade/:id" element={<DetailView />} /></Routes>
    </MemoryRouter>,
  )
  await waitFor(() => Boolean(findButton('更多')), '失败来源详情未就绪')
  findButton('更多')?.click()
  await waitFor(() => Boolean(findButton('提炼为案例')), '失败来源提炼入口未出现')
  findButton('提炼为案例')?.click()
  await waitForFrame()
  await waitForFrame()
  assert(!useStore.getState().trades.some((trade) => trade.tradeKind === 'case'), '草稿失败时不得创建案例')
  assert(hasNoteDraft(failedSource.id), '草稿失败后必须保留草稿')
  assert(document.body.textContent?.includes('TRD-FAILED'), '草稿失败后必须停留来源详情')
} finally {
  storage.saveAsset = originalSaveAsset
}
```

- [ ] **Step 2: 运行浏览器测试并确认红灯**

Run: `node scripts/run-browser-tests.mjs D:\Trader-Atlas D:\Trader-Atlas\vite.config.ts`

Expected: FAIL 于新 fixture 的最新草稿、双正文或失败不创建断言。

- [ ] **Step 3: 列表和看板改用 store 动作**

删除两处 `buildReviewCaseFromTrade/getNextReviewCaseRef/upsertTrade` 组合，context menu callback 统一为：

```ts
const result = useStore.getState().createReviewCaseFromTrade(source.id)
if (result.status !== 'created') {
  toast(result.status === 'source-is-case' ? '案例不能再次提炼' : '原交易已不存在')
  return
}
toast('已提炼为案例')
openTrade(result.reviewCase)
```

`BoardView` 的最后一行对应改为 `onOpen(result.reviewCase.id)`。

- [ ] **Step 4: 详情创建前强制 flush 并防重复提交**

加入 `caseCreating` state；处理器必须为异步并在成功后从 store 动作返回值导航：

```ts
const createCaseFromCurrentTrade = async () => {
  if (caseCreating || trade.tradeKind === 'case') return
  setCaseCreating(true)
  try {
    if (!(await flushNoteDraftToStore(trade.id))) {
      toast('正文尚未保存，未创建案例')
      return
    }
    const result = useStore.getState().createReviewCaseFromTrade(trade.id)
    if (result.status !== 'created') {
      toast(result.status === 'source-is-case' ? '案例不能再次提炼' : '原交易已不存在')
      return
    }
    toast('已提炼为案例')
    navigate(tradeDetailPath(result.reviewCase), { state: location.state })
  } finally {
    setCaseCreating(false)
  }
}
```

Menu 的 `onSelect` 用 `void createCaseFromCurrentTrade()`；提交期间 option disabled 或动作首行去重，且不得先导航。

- [ ] **Step 5: 渲染来源复盘与案例沉淀**

计算来源 HTML：

```ts
const sourceSnapshotHtml = trade.tradeKind === 'case'
  ? trade.sourceNoteHtml ?? sourceTrade?.note
  : undefined
```

只有 `sourceSnapshotHtml !== undefined` 时渲染“来源复盘” section。使用独立 `loadDetailNote(sourceSnapshotHtml, resolveNoteForDisplayResult)` effect 和 load state；成功时：

```tsx
<section className="dv-case-source-note" aria-labelledby="case-source-note-title">
  <div className="dv-case-note-heading">
    <h2 id="case-source-note-title">来源复盘</h2>
    <span>随原交易自动更新 · 只读</span>
  </div>
  <Editor content={resolvedSourceHtml} onChange={() => {}} ariaLabel="来源复盘正文" readOnly />
</section>
```

现有主 Editor 外加标题“案例沉淀”，将 case 的 aria label 改成 `案例沉淀正文`，仍绑定 `noteDraftId={trade.id}` 与 `onEditorChange`。来源缺失时保留顶部“原交易已不存在”；若历史案例同时缺少 `sourceNoteHtml` 和来源交易，则不渲染来源正文区，原 `note` 原样留在案例沉淀编辑器。

来源附件加载失败只显示只读 fallback 与“来源附件未完整载入”，不提供移除并编辑按钮。CSS 复用 DetailView 现有表面/文字/边框 token，两个正文之间只用边框和间距分层，不新增装饰阴影。

- [ ] **Step 6: 重跑浏览器、store、数据和构建门**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/reviewCases.test.ts src/store/reviewCaseSourceSync.test.ts src/storage/tradeRichText.test.ts src/storage/snapshotValidation.test.ts src/storage/snapshotCodec.test.ts src/storage/assetInventory.test.ts src/lib/importExportAssets.test.ts src/lib/webJournalArchive.test.ts`

Expected: 全部 PASS。

Run: `node scripts/run-browser-tests.mjs D:\Trader-Atlas D:\Trader-Atlas\vite.config.ts`

Expected: 新 ReviewCaseSourceSync fixture 与全部既有浏览器回归 PASS。

Run: `pnpm build`

Expected: typecheck、Vite build 与 bundle budget 全部 PASS。

- [ ] **Step 7: 提交详情与入口集成**

```powershell
git add -- src/views/ListView.tsx src/views/BoardView.tsx src/views/DetailView.tsx src/views/DetailView.css src/views/ReviewCaseSourceSync.browser.test.tsx src/views/ReviewCaseSourceSync.browser.test.html
git commit -m "feat: show synced source notes in review cases"
```

## Completion Evidence

- 立即提炼使用最新已成功归一化草稿；失败时零案例、零导航、草稿仍在。
- 来源 updateNote 同步全部关联案例，包括软删除案例；案例 note 与活动引用保持不变。
- 来源删除后最后快照可读；历史案例 note 未被拆分或覆盖。
- JSON、Web archive、IndexedDB、Electron migration 与 asset inventory 都把来源快照附件视为有效引用。
- 全部定向单元、全套浏览器回归与 `pnpm build` 通过。
- `git diff --check` 无错误；新增文件为 UTF-8 无 BOM。
