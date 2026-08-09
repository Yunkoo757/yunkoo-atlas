# Statistics Truth Gate Result

- Candidate SHA: `4f5d4c0e61fe27e38abd478568efe1de24c868b4`
- Evidence JSON: `test-results/statistics-truth/statistics-truth-gate.json`
- Fixture: `src/test/fixtures/performanceTruthFixture.ts`
- Fixture SHA-256: `e33895367da2cedeb968fd54b95f201d8593ee2e095e626387172d847e4f3331`
- Samples: 56
- Result: PASS

| Acceptance ID | Result | JSON evidence | Executed test IDs |
|---|---|---|---|
| T-SCOPE-001 | PASS | `golden.collections`, `commands` | `src/lib/performanceSelection.test.ts#testPerformanceSelectionFreezesEveryGoldenTruthCollection` |
| T-SCOPE-002 | PASS | `golden.collections`, `commands` | `src/lib/analysisScope.test.ts#testAnalysisScopeMatchesDashboardResultSet` |
| T-SCOPE-003 | PASS | `golden.collections`, `commands` | `src/lib/workspaceFacetConsistency.test.ts#testWorkbenchAnalysisMatchesSelectorAcrossKindsRangesAndArchive` |
| T-SCOPE-004 | PASS | `golden.collections`, `commands` | `src/views/DashboardScope.browser.test.html#__dashboardAnalysisScopeTest` |
| T-DATE-001 | PASS | `golden.collections`, `commands` | `src/lib/analysisScope.test.ts#testPaperTerminalWithoutCloseFactNeverEntersPerformanceRanges`<br>`src/lib/notionImportTradeFacts.test.ts#testNotionTerminalTradeWithoutSourceCloseDateStaysPending` |
| T-DATE-002 | PASS | `golden.collections`, `commands` | `src/lib/analysisScope.test.ts#testAllRangeStopsAtTheNextBusinessDayExclusiveBoundary` |
| T-DATE-003 | PASS | `golden.collections`, `commands` | `src/lib/performanceSelection.test.ts#testPerformanceSelectionFreezesTheSixAmCloseDayBoundary` |
| T-DATE-004 | PASS | `golden.collections`, `commands` | `src/lib/dashboardStats.test.ts#testDashboardStatsUseOnlyEligibleMetricIdsForEveryAggregation` |
| T-IMPORT-001 | PASS | `golden.collections`, `commands` | `src/lib/notionImportTradeFacts.test.ts#testNotionImportParsesCurrencyOnlyFromSourceMoneyFacts`<br>`src/components/NotionImportModal.browser.test.html#__notionImportPersistenceTest` |
| T-IMPORT-002 | PASS | `golden.collections`, `commands` | `src/lib/importDataHealth.test.ts#testCleanupPersistsBeforePublishingAndUndoPatchRestoresExactFields`<br>`src/views/ImportDataHealthView.browser.test.html#__importDataHealthViewTest@1280x900` |
| T-REVIEW-001 | PASS | `golden.collections`, `commands` | `src/lib/weeklyReviewSnapshot.test.ts#testCompletedReviewWithoutMetricsSnapshotUsesLiveRecomputedSource`<br>`src/lib/weeklyReviewSnapshot.test.ts#testCompletedReviewWithoutEvidenceSnapshotUsesLiveRecomputedSource`<br>`src/lib/weeklyReviewSnapshot.test.ts#testCompletedReviewWithoutRiskSnapshotUsesLiveRecomputedSource` |
| T-REVIEW-002 | PASS | `golden.collections`, `commands` | `src/views/WeeklyReviewView.browser.test.html#__weeklyReviewFlowTest@1280x900` |
| T-ROUTE-001 | PASS | `golden.collections`, `commands` | `src/lib/periods.test.ts#testYtdPeriodBoundsStartAtTheBusinessYearAndNeverIncludeFutureDays` |
| T-ROUTE-002 | PASS | `golden.collections`, `commands` | `src/lib/workspaceFacetConsistency.test.ts#testCalendarPeriodsAndDashboardPerformanceKeepDifferentDateFields`<br>`src/views/DashboardScope.browser.test.html#__dashboardAnalysisScopeTest` |
| T-CURRENCY-001 | PASS | `kpiTruth`, `commands` | `src/lib/cashCurrency.test.ts#testUsdEligibilityAndTotalsShareOneCurrencyFactRule`<br>`src/views/settings/ProfileSettingsCurrency.browser.test.html#__profileSettingsCurrencyTest` |
| T-DRILL-001 | PASS | `golden.collections`, `golden.drilldownTarget` | `src/lib/performanceSelection.test.ts#testPerformanceSelectionDrilldownReproducesArchiveScope`<br>`src/views/DashboardScope.browser.test.html#__dashboardAnalysisScopeTest` |

