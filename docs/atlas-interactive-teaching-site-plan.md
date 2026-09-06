# Atlas 互动教学站实现计划

## 目标

在 `atlas-docs-site/` 中交付一个面向 Windows / macOS 桌面浏览器的独立互动教学站。用户沿左侧任务地图完成 10 个章节，以一条教学交易为主线，逐步理解记录、详情、复盘、案例、统计、周期回顾、特殊记录、风险维护和桌面效率。

## 实现决策

- 使用原生 HTML、CSS 和 ES Modules，不依赖 Electron 渲染进程、IndexedDB 或真实用户数据。
- 使用数据驱动的章节定义，渲染逻辑与教学文案分离。
- 将 `src/styles/tokens.css` 中已经存在的语义 token 复制为独立站的必要子集；组件只消费语义变量。
- 使用仓库中已有的 Atlas 产品截图作为“产品实景”素材，并明确标注教学示例 / 实景截图。
- 进度、平台修饰键和教学选择只保存到站点自己的 `localStorage`。
- 站点保持桌面三列逻辑，按 Windows / macOS 变窄窗口收窄内容，不增加移动端导航分支。

## 文件边界

### 创建

- `atlas-docs-site/index.html`：独立站入口、语义骨架、字体和静态资源引用。
- `atlas-docs-site/styles/tokens.css`：从 Atlas 源 token 复制的语义子集，保留原变量名和来源说明。
- `atlas-docs-site/styles/site.css`：页面布局、组件状态、示例工作台样式、焦点与减少动效规则。
- `atlas-docs-site/content.js`：10 个章节、步骤、教学文案、问题和分支入口。
- `atlas-docs-site/data.js`：教学交易、案例、统计范围、风险状态、快捷键和维护示例数据。
- `atlas-docs-site/icons.js`：少量 Lucide 风格线性 SVG 图标，统一消费现有图标尺寸 / 描边语义。
- `atlas-docs-site/app.js`：状态机、页面渲染、事件绑定、进度持久化和平台切换。
- `atlas-docs-site/assets/`：独立站使用的 Atlas favicon、Inter 字体和已有产品截图副本。

### 不修改

- `src/` 与 Electron 代码保持不变。
- `vite.config.ts`、根 `package.json` 和现有桌面端构建入口保持不变。
- 工作区已有的阶段归属、数据整理和其他未相关改动保持原样。

## 执行顺序

### 1. 建立独立站骨架与 token 桥接

建立入口文件、独立样式目录和资源目录。`index.html` 只保留 `header`、`main`、`aside`、`section`、`footer` 等语义骨架，主内容由 `app.js` 填充。`tokens.css` 只保留 `surface`、`border`、`text`、`accent`、业务语义色、尺寸、间距、圆角、字体和动效角色，不写网站专属原始颜色。

验证：在本地静态服务器打开入口，确认没有资源 404，中文显示正常，页面根元素 `lang="zh-CN"`。

### 2. 定义数据模型与教学内容

在 `content.js` 中定义 `lessons` 数组，每个章节包含：

```js
{
  id: 'record-first-trade',
  kind: 'main' | 'branch',
  title: '记录第一笔交易',
  eyebrow: '02 / 10',
  objective: '先捕捉基本事实，后续可以补充',
  prerequisite: ['orientation'],
  steps: [
    { id: 'observe', type: 'observe', title, body, demo },
    { id: 'operate', type: 'operate', action, body, demo },
    { id: 'understand', type: 'understand', body, explanation },
    { id: 'confirm', type: 'quiz', question, options, answer, explanation }
  ]
}
```

内容覆盖设计文档中的 00–09 全部章节，并为每个核心模块写出“何时使用 / 记录了什么 / 是否进入哪个统计范围 / 下一步是什么”。示例数据放在 `data.js`，不在组件中硬编码统计数字。

验证：在浏览器控制台执行 `lessons.length` 与每章步骤完整性检查；通过一个静态 Node 检查脚本确认没有空标题、空问题或未定义的前置章节。

### 3. 实现任务地图与三列工作区

`app.js` 维护如下状态：

```js
{
  lessonId: 'orientation',
  stepIndex: 0,
  completedLessons: [],
  actionState: 'idle' | 'active' | 'success' | 'blocked' | 'busy',
  demoState: {},
  platform: 'windows' | 'macos'
}
```

