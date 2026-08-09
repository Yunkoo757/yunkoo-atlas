# 客户端托管本机网页与统一资料库设计

## 1. 决策摘要

Trader Atlas 将客户端资料库设为唯一数据真源。Windows 客户端启动后，只在本机回环地址提供与安装包版本一致的网页界面；Electron 界面与本机浏览器通过不同传输层访问同一个 `LibraryService`、同一个 `journal.db` 和同一个附件目录。

本方案不在 IndexedDB 与客户端资料库之间做双向同步。生产网页版不再向 IndexedDB 写入交易、复盘或附件；客户端未运行时，网页进入只读断线态。

已确认的产品边界：

- 只支持运行客户端的同一台电脑，不支持手机、平板、局域网或公网访问；
- 两端提交成功后的变更应在约 500ms 内出现在另一端；
- 不做逐字光标协作，同步点是一次成功的自动保存或显式操作；
- 两端可同时编辑不同资源；同一资源发生并发修改时拒绝后提交，不静默覆盖；
- 顶栏提供“在浏览器中打开”入口；
- 客户端断开时，网页停止写入并保留当前临时草稿；
- 现有网页版 IndexedDB 没有需要迁移的数据。

## 2. 背景与现状

当前两端只共享 `PersistedSnapshot` 等领域结构，存储实现完全分叉：

- `src/storage/provider.ts` 根据 `isElectron()` 在 `ElectronStorageAdapter` 与 `IndexedDbStorageAdapter` 之间二选一；
- Web 使用 IndexedDB 的 `snapshot`、`assets`、`meta` store，并已实现持久化 revision/CAS；
- Electron 通过 preload/IPC 调用主进程 `LibraryStorage`，数据位于 `journal.db` 与附件目录；
- Electron `saveSnapshot` 当前直接替换完整 snapshot，没有面向第二个并发写入者的 revision/CAS；
- Web Locks 与 BroadcastChannel 只覆盖同一浏览器资料库，无法协调 Electron 的磁盘资料库；
- 浏览器受沙箱限制，不能安全、稳定地直接读写客户端资料库目录。

因此，继续维护“两套存储后再同步”会形成双真源。正确边界是让客户端主进程成为资料库主机，浏览器只作为另一个经过认证的界面。

## 3. 目标

1. 客户端和本机浏览器读写同一份客户端资料库。
2. 快照、附件、导入、清理、备份和恢复统一经过一个服务层。
3. 所有业务写入具备持久化 revision、资源级前置条件和原子提交语义。
4. 不同资源的并发编辑可自动基于最新版合并。
5. 同一资源的并发编辑必须保留后提交者草稿并进入显式冲突处理。
6. 成功提交通过实时事件通知另一端，不要求刷新页面。
7. 浏览器访问只限本机、只在客户端运行期间有效。
8. 浏览器与客户端使用安装包内同一份前端资源，避免版本漂移。
9. 客户端关闭、切库、强杀或服务异常不得制造第二份可写资料库。

## 4. 非目标

- 不支持云同步、账号体系、远程设备或局域网访问。
- 不支持客户端关闭后的网页离线编辑。
- 不做多人逐字协同、光标同步或 CRDT。
- 不自动合并同一条交易、同一篇复盘或同一设置资源的并发内容。
- 不迁移、合并或保留现有生产网页版 IndexedDB 业务数据。
- 不让浏览器直接获取资料库真实磁盘路径。
- 不把客户端窗口、全局热键或在线更新能力移植到浏览器。

## 5. 总体架构

```text
Electron Renderer ── IPC ──┐
                           ├── LibraryService ── mutation queue ── journal.db
Local Browser ─ HTTP/WS ───┘                                  ├── attachments/
                                                              └── backups/
```

### 5.1 LibraryService

Electron 主进程新增单一 `LibraryService`，负责：

- 打开、关闭和切换资料库；
- 读取资料库身份、能力清单、revision 与资源；
- 校验并提交资源级 mutation；
- 准备、提交和回滚附件变更；
- 调用导入、附件清理、备份和恢复；
- 串行化所有影响资料库的操作；
- 生成提交事件并分发给 IPC 与 WebSocket 订阅者；
- 记录并查询幂等 mutation receipt。

