# 周复盘路由与返回状态最终修正报告

日期：2026-08-02
分支：`codex/weekly-review-route-return-state`
修正基线：`25e957ccd2adde93178d2babd35a1fc3413e2b06`

## 结果

五个 Important finding 已在同一修正波内完成。实现未新增依赖、未改变持久化 schema、未改变周复盘计算或冻结数据，也未构建 EXE。独立只读审查最初提出的两个后续 Important 和一个测试 Minor 也已补测并闭环。

## Finding 1：详情返回冻结来源周

变更文件：

- `src/lib/weeklyReviewRouteState.ts`
- `src/lib/weeklyReviewRouteState.test.ts`
- `src/lib/tradeRoute.ts`
- `src/hooks/useTradeReturnAnchor.ts`
- `src/views/WeeklyReviewView.tsx`
- `src/views/WeeklyRiskEvidence.tsx`
- `src/views/DetailView.tsx`
- `src/views/WeeklyReviewView.browser.test.tsx`
- `src/regression.test.ts`

实现与验证：

- `TradeDetailFrom` 分离规范来源 `search` 与冻结返回 `restoreSearch`；冻结值始终显式携带精确 `selectedWeek`，年度页签显式携带 `tab=year`，无关参数继续保留。
- app return 与 browser back 都通过一次性返回请求恢复冻结周、页签和锚点；来源 sessionStorage key 仍使用实际规范来源地址。
- 只有从显式 state/sessionStorage 验证得到的返回周可临时越过 `availableWeeks`；普通不可用深链仍规范化到当前周。
- 锚点超过 30 秒后不再滚动/聚焦，但一次性冻结 route context 仍可恢复 URL；stored 与显式请求均覆盖此语义。
- 真实浏览器覆盖：当前周在详情打开期间跨交易周后 app return、browser back；activity-only 历史周的交易消失后返回；同一不可用周的普通深链；缺失目标焦点与提示；未创建空周复盘实体。

RED 证据：

- `node scripts/run-regression-tests.mjs --unit-only src/lib/weeklyReviewRouteState.test.ts` → exit 1：`已验证返回请求必须临时放行原周`。
- `node scripts/run-browser-tests.mjs . vite.config.ts` → exit 1：`业务周推进后返回没有冻结原来源周`。
- `node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts` → exit 1：`锚点过期后仍须保留单次冻结路由上下文`。
- 独立审查后补强显式过期路径，同一 regression 命令 → exit 1：`过期显式锚点不得继续触发滚动与焦点恢复`。

GREEN：上述两个 unit 命令及完整浏览器矩阵最终均 exit 0。

## Finding 2：安全消费显式恢复状态

变更文件：

- `src/hooks/useTradeReturnAnchor.ts`
- `src/views/DetailView.tsx`
- `src/views/WeeklyReviewView.browser.test.tsx`

实现与验证：

- 显式 `restoreTradeId` 在请求接收时立即从 router state 通过 replace 消费，不等待恢复成功或超时。
- `selfReplaceRef` 识别自身的 state/search replace，保留现有 pending，不重建、不取消、不被旧请求覆盖。
- 显式 state、当前 route storage 与原规范来源 storage 使用 `createdAt` 选取最新请求；有效 storage 仍单次消费。
- 真实浏览器覆盖 `A 开始但未完成 → 打开 B → browser back`，只允许 B 开始并获得焦点；A 不得完成或触发 missing；state/storage 均已消费。

RED：`node scripts/run-browser-tests.mjs . vite.config.ts` → exit 1：`浏览器返回后最新的恢复请求 B 没有获得焦点`。
GREEN：完整浏览器矩阵最终 exit 0。

## Finding 3：Board 卡片自身作为返回焦点

变更文件：

- `src/hooks/useTradeReturnAnchor.ts`
- `src/views/WeeklyReviewView.browser.test.tsx`
- `src/regression.test.ts`

实现与验证：

- 继续优先可见的 `data-trade-primary-action` 后代，其次是可用 button/link。
- 后代均不可用时，只有目标自身可见、启用且可聚焦才作为 fallback。
- hidden、`aria-hidden`、disabled、`aria-disabled`、closed details 与实际布局可见性检查没有放宽。
- 浏览器夹具验证 Board card 自身获得焦点并居中，且不调用 `onMissing`；隐藏目标的 `onMissing` 直接计数并严格等于一次。

RED：`node scripts/run-browser-tests.mjs . vite.config.ts` → exit 1：`看板卡片自身没有获得返回焦点`。
GREEN：完整浏览器矩阵最终 exit 0。

## Finding 4：旧异步周切换不得覆盖新路由意图

变更文件：