左侧任务地图显示主线和分支，已完成章节可回看，未满足前置条件的分支显示锁定原因。中栏按步骤渲染概念正文、教学数据和小测。右栏是教练台，始终只告诉用户当前一项动作和完成进度。

所有动作使用原生按钮、链接、单选框、输入框和 `details` / `summary`，禁止用可点击 `div` 代替控件。主操作使用一个 `primary` 语义按钮，其余使用 `ghost` 或 `bordered`。

验证：键盘从任务地图进入当前章节，再进入中央练习和教练台；Enter、Space、Escape、Tab 和 Shift+Tab 行为可预测，完成章节后焦点回到下一节主操作。

### 4. 实现主线互动演示

为主线章节提供专用小型示例工作台：

- 认识 Atlas：选择“我想改进交易过程”，说明 Atlas 与行情终端的边界。
- 记录第一笔交易：选择品种、方向、状态、策略和标签，显示“先记录事实”。
- 补充详情：展开属性区、填写盘面摘要、切换补充信息、打开截图 / 正文说明。
- 完成复盘：填写一个事实和一个改进动作，点击“完成复盘”，展示状态变化。
- 沉淀案例：点击“加入案例库”，再打开来源关系，展示案例与原始交易的链路。
- 读懂统计：在实盘 / 模拟范围间切换，更新教学指标和口径标签；错过机会保持单独语义。
- 周复盘与随机复盘：完成一条掌握度评估，再从示例观察生成周复盘句子。

每个演示动作完成后进入 `success` 状态并给出解释；未完成前置动作时进入 `blocked`，说明“先完成什么”，不重置用户已有输入。

验证：逐章完成主线，刷新后保留进度；重置教学时使用确认对话，确认前后的章节状态可验证。

### 5. 实现特殊记录、风险、维护和设置分支

分支章节使用对照或选择练习，覆盖：

- 实盘 / 模拟盘 / 错过机会 / 随记 / 今日工作台的使用边界。
- 风险管理、风险数据修复、阶段归属和风险证据。
- 完整备份、JSON 副本、CSV 导入、Notion 导入、重复检测、恢复数据库和回收站。
- 资料、快捷键、策略、标签、品种、模板、显示和更新。
- 命令面板、搜索、侧栏范围和 Windows / macOS 快捷键修饰键。

分支示例不依赖真实导入文件，不会上传数据或调用外部服务；涉及破坏性的“清空 / 恢复 / 删除”只模拟选择结果，并在界面里明确后果和恢复路径。

验证：每个分支都能从地图进入，至少有一个可完成互动；统计范围、平台键名和数据维护结果在切换时同步变化。

### 6. 完成视觉实现与可访问性

使用 `site.css` 将任务地图、阅读轨道、教练台、示例工作台、测验、状态条、提示和对话框落到 Atlas token。页面不使用渐变、发光、多层阴影或未经命名的圆角 / 字号。业务色只在盈利、亏损、等待、错过和风险语境中出现。

补齐默认、hover、active、focus-visible、disabled、busy、success、blocked、错误和空状态。加入 `prefers-reduced-motion: reduce` 覆盖，静态反馈仍然清楚。

验证：在正常动效和减少动效两种模式检查；在 Windows / macOS 平台切换下检查快捷键提示；用现有截图做视觉对照，不把截图内容误写成实时数据。

### 7. 浏览器验收与交付

启动独立站静态服务器，用浏览器完成：

1. 首次进入与首页介绍。
2. 主线 00–06 的完整闭环。
3. 分支 07–09 的入口与互动。
4. 刷新恢复、重置教学、快捷键平台切换。
5. 键盘主路径、错误 / 阻塞状态和减少动效。

同时运行 HTML / JavaScript 语法检查、UTF-8 无 BOM 检查，并确认桌面端工作区已有改动没有被修改或暂存。

## 交付结果

- 一份可以直接用静态服务器打开的独立 Atlas 教学站。
- 10 个按任务地图组织的教学章节和教学数据。
- 主线闭环的可操作演示、分支模块的互动练习、可恢复的本地教学进度。
- 严格复用 Atlas 既有 token 的独立站样式。
- 设计文档、实现计划和浏览器验收结果。

