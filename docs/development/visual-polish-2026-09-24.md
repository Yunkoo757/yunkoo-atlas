# 2026-09-24 桌面视觉诊断与打磨

本轮以真实 Electron 截图、DOM 几何和生产代码交叉确认问题。保持既有暗色体系、主侧栏、页面轨道、列表密度和主要操作流程；修改局部排版、图表边界及键盘反馈。全部写入演示均使用新建 userData 与隔离资料库。

## 设计基线

- 事实来源：`tokens.css` → `global.css` → 公共 UI 组件 → 页面样式与可执行合同 → `design.md`。没有新增或修改主题 token。
- 保留 244px 主侧栏、8px 主窗格 inset、1240/1180/920/680px 页面轨道，沿用 ModalShell 440/560/720px 三档。
- 数据行 13px/20px、元数据 12px/18px、图表标注 11px/16px；常规控件仍为 28/32/36px。间距继续复用 `--sp-*` 与现有角色。
- 局部键盘位置使用控件自己的边界或内描边；没有恢复主侧栏/交易列表整行焦点框，也没有增加显示设置。

## 已确认的问题与修复

| 问题与实际证据 | 修复 | 验收要点 |
| --- | --- | --- |
| 统计曲线长金额首位、负号被负边距与固定轴宽裁切 | 移除负边距，测量真实 SVG 刻度宽度分配轴空间 | 两尺寸的 ±320000000 全部字符位于 SVG 内，不缩写金额或缩小字号 |
| 年度热力图的 `i` 在 Tooltip 内缩成约 2px 小点；最小窗主区 scrollWidth/clientWidth 为 600/521，中等窗宽仍有 6–16px 溢出 | 恢复完整方格，根据实际年度内容轨道的 580px 边界将全年周格分成两行 | 53 格全部可见，小窗主区 521/521；补充 1060–1200px 窗宽检查，日期和评分 Tooltip 保留 |
| 年度图刻度过暗，切换时默认逐段绘制折线 | 采用现有图表 caption 和 text-tertiary，统一 Tooltip 文字，关闭入场绘制 | 曲线直接完整呈现，未修改分数或统计口径 |
| 策略预览长英文 scrollWidth/clientWidth 为 1027/398；列表与长标签横向溢出 | 在名称本身允许换行，标签保留独立删除入口 | 预览 390/390；160 字符标签完整可读、可删除 |
| 40 字符复盘池名撑开首页和管理行；120 字符策略挤压编辑弹窗 | 名称允许换行，计数与操作不收缩，复选框保持宽度 | 首页、管理、编辑均无横向溢出，筛选仍能勾选，页脚保存可达 |
| 最小窗交易日说明被分段控件压成约 90px 窄列 | 仅在已有小窗断点让带说明的设置标题区独占一行 | 说明宽 89.67→517px、高 72→18px；1440 布局保持原样 |
| 公共按钮/字段及部分独立控件键盘聚焦后与默认外观相同 | 复用现有边界颜色补局部 focus-visible | 搜索清除、多空方向、头像、品种、模板、策略操作、显示开关、详情值和判断图片有可见位置反馈 |
| 图片灯箱的工具栏没有键盘位置反馈，图片菜单被灯箱遮罩遮挡 | 增加局部内描边，仅在灯箱内将图片菜单置于现有 popover 层级 | 普通详情菜单层级保留；灯箱右键及工具栏菜单可命中、可操作 |
| 随记标题受全局输入内边距影响，与正文错开 10px | 去除标题输入的额外水平 padding | 标题、元数据、正文起始边对齐；长正文继续正常换行 |

## 真实界面覆盖

Windows x64 Electron，实际显示缩放 200%。外框 1440×900 与产品最小外框 960×640；实际 renderer 视口分别为 1427×865、947×606。没有通过降低缩放或放大窗口掩盖问题。CDP 实际中文字形来源为本机 Noto Sans SC，记录在 `test-results/visual-polish/actual-fonts.json`。

默认路由覆盖 26 个场景、两种窗口，共 52 张完整界面截图：交易日志、待处理、看板、详情、统计、周期复盘、随机复盘、随记、错过机会、案例列表/看板、模拟、历史实盘/案例、回收站，以及资料、快捷键、策略、风险、风险修复、标签、品种、复盘起稿、显示、数据、更新设置。

