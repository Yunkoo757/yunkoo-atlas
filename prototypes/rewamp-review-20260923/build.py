from pathlib import Path
import json, base64, html

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
SOURCE = Path('C:/Users/Yunko/AppData/Local/Temp/atlas-rewamp-review-20260923')
items = [json.loads(p.read_text('utf-8')) for p in sorted((SOURCE/'registry').glob('*.json')) if p.name != 'schema.json']
font = next((ROOT/'node_modules/@fontsource-variable/inter/files').glob('inter-latin-wght-normal.woff2'))
css = (ROOT/'src/styles/tokens.css').read_text('utf-8') + (ROOT/'src/components/ui/Button.css').read_text('utf-8')
css += '\n@font-face{font-family:"Inter Variable";font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,'+base64.b64encode(font.read_bytes()).decode()+') format("woff2");font-display:swap}'
template = (OUT/'template.html').read_text('utf-8')
(OUT/'index.html').write_text(template.replace('/* ATLAS_STYLES */',css),encoding='utf-8')

rows=[]
for item in items:
    name=item['name']
    missing=[f['source'] for f in item['files'] if not (SOURCE/f['source']).exists()]
    if name=='neumorphic-download-button': verdict='优先：借鉴状态流，重写为 Atlas 异步按钮'
    elif name=='folder-tab-card': verdict='有条件：仅用于复盘集合入口，先比较列表与卡片'
    elif name in ['morph-search-capsule','animated-search-demo']: verdict='低优先：只借鉴聚焦反馈，保留现有搜索入口'
    elif name=='skeleton': verdict='已有局部实现：需要时统一占位尺寸，不直接引入'
    elif item['category'] in ['navbars','sidebars','controls']: verdict='保留 Atlas 现有导航及控件；不替换'
    elif item['category'] in ['bgs','cursors','ai-ui','text']: verdict='不适用于高频交易工作台；装饰动效或无对应业务'
    elif item['category']=='cards': verdict='不建议：堆叠/翻转/轮播降低证据可见性'
    elif item['category']=='toggles': verdict='不建议：缺少对应主题需求，体积和拟物过重'
    else: verdict='不建议：装饰大于任务收益；沿用现有 Button'
    if name=='slide-to-confirm-button': verdict='不建议：拖动不能替代风险范围与确认；源码实际为点击演示'
    rows.append(f"| [{name}](https://www.rewampui.com/components/{name}) | {item['category']} | {verdict} | {'缺失：'+', '.join(missing) if missing else '注册引用存在'} |")
report='''# Rewamp UI → Atlas 迁移判断

评估日期：2026-09-23。来源仓库提交：`45e2460e58c7306abe9fc783fa0584bbadb81086`。
范围：扫描全部 75 个 registry 条目、检查引用文件存在性，重点阅读下载按钮、文件夹卡片、搜索胶囊、骨架屏与确认按钮；对照 Atlas 当前公共组件及页面。并未逐个运行所有组件，也不是完整无障碍/性能审计。

## 判断

最值得先做的是 **异步操作按钮**。其次是有条件的 **复盘集合卡片**。搜索反馈只列为低优先微调。其余大多是展示站用的动效组件，直接迁入高密度客户端收益有限。

1. **异步操作按钮（优先）**：来源 Neumorphic Download Button。保留开始 → 处理中 → 成功/失败的连续反馈；去掉凸起圆盘、渐变和固定时长百分比。Atlas `src/components/DataIOContent.tsx` 当前导出依靠结果 toast，导出按钮未展示同位处理中状态。拟议以现有 `Button` + `InlineStatus` 组合表达，按真实 Promise 结果更新；取消另算，未知进度不展示百分比，不预设后端支持取消。验证防重复触发、失败重试、取消不报成功和屏幕阅读器反馈。
2. **复盘集合入口（有条件）**：来源 Folder Tab Card。保留“一个集合、一段摘要、一个入口”，移除旋转极光、鼠标跟随和大圆角。只用于选择复盘集合，不能替换交易日志、逐笔详情、已有属性或图片预览。先用样稿比较紧凑列表与卡片：集合少且摘要能帮助挑选时可试；数量多或依赖排序时继续用列表。样稿集合名和记录均为虚构，不代表已有资料库结构。
3. **搜索聚焦反馈（低优先）**：来源 Morph Search Capsule / Animated Search Demo。保留轻微的聚焦边界和清除入口；固定宽度、保留放大镜、按现有搜索协议处理中文组合输入和 Esc。Atlas 已有 CommandPalette，不另建搜索系统。样稿只有本地列表筛选，不声称替代命令面板。
4. **Skeleton（按需统一）**：Atlas 周复盘已有骨架屏和 reduced-motion 处理。可以统一尺寸合同，不能据此判定缺少加载能力。Rewamp Skeleton 依赖站点 `--elevated` 和 `animate-shimmer`，复制文件并不足以获得相同效果。
5. **不迁移导航与炫技动效**：Atlas SegmentedControl 已有随选项移动的指示器、方向键和减少动画支持。3D 卡组、轨道导航、跑马灯、鼠标尾迹、粒子背景均会增加信息遮挡或持续运动。滑动确认不能替代明确的影响范围和最终确认。

## 迁移前提与源码问题

- 官网是 React 源码组件展示库；上游 README 使用 React 19 / Tailwind 4，Atlas 当前为 React 18 与自有 CSS。版本差异不等于所有组件不兼容，但必须逐项转为 TSX、现有 token 和公共控件，不能整包安装 Tailwind 后原样覆盖。
- 下载按钮源码 `DURATION = 2200`，由 requestAnimationFrame 推进演示进度，没有接入下载服务。正式版必须接实际任务状态。
- 75 个注册条目中 4 个引用源文件在该提交不存在：aurora-text、digital-rain、frosted-folder-card、wallet-card-reveal。不要把 CLI 安装成功视为所有组件都可添加。
- CLI 包声明 MIT；本次仓库根目录未发现 LICENSE 文件。若后续直接复制上游组件源码，应先核清组件本身的许可与署名要求。本轮 HTML 根据交互概念独立编写，未复制上游组件源码。
- 无须新运行时依赖。优先扩展现有 Button / InlineStatus / SegmentedControl，业务集合组件留在复盘模块；不要给同一用途创建第二套基础控件。

## 样稿

打开同目录 `index.html`。它是独立离线 HTML，内嵌本轮 Atlas token、Button 样式与 Inter 字体。三个样例均使用虚构数据；导出是明确标注的模拟状态，不能创建备份或操作真实资料库。

轨道：standard 1180px；标题 20/28/600，区块 13/20/600，数据行 13/20/400，元数据 12/18/400；区块间距 24px，按钮复用既有 28px 合同。独立对象才用卡片，普通说明保持透明。

## 全量初筛

“注册引用存在”只证明路径存在，不证明组件能安装、正确运行或适用于 Atlas。

| 组件 | 分类 | 初筛建议 | 源码引用 |
|---|---|---|---|
'''+ '\n'.join(rows)+'\n'
(OUT/'assessment.md').write_text(report,encoding='utf-8')
print(f'Generated demo and assessment: {len(items)} registry entries')
