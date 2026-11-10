import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import JSZip from 'jszip'
import { chromium } from 'playwright'
const dir=path.dirname(fileURLToPath(import.meta.url))
const plan=JSON.parse(await fs.readFile(path.join(dir,'prompts.json'),'utf8'))
const results=[]
for(const candidate of plan.candidates){
 const result=JSON.parse(await fs.readFile(path.join(dir,`result-${candidate.label}.json`),'utf8'))
 const meta=await sharp(result.path).metadata()
 const relativePath=`images/${path.basename(result.path)}`
 const exportDir=path.join(dir,'chrome',candidate.label)
 await fs.mkdir(exportDir,{recursive:true})
 for(const size of [16,24,32,48,128])await sharp(result.path).resize(size,size,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toFile(path.join(exportDir,`icon-${size}.png`))
 const manifest={icons:Object.fromEntries([16,32,48,128].map(s=>[s,`icon-${s}.png`])),action:{default_icon:Object.fromEntries([16,24,32].map(s=>[s,`icon-${s}.png`]))}}
 await fs.writeFile(path.join(exportDir,'manifest-icons.json'),JSON.stringify(manifest,null,2)+'\n','utf8')
 // Label the returned candle by its visible form while preserving the original prompt.
 const visibleLabel=candidate.label==='09'?{requestedSubject:candidate.subject,subject:'烛光精灵',rationale:'专注与陪伴'}:{}
 results.push({...candidate,...result,...visibleLabel,width:meta.width,height:meta.height,relativePath})
}
await fs.writeFile(path.join(dir,'results.json'),JSON.stringify({provider:'built-in image_gen',model:'Specific model name not exposed by runtime',referenceRole:'user supplied style reference',constraintMode:'main-prompt constraints',results},null,2)+'\n','utf8')
const samples=(c,cls)=>`<div class="samples ${cls}">${[16,32,48].map(s=>`<img src="chrome/${c.label}/icon-${s}.png" width="${s}" height="${s}" alt="${c.label} ${s}px">`).join('')}<span>16 / 32 / 48</span></div>`
const cards=results.map(c=>`<article><a class="hero" href="${c.relativePath}" target="_blank"><img src="${c.relativePath}" width="${c.width}" height="${c.height}" alt="${c.label} ${c.subject}"></a><div class="info"><div class="title"><b>${c.label} · ${c.subject}</b><a href="${c.relativePath}" download>原图</a></div><p>${c.rationale}</p>${samples(c,'dark')}${samples(c,'light')}<div class="meta">${c.width} × ${c.height} 原图</div><details><summary>配色与 Chrome 文件</summary><p>${c.palette}</p><a href="chrome/${c.label}/icon-128.png" download>128px PNG</a> · <a href="chrome/${c.label}/manifest-icons.json" download>配置片段</a></details></div></article>`).join('')
await fs.writeFile(path.join(dir,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Atlas TV · 参考风格图标候选</title><link rel="stylesheet" href="../../src/styles/tokens.css"><style>*{box-sizing:border-box}body{margin:0;background:var(--surface-app);color:var(--text-primary);font:13px/1.5 var(--font-ui-base)}main{max-width:var(--page-rail-wide);padding:32px;margin:auto}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;gap:24px}h1{margin:0 0 6px;font-size:var(--font-size-title3);font-weight:600}p{margin:0;color:var(--text-secondary)}.reference{display:flex;align-items:center;gap:16px}.reference img{width:72px;height:72px;object-fit:contain}.reference a{font-size:12px}a{color:var(--text-primary);text-underline-offset:4px}a:focus-visible{outline:2px solid var(--accent);outline-offset:4px}.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px}article{overflow:hidden;background:var(--surface-pane);border:1px solid var(--color-border-secondary);border-radius:12px}.hero{display:flex;align-items:center;justify-content:center;line-height:0;background:var(--surface-inset);height:204px}.hero img{width:100%;height:100%;object-fit:contain}.info{padding:12px}.title{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px}.title b{font-weight:500}.title a{color:var(--text-secondary);font-size:11px}.info>p{font-size:11px;margin:6px 0 8px;min-height:16px}.samples{display:flex;align-items:center;gap:10px;min-height:60px;padding:6px;border-radius:6px;margin-bottom:6px}.samples img{flex:none}.dark{background:var(--surface-app)}.light{background:#F7F7F9;color:#42475F}.samples span{font-size:9px;line-height:1.3;width:28px;opacity:.65}.meta,details{font-size:11px;color:var(--text-secondary)}details{margin-top:8px}summary{cursor:pointer}details p{margin:8px 0}footer{margin-top:20px;color:var(--text-secondary);font-size:12px}</style><main><header><div><h1>Atlas TV · 10 个不同图标方向</h1><p>参考青蛙的圆润轮廓、软描边与柔和质感 · 动物 / 物体 / 抽象设计</p></div><div class="reference"><img src="style-reference.png" alt="用户提供的风格参考"><a href="atlas-tv-reference-10-icons.zip" download>下载全部</a></div></header><div class="grid">${cards}</div><footer>每张独立生成，完整保留原图。下方明暗背景均为实际 16 / 32 / 48px PNG。Chrome 文件夹另含 24 / 128px 与配置片段。本轮为 PNG 设计资产，未修改插件。</footer></main></html>\n`,'utf8')
const lines=results.map(c=>`| ${c.label} | ${c.subject} | ${c.rationale} | ${c.palette} | ${c.width} × ${c.height} | [原图](${c.relativePath}) |`)
await fs.writeFile(path.join(dir,'README.md'),`# Atlas TV · 参考风格的 10 个图标候选\n\n参考用户提供的青蛙图片，沿用软描边、柔和立体感、亲切表情，并结合 Atlas 的 #737BDD / #5e6ad2 靛紫与 #E7E7EB 柔白。10 个不同主体，包含动物、物体和无脸设计。参考图风格优先于 ip-as-logo 默认两色及角落裁切规则。\n\n使用内置 image_gen；具体模型版本未在接口中提供。每个候选一次独立生成，只使用同一张用户参考，完整保留所有返回原图，未筛选、排名、自动重试或修图。完整提示词与 main-prompt constraints 见 prompts.json。\n\n| 编号 | 主体 | 与插件的联系 | 请求配色 | 原生尺寸 | 文件 |\n| --- | --- | --- | --- | --- | --- |\n${lines.join('\n')}\n\n原图在 images/；chrome/01 至 chrome/10 各含16/24/32/48/128px PNG与manifest-icons.json。小尺寸导出仅进行缩放，不修改主体、重绘、自动优化或改变原图。选择候选后，将该文件夹中的PNG复制到扩展图标目录，将配置片段合并到现有manifest并按实际目录调整路径；保留action其他字段。\n\nindex.html 提供全部原图与明暗背景的实际尺寸预览。所有候选及参考图都在ZIP中，原图与生成源文件逐字节一致。本轮交付PNG设计资产，未制作SVG，未修改Atlas应用、TradingView插件或真实交易资料库。\n`,'utf8')
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage({viewport:{width:1240,height:1120},deviceScaleFactor:1})
 await page.goto(new URL(`file:///${dir.replaceAll('\\','/')}/index.html`).href)
 await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())))
 const check=await page.evaluate(()=>({images:document.images.length,broken:[...document.images].filter(i=>!i.naturalWidth).length,overflow:document.documentElement.scrollWidth>innerWidth}))
 await page.screenshot({path:path.join(dir,'preview.png'),fullPage:true})
 console.log(JSON.stringify(check))
}finally{await browser.close()}
const zip=new JSZip()
for(const c of results){
 zip.file(c.relativePath,await fs.readFile(c.path))
 for(const filename of await fs.readdir(path.join(dir,'chrome',c.label)))zip.file(`chrome/${c.label}/${filename}`,await fs.readFile(path.join(dir,'chrome',c.label,filename)))
}
for(const filename of ['prompts.json','results.json','README.md','preview.png','style-reference.png'])zip.file(filename,await fs.readFile(path.join(dir,filename)))
zip.file('index.html',(await fs.readFile(path.join(dir,'index.html'),'utf8')).replace('<link rel="stylesheet" href="../../src/styles/tokens.css">','<link rel="stylesheet" href="tokens.css">'))
zip.file('tokens.css',await fs.readFile(path.resolve(dir,'../../src/styles/tokens.css')))
await fs.writeFile(path.join(dir,'atlas-tv-reference-10-icons.zip'),await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}))
console.log(JSON.stringify({delivered:results.length,chromeExports:50}))