补充检查判断台（空、创建主题、收图、已收图）、复盘组合器、组合器规则、导入日期健康、阶段归属修复；以及年度趋势、周评分/风控、长名称输入/预览/保存、标签删除、复盘池首页/管理/编辑、搜索清除、新建展开和多空切换、图片超限提示、取消与重开、两图灯箱和菜单、详情属性、随记长标题/长正文、备份展开与恢复确认。恢复确认检查使用隔离备份，未替用户恢复真实资料库。

对照后保留的界面：交易列表密度与横向看板滚动、默认详情结构、周复盘评分和风控排列、备份列表与恢复确认。这些状态未发现需改变大布局的问题，不为制造差异重做页面。

## 截图与几何证据

以下目录均位于本地 `test-results/`，不纳入发布资产。`report.json` 中的实际构建文件、路径、窗口、缩放和几何数据是证据来源，目录名本身不证明版本。

- `visual-polish/before/`、`visual-polish/after/`：26 个路由的两尺寸默认界面与 computed style/geometry。
- `visual-polish/final/`：最终统一构建的默认界面及留开的隔离客户端。
- `visual-polish/statistics-before/`、`statistics-after-negative/`、`statistics-after-positive/`：统计、年度周格、Tooltip、周评分和风控。
- `visual-polish/settings-before/`、`settings-after/`、`settings-focus-before/`、`settings-focus-after/`、`settings-layout-before/`、`settings-layout-after/`：设置长名称、焦点与说明宽度；汇总 `settings-comparison.json`。
- `visual-polish/settings-final/`、`settings-focus-final/`、`settings-layout-final/`：清除早期 Toast 干扰后的设置交互复核。
- `visual-workbench-audit/before/`、`after/`、`detail-before-corrected/`：复盘池、搜索、新建与详情交互。
- `visual-polish/root-before/`、`root-after/`：公共按钮/字段、随记、判断台、组合器与修复完成状态。
- `visual-polish/heatmap-boundary-final/`：1060–1200px、步长 5px 的 29 档实际窗口，全部全年周格无溢出。
- `visual-workbench-audit/final-overlay/`：最终构建的新建错误/取消/重开，以及灯箱菜单、键盘焦点和图片切换。

部分早期采样含隔离样例自动清理过期回收站的 Toast，后续清晰截图等待通知自然结束；未删除界面元素伪造截图。`statistics-large-before` 实际运行的是已优化构建，不作为前后对比基线；详情基线采用 `detail-before-corrected`。

## 验证入口与边界

- `pnpm build:app`：类型检查、生产 Electron 构建及包体积合同。日志 `visual-polish/build-final.log`。
- `pnpm qa:design`：现有设计合同。日志 `visual-polish/design.log`。
- `node --test scripts/fixtures/desktop-visual-matrix.test.mjs scripts/fixtures/electron-evidence-runner.test.mjs`：采集器隔离与构建身份合同，21 项通过。日志 `visual-polish/tool-tests.log`。
- `pnpm test`：最终应用回归和治理汇总，日志 `visual-polish/regression-final.log`。
- 新增 `ReviewPoolLayout.browser.test`：长池名、长策略、数量和操作区、复选框宽度及页脚可达性。
- 扩展 `WeeklyReviewPresentation.browser.test`：481/564/569/574/580/621px 实际年度轨道的全年方格与横向溢出检查。
- 扩展 `ImageActions.browser.test`：普通菜单层级以及灯箱右键、工具栏菜单的实际命中检查。

正式采集器暴露了新库创建后未先建立写入会话就导入样例的问题，本轮补上 `storageOpen`/`loadSnapshot`；原干净构建身份校验没有削弱。未提交工作区的实机验证使用独立隔离脚本，不能冒称正式 clean-HEAD 采集通过。

全量测试首次发现已有光学校准白名单的三处行号随样式增补发生偏移；仅同步对应行号，原颜色表达式和允许原因保持不变。

本轮未验证 macOS 实机、其他系统缩放或正式安装包；不代表这些平台已经完成运行验收。本轮交付范围包含用户授权的全部本地提交，未推送、未发布。
