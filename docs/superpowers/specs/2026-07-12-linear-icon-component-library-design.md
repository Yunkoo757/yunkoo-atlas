# Linear 图标 React 组件库设计

## 背景

当前项目需要复用 Linear 的精细图标体系，包括静态装饰图标、工作流状态图标、参数化进度图标和帧动画图标。素材采集阶段已获得 301 个唯一静态 SVG、3 份原始 SVG 精灵库、Linear 官方九类分类映射，以及状态和动效相关的原始实现模块。

本设计将这些素材封装为当前 React 项目可直接调用、可搜索、可验证的本地组件库。视觉目标是保留 Linear 原始路径、比例、默认尺寸、状态计算与动画节奏；工程目标是提供稳定命名、完整类型提示和清晰的静态/动态边界。

## 目标

- 让业务代码能够通过具名组件或统一的 `LinearIcon` 入口调用图标。
- 保留 Linear 原始图标名称，建立规范的项目侧名称映射。
- 完整覆盖已采集的 301 个唯一静态 SVG，不遗漏、不重复导出。
- 单独实现状态、进度和动画图标，避免把实时图标错误固化为单帧 SVG。
- 默认继承 `currentColor`，同时允许调用方明确覆盖颜色和尺寸。
- 提供可搜索、可分类、可观察动画和实时参数变化的图鉴。
- 通过自动化检查保证导出、分类、命名和 SVG 内容持续一致。

## 非目标

- 不重构现有业务组件或替换所有现有图标。
- 不引入新的通用设计系统或图标构建框架。
- 不修改 Linear 原始路径来统一视觉风格。
- 不把 Linear 的完整应用模块作为运行时依赖。
- 不实现当前采集范围之外、无法从已登录页面验证的图标变体。

## 目录结构

组件库位于 `src/icons/linear/`，采集证据和原始素材继续位于 `assets/linear-icon-system/`。

```text
src/icons/linear/
├── static/                  # 生成的静态 React 图标组件
├── status/                  # Issue、Project、Cycle 等参数化状态图标
├── animated/                # Grid Loader、Grid Progress 等动效图标
├── registry.ts              # 规范名称到组件和元数据的注册表
├── categories.ts            # Linear 官方分类及排序
├── types.ts                 # 公共属性与名称联合类型
├── LinearIcon.tsx           # 统一入口
├── index.ts                 # 公共导出
└── README.md                # 使用、命名和维护说明

assets/linear-icon-system/
├── raw/                     # 原始精灵库、模块与来源清单
├── icons/                   # 拆分后的原始 SVG
├── manifest.json            # 名称、分类、来源、哈希和渲染类型
└── gallery.html             # 静态、状态、实时和动效图鉴
```

原始素材不会被业务代码直接导入；它们是生成、核对和追溯的来源。

## 命名规范

每个图标同时保存三种名称：

- `linearName`：Linear 原始 PascalCase 名称，例如 `FaceHeartEyes`。
- `name`：注册表使用的 kebab-case 名称，例如 `face-heart-eyes`。
- `componentName`：React 导出的 PascalCase 名称，例如 `LinearFaceHeartEyesIcon`。

所有公共组件统一使用 `Linear` 前缀和 `Icon` 后缀，避免与 Lucide、业务图标或浏览器全局名称冲突。文件名与组件名完全一致。原始名称存在历史拼写时不擅自修正，规范名称可增加可读映射，但 `linearName` 必须原样保留。

名称生成必须满足：

- 同一输入始终生成同一名称。
- 301 个静态图标的 `name`、`linearName` 和 `componentName` 分别唯一。
- 缩写和连续大写按词义切分，例如 `LinearAiIcon` 对应 `linear-ai`，`GitHub` 对应 `git-hub`。
- 出现生成冲突时构建失败，不自动添加数字后缀。

## 公共 API

### 具名静态组件

```tsx
import { LinearFaceIcon, LinearTeamIcon } from '@/icons/linear';

<LinearFaceIcon />
<LinearTeamIcon size={20} color="var(--accent)" />
```

