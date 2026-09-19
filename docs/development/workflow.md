# 开发与验证

按当前任务选择本页相关部分。命令以根 `package.json` 与对应脚本为准；这里解释使用边界，不复制全部脚本清单。

## 工作范围

应用由 `src/` 的 React renderer 和 `electron/` 的桌面主进程组成；`src/storage/` 与 `electron/library/` 涉及资料库。`atlas-website/`、`atlas-docs-site/` 和 `prototypes/` 是独立站点或样稿，不能因客户端任务顺带集成或修改。

局部修复从入口、相关实现和相邻测试开始。复杂跨模块任务再补充边界分析；不强制每个任务都生成计划文件、进行多轮评审或阅读全仓。独立调查或审查可并行，编辑时明确文件归属，最终由主任务整合验证。

## 选择验证范围

| 改动 | 合适的验证入口 |
| --- | --- |
| 文档、提示词、Skills | 核对引用、触发范围、约束是否保留及 UTF-8 无 BOM；技能语法验证不能证明行为质量。无需应用构建或启动。 |
| Hooks、Node 开发脚本 | 对改动脚本执行 `node --test <实际测试文件>`；Hooks 使用 `pnpm test:hooks`，它在临时 Git 仓库内测试，不提交当前项目。 |
| 局部 TS 逻辑 | `node scripts/run-regression-tests.mjs --unit-only <仓库相对测试路径>`；该路径必须是当前发现器支持的 `.test.ts` / `.test.tsx`。涉及类型边界时运行 `pnpm typecheck`。 |
| 桌面界面 | 相关行为回归，加 [UI 质量与验收](ui-quality.md) 要求的实际界面自检。`pnpm qa:design`、`pnpm check:desktop-visual` 是静态约束检查，不是视觉验收。 |
| 存储、恢复、迁移 | 相关单测和对应 Electron 生命周期场景；执行前核对脚本是否自行隔离，未隔离时先指定临时资料库。按故障风险覆盖中断、失败恢复与原数据完整性。 |
| 跨模块集成或提交前全面健康检查 | `pnpm qa:ci` 包含完整 `pnpm test`、静态设计检查和类型检查；其中 test 含浏览器回归，不是几秒钟的纯静态检查。 |
| 发布准备 | 在发布授权范围内执行 `pnpm qa:release`；扩展检查用 `pnpm qa:full`。正式发布入口是 `node scripts/release.mjs` 的 patch / minor / major（`pnpm release:*`），由 tag 触发 [Release 工作流](../../.github/workflows/release.yml)。完整资产以 `scripts/release-artifacts.mjs` 的 `expectedReleaseAssetNames` 为准：Windows x64 安装包与 blockmap、`latest.yml`，以及 macOS arm64/x64 的 dmg 与 zip。本地 `pnpm dist:win`、只上传 exe、或 `gh release` 只发 Windows，都不是产品发布。推送 tag 后必须等到该工作流成功，并用 `gh release view` 核对上述资产齐全后再交付；忽略门禁也不豁免 macOS。已公开但缺 macOS 的 Release 会让后续正式发布因哈希或清单冲突失败，不得把 Windows-only 说成已发布。 |

只修正本轮引入或任务范围内的失败；原有失败单独说明证据和影响。相关检查通过后不无理由重跑。若下一命令已包含某项检查，同一未变化输入不另跑一遍。`build` 与 `build:app` 均已包含类型检查；独立命令仍保留自身必要门禁。

局部测试结果不得冒充 `check-governance --require-execution` 的全量执行报告，也不得复用不匹配源码身份的旧证据。测试、截图和几何结果各自只证明实际覆盖的内容。浏览器回归用于桌面 renderer 验证，不新增浏览器产品承诺。

## 启动最新客户端并保留复核界面

开发热更新入口是 `pnpm dev:electron`。主进程、preload 或构建配置变化时确认进程已重启；renderer 热更新不能证明主进程是最新版本。

演示写入结果时，在项目根目录的专用终端先执行 `pnpm build:app`，成功后再启动下面的隔离客户端。两个路径都必须是本轮专用目录；不要替换为真实资料库。终端内若存在 `ELECTRON_RUN_AS_NODE`，先移除该变量。

Windows PowerShell：

```powershell
$atlasReviewRoot = Join-Path $env:TEMP ('atlas-review-' + [guid]::NewGuid().ToString('N'))
$env:TRADER_ATLAS_LIBRARY = Join-Path $atlasReviewRoot 'library'
$env:VITE_DEV_SERVER_URL = ''
pnpm exec electron . "--user-data-dir=$(Join-Path $atlasReviewRoot 'user-data')"
```

macOS 终端：

