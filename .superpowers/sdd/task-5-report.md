# Task 5 实施报告：实盘统计周期设置、影响预览与风险入口

## 实现

- 新增 `LiveCycleSettings`，在数据设置中提供建立、修改与清除实盘统计起点的流程。
- 默认起点优先采用最早的已确认风险规则生效日；本任务 fixture 的默认值为 `2026-07-27`。
- 确认前显示规则前实盘、当前周期、无法判断三项数量，以及每笔记录的 ref、品种和开仓时间。无法判断或未来日期不能确认。
- 保存先写入 store，再调用 `flushPersistNow()`；失败时恢复先前起点并尝试持久化回滚，不展示成功提示。
- 风险预算卡在可截断或开仓日期无法判断时提供设置 CTA；日/周/月标题会注明周期中的截断起点，限额数值保持完整规则值。
- `?visual=dialog` 保持真实预览弹窗打开，供移动端自动 QA。

## RED / GREEN 证据

### RED

命令：

```powershell
node scripts/run-browser-tests.mjs D:\Trader-Atlas D:\Trader-Atlas\vite.config.ts
```

原始关键输出：

```text
FAIL src/components/LiveCycleSettings.browser.test.html
Failed to resolve import "@/components/LiveCycleSettings" from "src/components/LiveCycleSettings.browser.test.tsx". Does the file exist?
```

该失败发生于新增测试已写入、生产组件尚不存在时，符合预期。

### GREEN

同一浏览器命令最终输出：

```text
PASS src/components/LiveCycleSettings.browser.test.html
```

并且命令以 exit code 0 完成，所有发现的浏览器测试均通过。

## 验证

```text
node scripts/run-browser-tests.mjs D:\Trader-Atlas D:\Trader-Atlas\vite.config.ts  -> exit 0
pnpm qa:risk-management-mobile                                  -> PASS: risk management and live cycle mobile QA at 420×844
pnpm typecheck                                                   -> exit 0
git diff --check                                                  -> exit 0，无输出
```

移动端 QA 检查了 420×844 下的风险准备卡、风险预算卡、开仓 Gate 和实盘新周期预览：均无横向溢出，预览数量卡为单列，弹窗 footer 与主操作完整可见，主操作高度不少于 44px。

## 文件

- `src/components/LiveCycleSettings.tsx`
- `src/components/LiveCycleSettings.css`
- `src/components/LiveCycleSettings.browser.test.tsx`
- `src/components/LiveCycleSettings.browser.test.html`
- `src/components/RiskBudgetCard.tsx`
- `src/views/settings/DataSettingsPanel.tsx`
- `scripts/qa-risk-management-mobile.mjs`

## 自查与风险

- 未改写历史交易、未升级 schema、未新增依赖、未加入多周期或历史 URL 筛选。
- 保存失败后，store 回到保存前起点；回滚后的第二次 flush 若仍失败会被安全吞掉，原始失败提示保持准确，不会虚报成功。
- 浏览器回归日志中现有 Notion、路由和图片持久化测试会输出其预期的 console error，但测试运行器仍以 exit code 0 通过；本任务页面没有浏览器诊断错误。
