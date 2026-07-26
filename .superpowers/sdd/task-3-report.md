# Weekly Risk Management Task 3 Report

## 状态

DONE

## 实现结果

- `SCHEMA_VERSION` 与普通 JSON `EXPORT_VERSION` 升至 9；`WEB_JOURNAL_EXPORT_VERSION` 保持 8，Web ZIP 的 `schemaVersion` 独立写入 9。
- `PersistedSnapshot`、字段注册表、空快照、Store hydrate/persist/reset、portable/JSON/Web ZIP/Electron ZIP 链路完整携带四个风险数组。
- 原生 v9 缺少任一风险数组、数组类型错误或风险实体结构非法时严格拒绝；v1–v8 仅在中央 codec 补空数组。
- v8 仅为有效终态 live 交易回填 `closedTradingDayKey`：日期字符串原样保留，时间戳复用 `closedTradingDayKeyFromClosedAt` 并读取快照自身 `display.tradingDayStartHour`；非法日期保持缺失。
- 原生 v9 对合法 `closedAt` 的终态实盘交易严格要求合法 `closedTradingDayKey`，并校验风险实体日期、有限正数、不可变身份、canonical `riskAmount` 与 override event 身份摘要。
- JSON 合并导入按稳定 ID 合并风险实体；周草稿按 `updatedAt` 的真实时间先后选择，不可变 policy、月限额和 override event 的同 ID 本地实体不被覆盖，新 ID 追加。
- 所有受必填字段影响的 typed snapshot fixture 已改为完整/空快照基底或显式补齐字段；保持 UTF-8 无 BOM。
- 未实现 Electron v8→v9 可恢复文件迁移、Gate 或 UI；这些仍属于后续 Task 4/5。

## RED / GREEN

1. RED：`snapshotCodec.test.ts` / `snapshotValidation.test.ts` 初次定向运行出现 6 个预期失败：
   - v9 四字段缺失用例收到“函数没有抛错”，确认没有被“未来版本”异常假冒；
   - v8 四风险数组为 `undefined`；
   - 日期字符串与时间戳均未回填业务日；
   - 合法终态实盘缺 key、损坏风险实体仍被接受。
   GREEN：中央 v9/legacy codec 与 snapshot validation 实现后全部通过。
2. RED：非终态 v8 交易被错误生成 `closedTradingDayKey`。
   GREEN：回填范围收紧为终态 live 交易。
3. RED：JSON merge 丢失四个风险集合，较新周草稿未生效。
   GREEN：按稳定 ID 与可变性规则合并。
4. RED：带 offset 的较新 `updatedAt` 因词典序比较被误判为更旧。
   GREEN：改为比较 `Date.parse` 后的真实瞬时。

## 最终验证

- 全量 unit：`node scripts/run-regression-tests.mjs --unit-only` → 636/636 PASS。
- brief 定向集：126/126 PASS，覆盖 codec、validation、persist、JSON/Web ZIP、切库、Electron ZIP、backup、activation。
- `pnpm typecheck` → 主 TypeScript project 与 Electron project 均 PASS。
- `git diff --check` → PASS。
- UTF-8 BOM 扫描 → 0 个 BOM 文件。

## 改动文件

- 核心合同：`src/storage/types.ts`、`persistedKeys.ts`、`emptySnapshot.ts`、`snapshotCodec.ts`、`snapshotValidation.ts`、`bootstrap.ts`、`persist.ts`、`migrate.ts`。
- JSON/Web 链路：`src/lib/importExport.ts`、`importTypes.ts`、`importMerge.ts`、`webJournalArchive.test.ts`。
- 完整 fixture 与核心测试：`src/storage/fixtures/fullPersistedSnapshot.ts`、`snapshotCodec.test.ts`、`snapshotValidation.test.ts`、`persist.test.ts`、`src/lib/importExportAssets.test.ts`、`importConcurrency.test.ts`、`librarySwitchRace.test.ts`。
- IndexedDB / Web typed fixtures：`src/storage/IndexedDbArchiveReplace.browser.test.ts`、`indexedDbRevision.browser.test.ts`、`indexedDbWriteEntrypoints.browser.test.ts`、`migrateDefaults.test.ts`、`noteDrafts.test.ts`、`src/components/DataIOWebArchive.browser.test.tsx`、`src/benchmarks/webZipBenchmark.browser.ts`。
- Electron typed fixtures与 QA：`electron/library/backup.test.ts`、`importCommit.test.ts`、`journalZip.test.ts`、`libraryActivation.test.ts`、`persistenceBenchmark.test.ts`、`electron/qa.ts`。
- 其他受严格类型影响的测试：`src/lib/businessDateAnchor.test.ts`、`notionImportCommit.test.ts`、`persistenceSafety.test.ts`、`src/regression.test.ts`、`src/store/tradeKindGuard.test.ts`。

## Commit

- 实现提交：`524389cd8c6b94cbec8c18aec5765997846af89e` (`feat: persist risk management schema v9`)

## 疑虑

- 无 Task 3 阻塞或已知缺陷。
- Electron 文件级 v8→v9 双文件可恢复迁移刻意未在本任务实现，等待 Task 4 接续。
