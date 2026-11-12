# 隐式状态机的后续优化清单

> 历史记录：判断台与复盘组合器已于 2026-11-12 退役，本文涉及它们的实现与验证不再代表当前功能。

更新日期：2026-11-10。依据 2026-11-09 未提交工作区的完整源码审计，按原编号完成六批实现与定向复核，保留已经满足约束的转换边界。

完整的 130 条审计记录、控制变量、转换、约束、源码位置和 SHA-256 已保存在 [审计基线 JSON](implicit-state-machines-2026-11-09.json)。其中 123 条属于桌面客户端，4 条仅用于浏览器开发测试，3 条为已有集中转换的对照。原来的 [可检索报告](../../test-results/implicit-state-machines-20261109/report.html) 保留历史证据并显示后续进度；`test-results` 是本地验证产物，可能被清理。

“优先建模”表示值得重点检查的流程，不代表已经发现缺陷。SM-034 的历史修复继续保留；本轮六批的变化和验证见下表。本清单不将所有流程统一改成状态机库，也不调整既有存储格式或交易口径。

## 已完成：SM-034 图片迁移的共享正则游标

| 证据 | 结论 | 对应处理 |
| --- | --- | --- |
| E-034-1：审计基线中，`externalizeNoteImages` 复用带 `g` 标记的模块级正则，并在循环内等待 `saveAsset`；`externalizeAllNotes` 并发调用它 | F-034：另一份正文会改变同一个 `lastIndex`，导致重复匹配或漏扫 | 每次调用创建独立正则，保留正文之间的并发迁移 |
| E-034-2：[三个并发回归](../../src/storage/externalizeNoteImages.test.ts) 在修复前均失败，修复后通过 | 两种可控交错分别覆盖重复和漏图；实际快照迁移覆盖交易、来源快照、周复盘、随记共 13 张图 | 核对每份 HTML 的数量、顺序、引用与原图字节归属，以及输入快照不被修改 |
| E-034-3：[macOS 隔离迁移记录](../../test-results/asset-externalization-fix-20261109/desktop.json) | 两份正文的三张原图仅生成三份磁盘附件，字节保持一致，客户端可正常显示 | macOS 已验证；Windows 尚未实测；既有重复附件未做清理 |

调用路径 P-034：旧数据迁移 → `externalizeSnapshotNotes` → `externalizeAllNotes` 的 `Promise.all` → 每次调用独立的 `externalizeNoteImages` 游标 → `saveAsset` → 回填原正文的附件引用。对应实现见 [assets.ts](../../src/storage/assets.ts) 和 [migrate.ts](../../src/storage/migrate.ts)。历史复现数据保留于 [原复现记录](../../test-results/implicit-state-machines-20261109/shared-regexp-reproduction.json)。

SM-034 已有验证：14 项相关单测、4 项浏览器回归、包含类型检查的应用构建通过。证据属于 SM-034，不能作为后续各批的验收结果。

## 六批的目标与验收约束

| 顺序 | 重点编号与流程 | 优化目标 | 完成条件 |
| --- | --- | --- | --- |
| 1 | SM-001、015–019、068：启动、图片保存、草稿、快照与自动保存 | 核对写入启停、草稿代次、单条正文串行冲洗和尾随任务排空的责任边界；必要时集中转换入口。暂停深度、在途任务与保存状态分别保留 | 旧异步结果不能覆盖新正文；归一化期间继续输入保留最新值；显式 flush 不早于图片及其回写完成；失败保留可重试草稿 |
| 2 | SM-002、020–025、027–031：切库、会话、耐久提交、附件与 GC | 按会话身份、候选所有权、提交前后和恢复锁划清转换；核对预览 token 的消费与失效 | 旧库/旧窗口回执不能写入新库；重复消费被拒绝；提交边界发生异常时按磁盘事实分类；仅回收本次拥有且未被引用的附件 |
| 3 | SM-051–056、058–059、063–064、130：导入、恢复与修复 | 明确解析、预览、提交、已提交后发布失败、补偿及恢复阶段；复用已有取消和事务合同 | 换文件、关闭、切库使旧请求失效；取消解析不进入提交；已耐久提交不能重试为重复导入；故障后原库或恢复副本可验证 |
| 4 | SM-003–005、009–011、026：退出、更新、热键和资源释放 | 核对单轮退出 Promise、意图升级、超时取消与回滚收尾；保存回执和原生资源所有权分别处理 | close/quit/install 交错只执行一轮终结；迟到回执失效；回滚完成前不能开启下一轮；Windows 会话结束与 macOS 退出分别验证 |
| 5 | SM-035–038、041–042、047、049：交易、风控、撤销与实盘阶段 | 沿用现有业务转换 helper，核对确认时事实指纹、版本和耐久结果；避免 UI 各自绕过规则 | 列表、看板、详情使用一致门禁；确认后预算或归属变化会重新校验；提交成功但 UI 发布失败不能再次提交；撤销不覆盖后续编辑 |
| 6 | SM-066–067、069–076、078–079、104、106–107：编辑、复盘、收图和复制 | 核对记录身份、异步代次、正文/图片就绪、重试与卸载；拆分确有独立责任的子流程 | 切换记录后迟到结果不串页；重复点击只提交一次；原图和顺序保留；复制到 ChatGPT Mac 的正文 TXT 与独立图片仍可粘贴，文件存活覆盖实际粘贴窗口 |