- `src/views/WeeklyReviewView.tsx`
- `src/views/WeeklyReviewView.browser.test.tsx`

实现与验证：

- 使用单调 `routeIntentGenerationRef`；任何后续周选择、页签选择、router location 操作或卸载都会使旧 intent 失效。
- Data Router 使用同步 `router.subscribe`；classic Router 在组件生命周期内包装 `push/replace/go`，并监听原生 `popstate/hashchange`，因此失效发生在旧 flush Promise 微任务恢复前。
- 只有 generation 仍为最新的周切换能在 flush 后写 URL；当前 intent 保存失败仍阻止导航并显示 `正文尚未保存，请重试`。
- 浏览器测试使用真实 `flushNoteDraftToStore()` 和可控 `storage.saveAsset` Promise，逐次订阅 router 写入，覆盖 week→tab、week A→week B、browser navigation 同步释放 flush、pending flush 时卸载，以及当前 intent 保存失败。

RED 证据：

- 初始竞态测试：完整浏览器命令 → exit 1：`较旧的周切换在 flush 后覆盖了较新的页签意图`。
- 独立审查后将 browser navigation 改为 router subscription 内同步释放 flush：完整浏览器命令 → exit 1：`flush 等待期间的浏览器导航没有生效`。

GREEN：`node scripts/run-browser-tests.mjs . vite.config.ts` 最终 exit 0；所有路由写入和卸载断言通过。

## Finding 5：真实日期与周一校验

变更文件：

- `src/lib/weeklyReviewRouteState.ts`
- `src/lib/weeklyReviewRouteState.test.ts`

实现与验证：

- `week` 必须同时满足严格 `YYYY-MM-DD`、本地日期 round-trip 相同、星期一，并且存在于 `availableWeeks` 或等于已验证返回周。
- 非法 owned 参数被清除并回到当前周，无关参数继续保留。
- 测试故意把 `2026-02-30` 和非周一 `2026-07-22` 放入 `availableWeeks`，证明成员关系不足以使其合法。

RED：`node scripts/run-regression-tests.mjs --unit-only src/lib/weeklyReviewRouteState.test.ts` → exit 1：`2026-02-30 即使存在于 availableWeeks 也不得成为有效周起始日`。
GREEN：同命令最终 7 项全部 PASS，exit 0。

## 最终门禁

- `node scripts/run-regression-tests.mjs --unit-only src/lib/weeklyReviewRouteState.test.ts` → exit 0，7/7 PASS。
- `node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts` → exit 0，全部 PASS，含 stored/explicit 过期返回上下文。
- `node scripts/run-browser-tests.mjs . vite.config.ts` → exit 0（50.8s），全部入口及 WeeklyReviewView 的 1920×1080、1280×900、768×1024、375×812 视口 PASS。
- `pnpm typecheck` → exit 0（7.4s）。
- `pnpm test` → exit 0（71.6s）；包含完整 browser、移动风险 QA 和治理门；`GOV PASS：60 个场景，723 个 UTF-8 文本文件`。
- `git diff --check` → exit 0。

浏览器输出中的 Notion 限额、持久化失败、broken route 和 destroyed editor 图片日志均来自套件内预期的负向夹具；命令最终 exit 0。

## 自审

- 变更限定为 9 个源/测试文件及本报告；未修改 `package.json`、lockfile、持久化类型/schema、周指标/风险计算、样式或发布配置。
- 无新增依赖、迁移、EXE、生成产物或无关工作树改动。
- app return、browser back、旧请求竞争、Board 自身焦点、隐藏目标、跨周、实体消失、普通深链、慢 flush、同步 location 竞态、卸载和保存失败均走生产实现。
- 独立只读审查初次 verdict 为 No（2 Important、1 Minor）；两项 Important 已分别 RED→GREEN，Minor 卸载用例已补齐；同一审查员复核最终 diff 后给出 `Ready: Yes`，Critical/Important/Minor 均为 none。
- 可选 `.dv-crumb`/软删除夹具未扩展：本波没有修改对应 `DetailShortcutNavigation` 浏览器夹具，遵守 brief“不为测试项扩大生产范围”的约束。

## 编码检查

对所有变更文件逐一使用严格 `UTF8Encoding(false, true)` 解码，并检查前三字节不是 `EF BB BF`；结果全部 `UTF8-NOBOM`。治理门同时报告 723 个 UTF-8 文本文件通过。

## 关注点

无阻塞 concern。同步 route-intent 失效使用 React Router 6.30.4 提供的 Data Router context 与 classic navigator 契约；当前类型检查、classic MemoryRouter、Data Router、Browser/Hash 对应行为和完整浏览器矩阵均已覆盖。未来升级 React Router 时应复核这一同步适配层。