`LibraryService` 不依赖 Electron IPC、HTTP 或 React。传输层只做认证、参数解码、结果编码和错误映射。

### 5.2 传输层

- `IpcLibraryTransport`：服务 Electron renderer，保留 context isolation 与 preload 白名单；
- `LoopbackLibraryTransport`：服务本机浏览器，提供同源静态资源、HTTP API 与 WebSocket；
- 两个传输层调用同一批 `LibraryService` 方法，不复制校验、事务或备份规则。

Electron renderer 没有必要改走 HTTP。统一的是后端行为和事务边界，而不是为了形式一致牺牲 IPC 的安全优势。

### 5.3 前端适配器

存储提供者从二态改为明确运行模式：

- `electron-ipc`：Electron renderer 使用；
- `local-host`：由客户端托管的本机网页使用；
- `test-indexeddb`：浏览器自动化和明确开发模式使用。

生产浏览器页面不得自动回退到 `test-indexeddb`。本地服务不可用时只进入断线界面。

### 5.4 同版本网页资源

本地服务直接提供当前安装包 `dist/` 中的静态资源。顶栏入口始终打开该本地地址，因此浏览器 UI、领域类型、mutation 协议和客户端安装版本天然一致。

## 6. 持久化模型与 schema v10

当前 schema 为 v9。统一资料库服务进入生产前将 Electron 资料库升级为 v10。

v10 增加：

- `meta.snapshotRevision`：非负安全整数；
- `mutation_receipts`：保存近期 `operationId`、请求摘要、结果 revision 与结果摘要；
- 支持资源级 mutation 的统一提交入口。

迁移规则：

- 已存在有效 snapshot 的 v9 资料库初始化为 revision `1`；
- 空资料库初始化为 revision `0`；
- v9 → v10 使用数据库与 manifest 成对恢复标记，并在替换前创建、验证迁移恢复点；
- 迁移失败时恢复完整 v9 对，不允许数据库和 manifest 版本分裂；
- v10 资料库不得被旧版客户端静默打开或降级写入。

服务器继续以规范化完整 snapshot 作为磁盘事实，但所有日常写入先按资源变更合并到当前 snapshot，再执行整体验证与原子持久化。

## 7. 资源边界

并发冲突以资源为单位，不以整个 snapshot 为单位。首版资源键固定如下：

- `trade:<id>`：单条交易或案例；
- `weekly-review:<id>`：单篇周复盘；
- `quick-note:<id>`：单篇随记；
- `strategy:<id>`：单个策略；
- `weekly-risk-preparation:<weekStart>`；
- `risk-policy-version:<id>`；
- `monthly-risk-limit:<id>`；
- `risk-override-event:<id>`；
- `profile`、`display`、`shortcuts`：各自独立的单例资源；
- `tag-presets`、`mistake-tag-presets`、`saved-trade-views`、`symbol-icons`、`symbol-catalog`、`review-templates`：按现有集合分别作为资源；
- `starred-ids`、`subscribed-ids`、`pinned-strategy-ids`：分别作为集合资源；
- `live-stats-start-trading-day-key`：独立单例资源。

同一 mutation 可包含多个资源，适用于需要保持领域不变量的操作，例如“交易状态 + 活动记录 + 风控确认”。批量 mutation 全部成功或全部失败。

同一资源中的不同字段首版仍视为冲突。该选择优先保护正文、复盘和交易事实，避免错误的逐字段拼接。

## 8. Mutation 协议

逻辑请求结构：

```ts
interface LibraryMutationRequest {
  operationId: string
  libraryId: string
  baseRevision: number
  changes: Array<{
    resourceKey: string
    expectedHash: string | null
    kind: 'put' | 'delete'
    value?: unknown
  }>
  preparedAssetIds?: string[]
}
```

规则：