每批可以拆成更小的改动，但应围绕一条完整调用链交付。先落地已确认的问题；只有明确减少非法组合、重复转换或遗漏分支时才做结构调整。普通菜单、提示、动画和简单二态开关随相关功能维护，不单独发动全量重构。SM-116–119 继续作为浏览器开发测试合同，不扩展产品平台；SM-121–123 用作集中转换的对照。

## 本轮实现与定向验证结果

| 批次 | 处理结果 | 验证入口与证据 |
| --- | --- | --- |
| 1：启动和保存 | 持久化任务绑定写入代次；关闭或丢弃写入后，旧任务不能重新排队、改新状态或消费新生命周期。暂停期间自动保存停止取下一份快照；草稿只发布仍有效的正文，新库不复用旧库冲洗任务。启动去重、快照协调和任务排空保留现有实现 | [写入生命周期回归](../../src/storage/persistenceLifecycle.test.ts)、[草稿生命周期回归](../../src/storage/noteDraftLifecycle.test.ts)；[本批 43 项单测记录](../../test-results/state-machines-optimization-20261110/batch-1-unit.log) |
| 2：切库和耐久事务 | 整批导入在 SQL 异步初始化之后重新校验 revision，同版本并发提交只能成功一次。会话门禁、候选身份、恢复刷新屏障、附件事务和 GC 继续使用原有合同 | [导入竞争回归](../../electron/library/importConcurrency.test.ts)；[本批 76 项单测记录](../../test-results/state-machines-optimization-20261110/batch-2-unit.log) |
| 3：导入和恢复 | Notion 与记录表单区分“提交前失败”和“已落盘后的发布/补偿失败”；后一类停止旧 Store 回写，并进入现有资料库恢复页，界面不再提示“均未写入、请重试”。归档预检、备份恢复和 schema 迁移保留已覆盖的事务合同 | [提交后失败回归](../../src/lib/committedPublish.test.ts)；[本批 131 项既有及新增回归记录](../../test-results/state-machines-optimization-20261110/batch-3-unit.log)、[补偿失败记录](../../test-results/state-machines-optimization-20261110/compensation-red.log) |
| 4：退出和更新 | 新增 renderer 退出屏障，先冻结输入并暂停自动保存，排空图片及尾随回写后才作最终 flush；主进程完成或取消前保留租约，卸载不再补写。旧取消不能释放新一轮锁。更新检查复用在途任务，迟到事件不撤销下载或待安装版本。原有意图升级、回滚、热键释放继续沿用 | [退出屏障回归](../../src/storage/closeBarrier.test.ts)、[更新交错回归](../../src/lib/updateConcurrency.test.ts)；[原有退出与资源回归 71 项](../../test-results/state-machines-optimization-20261110/batch-4-unit.log)、[屏障补充回归](../../test-results/state-machines-optimization-20261110/close-unit.log) |
| 5：业务和实盘阶段 | 开仓指纹、平仓结果、撤销字段冲突、软删除关联图、阶段归属与耐久交接已有集中转换和相邻回归，保留实现及资金口径，未作无依据重写 | [本批 177 项回归记录](../../test-results/state-machines-optimization-20261110/batch-5-unit.log) |
| 6：编辑和复盘 | 收图重试复用已保存的原件，只重试失败项；跨库清除缓存。上传预览 URL 持续到离场快照移除后释放，避免关闭时加载已失效 URL。正文/来源加载、记录切换、复盘会话和图文复制继续沿用现有身份及代次保护 | [真实收图重试回归](../../src/components/judgment/CaptureRetry.browser.test.tsx)、[编辑/复盘单测 66 项](../../test-results/state-machines-optimization-20261110/batch-6-unit.log)、[两项浏览器复核](../../test-results/state-machines-optimization-20261110/browser-recheck.log) |