静态组件接受统一属性：

```ts
interface LinearStaticIconProps extends React.SVGAttributes<SVGSVGElement> {
  size?: number | string;
  title?: string;
}
```

默认尺寸为 Linear 原生的 `16`。未提供 `title` 时组件作为装饰图标隐藏于辅助技术；提供 `title` 时生成可访问名称。

### 统一入口

```tsx
<LinearIcon name="face-heart-eyes" size={16} />
```

`name` 是由注册表生成的字符串联合类型，不接受任意字符串。统一入口主要服务于配置驱动界面；直接引用时优先使用具名组件，以获得更好的可发现性和 tree-shaking。

### 状态和实时组件

```tsx
<LinearIssueStatusIcon state="started" progress={0.5} />
<LinearProjectStatusIcon state="started" progress={0.42} animate />
<LinearCycleProgressIcon progress={0.6} active />
```

状态组件使用显式状态联合类型，并对输入进度限制在 `0..1`。状态图标保留 Linear 原生 14px 默认尺寸；项目和周期图标按其原始实现保留 16px 默认尺寸。

### 动效组件

```tsx
<LinearGridLoaderIcon variant="scope" />
<LinearGridProgressIcon progress={0.52} />
```

Grid Loader 支持已验证的原生变体：`scope`、`upDown`、`pong`、`blowOut`、`ufo`、`down`、`zap`、`hourglass`、`stats`、`cat`、`agent`、`read`、`unread`、`outlines`。组件复用原始位掩码帧数据、步进数量和时间计算，不用近似 CSS 旋转替代。

## 分类与注册表

分类使用 Linear 原始九类语义，并在界面显示简体中文名称：

| 分类键 | Linear 名称 | 中文显示名 |
| --- | --- | --- |
| `faces-people-health` | Faces, people, and health | 表情、人物与健康 |
| `organic` | Organic | 自然与食物 |
| `sport-activities-objects` | Sport, activities, and objects | 运动、活动与物件 |
| `travel-places` | Travel and places | 旅行与地点 |
| `technology` | Technology | 科技 |
| `interface` | Interface | 界面 |
| `companies` | Companies | 品牌与公司 |
| `money-currencies` | Money and currencies | 金融与货币 |
| `system` | System | Linear 系统图标 |

注册表的每条记录至少包含：

```ts
interface LinearIconMetadata {
  name: LinearIconName;
  linearName: string;
  componentName: string;
  category: LinearIconCategory;
  rendering: 'static' | 'status' | 'realtime' | 'animated';
  defaultSize: 14 | 16;
  source: string;
  sha256: string;
}
```

分类映射直接从已归档的 Linear 原始模块提取。没有官方映射的图标不能静默归入默认类别，生成过程必须报告并要求显式处理。

## SVG 渲染规则

- 保留原始 `viewBox`、路径、填充规则、裁剪规则、描边参数和路径顺序。
- 删除只属于 Linear 页面运行时的哈希 class 和 StyleX 变量。
- 固定主题色转换为 `currentColor`；明确的多色品牌图标仅在原始图形需要时保留固有颜色。
- 不进行路径简化、坐标舍入或 SVGO 重写，以免产生像素差异。
- React 属性只做语法等价转换，例如 `fill-rule` 转为 `fillRule`。
- 图标根节点转发标准 SVG 属性；调用方属性可覆盖默认尺寸和颜色，但不能覆盖内部几何。

## 状态与动画行为

### Issue 状态

- Backlog 使用原始分段圆环路径。
- Todo 使用空心圆。
- Started 使用参数化扇形，进度决定扇形终点，默认进度为 `0.5`。
- Completed、Duplicate、Canceled 和 Triage 使用原始路径。
- 状态色由 `currentColor` 或 `color` 属性控制。

### Project 状态

- 保留六边形轮廓、进度圆、遮罩和完成/取消路径。
- 仅在 `animate` 为真且状态发生变化时执行原始过渡。
- 完成态路径沿用原始缩放曲线和延迟。

