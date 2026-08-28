# JS Reverse Task Record

## Observe

- 页面：已登录的真实 All issues 工作区、Linear 官网、UI refresh 文章、公开登录页
- 目标请求：真实工作区 DOM、ARIA、计算样式、根 token、样式表与字体
- initiator：页面加载的 stylesheet / font response
- 可疑脚本：本任务不涉及签名生成；无需定位业务函数

## Capture

- 采样方式：复用 Chrome 登录态，直接读取真实 DOM、ARIA、计算样式、CSS 变量和当前页面截图
- 命中位置：`https://static.linear.app/client/assets/style-DDtm6ZIF.css`
- 关键入参：`https://linear.app/yunkoo/team/YUN/all` 与三个公开页面
- 关键返回：真实 244px 侧栏、28/36/44px 组件高度、字体 token、LCH 主题别名和组件计算样式

## Rebuild

- 入口函数：`inspect_linear.py`
- 依赖脚本：Python Playwright 1.58.0
- 环境缺口：未切换浅色主题、窄屏断点，也未覆盖完整 hover/focus/disabled 矩阵

## Patch

- first divergence：页面 CSS 使用 StyleX 哈希变量，不能把 `--sx-*` 名当稳定公共 token
- 本次补丁：直接从已登录工作区读取真实 DOM 与计算样式，并用官方文章解释 ThemeProvider 映射
- 复测结果：真实工作区 URL、标题、nav/main landmarks、9 条 Issue、390 个根变量和关键组件尺寸均已读取

## Output

- 是否拿到参数：是，拿到字体、字号、字重、颜色、圆角与部分组件尺寸
- 是否可稳定复现：是，当前登录态与当前 viewport 范围内可稳定复现
- 剩余风险：工作区组件的 hover / focus / disabled 全状态未覆盖
