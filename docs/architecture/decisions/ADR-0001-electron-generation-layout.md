# ADR-0001：Electron Generation 布局暂不进入生产

- 状态：No-Go
- 日期：2026-07-23
- 适用范围：Spec v2 `GEN-SPIKE`
- 决策者：工程验证；发布负责人已复核

## 背景

Spec v2 要求用隔离 Spike 验证 generation 目录、完整性 marker 和原子 pointer 切换，且只在 Windows NTFS 与 macOS APFS 的故障矩阵都能够证明恢复结果不会混代时，才允许另立生产 Epic。本 ADR 不授权把 Spike 接入应用。

## 证据

授权证据由 `.github/workflows/generation-spike.yml` 在最终发布候选提交上生成：

- `generation-spike-Windows`：Windows NTFS 原始报告；
- `generation-spike-macOS`：macOS APFS 原始报告；
- `generation-decision-evidence`：只在两份同 commit、同 tree、干净工作树的原始报告均通过严格校验后生成。

`scripts/verify-generation-decision.mjs --require-complete` 负责聚合平台结论，`scripts/verify-release-train-evidence.mjs --require-complete` 再把两份原始报告和聚合决策绑定到最终 13 项质量清单。GitHub Actions run 与 artifact 是当前候选的权威原始证据；run 标识随候选提交变化，不固化到 ADR。`docs/superpowers/reports/generation-spike-windows-ntfs.json` 是早期 dirty 工作树上的历史探索报告，仅保留背景，不参与发布授权。

当前已复核的双平台证据表明：

- 17 个逐操作注入点，以及磁盘不足（两次预检）、pointer 目标占用、跨卷 `EXDEV`，均在重启恢复后只选择完整旧代或完整新代；
- pointer 缺失、pointer 损坏、新代不完整和旧代不完整均没有产生 mixed generation；
- 所有恢复选择均只校验现有文件、不复制 generation；Windows 最慢实测约 3.02 ms，低于 5 秒决策上限；
- `requiredFree = expandedTemp + rollbackCopy + max(512 MiB, operationBytes × 10%)` 已在第一次 mutation 前和 pointer 切换前检查；
- 非稀疏 20 MiB 操作的预测新增峰值为 20,971,596 bytes，NTFS 卷剩余空间实测增量峰值为 20,979,712 bytes，误差约 0.039%；
- 目录树峰值 37,749,990 bytes，低于 `activeLibrary × 2.2 + 512 MiB` 的 573,780,787.2 bytes 上限；
- Windows 文件 `fsync` 可执行，但当前 Node/Electron 运行时无法提供真实目录 `fsync` durability barrier，因此平台结论为 `NO_GO_ON_THIS_PLATFORM`；
- macOS APFS 完成相同故障矩阵并支持目录 `fsync`，平台结论为 `GO_ELIGIBLE_ON_THIS_PLATFORM`；
- 聚合器按 fail-closed 规则输出全局 `NO_GO`，Spec v2 §17.3 的双平台决策证据已闭环，但 macOS 通过不能消除 Windows 阻断。

## 决策

**No-Go。Generation 布局不进入生产，不部分上线，也不创建实施 Epic。**

原因是 Windows NTFS 支持范围内缺少可证明的目录 durability barrier。仅有文件 `fsync`、rename 和恢复校验不足以声称断电后的目录项顺序已持久化。按照 Spec 的 fail-closed 原则，只要一个承诺平台不能完成全部 durability 条件，整体决策就是 No-Go。

## 后续重新评估条件

只有同时满足以下条件，才可以新建独立 ADR 和重新估算的 Epic；不得直接修改本 ADR 为“部分 Go”：

1. 引入并验证 Windows 原生 `FlushFileBuffers`/等价目录 durability 方案，或采用不依赖目录 fsync 顺序的协议；
2. Windows NTFS 与 macOS APFS 在同一协议版本上重新跑完全部故障矩阵；
3. 两个平台的磁盘公式误差、恢复选择和生产 bundle 隔离再次通过；
4. 新方案经过独立安全审查，并单独规划迁移、回滚与用户恢复。

## 影响

- 当前生产资料库布局保持不变；
- Spike 代码只存在于 `scripts/spikes/electron-generation/`；
- `src/`、`electron/` 和 Electron Builder 的生产文件清单不包含 Spike；
- 本决策不改变 Release 0–3 的交付范围。
