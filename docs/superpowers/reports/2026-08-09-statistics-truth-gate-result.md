# Statistics Truth Gate Result

- Candidate SHA: `0a84fa3b3968a9c225359f6bac3566ca2202cadc`
- Evidence JSON: `test-results/statistics-truth/statistics-truth-gate.json`
- Fixture: `src/test/fixtures/performanceTruthFixture.ts`
- Fixture SHA-256: `e33895367da2cedeb968fd54b95f201d8593ee2e095e626387172d847e4f3331`
- Samples: 56
- Result: PASS

| Acceptance ID | Result | JSON evidence | Executed test IDs |
|---|---|---|---|
| T-SCOPE-001 | PASS | `golden.collections`, `commands` | `src/lib/performanceSelection.test.ts#testPerformanceSelectionFreezesEveryGoldenTruthCollection`<br>`src/lib/strategies.test.ts#testStrategyStatsConsumeCallerEligibilityWithoutReclassifyingFacts` |
| T-SCOPE-002 | PASS | `golden.collections`, `commands` | `src/lib/analysisScope.test.ts#testAnalysisScopeMatchesDashboardResultSet` |
| T-SCOPE-003 | PASS | `golden.collections`, `commands` | `src/lib/workspaceFacetConsistency.test.ts#testWorkbenchAnalysisMatchesSelectorAcrossKindsRangesAndArchive` |
| T-SCOPE-004 | PASS | `golden.collections`, `commands` | `src/views/DashboardScope.browser.test.html#__dashboardAnalysisScopeTest`<br>`src/views/StatisticsTruthSurfaces.browser.test.html#__statisticsTruthSurfacesTest` |
| T-DATE-001 | PASS | `golden.collections`, `commands` | `src/lib/analysisScope.test.ts#testPaperTerminalWithoutCloseFactNeverEntersPerformanceRanges`<br>`src/lib/notionImportTradeFacts.test.ts#testNotionTerminalTradeWithoutSourceCloseDateStaysPending` |
| T-DATE-002 | PASS | `golden.collections`, `commands` | `src/lib/analysisScope.test.ts#testAllRangeStopsAtTheNextBusinessDayExclusiveBoundary` |
| T-DATE-003 | PASS | `golden.collections`, `commands` | `src/lib/performanceSelection.test.ts#testPerformanceSelectionFreezesTheSixAmCloseDayBoundary`<br>`src/lib/tradeWorkflow.test.ts#testTodayClosedMetricsPrefersFrozenTradingDayAndHonorsDayBoundary`<br>`src/data/weeklyReviews.test.ts#testWeeklyReviewWeeksAndTradesRejectFactsAfterTheFrozenBusinessDay` |
| T-DATE-004 | PASS | `golden.collections`, `commands` | `src/lib/dashboardStats.test.ts#testDashboardStatsUseOnlyEligibleMetricIdsForEveryAggregation`<br>`src/lib/tradeWorkflow.test.ts#testTodayClosedMetricsRejectsUnreliableFutureAndConflictingFacts` |
| T-IMPORT-001 | PASS | `golden.collections`, `commands` | `src/lib/notionImportTradeFacts.test.ts#testNotionImportParsesCurrencyOnlyFromSourceMoneyFacts`<br>`src/components/NotionImportModal.browser.test.html#__notionImportPersistenceTest` |
| T-IMPORT-002 | PASS | `golden.collections`, `commands` | `src/lib/importDataHealth.test.ts#testCleanupPersistsBeforePublishingAndUndoPatchRestoresExactFields`<br>`src/views/ImportDataHealthView.browser.test.html#__importDataHealthViewTest@1280x900` |
| T-REVIEW-001 | PASS | `golden.collections`, `commands` | `src/lib/weeklyReviewSnapshot.test.ts#testCompletedReviewWithoutMetricsSnapshotUsesLiveRecomputedSource`<br>`src/lib/weeklyReviewSnapshot.test.ts#testCompletedReviewWithoutEvidenceSnapshotUsesLiveRecomputedSource`<br>`src/lib/weeklyReviewSnapshot.test.ts#testCompletedReviewWithoutRiskSnapshotUsesLiveRecomputedSource`<br>`src/data/weeklyReviews.test.ts#testWeeklyReviewEvidenceKeepsReliableConflictAndPendingResultsWithoutMetrics`<br>`src/lib/weeklyReviewSnapshot.test.ts#testCompletionFreezesConflictAndPendingEvidenceWithoutPerformance` |
| T-REVIEW-002 | PASS | `golden.collections`, `commands` | `src/views/WeeklyReviewView.browser.test.html#__weeklyReviewFlowTest@1280x900`<br>`src/views/StatisticsTruthSurfaces.browser.test.html#__statisticsTruthSurfacesTest` |
| T-ROUTE-001 | PASS | `golden.collections`, `commands` | `src/lib/periods.test.ts#testYtdPeriodBoundsStartAtTheBusinessYearAndNeverIncludeFutureDays` |
| T-ROUTE-002 | PASS | `golden.collections`, `commands` | `src/lib/workspaceFacetConsistency.test.ts#testCalendarPeriodsAndDashboardPerformanceKeepDifferentDateFields`<br>`src/views/DashboardScope.browser.test.html#__dashboardAnalysisScopeTest` |
| T-CURRENCY-001 | PASS | `kpiTruth`, `commands` | `src/lib/cashCurrency.test.ts#testUsdEligibilityAndTotalsShareOneCurrencyFactRule`<br>`src/lib/tradeWorkflow.test.ts#testTodayClosedMetricsUsesUsdOnlyWithExplicitLegacyAssumption`<br>`src/lib/strategies.test.ts#testStrategyStatsAggregateUsdOnlyAndRespectLegacyFact`<br>`src/views/settings/ProfileSettingsCurrency.browser.test.html#__profileSettingsCurrencyTest`<br>`src/views/StatisticsTruthSurfaces.browser.test.html#__statisticsTruthSurfacesTest` |
| T-DRILL-001 | PASS | `golden.collections`, `golden.drilldownTarget` | `src/lib/performanceSelection.test.ts#testPerformanceSelectionDrilldownReproducesArchiveScope`<br>`src/views/DashboardScope.browser.test.html#__dashboardAnalysisScopeTest` |

