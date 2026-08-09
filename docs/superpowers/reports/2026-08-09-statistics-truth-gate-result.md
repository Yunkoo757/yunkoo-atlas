# Statistics Truth Gate Result

- Candidate SHA: `5b9f1009e04c51c7077451fca52d337e9994c6c8`
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

- `node scripts/run-regression-tests.mjs --unit-only src/lib/performanceSelection.test.ts src/lib/analysisScope.test.ts src/lib/dashboardStats.test.ts src/lib/notionDateAudit.test.ts src/lib/notionImportTradeFacts.test.ts src/lib/notionImportCommit.test.ts src/lib/importDataHealth.test.ts src/lib/weeklyReviewSnapshot.test.ts src/lib/periods.test.ts src/lib/workspaceFacetConsistency.test.ts src/lib/cashCurrency.test.ts src/storage/snapshotCodec.test.ts src/storage/snapshotValidation.test.ts src/store/useStoreCurrencyAssumption.test.ts`: exit 0, 154/17 expected tests.
- `browser-runner src/views/DashboardScope.browser.test.html#__dashboardAnalysisScopeTest src/components/NotionImportModal.browser.test.html#__notionImportPersistenceTest src/views/ImportDataHealthView.browser.test.html#__importDataHealthViewTest@1280x900 src/views/WeeklyReviewView.browser.test.html#__weeklyReviewFlowTest@1280x900 src/views/settings/ProfileSettingsCurrency.browser.test.html#__profileSettingsCurrencyTest`: exit 0, 5/5 expected tests.

## Failure reasons

- None.

## Final candidate verification

- `pnpm qa:statistics-truth`: PASS；证据绑定 candidate `5b9f1009e04c51c7077451fca52d337e9994c6c8`。
- `pnpm typecheck`: PASS；应用与 Electron TypeScript 均通过。
- `pnpm test`: PASS；完整项目测试、全部 renderer fixture 与治理门通过，未以聚焦结果代替全量结果。
- `pnpm test:release`: PASS；22/22 release contracts 通过。

## Deferred non-blocking ledger

- Task 4：旧 Notion 同日候选的 `openedAt` / `openedTradingDayKey` 取值优先级，以及 broad terminal helper 是否覆盖 `missed`，继续交由全分支最终审查；本 Gate 已明确 `missed` 不进入现金绩效选择。
- Task 6：saved-view 的 YTD 标签与非法 period 页样式类仍为非阻断 minor。
- Task 7：设置页影响数量仍混合“全部旧现金事实”与“当前绩效影响”，保持为非阻断 minor。
- 上述项目均不改变本报告的 ID 集合、日期上界、USD-only KPI 或下钻真值结果。