## KPI truth

- USD IDs: expected `["FX-USD"]`, actual `["FX-USD"]`.
- USD total: expected 100, actual 100.
- Future/missing/invalid close-day contamination: `{"futureInKpiIds":[],"missingInKpiIds":[],"invalidInKpiIds":[],"nonUsdInUsdTotalIds":[],"unknownCurrencyInUsdTotalIds":[]}`.

## Command evidence

- `node scripts/run-regression-tests.mjs --unit-only src/lib/performanceSelection.test.ts src/lib/analysisScope.test.ts src/lib/dashboardStats.test.ts src/lib/notionDateAudit.test.ts src/lib/notionImportTradeFacts.test.ts src/lib/notionImportCommit.test.ts src/lib/importDataHealth.test.ts src/lib/weeklyReviewSnapshot.test.ts src/lib/periods.test.ts src/lib/workspaceFacetConsistency.test.ts src/lib/cashCurrency.test.ts src/storage/snapshotCodec.test.ts src/storage/snapshotValidation.test.ts src/store/useStoreCurrencyAssumption.test.ts`: exit 0, 156/17 expected tests.
- `browser-runner src/views/DashboardScope.browser.test.html#__dashboardAnalysisScopeTest src/components/NotionImportModal.browser.test.html#__notionImportPersistenceTest src/views/ImportDataHealthView.browser.test.html#__importDataHealthViewTest@1280x900 src/views/WeeklyReviewView.browser.test.html#__weeklyReviewFlowTest@1280x900 src/views/settings/ProfileSettingsCurrency.browser.test.html#__profileSettingsCurrencyTest`: exit 0, 5/5 expected tests.

## Failure reasons

- None.

## Final candidate verification

- Code candidate: `4f5d4c0e61fe27e38abd478568efe1de24c868b4` (`fix(stats): close final truth-surface gaps`).
- `pnpm qa:statistics-truth`: PASS；16/16 acceptance IDs、17 个 required unit IDs、5 个 renderer IDs，证据固定引用上述 code candidate。
- `pnpm typecheck`: PASS；应用与 Electron TypeScript 均通过。
- `pnpm test`: PASS；完整项目测试、全部 renderer fixtures 与治理门通过，未以聚焦结果替代全量结果。
- `pnpm test:release`: PASS；22/22 release contracts 通过。
- 后续报告提交只包含文档，不改变上述候选的源码、测试或 fixture 身份。

## Final truth-surface closure

- Today 战绩通过 PerformanceSelection 的内部 today 窗消费 `eligibleMetricIds`、`pnlIds` 与 `rIds`，不再回退 `openedAt`。
- StrategyHeader 与 StrategiesPanel 分开“当前实盘关联数”和“绩效样本数”，绩效只消费选择器资格 ID。
- Weekly 周入口、实时指标、实时证据和新完成快照冻结在 `currentTradingDayKey`，future close 不进入绩效；missed evidence 保持独立。
- 外部 evidence validator 将命令级 expected IDs、acceptance 映射与声明差集绑定到规范合同，并从 candidate 的 `git show` 重算 fixture checksum。

## Deferred non-blocking ledger

- 保持最终审查已登记的非阻断项：Task 4 同日候选解释、Task 6 saved-view YTD 标签、Task 6 非法范围页样式类、Task 7 设置页影响数量，以及 1 项 UX copy minor。
- 上述项目未在本次 Important fix wave 中处理，不改变 Gate T 日期、结果、币种或下钻真值。
