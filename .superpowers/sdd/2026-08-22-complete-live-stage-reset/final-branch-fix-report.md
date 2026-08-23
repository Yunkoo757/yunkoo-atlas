# Final Whole-Branch Fix Wave 报告

日期：2026-08-23（Asia/Hong_Kong）

基线：`bc8ba0ce36bb39bce91c6e43153808b044ab1a1a`

工作树：`D:\Trader-Atlas\.worktrees\complete-live-stage-reset`

状态：Windows 实现与本机验证完成；macOS workflow 已实现，精确提交的原生执行待 CI/主机完成

## 1. 交付结论

本轮一次性关闭 whole-branch review 的 10 项 Major、final addendum 的 2 项 Major，并在最终差异审计中继续关闭相邻的事务、迁移图、永久删除图、storage recovery 与 release artifact 缺陷。所有代码、测试、workflow 与报告均先进入 tracked commit；所有携带 bundle provenance 的 Electron/安装包证据必须在最终 clean HEAD 上重建，报告只引用稳定路径，不固化会因最终提交变化的 SHA 或时间戳。

## 2. 十项 finding 的实现与 TDD 证据

| # | 关闭结果 | 关键 RED → GREEN 合同 |
| --- | --- | --- |
| 1 | Native v12 stage 按 `startsOn` 严格时间顺序要求 sequence 单调，current/latest 必须拥有全局最大 sequence；下一阶段使用全局 max + 1。 | 非单调、current 非最大、历史较大 sequence 的 rollover RED；validation、migration、rename、rollover 回归 GREEN。 |
| 2 | 新增前台 stage rollover scheduler：精确安排下一业务周边界，低频 fallback 检查睡眠/时钟变化，并响应 visibility、focus、切库及 schedule/cancel/commit。 | Sunday→Monday、跨多周睡眠、blocker/postpone、cancel、卸载、时钟前后跳 RED；fake-clock GREEN，无 busy loop，timer 可清理。 |
| 3 | sql.js snapshot 先在隔离候选 DB 生成字节；原子写异常后逐字节区分 candidate committed、previous unchanged 与 indeterminate；仅按磁盘真相交换 active DB。 | 替换前失败、rename 后目录 fsync 失败、不确定字节、同实例重试/重开 RED；真实 `LibraryStorage` fault injection GREEN。renderer 对提交结果与恢复状态可重试/提示，不会用 stale 快照覆盖磁盘。 |
| 4 | v11 非法日历周或无法匹配完整 stage 周期时保留原始日期、置 `liveStageId:null` 并进入显式日期修复；Native v12 校验真实日期与周一至周日边界。 | codec、直接迁移、Electron open/recovery、JSON import、repair UI RED；全部 GREEN。关系待修复与日期 quarantine 已分离，合法周区间不会被误要求改日期。 |
| 5 | 每次 current-stage non-open→open 都先检查 stage policy 与当月限额；历史 open activity 只能在 stage setup 完整后抑制重复单笔确认。 | 带历史 open→planned 的导入交易绕过 setup RED；domain、Store、持久化及真实 browser 对话框 GREEN。 |
| 6 | 随机复盘默认 account pool 明确包含全库 current+archived live trades/cases；paper 保持独立、默认关闭。v1/v2 会话确定迁移且不改变 active round。 | live-only、paper-only、组合、current/history、round roundtrip 与 UI 标签 RED；GREEN。 |
| 7 | 周复盘 frozen risk graph、顶层风险图与 stage repair 使用同一 ownership/reference 合同；outer review 与 embedded pending policy/override 原子归属。 | cross-stage、pending dependency、missing source、missing/cross-stage policy、v11 decode/import/Electron open RED；GREEN。来源已永久删除时，仅完整 `evidenceSnapshot`/`tradeIdentityAtDecision` 可作为自包含冻结证据；来源仍存在则必须同 stage。 |
| 8 | packaged runner 从实际安装/挂载 payload 分别读取 renderer 与 Electron main identity，二者必须 clean 且匹配 repo HEAD/精确 `GITHUB_SHA`；报告绑定 artifact、executable、`app.asar` SHA-256。 | stale/dirty/mismatch、单 bundle、hash 缺失与 report mutation RED；共享 identity contract GREEN。 |
| 9 | packaged cleanup 使用实际 main PID 的有界 close→app exit→hard kill；只有 launcher/main 均退出且临时 profile 删除后才可写 PASS。 | close reject/hang、fulfilled-without-exit、hard-kill-no-exit、短暂 profile lock、primary+cleanup 双失败 RED；GREEN，双错误用 `AggregateError` 保留。 |
| 10 | Windows 对最终 NSIS 做隔离静默安装并执行 identity、migration、rollover、library switch、附件、forced-kill/recovery；macOS 每架构分别挂载最终 DMG、解压最终 ZIP 并执行同一 final-payload smoke，成功后才上传。 | CLI 参数/格式、pre-migration provenance、子进程 kill grace、workflow 顺序、扁平 publish layout、matrix artifact 唯一性 RED；GREEN。 |

