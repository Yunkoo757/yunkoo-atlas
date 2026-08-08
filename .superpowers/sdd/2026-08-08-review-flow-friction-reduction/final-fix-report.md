# Final fix report — review-flow-friction-reduction

日期：2026-08-08

Fix base：`c527f32`

范围来源：`final-review-findings.md` 中 2 个 Important 与 3 个 Minor

状态：五项已修复并完成 RED/GREEN 与全量门禁。

## 范围与决议

- 案例正文仍不显示 inline copy；live 与 paper 恢复原 inline copy。
- case/live/paper 的顶部“更多 → 复制编号”均继续可用，并复制当前记录编号。
- 图片加载只新增组级 `aria-busy` 与一个视觉隐藏 `role="status"`；骨架继续逐槽位 `aria-hidden`，没有逐图播报。
- 未改变图片 settled 原子提交、加载代次、错误槽位、固定几何或对象资源生命周期。
- 未改 Sidebar、schema、依赖、版本、设计规格状态或打包配置；未运行、未声称 EXE 打包。

## Finding 1 — Important：shared detail scope regression

### RED

先在 `DetailShortcutNavigation.browser.test.tsx` 增加真实 `DetailView` 行为断言：案例没有 `.dv-copy-id`，实盘与模拟盘存在 inline copy；三种类型的“更多 → 复制编号”都复制当前编号。生产代码尚未修改时运行：

`node scripts/run-browser-tests.mjs . vite.config.ts` → **Exit 1**（66.7s）。

精确失败：`实盘详情必须保留正文侧栏复制编号入口`。案例无 inline copy 与案例 More copy 在到达该失败前已通过。

### GREEN

在 `DetailView.tsx` 仅对 `trade.tradeKind !== 'case'` 恢复属性区 footer；在 `DetailView.css` 恢复原 footer/copy 样式及窄屏 44px 触控高度。没有新增复制实现，继续复用 `copyRef`。

`node scripts/run-browser-tests.mjs . vite.config.ts` → **Exit 0**（65.3s）；最终复验同命令 → **Exit 0**（65.5s）。真实交互覆盖 case/live/paper inline 可见性和三类 More copy。

### 变更文件

- `src/views/DetailShortcutNavigation.browser.test.tsx`
- `src/views/DetailView.tsx`
- `src/views/DetailView.css`

## Finding 2 — Important：silent image-group loading state

### RED

先在 `ReviewSessionImageReadiness.browser.test.tsx` 增加行为断言：settling 时 gallery 为 `aria-busy="true"`，组内恰有一个视觉隐藏 `role="status"` 且文案为“交易截图载入中…”；settled 后 `aria-busy="false"` 且加载 status 移除。生产代码尚未修改时运行：

`node scripts/run-browser-tests.mjs . vite.config.ts` → **Exit 1**（66.7s）。

精确失败：默认与 1920/1280/768/375 变体均在 `图片组 settling 期间必须标记 aria-busy` 失败。

### GREEN

在 gallery 边界添加 `aria-busy={!imagesReady}`；仅 loading 分支渲染一个 `.review-session-gallery-status[role="status"]`，CSS 以 1px/clip 方式视觉隐藏。所有 skeleton 继续 `aria-hidden="true"`，图片 settled/代次逻辑未改。

`node scripts/run-browser-tests.mjs . vite.config.ts` → **Exit 0**（65.3s）；最终复验 → **Exit 0**（65.5s）。原有原子显示、几何不变、迟到请求隔离、部分失败稳定槽位与灯箱来源断言继续通过。

### 变更文件

- `src/views/ReviewSessionImageReadiness.browser.test.tsx`
- `src/views/ReviewSessionView.tsx`
- `src/views/ReviewSessionView.css`

## Finding 3 — Minor：non-default snapshot false green

### RED

测试先把当前轮次设置为非默认快照：`includeAccountTrades:false`、`requireContent:true`。完成一轮后断言“再随机一轮”保留它；“重新设置”恢复同一草稿；修改草稿后取消不得提交，再次打开仍恢复完成轮次快照。

为证明该增强测试不再假绿，临时把 production 的 reshuffle `filters` 改成 `DEFAULT_REVIEW_SESSION_FILTERS`（只用于 mutation，随后立即恢复），运行：

`node scripts/run-browser-tests.mjs . vite.config.ts` → **Exit 1**（66.2s）。

默认与四档显式视口均精确失败于：`再随机一轮不得把非默认筛选快照硬编码回默认值`。临时 mutation 未进入最终 diff。

### GREEN

恢复原生产实现 `filters: session.filters` 后，完整 runner → **Exit 0**（65.5s）。当前 production 本来正确，本 finding 的最终改动仅加强真实浏览器覆盖。

### 变更文件

- `src/views/ReviewSession.browser.test.tsx`

