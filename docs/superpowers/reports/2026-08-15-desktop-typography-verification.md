# Desktop Typography Verification — 2026-08-15

## Source

**Result: PASS**

| Item | Value |
| --- | --- |
| Candidate branch | `codex/linear-typography-system` |
| Artifact source commit | `505088ff4d88ddd6b83988b6bfcbf6c9435707a2` |
| Source state | clean before gates, build, packaging, captures, push, and CI dispatch |
| Remote source | `origin/codex/linear-typography-system` resolved to the same `505088f` commit before dispatch |
| Verification report commit | the docs-only child commit containing this file; it is intentionally later than, and must not be treated as, the artifact source commit |
| Final workflow | `desktop-visual-evidence.yml`, run [`31875146610`](https://github.com/Yunkoo757/yunkoo-atlas/actions/runs/31875146610) |

All binary, runtime, screenshot, and CI evidence in this report was regenerated from `505088ff4d88ddd6b83988b6bfcbf6c9435707a2`. No conclusion or value from earlier `445b833` evidence is reused. The report commit changes documentation only; packaged binaries continue to identify source commit and repository HEAD as `505088f`, with `dirty=false`.

## Gates

| Gate | Result | Fresh evidence from `505088f` |
| --- | --- | --- |
| `git status --short` before evidence | PASS | no output |
| `pnpm typecheck` | PASS | exit 0 |
| `pnpm test` | PASS | exit 0; governance PASS: 60 scenarios, 808 UTF-8 text files |
| `pnpm build:app` | PASS | exit 0; three bundle budgets pass; Inter and JetBrains assets emitted |
| `pnpm qa:desktop-visual:electron` | PASS | 35 captures; five typography checks; 0 console/page/overflow |
| first seven-scenario visual review | PASS | Windows Electron 1440×900; `0 P0 / 0 P1` |
| `pnpm dist:win` | PASS | installer and unpacked executable rebuilt from `505088f` |
| packaged Windows 100/125/150 | PASS | each has 35 unique captures, 35 PNG, 12/12 checks, 0 capture errors/overflow |
| CI Windows + macOS x64 + macOS arm64 | PASS | jobs `94989650157`, `94989650133`, `94989650181` |
| second seven-scenario visual review | PASS | final macOS x64 Retina artifact 1440×900; `0 P0 / 0 P1` |

The final search `rg -n 'Geist Sans|geist-sans' src package.json pnpm-lock.yaml dist` returned no matches (`exit 1`, the expected no-match status). JetBrains Mono remains installed, imported, and tokenized. Its CSS uses are restricted to approved technical surfaces—code/pre, raw import/data previews, file paths, route error codes, and shortcut keys—while the complete typography design-contract suite rejects mono on visible business-value surfaces.

### TYPE acceptance mapping

| ID | Acceptance requirement | Concrete automated/source contract | QA report or artifact evidence | Report section |
| --- | --- | --- | --- | --- |
| `TYPE-01` | All visible UI uses Inter Variable with platform CJK sans fallback. | `testUiFontUsesBundledInterAndPlatformCjkFallbacks` and `testTypographySystemUsesOnlyBundledSansFontsAndCanonicalWeights` | `typography-inter-loaded`, `typography-latin-inter`, and `typography-cjk-sans` in `.gstack/qa-reports/desktop-visual-convergence/electron-report.json`, the three local Windows packaged reports, and CI artifacts `9244559517`, `9244563821`, `9244547204` | **Typography → Runtime evidence** |
| `TYPE-02` | Sidebar, lists, body, editor, dialogs, menus, and feedback map to approved semantic roles. | `testDesktopVisualTokensExposeCanonicalRoles`, `testShellTypographyUsesSemanticRolesAndApprovedTracking`, and `testNarrativeAndOverlayTypographyUsesApprovedTrackingAndEditorInheritance` | `typography-role-metrics` in the Electron report and every packaged report; Trades, Detail, Review Session, and Settings/Data captures in Windows evidence and macOS x64 artifact `9244563821` | **Typography** and **Frozen Geometry** visual-review record |
| `TYPE-03` | No unexplained second size, weight, tracking, or line-height system remains in visible UI. | `testProductFontSizesUseCanonicalRolesOrNamedExceptions`, `testTrackingAllowlistRejectsBusinessNumbersAndRequiresExactSelectorRender`, and `testTypographySystemUsesOnlyBundledSansFontsAndCanonicalWeights` | Full `pnpm test` gate plus `typography-role-metrics`; both seven-scenario capture reviews from the Electron report and artifact `9244563821` found no second visible type system | **Gates** and **Typography** |
| `TYPE-04` | Business numerals use the UI font with tabular nums; mono remains technical-only. | `testBusinessNumericSurfacesUseUiTabularTypography` and `testBusinessNumericContractRejectsMonoFontShorthandsAndStacks` | The `numeric` probe in the Electron and packaged reports resolves to Inter; Dashboard, Weekly Review, and Review Session captures in artifact `9244563821` were inspected, while the source contract preserves mono only for code/raw-data/diagnostic/shortcut surfaces | **Gates** search/audit paragraph and **Typography** |
| `TYPE-05` | Mixed Chinese, Latin, and numeric baseline, weight, and density are coordinated on Windows and macOS. | `typography glyph matching binds Chromium internal names to declared native families`, `macOS typography accepts only approved Inter and localized CJK family PostScript pairs`, and `typography glyph checks reject unknown duplicate empty and incomplete probe fonts` in `scripts/fixtures/packaged-desktop-visual.test.mjs` | `typography.glyphFonts.mixed` and `.numeric` plus the Latin/CJK checks in all packaged reports; Windows artifact `9244559517` and macOS artifacts `9244563821`/`9244547204`; both manual review rounds | **Typography → Runtime evidence** and **Frozen Geometry** visual-review record |
| `TYPE-06` | Primary, secondary, supporting, subdued, and disabled text hierarchy remains clear, with no more than three grays on one row. | `testDesktopVisualTokensExposeCanonicalRoles` locks the five canonical text tokens; `testSmallInteractionCopyAndContrastContracts` checks selected-state contrast | Both seven-scenario review sets, sourced from `.gstack/qa-reports/desktop-visual-convergence/electron-report.json` and macOS x64 artifact `9244563821`, explicitly passed hierarchy/state inspection with `0 P0 / 0 P1` | **Gates** visual-review rows and **Frozen Geometry** review paragraph |
| `TYPE-07` | Editor edit mode, saved read-only mode, and pasted rich text do not change fonts. | `testNarrativeAndOverlayTypographyUsesApprovedTrackingAndEditorInheritance` locks pasted-node UI inheritance/code mono isolation; `src/editor/ReviewContext.browser.test.html#__reviewContextInteractionTest` verifies editable/read-only computed typography and unchanged saved HTML; `testDetailUsesDesktopReviewHierarchy` locks the visible detail hierarchy | Detail and Review Session captures in the Electron evidence and macOS x64 artifact `9244563821`, inspected in both rounds | **Gates** visual-review rows and **Frozen Geometry** review paragraph |
| `TYPE-08` | Month groups and all explicitly frozen layout geometry remain unchanged. | `testCalibratedListGeometryAndSurfacesStayCanonical` plus `month-group-geometry` required/fail-closed assertions in `scripts/fixtures/packaged-desktop-visual.test.mjs` | `month-group-geometry` in the Electron report, all three local Windows scale reports, Windows artifact `9244559517`, and macOS artifacts `9244563821`/`9244547204` records 36px + 8px = 44px | **Frozen Geometry** |
| `TYPE-09` | Windows 100%/125%/150% and macOS Retina have no new clipping, overflow, or serif fallback. | `Windows packaged evidence accepts only the supported 100 125 150 percent scale matrix`, `macOS packaged workflow runs both architectures at explicit Retina scale`, and fail-closed screenshot/platform checks in `scripts/fixtures/packaged-desktop-visual.test.mjs` | Local `win32-x64-scale-100/125/150/report.json`; CI artifact `9244559517`; Retina artifacts `9244563821` and `9244547204`; each has 35 unique captures and zero diagnostics/overflow | **Typography → Runtime evidence** and **Frozen Geometry** |
| `TYPE-10` | Full tests, application build, Windows packaging, and separately recorded Windows/macOS evidence pass. | `pnpm typecheck`, `pnpm test`, `pnpm build:app`, `pnpm qa:desktop-visual:electron`, `pnpm dist:win`, packaged scale validation, and workflow fail-closed fixtures | Workflow run `31875146610`, jobs `94989650157`/`94989650133`/`94989650181`, artifacts `9244559517`/`9244563821`/`9244547204`, and the local installer/unpacked binaries | **Source**, **Gates**, and **Artifacts** |

## Typography

### Runtime evidence

| Platform | Arch / scale | source / repository / CI | requested / DPR / display | Captures | Checks | Diagnostics | Latin | CJK |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- |
| Windows local packaged | x64 / 100% | `505088f` / `505088f` / local | 1 / 1 / 1 | 35 unique + 35 PNG | 12/12; typography 5/5 | 0 errors / 0 overflow | Inter | Microsoft YaHei UI |
| Windows local packaged | x64 / 125% | `505088f` / `505088f` / local | 1.25 / 1.25 / 1.25 | 35 unique + 35 PNG | 12/12; typography 5/5 | 0 errors / 0 overflow | Inter | Microsoft YaHei UI |
| Windows local packaged | x64 / 150% | `505088f` / `505088f` / local | 1.5 / 1.5 / 1.5 | 35 unique + 35 PNG | 12/12; typography 5/5 | 0 errors / 0 overflow | Inter | Microsoft YaHei UI |
| Windows CI packaged | x64 / 100–150% | `505088f` / `505088f` / `505088f` | exact 1, 1.25, 1.5 triples | 105 PNG total | 12/12 per scale | 0 errors / 0 overflow | Inter | Microsoft YaHei UI |
| macOS Retina CI | x64 / 200% | `505088f` / `505088f` / `505088f` | 2 / 2 / 2 | 35 unique + 35 PNG | 14/14; typography 5/5 | 0 errors / 0 overflow | Inter / Inter-Regular | 蘋方-簡 / PingFangSC-Regular |
| macOS Retina CI | arm64 / 200% | `505088f` / `505088f` / `505088f` | 2 / 2 / 2 | 35 unique + 35 PNG | 14/14; typography 5/5 | 0 errors / 0 overflow | Inter / Inter-Regular | 蘋方-簡 / PingFangSC-Regular |

`document.fonts.check` passed. Runtime measurements on Windows and both macOS architectures are row `13px/20px/400`, metadata `12px/16px/500`, and month-group title `13px/20px/600`. Source contracts and the complete test gate additionally pass the canonical `11/12/13/15/20px` role set and `400/500/600` weights. No report contains a failed typography check or serif/Songti fallback.

## Frozen Geometry

| Evidence | Month bar | First-row top gap | Virtual total | Overflow | Layout drift |
| --- | ---: | ---: | ---: | ---: | ---: |
| Windows Electron | 36px | 8px | 44px | 0 | 0px |
| Windows packaged 100% | 36px | 8px | 44px | 0 | 0px |
| Windows packaged 125% | 36px | 8px | 44px | 0 | 0px |
| Windows packaged 150% | 36px | 8px | 44px | 0 | 0px |
| macOS x64 Retina | 36px | 8px | 44px | 0 | 0px |
| macOS arm64 Retina | 36px | 8px | 44px | 0 | 0px |

Two fresh manual reviews directly inspected Trades, Today, Detail, Dashboard, Weekly Review, Review Session, and Settings/Data. Round 1 used the new Windows Electron captures; round 2 used run `31875146610`’s macOS x64 Retina artifact. Both rounds found `0 P0 / 0 P1`: no serif/Songti fallback, clipping, horizontal overflow, mixed-script baseline break, hierarchy or density regression, month/list/button/tag geometry drift, or inconsistent visible state typography.

## Artifacts

### Local Windows release

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `release/Trader-Atlas-1.4.0-win-x64.exe` | 120140185 | `3EDEE8570365C15501890C5BD6BDDFE705160DC246488F1F8209F8190DD1FB11` |
| `release/win-unpacked/Trader Atlas.exe` | 225449472 | `B140880CACD0C34F948DAC2B68C4B6F7E46CE886774A612C82F848E7782DD839` |

The three local packaged reports independently repeat the installer hash and executable hash above and bind the embedded source identity to repository HEAD `505088f`, `dirty=false`.

### Workflow run `31875146610`

| Platform | Job ID | Artifact ID | Download bytes | Native package bytes / SHA-256 | Executable SHA-256 |
| --- | ---: | ---: | ---: | --- | --- |
| Windows x64 scales | `94989650157` | `9244559517` | 11821856 | three reports + 105 PNG | n/a |
| macOS x64 Retina | `94989650133` | `9244563821` | 8876279 | 151759568 / `68C76F85F2B008D7571AC3E827B8AFC9C9BE116ACB3B200D48BD433C04E295B8` | `2C50CE097F5B1A244295E69449A6D37EF427D53D51A647F947EA27DC195ECED4` |
| macOS arm64 Retina | `94989650181` | `9244547204` | 7120549 | 149204747 / `DA9F40F5593F8F29AD5D45CFB8CD1E4CB59DD37AD5D247B664A3794D817E3481` | `69CB21F64C53C751678957803B2D82D2D5D7F054AFD570267EDA21179CBFF136` |

All three artifacts were downloaded separately by ID and matched the API byte counts. Each macOS artifact unpacked to exactly 36 files—one fail-closed report and 35 PNG—and the Windows artifact unpacked to 108 files—three reports and 105 PNG. Local scale evidence remains isolated in `test-results/desktop-visual-packaged/win32-x64-scale-100/`, `win32-x64-scale-125/`, and `win32-x64-scale-150/`; CI evidence is retained under `test-results/desktop-visual-ci/run-31875146610/`. Generated QA evidence and release binaries remain ignored and are not committed.