1. `operationId` 由调用端在操作开始时生成，重试不得更换；
2. `expectedHash` 是编辑前规范资源的 SHA-256；资源原本不存在时为 `null`；
3. `baseRevision` 用于快速路径、诊断和事件排序，但不是唯一冲突依据；
4. 当前 revision 等于 `baseRevision` 时可直接进入资源校验；
5. 当前 revision 已前进时，只要所有目标资源的当前哈希仍等于 `expectedHash`，服务端就基于最新版自动合并；
6. 任一目标资源哈希不一致，整个 mutation 返回资源冲突，资料库零变化；
7. 合并后的完整 snapshot 必须通过现有 codec、schema 和附件引用校验；
8. snapshot、资产索引、revision 与 receipt 必须作为一个逻辑提交完成；
9. 成功提交使 revision 恰好加一；失败不得改变任何持久状态；
10. 相同 `operationId` 与相同请求摘要返回原结果；相同 ID 携带不同请求必须拒绝。

`mutation_receipts` 至少保留最近 1,000 条或 24 小时内的记录，以更晚到达者为准。清理 receipt 不改变业务 revision。

## 9. 附件提交

附件不通过 WebSocket 广播字节，也不允许先成为正式附件后再等待快照引用。

流程：

1. 调用端创建 `operationId` 并上传附件到主进程准备区；
2. 服务端生成安全附件 ID，校验 MIME、大小、路径和图像处理结果；
3. mutation 通过 `preparedAssetIds` 引用准备附件；
4. 服务端校验合并后的 snapshot 确实引用这些附件；
5. 正式附件、资产索引、snapshot、revision 与 receipt 作为一个可恢复逻辑提交；
6. mutation 取消、冲突、过期或客户端断开后，准备附件按 TTL 清理；
7. 删除或 GC 继续复用当前引用复查、恢复清单和故障恢复协议。

这样 Electron 与浏览器不再分别拥有不同的附件落盘时序。

## 10. 实时事件与前端状态

成功提交后，`LibraryService` 生成：

```ts
interface LibraryCommitEvent {
  libraryId: string
  revision: number
  operationId: string
  changedResourceKeys: string[]
}
```

- Electron 通过 IPC event 接收；
- 浏览器通过已认证 WebSocket 接收；
- 事件只携带 revision 与资源键，不广播完整 snapshot 或附件；
- 收到事件后，客户端按资源键读取最新版并更新 Zustand；
- 发送方也以服务端确认结果为准，不把本地候选当作已提交事实；
- WebSocket 重连后先读取当前 envelope；revision 有缺口时执行完整 rehydrate；
- 正常本机提交至另一端可见的目标延迟为 500ms 内。

现有 `schedulePersist(fullSnapshot)` 将逐步替换为资源级 persistence client。它维护：

- 最近一次服务端确认的资源基线与哈希；
- 当前 dirty 资源；
- 每个进行中 operation；
- 本地未提交草稿；
- 当前连接、libraryId 与 revision。

## 11. 冲突体验

两端编辑不同资源时，服务端自动合并到最新 revision。

同一资源冲突时：

- 服务端返回 `resource-conflict`、当前 revision、冲突资源键和服务端当前值；
- UI 不覆盖本地编辑器或表单；
- 非冲突远端资源仍可继续实时更新；
- 冲突资源停止自动提交；
- UI 提供“查看另一端版本”“复制我的草稿”“放弃草稿并加载新版”；
- 首版不提供“覆盖另一端”按钮，也不自动逐字段合并；
- 用户重新基于最新版编辑后生成新的 operation 与 expected hash。

## 12. 本机服务、会话与防护

### 12.1 监听边界

- 固定监听 `127.0.0.1:47631`；
- 不绑定 `0.0.0.0`、局域网网卡或 IPv6 外部地址；
- 端口被占用时只禁用浏览器访问能力，不影响 Electron 客户端继续使用资料库；
- 客户端显示明确错误和重试入口，不静默改用随机端口。

### 12.2 打开与认证

