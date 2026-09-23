"""Build inputs for an isolated, source-faithful Rewamp UI showroom.
Run prepare.py, npm exec vite build -- --config atlas-vite.config.js in SOURCE,
then prepare.py --pack. The main Atlas package is never changed.
"""
from pathlib import Path
import json, re, sys, base64

OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[1]
SOURCE=Path('C:/Users/Yunko/AppData/Local/Temp/atlas-rewamp-review-20260923')
UI=SOURCE/'src/components/ui'
REV='45e2460e58c7306abe9fc783fa0584bbadb81086'

groups={'cards':'卡片与图片','navbars':'导航','sidebars':'侧栏','buttons':'按钮','search-bars':'搜索','toggles':'切换器','bgs':'动态背景','text':'文字动画','ai-ui':'动态球体','cursors':'光标'}
registry=(SOURCE/'src/components/docsRegistry.js').read_text('utf-8')
entries=[]
for group,body in re.findall(r"id: '([^']+)'[\s\S]*?components: \[([\s\S]*?)\n        \]",registry):
    for title,slug,file in re.findall(r"makeLazy\('([^']+)', '([^']+)', \(\) => import\('./ui/([^']+)'\)",body):
        entries.append(dict(title=title,slug=slug,file=file,group=group,groupLabel=groups[group]))

translated={
'folder-tab-card':('文件夹卡片','复盘集合入口','移动鼠标看流光；点击卡片右上角，打开模拟集合。','保留文件夹切口、流动渐变、玻璃箭头。换入集合名与数量。'),
'diagonal-card-stack':('斜向卡片流','案例图浏览','拖拽、悬停；点击卡片切换堆叠状态。','保留斜向连续流和收拢动画，图片换成模拟复盘图。'),
'perspective-flip-deck':('透视翻牌','同一案例的多周期截图','点击卡组翻页；悬停查看暂停与透视效果。','保留转轴翻页和卡片透视，只替换图片内容。'),
'orbital-card-arch':('环轨卡片','案例集合浏览','拖拽图片带，点击卡片收拢与展开。','保留弧面运动，换入模拟复盘图。'),
'editorial-3-d-orbit-carousel':('节拍式 3D 轮播','案例封面精选','使用组件中的前后切换或播放按钮，也可拖拽。','保留节拍、排版与旋转，换入模拟复盘图。'),
'arch-card-carousel':('弧形图片轮播','截图与证据图库','水平拖拽、悬停图片；观察弧形排列和惯性。','保留拱形排列与拖拽惯性，换入模拟复盘图。'),
'morphing-tab-navbar':('变形标签导航','日志 / 案例 / 周复盘','点击各标签，观察高亮底板的弹簧移动。','保留玻璃胶囊与弹簧高亮；标签改为 Atlas 模块。'),
'magnetic-pill-navbar':('磁吸胶囊导航','页面视图切换','点击不同标签，观察选中底板的滑动。','保留磁吸选中态和尺寸，替换导航文字。'),
'liquid-underline-navbar':('液态下划线','详情页内容分区','将鼠标移到不同标签，观察下划线形变。','保留液态线条与悬停反馈，替换导航文字。'),
'kinetic-lens-sidebar':('透镜侧栏','专注复盘导航','悬停、滚轮或拖拽纵向菜单；点击项目。','保留焦点放大与透镜层级；内容改成 Atlas 模块。'),
'sidebar':('动态图标侧栏','Atlas 折叠侧栏','悬停图标查看动态提示，点击切换选中项。','保留原版图标动效；仅演示入口，不操控真实窗口。'),
'flower-sidebar':('花形侧栏','工作台导航','点击导航、在组件内搜索；观察指示器变化。','保留侧栏轮廓、花形装饰和运动；替换菜单文字。'),
'neumorphic-download-button':('拟物下载按钮','完整备份','点击一次，观察环形进度、图标和文字变化。','保留原版拟物圆盘与环形进度；文案改成导出备份。定时动画不是实际导出。'),
'slide-to-confirm-button':('运送确认按钮','完成一次复盘的视觉实验','点击按钮，观察小车穿过按钮的完整过程。','保留原版运送动画，仅替换文字。这里是点击动画，并非真正滑动确认。'),
'gloss-button':('光泽按钮','开始复盘入口','移动鼠标并按下按钮，观察持续流动的材质。','保留光泽与颜色流动，只换成“开始复盘”。'),
'morph-search-capsule':('变形搜索胶囊','搜索案例','点击胶囊并输入内容；点击外部看收起效果。','保留收展、涟漪与图标形变；搜索仅作用于演示。'),
'animated-search-demo':('展开搜索框','搜索交易日志','悬停展开，输入文字，再点击清除。','保留完整搜索展开与清除动效，替换占位文字。'),
}
text_patches={
 'morphing-tab-navbar':{'Home':'今日','About':'日志','Projects':'案例','Contacts':'周复盘'},
 'magnetic-pill-navbar':{'Home':'今日','About':'日志','Projects':'案例','Contacts':'周复盘'},
 'liquid-underline-navbar':{'Home':'概览','About':'笔记','Projects':'图片','Contacts':'属性'},
 'flower-sidebar':{'Dashboard':'今日工作台','Explore Components':'交易日志','Page Templates':'案例记录','Design Tokens':'策略管理','Fluid Motion':'周复盘','Activity Feed':'历史实盘','Settings':'设置'},
 'neumorphic-download-button':{'Download':'导出备份','Downloading…':'正在导出…','Downloaded':'备份完成','Click button to simulate neumorphic download':'点击体验导出动画 · 不生成文件'},
 'slide-to-confirm-button':{'Complete Order':'完成复盘','Order Placed':'复盘已完成','Click button to confirm order':'点击体验完成动画 · 不保存记录'},
 'gloss-button':{'Gloss Button':'开始复盘'},
}
# Replace string literals / displayed JSX text, never imports, identifiers or mechanics.
patch_imports=[]
patch_exports=[]
for n,(slug,mapping) in enumerate(text_patches.items()):
    entry=next(e for e in entries if e['slug']==slug)
    path=UI/(entry['file']+'.jsx')
    text=path.read_text('utf-8')
    for old,new in mapping.items():
        text=text.replace('"'+old+'"','"'+new+'"').replace("'"+old+"'","'"+new+"'").replace('>'+old+'<','>'+new+'<')
    patched='AtlasPreview'+entry['file']+'.jsx'
    (UI/patched).write_text(text,encoding='utf-8')
    patch_imports.append(f"import P{n} from './src/components/ui/{patched}';")
    patch_exports.append(json.dumps(slug)+f': P{n}')