### Cycle 进度

- 复用原始半径、周长、间隙和旋转公式。
- 进度变化使用原始 `0.6s` 描边过渡。
- planned、active、completed、next 等视觉分支通过明确属性表达。

### Grid Loader

- 使用原始 5×5 点阵、位掩码帧数据和逐帧位移策略。
- 当图标离开视口时允许暂停动画，避免无意义刷新。
- `prefers-reduced-motion: reduce` 下停留在具有辨识度的静态帧。

### Grid Progress

- 以 25 个点显示离散进度。
- 当前边界点按原始 600ms 周期在完全不透明和 0.3 透明度之间切换。
- 进度为 0 或 1 时不运行脉冲动画。

## 图鉴

`assets/linear-icon-system/gallery.html` 是本地可查看的交付物，包含：

- 按九类浏览全部静态图标。
- 按规范名或 Linear 原始名搜索。
- 切换浅色/深色背景与前景色。
- 调整 14、16、20、24 和 32px 尺寸。
- 独立的状态、实时和动效区域。
- Issue、Project、Cycle 图标的进度滑块。
- Grid Loader 全变体并列预览。
- 每项展示规范名、原始名、组件名、类别和渲染类型。

图鉴只读取生成清单和组件等价实现，不依赖 Linear 登录态或外部网络。

## 生成流程

生成脚本以 `assets/linear-icon-system/raw/` 为唯一输入：

1. 读取并校验三份 SVG 精灵库。
2. 拆分 `<symbol>`，按 ID 去重并记录重复来源。
3. 从官方分类映射模块解析类别。
4. 生成静态 TSX 组件、类型、注册表和导出文件。
5. 复制经过验证的参数与路径到专用动态组件。
6. 计算源 SVG 的 SHA-256，写入清单。
7. 生成离线图鉴。
8. 运行格式化、类型检查和专项测试。

生成文件带有来源注释，不允许手工修改；调整应发生在生成脚本或动态组件源文件中。

## 错误处理

- SVG 缺少 ID、`viewBox` 或无法闭合时立即失败。
- 名称冲突、组件名冲突或文件名冲突时立即失败。
- 官方分类缺失或存在未知分类时立即失败。
- 动画变体没有对应帧数据时立即失败。
- 运行时接收到非法进度时限制到 `0..1`，`NaN` 视为 `0`。
- `LinearIcon` 收到编译期不可能出现的名称时返回 `null`，开发环境记录明确错误。

## 验证与测试

### 生成与结构测试

- 生成 301 个唯一静态组件。
- 三套名称各自唯一，文件名与组件名一致。
- 每个静态图标恰好属于一个官方类别。
- 清单数量与公共导出数量一致。
- 原始 SVG 哈希稳定，未经授权的路径变化会导致快照失败。

### 组件测试

- 默认尺寸、尺寸覆盖、颜色继承和属性转发正确。
- `title` 对可访问属性的影响正确。
- `LinearIcon` 对每个注册键解析到正确组件。
- 状态组件覆盖所有状态和进度边界。
- Grid Loader 覆盖全部变体，Grid Progress 覆盖 0、部分和 1。
- reduced-motion 时不执行持续动画。

### 项目级验证

- `pnpm typecheck` 通过。
- 与图标库相关的测试通过。
- 现有回归测试通过。
- 图鉴在 Chromium 中无控制台错误，全部分类数量之和为 301。
- 对截图中出现的 Backlog、Todo、In Progress、Done、Canceled、团队图标和标签图标进行视觉核对。

## 完成标准

- 301 个静态图标均可通过具名组件和 `LinearIcon` 使用。
- Linear 官方九类分类覆盖率为 100%。
- Issue、Project、Cycle、Grid Loader 和 Grid Progress 均使用可运行的参数化或动画实现，而不是截图或单帧近似。
- 命名、类型、文档、图鉴和测试完整。
- 项目类型检查及相关测试通过。
- 所有新增文本文件均保存为 UTF-8 无 BOM，中文字符保持不变。