本轮新增 18 项单元回归及 1 个真实组件浏览器场景。跨平台检查还修正了既有测试中的 Windows 路径、Windows 快捷键文案、macOS 的 Mod 录制和遗漏的回测导航默认值；应用原有按键定义及路径安全门禁保留。

SM-033、SM-111 的预览资源/离场所有权在第六批联调中补充处理。简单菜单、提示、动画、局部解析器继续按原清单随功能维护；SM-116–119 仅保留开发测试合同，SM-121–123 保留作为已有集中转换的对照。

本地验证产物汇总：

- [全量检查日志](../../test-results/state-machines-optimization-20261110/qa-ci.log)、[构建日志](../../test-results/state-machines-optimization-20261110/build.log)。日志记录实际结果，不以单批通过冒充全量通过。
- [真实 Electron 验收记录](../../test-results/state-machines-optimization-20261110/native.json)：隔离库中的图片保存/切记录、落盘后发布失败、停止旧写入、实际恢复刷新及退出备份；窗口为 1440×900、960×640，显示缩放 2。
- [macOS 原生剪贴板记录](../../test-results/case-clipboard-files/native/report.json)：一次粘贴收到 UTF-8 TXT 与三张独立原图，核对字节、尺寸、并发请求、失败保留和文件存活。

Windows 原生会话结束、实际更新安装和原生剪贴板没有在这台 Mac 上执行，不能把跨平台单测称为 Windows 运行验收。原始 130 项清单的编号、历史 SHA-256、计数和修复前复现记录保持不变。

## 第一批已复核的场景与回归入口

已复核 SM-016、018、019、068 的交接，以及 SM-001、015、017 的启动和快照发布边界。

| 场景 | 核对责任 | 现有回归入口 |
| --- | --- | --- |
| A、B 图片保存交错；A 保存期间继续输入 C | 图片只归属原 `noteDraftId`；旧归一化不覆盖 C；存储结果仍被追踪 | [EditorImagePersistence.browser.test.tsx](../../src/editor/EditorImagePersistence.browser.test.tsx)、[noteDrafts.test.ts](../../src/storage/noteDrafts.test.ts)、[noteDrafts.browser.test.ts](../../src/storage/noteDrafts.browser.test.ts) |
| 冲洗草稿与自动保存同时到来；多层 suspend/resume | 同一份最新快照的顺序明确；最后一次 resume 才恢复写入；失败不能显示已保存 | [persistenceController.test.ts](../../src/storage/persistenceController.test.ts)、[persistedSnapshotCoordinator.test.ts](../../src/storage/persistedSnapshotCoordinator.test.ts) |
| 排空过程中派生新的图片回写任务；其中一个任务失败 | 等待尾随任务；失败向上报告，草稿仍可恢复；重试不重复创建原件 | [pendingOperations.test.ts](../../src/storage/pendingOperations.test.ts)、[noteDrafts.test.ts](../../src/storage/noteDrafts.test.ts) |
| 图片尚未完成时切记录、切库或退出 | 旧任务不会落入新记录或新库；退出先等待受管任务与草稿 | [librarySwitchRace.test.ts](../../src/lib/librarySwitchRace.test.ts)、[quitCoordinator.test.ts](../../electron/quitCoordinator.test.ts)，加本批隔离客户端场景 |

已有用例继续保留，新增并发回归用可控制的 Promise 或时钟推进。新增缺陷均记录了失败次序；“已复核”不表示该流程经过形式证明。

## 各批交付与回写

1. 按原 SM 编号登记本批范围、当前源码位置和待守约束；历史审计编号与 SHA-256 保持原样。新增流程单独编号，不用旧编号描述另一项功能。
2. 发现问题时记录触发次序、失败结果与最小复现；待复核项只有取得证据后才升级为已确认问题。
3. 修复已确认问题时，先证明回归能在旧实现上失败，再验证修复结果；结构调整以可观察行为及约束验证，避免测试复刻实现。
4. 执行相关回归和风险所需的类型/构建检查。应用运行代码变化后，按 [开发与验证](workflow.md) 与 [桌面验收技能](../../.agents/skills/atlas-desktop-verify/SKILL.md) 打开最新隔离客户端，并记录实际平台、代码来源、操作路径和未覆盖项。
5. 回写已完成编号、改动、验证命令、结果、证据和限制。状态依次为待复核、已确认问题或结构调整、实现中、已验证；判定无须改动时记录依据。发布与打包另按项目发布约定执行。

本轮完成六批实现与定向验证；正式运行证据及全量检查结果以本轮验收记录为准。发布、安装包与远端操作另遵循项目授权。
