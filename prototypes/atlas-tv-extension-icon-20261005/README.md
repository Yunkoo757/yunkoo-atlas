# Atlas TV 扩展图标

方向：Atlas 环形品牌标记 + 双 K 线。

配色来自当前 build/icon.svg（#121318、#E7E7EB、#737BDD），渐变末端采用 tokens.css 的 #5e6ad2；浅高光是现有颜色与白色的叠加。未使用外部字体、位图、滤镜或脚本。

- atlas-tv.svg：512 × 512 矢量母版。
- atlas-tv-glyph.svg：透明主体，适用于深色背景。
- svg/：各尺寸 SVG，16/20/24/32 为单独光学校正。
- icons/：16/20/24/32/48/64/128/256/512px PNG。
- manifest-icons.json：icons 与 action.default_icon 的合并片段，保留现有 action 其他字段。
- index.html：明暗背景、实际尺寸、工具栏情境预览。

Chrome 不支持在 manifest 图标字段中直接使用 SVG。官方文档：https://developer.chrome.com/docs/extensions/develop/ui/configure-icons

此交付为独立设计资产，未替换 Atlas 正式应用图标或修改 TradingView 插件。

重新生成：在仓库根目录运行 node prototypes/atlas-tv-extension-icon-20261005/generate.mjs
