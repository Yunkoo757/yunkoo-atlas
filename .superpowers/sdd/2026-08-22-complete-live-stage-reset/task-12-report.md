# Task 12 验收报告

日期：2026-08-23（Asia/Hong_Kong）
工作树：`D:\Trader-Atlas\.worktrees\complete-live-stage-reset`
设计状态：已实现；Windows 已验证；macOS CI 验证待完成

## 1. 交付结论

- v12 运行时、持久化、路由、统计和 UI 已只使用 `liveStages`、`currentLiveStageId`、`scheduledStageRollover` 作为实盘阶段真值。
- v11 周期字段仅保留在两个逐文件、逐 token 的兼容边界；v12 解码遇到旧字段会失败关闭。
- 原周期管理器、周期路由、日期推导归档统计模块及对应陈旧 UI/测试已删除。
- Windows 本地 correctness、视觉、耐久性、Electron 安全和安装包门禁通过。
- macOS release job 已静态复核完整，但本 Windows 主机没有运行 macOS 命令，也没有触发远程 workflow；因此不能宣称 macOS 已验证。

## 2. legacy runtime 静态治理

生产扫描范围为 `src`、`electron`、`scripts` 中可执行的 TS/TSX/JS/MJS/CSS/HTML；排除测试与 fixture。allowlist 不允许目录级放行：

| 文件 | 允许 token | 原因 |
| --- | --- | --- |
| `src/lib/stageMigration.ts` | `livePerformanceCycles`、`liveStatsStartTradingDayKey` | 读取 v11 输入、生成确定性 v12 stage 图并删除旧字段的纯迁移边界。 |
| `src/storage/snapshotCodec.ts` | `livePerformanceCycles`、`liveStatsStartTradingDayKey` | 仅在 manifest <= 11 时解码并交给迁移；v12 明确拒绝旧字段。 |

精确搜索结果只有上述两个文件。`重置实盘统计` 与 `重置统计` 在可执行生产源中为 0；`node scripts/check-governance.mjs` 输出 `GOV PASS：65 个场景，859 个 UTF-8 文本文件`。

新增质量场景：

- `LS-V11-MIGRATION`
- `LS-OWNERSHIP-STABLE`
- `LS-ROLLOVER-ATOMIC`
- `LS-HISTORY-SCOPE`
- `LS-REVIEW-DEFAULT`

## 3. 两个延期正确性缺陷

### 3.1 TradeComposer stale CAS

根因：Composer 批量提交的新实盘交易没有在 upsert 边界取得 `currentLiveStageId`，因此候选快照会先因 stage ownership 校验失败，抢在 IndexedDB revision CAS 前抛出非 typed 错误。并发检测本身没有失效，但调用者看到的错误合同错误。

修复：`buildTradePatch` 将当前 stage ID 传入统一 `applyTradeUpsertsToSlice`，使候选实盘交易先获得稳定归属；之后 stale 写入正常到达原有 CAS 边界并抛出 `StorageRevisionConflictError`。测试同时证明 winner revision/快照不变、无半提交交易、无孤儿附件、Store 不发布候选。

### 3.2 WebStorage authoritative reload

根因：冲突恢复直接连续 `setState` 应用远端快照。持久化协调器可能把中间 store 变化当作本地新写入/旧基线，导致加载权威快照时集合或 dirty 状态被混入，而不是形成一个完整耐久替换。

修复：将纯快照发布逻辑拆到 `snapshotStore.ts`，通过 `publishDurableStoreRefresh` 在协调器的 durable publish 边界内原子发布完整远端快照和清理会话 UI，然后丢弃 pending、设置远端 revision、重置保存状态。测试证明本地未确认 stage/quick note 不残留，`currentLiveStageId` 同步替换，恢复导出仍保留本标签页内容与附件缺失清单，最终状态为 `idle`。

## 4. 视觉超时诊断与修复

### 4.1 renderer 首场 `.trade-list` 超时

已知失败只有等待 `.trade-list` 30 秒，无 console stack。审查失败后遗留 diff 发现 schema 常量已从 11 改为 12，fixture 已迁移为原生 v12 stage；旧 QA 将 schema 与 snapshot 分开维护，清理 legacy 字段时两者可漂移，启动会进入存储 bootstrap 错误态而永远不渲染列表。

TDD 收口：视觉 fixture 现在只导出一个 `{ schemaVersion, snapshot }` envelope；renderer 与 Electron 均消费同一 snapshot，矩阵测试逐项断言 schema=12、唯一 current stage、全部实盘实体/周复盘拥有有效 stage、无旧字段。没有增加任何 30 秒 timeout。

复现证据：普通 renderer 及移动原 Vite cache 后的冷 cache renderer 均通过；冷 cache 分别约 16.4/16.6 秒完成 120 captures，排除“冷编译需要更长等待”的假设。

### 4.2 Electron `/live-history` 超时与假绿

Electron 第二 viewport 从 paper trades 进入 `/live-history` 时等待 `.list-scroll` 超时。根因是 `/live-history` 的默认原生 stage 页面已是概览 `.live-archive-scroll`，QA 仍等待旧交易列表。因为上一场 paper trades 也有 `.list-scroll`，首 viewport 曾立即命中旧 DOM 并误截，构成假绿。

TDD 收口：矩阵合同明确锁定 `/live-history` 的 ready selector 为 `.live-archive-scroll`；真实 Electron 5 viewport × 24 scenario 共 120 captures 全部通过，0 console error、0 page error、0 overflow。没有扩大 timeout。

