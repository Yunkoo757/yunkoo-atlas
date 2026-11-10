# Atlas TV · 参考风格的 10 个图标候选

参考用户提供的青蛙图片，沿用软描边、柔和立体感、亲切表情，并结合 Atlas 的 #737BDD / #5e6ad2 靛紫与 #E7E7EB 柔白。10 个不同主体，包含动物、物体和无脸设计。参考图风格优先于 ip-as-logo 默认两色及角落裁切规则。

使用内置 image_gen；具体模型版本未在接口中提供。每个候选一次独立生成，只使用同一张用户参考，完整保留所有返回原图，未筛选、排名、自动重试或修图。完整提示词与 main-prompt constraints 见 prompts.json。

| 编号 | 主体 | 与插件的联系 | 请求配色 | 原生尺寸 | 文件 |
| --- | --- | --- | --- | --- | --- |
| 01 | 月兔 | 观察与判断 | soft ivory #E7E7EB, lilac #A4A8E8, indigo accent #737BDD | 1254 × 1254 | [原图](images/01.png) |
| 02 | 蝾螈 | 灵活切换与操作 | powder mauve #D6C7E3 and muted lavender #929BDD, cream face #F1EAD9 | 1254 × 1254 | [原图](images/02.png) |
| 03 | 企鹅 | 专注与整洁 | deep indigo #545D94, porcelain #E7E7EB, restrained muted peach beak | 1254 × 1254 | [原图](images/03.png) |
| 04 | 蜗牛 | 回放中的耐心与节奏 | cream #E7E7EB, lavender shell #ADB1E9, indigo spiral #737BDD | 1254 × 1254 | [原图](images/04.png) |
| 05 | 蝠鲼 | 沉浸与顺畅控制 | muted slate blue #889BCC, cream #E7E7EB, lilac accent #737BDD | 1254 × 1254 | [原图](images/05.png) |
| 06 | 罗盘 | 图表导航与方向 | porcelain #E7E7EB, indigo #737BDD, dark blue-gray #42475F | 1254 × 1254 | [原图](images/06.png) |
| 07 | 沙漏 | 回放与时间管理 | lavender #9FA5E2, cream #EFE9D9, muted warm sand #D1BE92 | 1254 × 1254 | [原图](images/07.png) |
| 08 | 望远镜 | 观察结构与聚焦 | ivory #E7E7EB, lilac #A4ABE5, deep indigo lenses #42475F | 1254 × 1254 | [原图](images/08.png) |
| 09 | 烛光精灵 | 专注与陪伴 | indigo-lilac #929BDD, pale cream #E7E7EB, subdued rose cheeks | 1254 × 1254 | [原图](images/09.png) |
| 10 | 轨道星球 | Atlas 全局工作台与关联 | porcelain #E7E7EB, soft lilac #A4ABE5, indigo #737BDD | 1254 × 1254 | [原图](images/10.png) |

原图在 images/；chrome/01 至 chrome/10 各含16/24/32/48/128px PNG与manifest-icons.json。小尺寸导出仅进行缩放，不修改主体、重绘、自动优化或改变原图。选择候选后，将该文件夹中的PNG复制到扩展图标目录，将配置片段合并到现有manifest并按实际目录调整路径；保留action其他字段。

index.html 提供全部原图与明暗背景的实际尺寸预览。所有候选及参考图都在ZIP中，原图与生成源文件逐字节一致。本轮交付PNG设计资产，未制作SVG，未修改Atlas应用、TradingView插件或真实交易资料库。
