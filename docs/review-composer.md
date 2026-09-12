# 复盘组合器：接入与维护

入口：工作区 → 复盘组合器；默认快捷键 R。设置 → 组合器规则。
显式自定义过 R 的旧资料库保留原绑定，组合器可在快捷键设置中另行配置。

## 数据与规则版本

- `PersistedSnapshot.reviewComposer` 是资料库独立命名空间，通过现有 SQLite 快照事务保存，参与备份、完整导出与恢复。
- 命名空间使用 `schemaVersion: 1`。旧快照缺省时初始化空工作区；未来不兼容版本拒绝加载，不能静默清空。
- `draft` 保存条件、完整正文、规则版本、引擎版本及更新时间。规则更新不重新生成草稿。
- `activeRules` 和 `previousRules` 分开保存，支持一次版本切换与回退。合并导入保留当前资料库组合器内容；完整替换恢复导入内容。
- 新增数据库字段时必须同步 types、codec、validation、bootstrap、snapshotStore、persist、persistedKeys、import/export、merge 及合同测试。不要只写 UI store。
- 旧版 Atlas 不识别此命名空间；不要使用旧版覆盖保存已含组合器数据的资料库。

## 规则包

默认“导出完整规则”下载 Markdown，包含所有规则模块、当前配置、选项定义、生成/场景源码及 Atlas 参数适配与兼容性校验源码。维护范围中可导出完整 ZIP 档案。

“导出参数 JSON”只导出可配置参数；通过“导入参数更新”导入。它不代表完整规则库，也不能用来更新事件或校验机制。参数导入失败时现行规则与正文保留。

```json
{
  "formatVersion": 1,
  "version": "2026.09.13.2",
  "name": "Serein 离线复盘",
  "engineVersion": 1,
  "allowedNavigations": ["1", "2", "3", "4", "5"],
  "defaults": { "period": "4H/15m/1m" },
  "phrases": []
}
```

- `allowedNavigations` 控制手动选项及模拟生成范围。
- `defaults` 控制新建/重置手动条件；不能写入历史事实、原话或场景对象。
- `phrases` 为 `{ "from": "旧表述", "to": "新表述" }` 字面文本对；按顺序应用，不支持脚本和正则。
- 模拟事件关系、对象语义及校验机制属于引擎能力，修改这些内容必须升级引擎及回归样本，不能靠文字替换冒充逻辑更新。
- 文本依据随应用内置，仅供查阅，不会把 MD 当作可执行规则。
- 导入检查格式、引擎版本、默认组合及 60 个确定性模拟样本。检查不等于真实交易条件得到验证。

## 原模块迁移基线

来源 `D:\复盘`，引擎与场景模块仅改为 ES module，未重写生成逻辑。原文件 SHA-256 记录于 `scripts/fixtures/review-composer/source.json`。
`legacy-output.json` 保存 120 个模拟场景及 10 个手动组合的原输出；迁移适配层须逐字通过。
原 `{version:1,state:...}` 选项 JSON 仍可导入/导出。应用运行不依赖 D 盘源目录。

## 设计与验证

- 标准工作台轨道，公共 Toolbar、Button、Select、DatePicker、SegmentedControl 和 ModalShell；字段遵循全局样式。
- 五步切换显示条件，正文使用 body 文字角色；一层页面滚动，宽度不足时上下排列。
- 低频工具进入更多菜单；规则设置复用相同组件，依据默认收起。
- 引擎及数据回归：`node scripts/run-regression-tests.mjs --unit-only src/lib/reviewComposer/composer.test.ts`。
- 桌面验证：先 `pnpm build:app`，再 `node scripts/qa-review-composer.mjs`。加 `--keep-open` 可留下隔离测试窗口。
- 桌面证据位于 `qa-screenshots/review-composer/<时间戳>/`，包含当前窗口、960×640、选择器、日期、校验、规则设置和长正文。
- macOS 仍需在对应平台进行实际视觉及快捷键验证。