报告：

- `.gstack/qa-reports/desktop-visual-convergence/renderer-report.json`
- `.gstack/qa-reports/desktop-visual-convergence/electron-report.json`

## 5. 删除审计与覆盖强度

- 删除 `qa-risk-management-mobile` 与 420×844 脚本符合仓库只支持 Windows/macOS 桌面客户端的明确范围；风险 Gate、建档、修复视图仍由桌面 browser/unit/Electron 测试覆盖。
- 删除的 `LiveCycleSettings`、cycle route/statistics/dashboard/navigation 测试绑定的是已退休日期周期模型，恢复它们会重新引入双真值。
- 有效语义没有随测试一起删除：v11 迁移、稳定 ownership、stage archive/current scope、原子 rollover、历史编辑、随机复盘、风险 Gate、Dashboard/Data Settings stage manager 入口均有 stage-native 测试。
- 发现原质量场景表没有 stage-native 里程碑后，先写 RED 治理断言，再补 5 个上述 LS 场景；因此删除没有弱化发布治理。

## 6. Windows 门禁结果

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `pnpm typecheck` | PASS | TS app + Electron 配置均 exit 0。 |
| `pnpm test` | PASS | Node quality、unit、browser、治理全绿；治理 65 场景。 |
| `pnpm build` | PASS | Vite build 与三项 bundle budget 全绿。 |
| `pnpm qa:design` | PASS | Trader Atlas design contract 全绿。 |
| `pnpm qa:desktop-visual --renderer` | PASS | 120 captures；0 console/page error；0 overflow；字体/分组几何全绿。 |
| `pnpm qa:desktop-visual:electron` | PASS | 120 captures；0 console/page error；0 overflow；隔离临时资料库已清理。 |
| `pnpm qa:desktop-visual:packaged` | PASS | `test-results/desktop-visual-packaged/win32-x64-scale-100/report.json`；原生平台/缩放/字体/分组几何/文件选择/错误恢复/关闭到托盘全绿。 |
| `pnpm benchmark:persistence` | PASS | `test-results/persistence-benchmark/persistence-smoke.json`。20k Web/Electron median save 289.0/1076.9ms；quit median 1522.8ms。 |
| `pnpm test:forced-kill:electron` | PASS | `test-results/forced-kill/forced-kill-windows-ntfs.json`；schema v12；真实 Electron SIGKILL；三迁移边界、stage scope、revision 恢复全绿。 |
| `pnpm test:asset-lifecycle:electron` | PASS | 4/4；`test-results/platform-evidence/asset-lifecycle-windows-ntfs.json`。 |
| `pnpm test:electron-safety:platform` | PASS | 2/2；`test-results/platform-evidence/electron-safety-windows-ntfs.json`。 |
| `pnpm test:live-stage:desktop` | PASS | schema migration、stage rollover、library switch 37 项全绿。 |
| `pnpm dist:win` | PASS | build:app + electron-builder NSIS x64 exit 0。 |

强杀门禁另外发现并修复了一个证据 bug：seed 先对保存前对象取哈希、verify 对解码规范化后的对象取哈希，语义相同仍会 revision 不同。现在 seed 保存后立即重读已持久化 snapshot 再取期望 revision；原有强杀恢复断言未放宽。

## 7. Windows 产物元数据

本轮 `dist:win` 起点后生成：

| 产物 | 字节 | UTC 修改时间 | 晚于构建起点 |
| --- | ---: | --- | --- |
| `release/Trader-Atlas-1.4.1-win-x64.exe` | 121,937,781 | 2026-08-22T16:34:32.5918505Z | 是 |
| `release/Trader-Atlas-1.4.1-win-x64.exe.blockmap` | 127,636 | 2026-08-22T16:34:35.9880910Z | 是 |
| `release/latest.yml` | 357 | 2026-08-22T16:34:36.0056417Z | 是 |

## 8. macOS workflow 静态复核

`.github/workflows/release.yml` 的 `build-macos` job 使用 `macos-latest`，依次执行：

1. `pnpm build:app`
2. `pnpm test:live-stage:desktop`（schema migration、stage rollover、library switching）
3. `pnpm qa:electron`
4. `pnpm test:asset-lifecycle:electron`
5. `pnpm test:forced-kill:electron`
6. `pnpm test:electron-safety:platform`
7. `electron-builder --mac dmg zip --x64 --arm64 --publish never`
8. x64/arm64 DMG/ZIP 非空校验与上传

尚缺：在包含本 Task 12 提交的 macOS CI/主机上实际执行上述 job。没有运行 `pnpm dist:mac`，没有远程触发，也不报告 macOS PASS。

## 9. 验收清单与剩余关注

- [x] 每个 stage-scoped 实体有稳定显式 ownership；`null` 只用于待修复路径。
- [x] v11 迁移确定、可恢复、不猜测；v12 严格拒绝旧字段。
- [x] current/history/review/risk/weekly/scheduling 行为全绿。
- [x] rollover 候选、备份、CAS、原子提交与强杀恢复全绿。
- [x] legacy 字段不再是 runtime truth，allowlist 精确且有治理门禁。
- [x] Windows correctness、视觉、耐久性与安装包通过。
- [ ] macOS 对这个精确提交的 runtime/package CI 证据待完成。

唯一发布关注项是 macOS 实机/CI 尚未执行；在此证据到达前，设计状态不得提升为双平台“Implemented and verified”。
