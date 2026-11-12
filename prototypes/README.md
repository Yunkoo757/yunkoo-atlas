# 历史设计与原型资产归档

这里保存已交付的设计原图、可编辑 SVG、页面样稿、预览及下载 ZIP。它们独立于 Atlas 运行代码，不参与桌面安装包构建。产品实现与最新设计事实以 `../src/styles/tokens.css`、公共组件及 `../design.md` 为准，旧样稿不能作为最新运行验收证据。

## 目录索引

| 资料组 | 基线文件数 | 基线体积 |
| --- | ---: | ---: |
| [app-icon-family-20261002](app-icon-family-20261002/) | 17 | 0.19 MB |
| [atlas-tv-extension-icon-20261005](atlas-tv-extension-icon-20261005/) | 26 | 0.30 MB |
| [atlas-tv-ip-icons-20261005](atlas-tv-ip-icons-20261005/) | 28 | 20.20 MB |
| [atlas-tv-reference-icons-20261005](atlas-tv-reference-icons-20261005/) | 89 | 20.23 MB |
| [icon-concepts](icon-concepts/) | 21 | 0.01 MB |
| [list-visual-study](list-visual-study/) | 38 | 6.90 MB |
| [rewamp-review-20260923](rewamp-review-20260923/) | 11 | 0.58 MB |
| [rewamp-showroom-20260923](rewamp-showroom-20260923/) | 17 | 5.11 MB |
| [trade-list-symbol-icons-20260831](trade-list-symbol-icons-20260831/) | 5 | 0.46 MB |

机器可读清单与 ZIP 校验值见 [asset-catalog.json](asset-catalog.json)。基线不包含本索引及清单文件本身。

## 保留与清理规则

- 保留原图、可编辑源文件、生成脚本和已被说明文档引用的下载包；本轮逐个校验 ZIP 完整性。
- 现有交付链接与文件路径保留，避免归档时使设计文档或用户下载失效。
- 确认产物可由源文件完整重建、且没有文档或交付引用后，才移除重复产物；禁止删除原图后仅保留预览。
- 本轮不重写 Git 历史。历史文件占用与应用加载/安装包成本分别核对，不能仅凭目录体积删产品代码。