## 3. 最终差异审计追加关闭项

- `saveAssetAsync` 不再在图片处理 `await` 之前捕获 sql.js DB；最后一个 await 后重取 active DB，并在不让出事件循环的临界区写附件、asset row 与数据库，真实并发 snapshot swap 回归证明不再出现 `Database closed` 或孤儿附件。
- `commitAssetPurge` 将 sql.js 初始化提前到 preview/CAS、引用集合、活动 DB 与附件状态读取之前；初始化后的清理临界区不再让出事件循环。真实并发 snapshot swap 回归证明只会 stale-revision 零删除或完整提交，不会访问已关闭 DB、悬挂引用或残留 `.trash`。
- v11 top-level risk graph 在 override、weekly preparation、monthly limit 任一 policy 引用缺失时整体进入 `liveStageId:null`，不再生成 codec 无法打开的半迁移图。
- v11 weekly frozen override 的 embedded/top-level policy 闭包不可证明时，outer review 与全部 embedded ownership 原子 pending；合法日期不误标 `legacyPeriodQuarantine`。
- 永久删除会保护 pending case、pending top-level override、pending weekly review 所需的真实来源；旧 completed review 缺少自包含证据时也阻止删除。现代 completed review/assigned override 的冻结证据保持不可变且允许来源永久删除；draft 引用随删除原子清理。手动删除返回 `purgedIds/blockedIds`，30 天自动清理跳过阻塞项且不误报。
- final artifact runner 的 subprocess timeout 具有 SIGKILL 后第二层 grace deadline；bridge 主错误不会被 cleanup 错误覆盖。
- forced-kill 的真实 seed 现以完整合法的 archived/current 时间线建图，并把 weekly review、policy、preparation、monthly limit、override 与 current trade 原子归属到覆盖其日期的 current stage；专用 fixture 回归在启动 Electron 前先执行完整 v12 validator，并验证 seed 不会留下无物理附件的 rich-text 引用、可生成通过校验的 rollover 前置恢复点。
- Web ZIP release benchmark 以确定性 current stage 覆盖其 live trade 日期并写入原生 ownership，避免随执行日期漂移后生成不合法 v12 归档。
- Windows final-payload 安装与卸载均显式使用 NSIS `/currentuser`，且 `/D=<isolated-root>` 保持最后一个未加引号参数；已有 machine-wide 安装不会再触发 UAC、重定向 smoke 或让清理误选真实安装。
- release workflow 将 release 文件与 final report 分离上传，publish 下载保持扁平；macOS matrix 三类诊断 artifact 均按 arch 唯一命名；forced-kill workflow 的 mac 报告路径与 fail-closed 上传合同已修正。

## 4. Final Fix Addendum 与末轮复审关闭项