## KPI truth

- USD IDs: expected `["FX-USD"]`, actual `["FX-USD"]`.
- USD total: expected 100, actual 100.
- Future/missing/invalid close-day contamination: `{"futureInKpiIds":[],"missingInKpiIds":[],"invalidInKpiIds":[],"nonUsdInUsdTotalIds":[],"unknownCurrencyInUsdTotalIds":[]}`.

## Command evidence

- `node scripts/run-regression-tests.mjs --unit-only src/lib/performanceSelection.test.ts src/lib/analysisScope.test.ts src/lib/tradeWorkflow.test.ts src/lib/strategies.test.ts src/data/weeklyReviews.test.ts src/lib/dashboardStats.test.ts src/lib/notionDateAudit.test.ts src/lib/notionImportTradeFacts.test.ts src/lib/notionImportCommit.test.ts src/lib/importDataHealth.test.ts src/lib/weeklyReviewSnapshot.test.ts src/lib/periods.test.ts src/lib/workspaceFacetConsistency.test.ts src/lib/cashCurrency.test.ts src/storage/snapshotCodec.test.ts src/storage/snapshotValidation.test.ts src/store/useStoreCurrencyAssumption.test.ts`: exit 0, 198/25 expected tests.
- `browser-runner src/views/DashboardScope.browser.test.html#__dashboardAnalysisScopeTest src/components/NotionImportModal.browser.test.html#__notionImportPersistenceTest src/views/ImportDataHealthView.browser.test.html#__importDataHealthViewTest@1280x900 src/views/WeeklyReviewView.browser.test.html#__weeklyReviewFlowTest@1280x900 src/views/settings/ProfileSettingsCurrency.browser.test.html#__profileSettingsCurrencyTest src/views/StatisticsTruthSurfaces.browser.test.html#__statisticsTruthSurfacesTest`: exit 0, 6/6 expected tests.

## Failure reasons

- None.

## Final fix round 2 verification

- Base: `a63dc4955dee6d7d6f7bc9f78473dd3d3b47370f`.
- Code candidate: `0a84fa3b3968a9c225359f6bac3566ca2202cadc` (`fix(stats): preserve weekly result evidence`).
- `pnpm qa:statistics-truth`: PASS；16/16 acceptance IDs、25 个 required unit IDs、6 个 renderer IDs；198 个 unit 与 6 个 renderer 的 actual IDs 均来自本次真实通过的命令。
- `pnpm typecheck`: PASS；应用与 Electron TypeScript 均通过。
- `pnpm test`: PASS；运行前已移走 `test-results/statistics-truth/statistics-truth-gate.json`，完整项目测试在 runtime Gate JSON 不存在的状态下通过。
- `pnpm test:release`: PASS；22/22 release contracts 通过。
- Validator contract: PASS，19/19；包含 canonical coverage、自包含有效证据、runtime JSON 不存在以及全部既有伪造 mutation。

## Weekly evidence truth

- 周事实选择复用 PerformanceSelection，并取 `eligibleMetricIds + conflictResultIds + missingResultIds` 的可靠、非未来、当周实盘并集。
- 平仓数、胜率、USD 与 R 绩效分别只消费 `eligibleMetricIds`、`pnlIds` 与 `rIds`；conflict/pending 只保留事实证据与独立告警，不进入绩效。
- 仅有 conflict 或仅有 pending result 的周仍生成入口；新完成快照冻结这些 evidence，但 metrics 不计；future 仍不进入入口、实时证据或新快照。

## Candidate evidence identity

- Fixture sample count: 56.
- Fixture SHA-256: `e33895367da2cedeb968fd54b95f201d8593ee2e095e626387172d847e4f3331`.
- Gate JSON SHA-256: `36727d89deccc69f23d0a0fcfd9145007dc3cdab6f232a937dbe9f03377341ed`.
- 本报告的后续提交只包含文档，不改变上述 code candidate 的源码、测试或 fixture 身份。

## Deferred non-blocking ledger

- Strategy eligibility mode 下的 health dead branch Minor 保持 deferred。
- 其他既有 Minor/UX copy 项未在本轮处理。
