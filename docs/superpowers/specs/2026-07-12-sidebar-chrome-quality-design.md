# 侧栏 Chrome 质感（方案 C）设计规格

**日期：** 2026-07-12  
**状态：** 待用户确认  
**演示：** [`demos/sidebar-chrome-quality.html`](../../demos/sidebar-chrome-quality.html)  
**选型：** 用户确认方案 **C · 描边 + 静层级**

## 1. 目标

让侧栏导航在观感上更接近 Linear 产品 chrome：冷静、精密、统一，而不是「实心 emoji / 填充 glyph 混搭」。

成功标准：

- 侧栏图标全部为 **细描边（stroke）**，线宽一致，无实心填充星/圆混入导航。
- 分区标题更静；未选中态更弱；选中态仍清晰但不刺眼。
- 行距略增，图标与文字光学对齐稳定。
- **不改变**路由、计数、我的空间容量与业务逻辑。

## 2. 非目标

- 不重构侧栏信息架构（工作台 / 我的空间 / 更多 保持现有结构）。
- 不替换列表行内交易 `StatusIcon`（已用 Linear Issue 状态，属业务语义，不属 chrome）。
- 不替换品种 `SymbolIcon`、策略色块图标体系（策略面板仍可保留现有策略图标；侧栏策略入口若存在，只用 stroke chrome 图标）。
- 不在本轮重做移动端底部导航的全部视觉（可复用同一 stroke 图标集，样式跟随现有 MobileNavigation）。
- 不删除 `src/icons/linear` 静态填充库；它继续服务内容装饰 / 命令面板等场景，但 **侧栏导航不再使用实心映射**。

## 3. 视觉原则

| 维度 | 规格 |
|------|------|
| 图标风格 | 16×16 viewBox，描边，`stroke-width: 1.5`，`round` 端点与拐角，`fill: none` |
| 默认色 | 未选中图标 ≈ `text-quaternary` 再略淡；文字 ≈ `text-tertiary` |
| Hover | 文字与图标同步提到 `text-secondary` / `text-primary` 之间；背景 `bg-hover` |
| Active | 背景略亮的圆角条；文字 `text-primary`；图标接近 `text-secondary`（不要纯白刺目） |
| 分区标题 | 更小字号、更淡色、略增字距；中文可保持「工作台 / 我的空间」，视觉上接近 Linear 的静标题 |
| 行高 | 导航项目标高度约 **32–33px**（现状约 30px） |
| 顶栏按钮 | 搜索 / 新建保持圆形触控区；图标改为同族 stroke |

参考气质：用户提供的 Linear 侧栏截图（细线、留白、弱层级）。

## 4. 图标集（侧栏专用）

新增侧栏 chrome 图标模块（建议路径）：`src/icons/sidebarChrome.tsx`（或 `src/icons/linear/chrome/sidebarNavIcons.tsx`）。

每个入口一个具名 stroke 组件，语义对齐现有导航：

| 入口 | 语义图标 |
|------|----------|
| 今日记录 | 日历 |
| 交易日志 | 四格 / issues 角标感 |
| 案例记录 | 打开的书 / 文档 |
| 仪表盘 | 四宫格 |
| 进行中 | 空心圆 + 中心点 |
| 星标交易 | 空心星 |
| 错过的机会 | 空心圆 + 斜线 |
| 模拟回测 | 烧瓶描边 |
| 保存视图 / 书签类 | 书签描边 |
| 策略入口 | 准星 / 目标描边 |
| 回收站 | 垃圾桶描边 |
| 设置 | 齿轮描边 |
| 搜索 | 放大镜描边 |
| 新建 | 笔 / 方块笔描边 |

实现约束：

- 路径手写或从 Linear **UI chrome** 归档模块抽取（如已有 Close/Chevron）；**不要**把 `LinearStarredIcon` 等填充 glyph 再映射进侧栏。
- `Sidebar.tsx` / `sidebarNav.ts` / `WORKSPACE_ICONS` 改为引用该 stroke 集。
- `appIcons` 中面向全局的填充映射可保留给其它页面；侧栏 import 路径与全局 appIcons 解耦，避免再次混入实心图标。

## 5. CSS / Token 调整（仅侧栏范围）

主要改 [`src/components/Sidebar.css`](../../src/components/Sidebar.css)：

- `.sb-section-label`：降低明度、略增 `letter-spacing`、字号略减。
- `.sb-item`：高度/内边距微调到约 32–33px。
- `.sb-item svg` / `.sb-item.is-active svg`：统一 stroke 着色，去掉对「实心更重」的依赖。
- `.sb-hbtn`：与方案 C 一致的弱默认色、hover 略亮。
- 不新增运行时依赖；不改全局 `--sidebar-width` 除非验收时发现溢出（默认保持 244px）。

## 6. 范围文件

必改：

- `src/components/Sidebar.tsx`
- `src/components/Sidebar.css`
- `src/lib/sidebarNav.ts`
- 新增侧栏 stroke 图标模块
- 若 `MobileNavigation.tsx` 复用同一套 PRIMARY/SECONDARY 图标，随 `sidebarNav` 自动受益

可选同轮（若成本低）：

- 设置页左侧 `SettingsLayout` 导航改为同一 stroke 语言（保持信息架构不变）

明确不做：

- `StatusIcon` / `SymbolIcon` / `StrategyIcon`（策略选择器内的彩色图标）
- 编辑器排版图标
- 大范围替换命令面板内所有图标

## 7. 验收

- 并排对比：硬刷新后侧栏不再出现实心星/实心圆导航图标。
- 选中「交易日志」时：底衬清晰，图标不刺眼。
- 分区标题肉眼弱于导航项。
- `pnpm build` 通过。
- 演示页 C 列作为视觉基准；实现后允许 ± 细微色差，但图标语言必须是 stroke。

## 8. 风险与回退

- **识别度**：空心星/圆在暗色下可能偏弱 → 用 active/hover 提亮，而不是改回实心。
- **与填充库并存**：文档与代码注释标明「侧栏只用 chrome stroke」，避免后续又从 `appIcons` 的 `Star`（实心映射）拉回侧栏。
- 回退：还原 Sidebar 图标 import 与 CSS token 即可；不涉及数据迁移。