- 恢复 CTA 不再执行 renderer-only reload。`storage:recover` 在主进程 exclusive gate 内从磁盘新建并验证 `LibraryStorage`，原子替换全局实例、释放带 recovery lock 的旧实例，再把 gate 保持到主框架 `did-navigate` 提交；同步 reload、子框架、in-page navigation、load failure、renderer crash 与超时均 fail closed。真实 Electron 故障注入证明 lifecycle ID 已替换、旧 renderer 尾写被拒绝、fresh storage 读取磁盘真相且退出后后续写仍耐久。
- `saveAssetAsync`、`importAsset` 与整批 `commitImport` 均从 authoritative `journal.db` 构造隔离 sql.js candidate；数据库原子替换后按 exact candidate / exact previous / neither-or-unreadable 判定 committed、unchanged、indeterminate。只有磁盘证明未引用且附件仍为本次精确字节时才清理；不确定状态锁住旧生命周期并保留全部审计证据，candidate/active DB 关闭异常不能覆盖耐久结论。
- 附件根目录、目标文件与 committed direct consumers 均拒绝 symlink/junction、非普通文件、大小写或扩展名别名及不完整物理字节；Windows/macOS portable ID/file-name collision 在 open、preview、commit、import、backup/archive 和 trash recovery 前拒绝。即使 legacy purge 已删 DB 行后崩溃，只要 snapshot 仍 exact/casefold 引用，启动恢复也会在任何删除前 fail closed，保留 active/staged/DB。
- `storage:commitImport` 与其他写入口共用 typed recovery notification boundary，indeterminate 锁定先广播 `storage:recovery-required`，再向 renderer 抛错；App 与设置页共用实际主进程恢复动作和一致文案。
- storage recovery evidence 在运行前删除旧报告，在最终 provenance 与退出后 raw DB 耐久校验完成、Electron 进程退出且临时目录删除成功之后才发布 PASS；cleanup 或 child-process error 均阻止报告生成。release candidate 对该 JSON 设置独立存在性 gate，双平台 evidence workflow 的 path filter 已覆盖 gate、build identity、provenance、renderer bootstrap 与 lockfile 等直接输入。
- 真实恢复 runner 同时等待 Playwright 主框架 `framenavigated` 与主进程 `did-navigate` observer/`storage:recover` IPC 收尾；不再把 renderer 已提交导航误当成主进程 QA 状态已经可读。双观察者屏障仍逐项断言 lifecycle 已替换、commit 时 exclusive 为真且 recovery 已结束。
- 图片 QA 在触发 paste 前安装 save-cycle observer，只有先观测到非 saved 状态再进入新的 saved 才继续 reload 校验；不再依赖产品有意延迟显示、且可能在检查前结束的 dirty/saving DOM。图片 reload、asset ID、两交易 ownership 与 lightbox 断言保持不变。
- 完整 QA 的回归 runner 在每次 `vite.build()` 后及异常 `finally` 恢复调用方 `NODE_ENV`，避免 production React 依赖预构建污染后续开发服务器；工作台入口和安全复制对话框改用当前可访问名称，不再等待已移除的 `.empty-btn`/旧标题。真实工作台长流程 35/35 全绿。
- 10K production-preview 门继续真实执行 v11→v12 迁移，但输入改为一致的 legacy v11 快照：不再把 native `liveStages`/ownership 与旧 manifest 混装，并用覆盖固定样本日期的合法旧 current 边界保证迁移后的 9,996 笔已平仓实盘仍进入 current Dashboard。完整功能观察与冻结性能预算同时 GREEN。
- 共享 Electron bundle identity 采集在 `firstWindow()` 返回后对 renderer/main 身份安装执行有硬上限的就绪等待，再进入原有 clean HEAD、dirty 与精确 SHA 校验；不会把 about:blank 的瞬时缺失误判为产物缺失，身份齐备后也不会重试或放宽陈旧/脏结果。transient blank RED 后 focused GREEN。
- Electron headless QA seed 复用空快照实际创建的 `currentLiveStageId` 为实盘交易写入原生 ownership，并由独立 validator contract 在启动主进程前验证完整 v12 快照；不再用缺失 ownership 的 fixture 误伤真实 SQLite/ZIP/backup 门禁。
- 最终 focused storage/GC/recovery fault-injection 集合 49 项全绿；bundle/recovery workflow fixtures 15 项全绿；两轮独立只读复审均明确 Closed。

## 5. 验证门与稳定证据

| 门禁 | 结果/权威证据 |
| --- | --- |
| `pnpm test` | PASS；Node quality、unit、browser、治理全绿；67 个治理场景及 UTF-8/无 BOM 检查全部通过。 |
| `pnpm typecheck` | PASS；app 与 Electron TypeScript 配置均 exit 0。 |
| `pnpm build` / `pnpm build:app` | PASS；Vite 与 bundle budget 全绿；后者在 clean HEAD 嵌入最终双 bundle identity。 |
| `pnpm qa:design` | PASS。 |
| renderer visual | `.gstack/qa-reports/desktop-visual-convergence/renderer-report.json`。 |
| Electron visual | `.gstack/qa-reports/desktop-visual-convergence/electron-report.json`；必须由 clean HEAD bundle 生成。 |
| persistence benchmark | `test-results/persistence-benchmark/persistence-smoke.json`。 |
| forced kill | `test-results/forced-kill/forced-kill-windows-ntfs.json`。 |
| asset lifecycle | `test-results/platform-evidence/asset-lifecycle-windows-ntfs.json`。 |
| Electron safety | `test-results/platform-evidence/electron-safety-windows-ntfs.json`。 |
| stage-native desktop | `pnpm test:live-stage:desktop`，schema migration、rollover、library switch 全绿。 |
| storage recovery lifecycle | `test-results/storage-recovery/storage-recovery-electron.json`；绑定 clean HEAD renderer/main identity、旧/新 lifecycle、exclusive navigation barrier 与退出后 raw DB 真相。 |
| final NSIS payload | `test-results/final-packaged-artifact/windows-x64-nsis.json`；绑定最终 installer 与安装后 payload。 |
| installed packaged visual | `test-results/desktop-visual-packaged/win32-x64-scale-100/report.json`；记录 renderer/main identity 与三组 payload hash。 |

最终 clean-HEAD 证据的 `repository.head`、renderer/main `commit`、`dirty:false`、精确 `GITHUB_SHA`（CI 时）以及 SHA-256 直接以这些 JSON 为权威。本报告不复制易陈旧值。

## 6. 平台状态与发布边界

- Windows：本机完整验证最终 clean HEAD、最终 NSIS 安装路径及 packaged visual；安装/资料库/userData 均使用隔离临时目录，并执行有界进程与目录清理。
- macOS：workflow 已对 `macos-26` arm64 与 `macos-26-intel` x64 分别构建、执行 DMG+ZIP final smoke 并隔离上传；本 Windows 主机没有运行 macOS 命令，也没有触发远程 workflow，因此保持 pending，不能宣称 macOS PASS。
- 未 merge、未 push。
