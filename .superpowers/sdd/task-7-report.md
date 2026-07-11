# Task 7 实施报告

## 状态

完成。导入、直接 merge 与快照恢复均通过 `normalizeDisplay` 这一条规范化链路；新增可重复执行的 `qa:sidebar`，覆盖计划中的九类场景与 1920、1440、900、390 四个 viewport。

## TDD 记录

- RED：`testMergeImportPayloadNormalizesCorruptedDisplay` 失败，证明直接 merge 会绕过工作区项目去重与 order 重写。
- GREEN：将 `mergeImportPayload` 的 display 合并结果交给现有 `normalizeDisplay`，没有在 `importExport.ts` 复制侧栏规则。
- 导出 → JSON 解析 → merge 往返测试覆盖四类目标、顺序、placement、失效引用、语义去重、第 9 个 pinned 转 overflow，以及 paper 最终解析到 `/sim`。
- 补齐 Task 1 审查记录：显式 `sidebarWorkspaceItems` 优先于 `sidebarPins`；`replaceSidebarWorkspaceItems` 会再规范化且不改 `sidebarPins`。

## 浏览器 QA

`scripts/qa-sidebar-navigation.mjs` 真实验证：

1. 默认四核心与四个系统工作区项目。
2. 保存视图、策略、案例视图混排及第 9 个 overflow。
3. 精确项唯一强选中，附加筛选只显示 modified 圆点。
4. 再点固定项恢复原始查询。
5. 今日、交易、案例恢复 pathname、search 与 list/board/table 模式。
6. 列表、看板、表格打开详情并返回后，以目标元素和滚动容器 bounding box 验证来源交易位于 viewport。
7. 删除保存视图后日常侧栏隐藏，管理器显示失效项并可移除。
8. Escape 取消、完成持久化、撤销、焦点返还及移动端模态焦点约束。
9. 1920、1440、900、390 无横向溢出，390 使用五项底栏、更多抽屉与全屏管理器。

QA 同时收集未捕获页面错误、console error、React key 和可访问名称警告；本次运行未发现问题。

## 完整验证

- `pnpm test`：退出码 0。
- `pnpm build`：退出码 0，2665 modules transformed。
- `pnpm qa:design`：退出码 0，5 项设计契约全部 PASS。
- `pnpm qa:sidebar`：退出码 0，九类场景、三种详情返回锚点与四个 viewport PASS。
- 占位符检查：未发现新增 TODO/FIXME。
- `git diff --check`：退出码 0。
- UTF-8 检查：四个计划文件及本报告均为 UTF-8 无 BOM。
