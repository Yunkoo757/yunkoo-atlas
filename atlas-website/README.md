# Trader Atlas 官网与教学站

面向 Windows / macOS 桌面用户。线上地址 https://yunkoo.net/ ，教学站在 /guide/。

本地预览：在仓库根目录执行 node atlas-website/server.mjs，打开 http://127.0.0.1:4175/。执行 node atlas-website/build.mjs 生成 dist 后，在 atlas-website 目录执行 npx wrangler deploy 发布到 yunkoo.net。

## 共用设计

两站共用 site-shell.js 导航、site-shell.css 布局以及 brand.css 字体与颜色。使用统一 SVG 图标、宽正文与低密度排版。官网文字聚焦支持暂停、键盘操作和减少动态效果。

## 产品窗口

product-shot.js 展示真实客户端截图，仅作页面内展示，不提供放大、原图跳转或下载控件。8 张截图保存于 atlas-docs-site/assets/product，均为 2648 × 1701 无损 PNG，不缩放采集、不叠加光标。manifest.json 记录尺寸与采集方法。

capture-window.ps1 通过启用 DPI 感知的 PrintWindow 捕获运行中的 Trader Atlas 自身窗口表面，避免桌面悬浮图标与光标混入。使用 -OutputPath 指定输出 PNG；先在客户端打开所需页面。不要使用桌面截图或放大低分辨率图片替代。图片含用户授权展示的实际窗口内容，构建不包含真实资料库文件。

## 内容覆盖

官网介绍交易日志、单笔复盘、随记与反思、案例库、随机复盘、周期复盘、统计分析、风险与资料库、工作空间。预览提供 7 个页面；日志在首屏，随记另设独立介绍。

教学站共 11 章、44 步，保留操作练习、问答、搜索及桌面平台切换。官网功能链接可直接进入对应章节。练习使用独立教学数据，不连接真实资料库。

## 验证

node atlas-docs-site/verify.mjs 检查章节结构；构建后检查静态截图、标签切换、章节跳转与教学练习。浏览器测试使用 localhost 独立来源，不覆盖 127.0.0.1 的教学进度。所有源文件 UTF-8 无 BOM。

本轮模块展示规范见根目录 design.md 第 15 节。九项功能使用双行低速自动往返滚动，悬停、聚焦与暂停按钮均可停止，支持前后按钮、方向键、Home/End；七张软件预览支持叠层翻页，页码与标签同步。Liquid Ether 流体仅作用于官网首屏，减少动态效果设置下关闭；教学正文保持静态。动效与模块尺寸取自共享 brand.css 的官网展示 token。
顶部固定宽度胶囊循环逐字输入、停留、删除真实功能文案，读屏名称固定。自动流动速度、流体力度、黏度和色板、打字间隔均由共享 token 定义。

背景使用 React Bits LiquidEther 适配为原生模块，Three.js 固定为 0.180.0，均本地加载；许可保存在 vendor。参数取自 2026-09-06 TikHub 首屏配置：force 8、cursor 80、viscous 60、resolution .5、autoSpeed .3、autoIntensity .6、resume 5000ms、opacity .45。

可见度校准：流体高度止于首张产品截图，暗色着色移除重复衰减；当前视觉增益 1.8、透明度 .32、力度 12、半径 100、黏度 45、空闲强度 .8。覆盖上文参考站原始参数，以共享 token 为准。

导航与截图构图遵循 design.md 15.2：共享透明玻璃导航，首屏完整概览，功能区以固定 16:9 视窗展示原图局部。


新版展示素材：先运行 pnpm build:app，再运行 node atlas-website/capture-showcase.mjs。脚本创建独立 userData 与 library，核对实际路径后导入 showcase-fixture.mjs；在空白渲染页导入以避免界面旧状态回写。截图为最新 Electron 3x 原生输出，4320×2880，无重采样。输出 assets/product/showcase；页面明确标注示例数据。保留 test-results 下隔离资料库用于复核。不得改用实际用户资料库路径。