## Finding 4 — Minor：no-op assertion checks the wrong trade

### RED

测试在重复评估前后均用 `reviewCase.id` 从 store 解析队列目标，再比较目标案例序列化快照，不再读取未入队的 `trades[0]` 账户交易。

为证明断言会抓到目标损坏，临时在 rewind 路径直接污染 `prevId` 对应案例（只用于 mutation，随后立即恢复），运行：

`node scripts/run-browser-tests.mjs . vite.config.ts` → **Exit 1**（66.8s）。

默认与四档显式视口均精确失败于：`返回 no-op 评估不得改写队列中的目标案例`。原先比较 `trades[0]` 会漏掉该 mutation；临时 mutation 未进入最终 diff。

### GREEN

恢复未改写交易的原生产路径后，完整 runner → **Exit 0**（65.5s）；重复评估仍推进队列、不新增 UndoAction，返回后目标案例保持不变。

### 变更文件

- `src/views/ReviewSession.browser.test.tsx`

## Finding 5 — Minor：missing 768/1920 viewport evidence

### RED

使用真实 `discoverBrowserTests(process.cwd())` 对两个随机复盘 HTML 的已发现 viewport 宽度断言 `[375, 768, 1280, 1920]`。临时还原 base 元数据（流程夹具无声明且 root 固定 1280；图片夹具仅 1280/375）后运行 one-off discovery assertion → **Exit 1**（0.2s）。

精确失败：`ReviewSession.browser.test.html did not execute all required widths`；actual `[]`，expected `[375,768,1280,1920]`。

### GREEN

两个夹具都声明 `1920x1080,1280x900,768x1024,375x812`；流程夹具 root 改为 `width:100%; min-height:100vh`，图片夹具原本已响应式。相同 discovery assertion → **Exit 0**（0.2s），输出 `PASS random-review fixtures execute 375/768/1280/1920`。

完整 runner 的实际执行记录同时包含：

- `ReviewSession.browser.test.html` 默认、1920×1080、1280×900、768×1024、375×812 全 PASS；
- `ReviewSessionImageReadiness.browser.test.html` 默认、1920×1080、1280×900、768×1024、375×812 全 PASS。

### 变更文件

- `src/views/ReviewSession.browser.test.html`
- `src/views/ReviewSessionImageReadiness.browser.test.html`

## 最终验证命令

| 命令 | Exit | 结果摘要 |
| --- | ---: | --- |
| `node scripts/run-regression-tests.mjs --unit-only src/lib/reviewSession.test.ts src/lib/reviewImageReadiness.test.ts src/regression.test.ts` | 0 | focused review-session/image-readiness 与共享回归全 PASS |
| `node scripts/run-browser-tests.mjs . vite.config.ts` | 0 | 完整 browser runner；详情、流程、图片及时序四档均 PASS |
| `pnpm typecheck` | 0 | renderer 与 Electron TypeScript 检查通过 |
| `pnpm test` | 0 | 全量测试通过；含完整 browser runner、420×844 mobile QA、governance |
| `pnpm build` | 0 | typecheck、Vite production build、bundle budget 全通过 |
| `pnpm qa:risk-management-mobile`（由 `pnpm test` 执行） | 0 | `PASS: ... mobile QA at 420×844` |
| `node scripts/check-governance.mjs --require-execution` | 0 | `GOV PASS：60 个场景，747 个 UTF-8 文本文件` |
| `pnpm check:bundle` | 0 | 239.2/353.6/451.2 KB 三档预算均 PASS |
| `git diff --check` | 0 | 无 whitespace error；仅 Git 的未来 CRLF checkout 提示 |

## UTF-8 与 BOM

对 9 个源码/测试/夹具文件及本报告共 10 个 fix 文件执行严格 UTF-8 decoder（异常即失败），并逐文件检查前三字节不是 `EF BB BF`：**Exit 0**，输出 `PASS strict UTF-8/no BOM: 10 files`。报告更新后再次执行相同检查并运行 `git diff --check`，结果见提交前终检。

## 自审

- 逐项对照五个 finding，未处理列表外问题。
- 生产行为只改两个 Important：按 trade kind 恢复共享页脚、补组级图片可访问加载状态。
- Minor 1/2/3 只修测试证据与夹具，不借机改现有正确 production 行为。
- 图片 atomic/代次/settled/error、Sidebar、schema、依赖、版本与打包均未变。
- 设计规格的完成标准与验证陈述仍成立，无需修正文档；本轮没有声称 EXE packaging。

## 顾虑

无已知功能或门禁顾虑。完整 browser runner 会输出由测试显式允许的预期错误场景日志（导入限制、持久化失败、错误边界、销毁后图片持久化），但 runner 最终 Exit 0，且未出现非允许诊断。