1. 用户点击顶栏“在浏览器中打开”；
2. 主进程生成 60 秒有效、仅可使用一次的随机令牌；
3. 默认浏览器打开 `http://127.0.0.1:47631/#token=...`；
4. 页面从 fragment 读取令牌并立即清除地址栏 fragment；
5. 页面以 POST 交换本机会话；
6. 服务端设置 `HttpOnly; SameSite=Strict; Path=/` 会话 cookie，并返回 CSRF nonce；
7. 会话密钥只存在客户端进程内，客户端重启后旧 cookie 自动失效；
8. 会话最长 12 小时，且不得超过当前客户端进程生命周期。

### 12.3 请求防护

- 只接受精确 `Host: 127.0.0.1:47631`；
- mutation、附件和 WebSocket 必须校验精确 Origin；
- 所有状态变更请求同时要求会话 cookie 与 CSRF nonce；
- 不设置跨域响应头，不允许 wildcard CORS；
- GET 不得产生业务写入；
- 静态资源使用严格 CSP，禁止第三方脚本和远程 frame；
- 拒绝 token 重放、会话跨进程复用和 libraryId 不匹配；
- 日志不得记录令牌、cookie、正文、附件字节或资料库路径。

## 13. 断线、重连与切库

- WebSocket 中断或 HTTP 健康检查失败后，网页立即冻结所有业务写入；
- 当前文本与表单草稿可写入当前标签页 `sessionStorage`，键必须包含 libraryId、resourceKey 与 baseRevision；
- `sessionStorage` 只保存未提交草稿，不保存完整资料库或附件，不构成第二数据真源；
- 断线期间禁止上传附件、导入、恢复、GC 和备份管理；
- 同一客户端与同一资料库恢复后，网页自动重连并重新校验 revision；
- 资源未变化时可重试原 operation；资源已变化时进入冲突流程；
- 客户端切库时先广播 `library-invalidated`，随后撤销全部浏览器会话；
- 新资料库不得自动接收旧资料库草稿，只允许用户复制文本或丢弃；
- 客户端正常退出发送 shutdown 事件；异常退出由连接断开触发相同行为。

网页刷新后可恢复同一标签页的文本草稿；未提交图片只保留在内存，刷新或断线后要求重新选择，避免在浏览器建立附件副本。

## 14. 能力清单与界面边界

服务端 bootstrap 返回能力清单，至少包括：

- `libraryRead`、`libraryWrite`；
- `assetRead`、`assetWrite`、`assetGc`；
- `backupCreate`、`backupVerify`、`backupRestore`、`backupDelete`；
- `archiveImport`、`archiveExport`。

数据界面按能力渲染，不再用 `isElectron()` 推断备份和附件功能。本机浏览器连接客户端后可以使用完整数据管理能力。

窗口热键、窗口尺寸、托盘、全屏和软件更新继续由 Electron 环境判断，并且不通过本地 HTTP 暴露。

## 15. 故障语义

服务层使用稳定错误码，传输层不得把它们降级为模糊字符串：

- `resource-conflict`：目标资源已变化；
- `revision-invalid`：revision 元数据损坏；
- `library-switched`：资料库身份已变化；
- `operation-reused`：operationId 被不同请求重复使用；
- `asset-prepare-expired`：准备附件已过期；
- `validation-failed`：合并后领域或附件引用校验失败；
- `storage-unavailable`：磁盘或资料库暂时不可用；
- `session-invalid`：本机会话失效；
- `service-disconnected`：客户端主机不可达。

存储故障、校验失败和冲突必须保持 snapshot、附件、revision 与 receipt 全部不变。响应丢失后的同 ID 重试从持久化 receipt 返回原结果。

## 16. 备份、恢复和强制退出

- 自动备份仍只由客户端主进程调度，避免多个页面重复创建；
- 浏览器可以显式请求创建、验证、恢复或删除备份，但实际操作仍由 `LibraryService` 独占执行；
- 恢复、导入和切库期间冻结全部 renderer 与浏览器写入；
- 成功恢复后生成新的当前 revision，并广播完整 rehydrate 要求；
- 强杀、断电或崩溃只保证最后一次已确认 revision，与现有客户端承诺一致；
- v10 必须继续通过现有原子文件、备份验证和 forced-kill 证据门。