(SOURCE/'atlas-patches.jsx').write_text('\n'.join(patch_imports)+'\nexport default {'+','.join(patch_exports)+'};',encoding='utf-8')

priority=list(translated)
for e in entries:
    info=translated.get(e['slug'])
    if info:
        e.update(zh=info[0],scene=info[1],hint=info[2],changes=info[3])
    else:
        e.update(zh=e['title'],scene='原版交互展示',hint={'navbars':'悬停或点击不同导航项，比较运动和选中反馈。','buttons':'悬停并点击按钮，观察原版材质与动画。','toggles':'点击切换器，观察完整形变与主题变化。','bgs':'移动鼠标并停留片刻，观察原版动态背景。','text':'观察文字入场、循环或悬停效果。','ai-ui':'移动鼠标、悬停，观察原版球体运动。','cursors':'在演示区域内移动鼠标，观察跟随效果。'}.get(e['group'],'操作演示区域，体验原版交互。'),changes='未改写组件内容，展示 Rewamp 原版。')
    e['context']=e['slug'] in translated and e['slug']!='sidebar'
    e['featured']=e['slug'] in translated
entries.sort(key=lambda e:priority.index(e['slug']) if e['slug'] in priority else 100+list(groups).index(e['group']))
(OUT/'catalog.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2),encoding='utf-8')

if '--pack' in sys.argv:
    dist=SOURCE/'atlas-showroom-dist'
    js=next((dist/'assets').glob('*.js')).read_text('utf-8')
    # Public-root URLs do not resolve from a standalone local file. Embed the
    # unchanged upstream logo, just as Vite already inlines imported images.
    logo='data:image/svg+xml;base64,'+base64.b64encode((SOURCE/'public/logos/logo.svg').read_bytes()).decode()
    js='const __ATLAS_LOGO_ASSET__='+json.dumps(logo)+';\n'+re.sub(r'''["']/logos/logo\.svg["']''','__ATLAS_LOGO_ASSET__',js)
    css='\n'.join(p.read_text('utf-8') for p in (dist/'assets').glob('*.css'))
    renderer='<html><head><meta charset="UTF-8"><style>'+css+'</style><style>html,body,#root{margin:0;min-height:100%;height:100%;}body{overflow-x:hidden}</style></head><body><div id="root"></div><script>window.__ATLAS_DEMO_CONFIG__=__CONFIG_PLACEHOLDER__;</script><script type="module">'+js.replace('</script','<\\/script')+'</script></body></html>'
    shell=(OUT/'shell.html').read_text('utf-8')
    tokens=(ROOT/'src/styles/tokens.css').read_text('utf-8')
    button=(ROOT/'src/components/ui/Button.css').read_text('utf-8')
    font=next((ROOT/'node_modules/@fontsource-variable/inter/files').glob('inter-latin-wght-normal.woff2'))
    fonts='@font-face{font-family:"Inter Variable";font-weight:100 900;src:url(data:font/woff2;base64,'+base64.b64encode(font.read_bytes()).decode()+')} '
    payload=json.dumps(renderer,ensure_ascii=False).replace('<','\\u003c')
    shell=shell.replace('/* ATLAS_CSS */',tokens+button+fonts).replace('__CATALOG_DATA__',json.dumps(entries,ensure_ascii=False).replace('<','\\u003c')).replace('__RENDERER_DATA__',payload)
    (OUT/'showroom.html').write_text(shell,encoding='utf-8')
    print(f'Standalone showroom: {len(entries)} originals, {sum(e["context"] for e in entries)} Atlas contexts, {len(shell.encode())/1024/1024:.1f} MB')
else:
    (SOURCE/'atlas-preview.jsx').write_text((OUT/'renderer.jsx').read_text('utf-8'),encoding='utf-8')
    (SOURCE/'atlas-preview.html').write_text('<html><meta charset="UTF-8"><div id="root"></div><script type="module" src="/atlas-preview.jsx"></script></html>',encoding='utf-8')
    (SOURCE/'atlas-vite.config.js').write_text("""import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({plugins:[react(),tailwindcss()],build:{outDir:'atlas-showroom-dist',assetsInlineLimit:1000000,cssCodeSplit:false,rollupOptions:{input:'atlas-preview.html',output:{inlineDynamicImports:true}},chunkSizeWarningLimit:5000}});
""",encoding='utf-8')
    print(f'Prepared {len(entries)} component originals and {len(patch_exports)} text-only adaptations in isolated upstream checkout.')
