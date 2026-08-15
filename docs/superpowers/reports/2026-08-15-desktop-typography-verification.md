# Desktop Typography Verification — 2026-08-15

## Source

**Result: PASS**

| Item | Value |
| --- | --- |
| Candidate branch | `codex/linear-typography-system` |
| Artifact source commit | `445b8336d7b4a9fc2c78840d05168c2d8c368350` |
| Source state | clean before gates, packaging, captures, and CI dispatch |
| Verification record | this documentation-only commit, created after all artifacts; it does not change the artifact source |
| Final workflow | `desktop-visual-evidence.yml`, run [`31865071716`](https://github.com/Yunkoo757/yunkoo-atlas/actions/runs/31865071716) |

All binary and visual evidence in this report is bound to candidate `445b8336d7b4a9fc2c78840d05168c2d8c368350`. Earlier runs `31863311888` and `31864585436` are superseded failure history and are not used as passing evidence.

## Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| `git status --short` before build | PASS | no output |
| `pnpm typecheck` | PASS | exit 0 |
| packaged workflow fixture | PASS | `19/19` |
| `pnpm test` | PASS | candidate: 60 governance scenarios, 803 UTF-8 text files; final documentation tree: 60 scenarios, 804 files |
| `pnpm build:app` | PASS | exit 0; all bundle budgets pass |
| `pnpm qa:desktop-visual:electron` | PASS | 35 captures; five typography checks; 0 console/page/overflow errors |
| `pnpm dist:win` | PASS | installer and unpacked executable produced |
| packaged Windows 100/125/150 | PASS | 35 captures and 35 PNG per scale; 12/12 checks per scale |
| CI Windows + macOS x64 + macOS arm64 | PASS | jobs `94964706699`, `94964706674`, `94964706638` |

The final acceptance search found no `Geist Sans` or `geist-sans` in `src`, `package.json`, `pnpm-lock.yaml`, or `dist`. JetBrains Mono remains loaded and is restricted to approved technical surfaces such as code/pre, raw import/data previews, paths, error codes, and shortcut keys. The complete design-contract suite verifies that business surfaces do not use mono.

## Typography

### Platform runtime evidence

| Platform | Arch/scale | requested / DPR / display | Captures | Checks | Errors / overflow | Latin | CJK |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| Windows packaged | x64 / 100% | 1 / 1 / 1 | 35 unique + 35 PNG | 12/12; typography 5/5 | 0 / 0 | Inter | Microsoft YaHei UI |
| Windows packaged | x64 / 125% | 1.25 / 1.25 / 1.25 | 35 unique + 35 PNG | 12/12; typography 5/5 | 0 / 0 | Inter | Microsoft YaHei UI |
| Windows packaged | x64 / 150% | 1.5 / 1.5 / 1.5 | 35 unique + 35 PNG | 12/12; typography 5/5 | 0 / 0 | Inter | Microsoft YaHei UI |
| macOS Retina CI | x64 / 200% | 2 / 2 / 2 | 35 unique + 35 PNG | 14/14; typography 5/5 | 0 / 0 | Inter / Inter-Regular | 蘋方-簡 / PingFangSC-Regular |
| macOS Retina CI | arm64 / 200% | 2 / 2 / 2 | 35 unique + 35 PNG | 14/14; typography 5/5 | 0 / 0 | Inter / Inter-Regular | 蘋方-簡 / PingFangSC-Regular |

Runtime role measurements pass on both macOS architectures: row `13px/20px/400`, metadata `12px/16px/500`, and group `13px/20px/600`. Source contracts additionally pass the complete canonical role set `11/12/13/15/20px` and weights `400/500/600`, semantic roles across sidebar/list/body/editor/modals/menu/status, tabular business numerals, and editor edit/read-only/paste font stability.

TYPE-01 through TYPE-10 are satisfied: Inter plus platform CJK sans is used across UI surfaces; semantic roles and hierarchy are explicit; there is no unexplained second business type system; mono is technical-only; mixed CJK/Latin/numeric rendering passes on Windows and macOS; primary/secondary/auxiliary hierarchy remains scannable; editor transitions preserve content and typography; frozen geometry is unchanged; packaged scale coverage has no clipping, overflow, or serif fallback; and all tests, build, Windows packaging, and cross-platform evidence gates pass.

## Frozen Geometry

| Platform evidence | Month bar | First-row gap | Virtual row total | Overflow | Layout drift |
| --- | ---: | ---: | ---: | ---: | ---: |
| Electron Windows | 36px | 8px | ~44px | 0 | 0 |
| Packaged Windows 100% | 36px | 8px | ~44px | 0 | 0 |
| Packaged Windows 125% | 36px | 8px | ~44px | 0 | 0 |
| Packaged Windows 150% | 36px | 8px | ~44px | 0 | 0 |
| macOS x64 Retina | 36px | 8px | ~44px | 0 | 0 |
| macOS arm64 Retina | 36px | 8px | ~44px | 0 | 0 |

Two manual seven-scenario reviews were performed against fresh candidate evidence: round 1 used Windows Electron captures; round 2 used the final macOS x64 Retina artifact. Each round directly inspected Trades, Today, Detail, Dashboard, Weekly Review, Review Session, and Settings/Data. Both rounds found `0 P0 / 0 P1`: no serif/Songti fallback, clipping, overflow, baseline break, hierarchy regression, density regression, or geometry/state drift.

## Artifacts

### Windows local release artifacts

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `release/Trader-Atlas-1.4.0-win-x64.exe` | 120140257 | `A32E8996821E35150E00C9250923C4F3902E9FFC015583DB9539D1F43EC1EEB0` |
| `release/win-unpacked/Trader Atlas.exe` | 225449472 | `0EB0358BA493A362EEE38B209A2C388429E054A943117846ACF03E7BC4A00D69` |

### Workflow artifacts

| Platform | Artifact ID | Download bytes | Package bytes / SHA-256 | Executable SHA-256 |
| --- | ---: | ---: | --- | --- |
| Windows x64 scales | `9241791657` | 11857463 | three scale reports + 105 PNG | n/a |
| macOS x64 Retina | `9241788498` | 8973389 | 151760943 / `C910FD40634F1E7549CAF0D1D0D2B2AEE5CBBCA5AAA52FA5060AB6EAD6ED1C56` | `2C50CE097F5B1A244295E69449A6D37EF427D53D51A647F947EA27DC195ECED4` |
| macOS arm64 Retina | `9241767812` | 7175205 | 149206142 / `43431F4F1829C32C1EB719BCDC854CC755B1A580348960D6F177FCA2DE3ACCBD` | `69CB21F64C53C751678957803B2D82D2D5D7F054AFD570267EDA21179CBFF136` |

Each macOS ZIP was downloaded by artifact ID and unpacked to exactly 36 files: one fail-closed report plus 35 PNG captures. Windows scale evidence remains isolated in `test-results/desktop-visual-packaged/win32-x64-scale-100/`, `win32-x64-scale-125/`, and `win32-x64-scale-150/`. Downloaded CI evidence is retained under `test-results/desktop-visual-ci/run-31865071716/`. These generated binaries, reports, and screenshots are intentionally ignored and not committed.