## 17. 实施阶段

### 阶段 A：客户端 revision 基座

- 完成 v9 → v10 安全迁移；
- 引入 `LibraryService`、持久化 revision、receipt 与统一操作队列；
- 现有 Electron IPC 改为薄传输层；
- 在没有浏览器功能时先证明客户端行为与恢复能力不退化。

### 阶段 B：资源级提交

- 定义资源映射、规范哈希与 mutation codec；
- 替换 renderer 全量快照防抖保存；
- 接入资源冲突状态、草稿保留和幂等重试；
- 覆盖所有写入口，禁止绕过 `LibraryService`。

### 阶段 C：本机网页主机

- 提供静态资源、认证、HTTP API、WebSocket 和安全门；
- 新增 `LocalHostStorageAdapter`；
- 顶栏增加“在浏览器中打开”；
- 使用 capability 替代数据功能的 Electron 环境判断。

### 阶段 D：实时与断线体验

- 接入资源事件、局部拉取、reconnect rehydrate；
- 增加断线只读态、sessionStorage 草稿和切库失效；
- 关闭生产网页版 IndexedDB 业务写入。

每个阶段独立提交、独立验证，不允许在 revision 基座未稳定时直接开放浏览器写入。

## 18. 测试与发布门

### 18.1 服务合同

- 同一套服务合同分别经 IPC 与 HTTP 运行；
- 相同输入必须得到相同 revision、数据、错误码和附件结果；
- 任何传输层不得自行实现业务校验。

### 18.2 并发矩阵

- 两端从同一 revision 编辑不同交易，两个 mutation 均成功；
- 两端编辑同一交易，第一项成功，第二项 `resource-conflict` 且草稿保留；
- 批量 mutation 任一资源冲突时全部回滚；
- 响应丢失、断线重试与进程重启后，相同 operationId 不重复创建数据；
- 远端事件不覆盖本地 dirty 资源。

### 18.3 附件与恢复

- snapshot 与新附件在任一故障点都只能全部出现或全部不出现；
- 冲突、取消和超时准备附件可以安全回收；
- GC 不删除任一客户端最新 revision 中仍被引用的附件；
- 备份、恢复、导入和强杀测试继续验证真实字节与资料库身份。

### 18.4 本机安全

- 非 loopback 连接、错误 Host、错误 Origin、缺少 CSRF、令牌重放和过期会话全部拒绝；
- 切库和客户端重启后旧会话不可继续读写；
- 日志扫描确认不包含访问凭证、正文、附件内容或真实资料库路径；
- 端口占用只降级浏览器功能，不阻断桌面资料库。

### 18.5 端到端与性能

- 使用打包后的真实 EXE 启动本机服务，再由真实 Chromium 完成双端读写；
- 成功提交到另一端可见的本机目标为 500ms 内；
- 10K 交易资料库的正常实时事件不得携带完整 snapshot；
- WebSocket 断线、重连、客户端重启和切库均有真实浏览器测试；
- 生产连接模式测试必须证明 IndexedDB 未写入交易、复盘或附件；
- 现有 typecheck、全量测试、治理、bundle budget、Electron 平台安全和 Windows EXE 构建继续作为发布门。

## 19. 完成标准

仅当以下条件同时满足，才可宣称网页端与客户端存储逻辑统一：

1. 两端所有数据操作最终进入同一个 `LibraryService`；
2. 生产网页不存在可写的独立业务资料库；
3. Electron 资料库具备持久化 revision、资源前置条件和幂等 receipt；
4. 不同资源可并发提交，同一资源冲突不丢草稿；
5. 两端在成功提交后实时更新；
6. 客户端断开、切库和重启期间网页无法写入旧资料库；
7. 浏览器访问不能离开本机回环边界；
8. 附件、备份、恢复和 forced-kill 保证不低于当前客户端；
9. 打包 EXE 与真实浏览器端到端证据通过。