```sh
atlas_review_root="$(mktemp -d "${TMPDIR:-/tmp}/atlas-review.XXXXXX")"
TRADER_ATLAS_LIBRARY="$atlas_review_root/library" VITE_DEV_SERVER_URL='' \
  pnpm exec electron . "--user-data-dir=$atlas_review_root/user-data"
```

已保存的资料库配置优先于 `TRADER_ATLAS_LIBRARY`，因此 userData 必须全新，不能只更换环境变量。首次隔离目录不存在时会进入“资料库未打开”；通过“选择其他资料库 → 选择本轮 library 目录 → 在此创建新资料库”初始化，再导入隔离样例。

启动后核实实际 userData 与资料库路径，使用隔离样例，打开本轮目标页。上述命令只负责启动，不自动导入样例、导航或证明视觉合格。完成自检后保留该窗口给用户操作；交付说明标注隔离资料库和复核路径。不要在用户复核前清理目录或结束进程；需要后台启动时只隐藏辅助终端，保留可见客户端。

现有 `qa:desktop-visual:electron` 采集器要求干净工作区及匹配 HEAD 的构建，并会在结束时关闭客户端、清理临时库。日常未提交修改通过上述隔离启动方式检查；不得为了采集而擅自提交、丢弃改动或削弱证据校验。正式采集参数见 [atlas-desktop-verify](../../.agents/skills/atlas-desktop-verify/SKILL.md)。

## Hooks

项目 Git Hook 的唯一入口是 `.githooks/pre-commit`，运行 `scripts/check-staged-text.mjs`。它只读取暂存区中新增或修改的已知文本类型，检查 UTF-8 无 BOM；不自动转换文件、不修改暂存区、不执行应用测试、不访问资料库或网络。二进制和删除项不做文本解码；具体扩展名由脚本维护。

- 当前克隆安装：`pnpm hooks:install`。安装器只设置本仓库的 `core.hooksPath`，并在需要时设置执行权限；已有不同 Hook 路径或默认目录中的其他 Hook 时报告冲突，不覆盖。
- 查看生效来源：`git config --show-origin --get core.hooksPath`。
- 手动复核暂存内容：`pnpm check:staged`。未暂存文件不在其检查范围；工作区改好后需要重新暂存对应文件。
- 编码失败：用 UTF-8 无 BOM 重新保存报告中的文件，确认中文未损坏，再重新暂存并检查。不要用 Hook 自动转码来猜测历史编码。
- 新克隆需要重新安装；Git Hooks 是本地反馈，不是远端强制门禁。`pnpm test:hooks` 已接入 `pnpm test`，用于检验 Hook 本身的行为，不能证明所有提交文件合规。
- 移除本项目接线前先确认当前值仍为 `.githooks`，再执行 `git config --local --unset core.hooksPath`；不删除他人 Hook 文件。

当前没有项目级 Codex/Claude 生命周期 Hook；`.claude/settings.local.json` 只是本机已有权限设置。不要为凑流程新增每次工具调用的提醒、强制停顿或全量测试。需要生命周期 Hook 时，先定义可确定判断的事件、失败条件和退出方式，再核对 [官方 Hooks 文档](https://learn.chatgpt.com/docs/hooks)；Git Hook 与 Agent Hook 不能混称。

## 维护提示词与技能

本轮依据 [Rethinking skills and prompts for GPT-6 Astra](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)：常驻说明保留项目事实与权限边界，条件细则按需读取，技能描述准确匹配任务，完成条件覆盖验证与交付。Hooks 的具体编码检查是 Atlas 的工程选择，文章没有规定必须使用此 Hook。

根 `AGENTS.md` 保存跨任务约定；UI 细则只维护在 `ui-quality.md`，`design.md` 维护设计事实；项目技能放 `.agents/skills/`，目录格式见 [官方技能文档](https://learn.chatgpt.com/docs/build-skills)。不把 Atlas 细则复制到用户全局技能或第三方插件缓存；不另建内容重复的 `AGENT.md`、`CLAUDE.md`。

技能描述用一句话写具体触发，正文只保留影响决策的知识和引用；不要用“所有开发都必须调用”扩大范围。常规任务无需新增技能；遇到复用价值明确的流程才补充。规则调整后用真实任务核对路由，例如：文档勘误不启动 UI；弹窗打磨读取 UI 门禁并打开最新客户端；恢复功能在隔离资料库验证；只诊断的请求停在诊断边界。

根据实际误触发、遗漏、重复工具调用或提前停止改进规则；不凭文件变短宣称速度、成本或模型质量已提升。新增要求说明对应的真实失败或不可变条件，避免把一次问题扩张成所有任务的永久流程。
