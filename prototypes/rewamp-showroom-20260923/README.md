# Atlas × Rewamp UI 可操作展厅

入口：`showroom.html`。独立单文件，双击即可运行，不需要启动 Atlas 或 Vite。

这版用于看见真实组件效果后再作选择，替代上一轮仅抽取交互概念的评估样稿。上一版文件保留。

## 包含什么

- 70 个官网展示组件：卡片、导航、侧栏、按钮、搜索、切换器、背景、文字动画、球体与光标。
- 16 个 Atlas 内容场景，支持原版 / Atlas 场景 / 并排对照。其余组件明确只显示原版。
- “先看这组”提供 17 个优先体验入口，筛选“全部”可查看全库。
- 暗色 / 浅色、重播、放大、搜索、收藏候选、导出候选 JSON。

原版效果运行上游 React 组件及其原有 CSS、Framer Motion、Canvas/WebGL 逻辑。没有用简化 HTML 或静态截图代替原组件。

Atlas 场景保留原版材质、尺寸、运动参数和机制。6 个卡片组件通过 props 换入虚构的集合数据或本地生成的复盘示意图；透镜侧栏和搜索通过 props 换入示例内容；7 个展示组件只替换字符串文字。它们是适配效果试验，不是已符合 Atlas 正式设计合同的组件。外部展厅使用仓库当前 Atlas token 与 Button 样式；上游演示在独立 iframe 内保留自身样式，不污染 Atlas。

任何进度、完成、导航、查询都是演示，不访问真实资料库。收藏仅写入当前预览页的浏览器 localStorage；导出选择是用户点击后生成一份新的 JSON 文件。关闭预览不会改变客户端。

## 来源

- 作者：palakonweb，项目 [Rewamp UI](https://github.com/palakonweb/Rewamp-UI)，[官网](https://www.rewampui.com/)。上游组件与素材的权利归原作者或相应权利人。
- 源码提交：`45e2460e58c7306abe9fc783fa0584bbadb81086`。
- 官网 `docsRegistry.js` 是 70 个展示入口；CLI registry 的 75 条包括共享项和未进入当前展示目录的条目，二者不是同一个计数口径。
- 上游完整仓库保存在 `C:/Users/Yunko/AppData/Local/Temp/atlas-rewamp-review-20260923`。该临时路径可能被系统清理；构建复现需要重新检出同一提交。
- 本地评估产物；没有把上游素材发布成 Atlas 产品，也没有将缺少明确许可的源码认定为可直接商用迁移。正式复制源码时仍需核清组件许可和保留署名。

## 重建

1. 在上述隔离上游目录安装其自身依赖：`npm install --ignore-scripts --no-audit --no-fund --package-lock=false`。
2. 从 Atlas 根目录运行 `python prototypes/rewamp-showroom-20260923/prepare.py`。
3. 在隔离上游目录运行 `npm exec vite build -- --config atlas-vite.config.js`。
4. 从 Atlas 根目录运行 `python prototypes/rewamp-showroom-20260923/prepare.py --pack`。
5. 验证：`python prototypes/rewamp-showroom-20260923/verify.py`。

Atlas 根依赖没有增加 Tailwind、Three.js 或 React 19。它们仅用于隔离预览的构建，生成后的 HTML 已内嵌运行代码、样式与上游本地图片。部分原版使用远端 Unsplash 图片，需要网络；Atlas 场景中的模拟复盘图全部内嵌。部分原版 WebGL 效果依赖浏览器图形能力。

## 验证边界

见 `verification.json`。逐一挂载检查覆盖 70 原版与 16 Atlas 场景；关键交互包括文件夹展开返回、中文导航切换、下载状态动画、并排对照、候选选择导出、较小桌面宽度和浅色。它不是全部原组件的生产级功能、性能、键盘或无障碍认证，原版动画也不保证遵循 Atlas 的减少动画合同。未集成正式 Electron，未验收 macOS。
