# 2026-09-24 性能优化与验收

本轮覆盖桌面启动、批量记录处理、保存调度、快照引用校验、统计计算、搜索及虚拟列表。全部基准使用合成数据或本轮专用隔离资料库，没有操作用户真实交易资料库。没有修改设计 token、统计口径、风险门禁、磁盘事务或冲突恢复协议。

## 实测结果

Windows x64、Ryzen 9 9950X3D、Node 24.14.0。下表是同机、同样例的中位数；各行测量边界不同，不能合并为整款软件的加速倍数。

| 场景 | 优化前 | 优化后 | 测量边界 |
| --- | ---: | ---: | --- |
| 20K 批量新建 | 4,936.6 ms | 72.5 ms | 生产 Store 归一化与数组生成，不含落盘 |
| 20K 批量更新 | 10,505.2 ms | 47.9 ms | 同上 |
| 20K 周报引用校验 | 970.1 ms | 55.8 ms | 单个周报引用全体交易的压力样例 |
| 10K 统计计算 | 16.852 ms | 3.287 ms | 真实生产统计函数，不含选择器、渲染和 IPC |
| 50K 统计计算 | 171.280 ms | 36.150 ms | 同上 |
| 20K 连续正文搜索渲染 | 176.2 ms | 6.4 ms | React 渲染，已建立索引 |
| 20K 搜索输入至稳定帧 | 186.7 ms | 32.1 ms | 已建立索引的连续输入 |
| 100 次非持久化状态更新 | 100 次保存调度 | 0 次 | 无真实编辑的 Store 更新 |
| 交易日志首屏 JS | 247.6 KB | 235.4 KB | 静态依赖树，gzip level 9 |
| 已有资料库启动快照读取 | 2 次 | 1 次 | 仍建立写入会话并执行完整校验 |
| 10K Electron 重载至列表稳定 | 1,852.490 ms | 1,497.978 ms | 3 次预热、10 次采样，含真实本地资料库读取 |

统计基准使用 10 次预热、50 次交替采样，10K P95 为 23.382 → 4.634 ms。存储纯函数基准为 1 次预热、3 次采样。20K 首次未缓存正文查询仍约 216.6 ms，不能把暖态收益解释为冷查询耗时。记录索引以不可变对象为弱键，编辑、策略更名与移除记录有对应失效回归。

桌面重载中位数降低 19.1%，P95 为 2,157.366 → 1,515.796 ms（降低 29.7%）。它测的是渲染进程重载，不是新进程冷启动。

## 实现

- `useStore.ts`：批量规范化保留输入顺序，用索引定位记录，最后一次生成交易数组；保留新增逆序、重复 ID 覆盖、活动记录、类型与阶段保护。
- `persist.ts`：保留不可变持久化字段的引用，恢复协调器对真实编辑与临时 UI 状态的区分。
- `snapshotValidation.ts`：验证重复 ID 后建立交易、阶段和政策索引，避免每个引用扫描整库。
- `bootstrap.ts`：复用已有快照；空库走原迁移函数，迁移后重新读取权威快照。原迁移 boolean API 和 preload revision 合同保留。
- `dashboardStats.ts` / `tradeTruth.ts`：复用每笔结果解析，以累计器完成总计和策略汇总；按业务日分桶后排序，保留同日顺序和浮点累加顺序。
- `CommandPalette.tsx`：正文索引、匹配与可见批次分别计算，翻页不重新解析所有正文。
- `useWorkbenchVisibleTrades.ts` / `TradeList.tsx`：只订阅影响筛选排序的偏好，稳定虚拟器回调，滚动时使用分组二分定位与星标集合。
- `DeferredTradeOverlays.tsx`：新建、平仓、风险和图片弹窗首次请求才加载，之后保留原挂载生命周期；包体积门禁防止重新进入首屏静态依赖。

## 正确性与桌面证据

- 统计原/新生产 bundle 的 1K、10K、50K 完整对象严格相等；额外覆盖结果权威组合、重复选择、无效日期、冻结业务日、现金 PnL 子集及浮点边界。
- 批量更新以 100 组混合输入对照原函数，除新生成的随机活动 ID 和时间外逐字段一致。
- `node scripts/benchmark-persistence.mjs --correctness-only` 覆盖 10K/20K 实际保存、附件、并发冲突、退出恢复点与重开；它不是严格多次磁盘性能统计。
- `pnpm build:app` 包含 TypeScript 和 Electron 构建；`pnpm qa:design` 检查现有设计合同。
- 全量回归入口为 `pnpm test`。首轮仅旧正文索引静态断言失败，已更新为真实调用链与行为断言；最终全套日志为 `test-results/performance-regression-final.log`。
- 桌面采集使用最新本地生产构建、全新 userData 和 library。10K 长正文样例，Windows 实际 200% 显示缩放，1440×960 和最小 960×640 外框；检查列表、搜索、新建弹窗展开/取消/再次打开、统计导航，并保留最终列表窗口。
- 截图、字体、弹窗几何、溢出和实际隔离路径见 `test-results/performance/final/desktop.json` 及同目录 PNG；CPU 采样见 `reload.cpuprofile`。本轮没有验证 macOS 实机或正式安装包。

## 复现与原始报告

```powershell
node scripts/benchmark-dashboard-production.mjs --baseline test-results/performance-analytics/dashboard-production-baseline.mjs --output test-results/performance-analytics/repeat.json
node scripts/benchmark-storage-hotpaths.mjs --output test-results/performance-storage/repeat.json
pnpm build:app
node scripts/benchmark-desktop-performance.mjs --label=repeat --verify
```

桌面基准固定使用临时隔离资料库；`--keep-open` 在验收后保留窗口供操作。桌面重载统计为 3 次预热、10 次采样，从 reload 到列表稳定两帧，不代表冷进程启动或安装包启动速度。采样前等待真实保存结束，不跳过未保存保护。

原始数据目录：`test-results/performance-analytics/`、`test-results/performance-storage/`、`test-results/performance-render/`、`test-results/performance/before/`、`test-results/performance/final/`。报告保留测量边界和原始样本；测量期间系统负载会影响绝对耗时。
