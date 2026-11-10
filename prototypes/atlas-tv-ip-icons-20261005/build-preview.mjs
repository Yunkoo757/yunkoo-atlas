import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import JSZip from 'jszip'
import { chromium } from 'playwright'
const dir = path.dirname(fileURLToPath(import.meta.url))
const plan = JSON.parse(await fs.readFile(path.join(dir,'prompts.json'),'utf8'))
const results = []
for (const candidate of plan.candidates) {
  const result = JSON.parse(await fs.readFile(path.join(dir,`result-${candidate.label}.json`),'utf8'))
  const metadata = await sharp(result.path).metadata()
  results.push({...candidate,...result,width:metadata.width,height:metadata.height,relativePath:`images/${path.basename(result.path)}`})
}
await fs.writeFile(path.join(dir,'results.json'),JSON.stringify({provider:'built-in image_gen',model:'Runtime did not expose a specific model name',constraintMode:'main-prompt constraints',results},null,2)+'\n','utf8')
const corners = {'lower-left':'左下','lower-right':'右下'}
const cards=results.map(c=>`<article><a class="image" href="${c.relativePath}" target="_blank"><img src="${c.relativePath}" alt="${c.label} ${c.subject}" width="${c.width}" height="${c.height}"></a><div class="info"><div class="title"><b>${c.label} · ${c.subject}</b><a href="${c.relativePath}" download>原图</a></div><div class="samples"><img src="${c.relativePath}" width="16" height="16" alt="16px 预览"><img src="${c.relativePath}" width="32" height="32" alt="32px 预览"><span>16 / 32px</span></div><div class="meta">${corners[c.corner]} · ${c.width} × ${c.height}</div><details><summary>配色与方向</summary><p>${c.rationale}</p><p>角色 ${c.colors.subject.join(' / ')}<br>背景 ${c.colors.background}</p></details></div></article>`).join('')
await fs.writeFile(path.join(dir,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Atlas TV · 10 个 IP 图标候选</title><link rel="stylesheet" href="../../src/styles/tokens.css"><style>*{box-sizing:border-box}body{margin:0;background:var(--surface-app);color:var(--text-primary);font:13px/1.5 var(--font-ui-base)}main{max-width:var(--page-rail-wide);padding:32px;margin:auto}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}h1{margin:0 0 6px;font-size:var(--font-size-title3);font-weight:600}p{margin:0;color:var(--text-secondary)}a{color:var(--text-primary);text-underline-offset:4px}a:focus-visible{outline:2px solid var(--accent);outline-offset:4px}.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px}article{overflow:hidden;background:var(--surface-pane);border:1px solid var(--color-border-secondary);border-radius:var(--radius-12,12px)}.image{display:block;line-height:0}.image img{width:100%;height:auto;aspect-ratio:1;display:block}.info{padding:12px}.title{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px}.title b{font-weight:500}.title a{color:var(--text-secondary);font-size:11px}.samples{height:40px;display:flex;align-items:center;gap:10px;margin:8px 0}.samples img{flex:none}.samples span,.meta{font-size:11px;color:var(--text-secondary)}details{font-size:11px;margin-top:8px;color:var(--text-secondary)}summary{cursor:pointer}details p{margin-top:6px}footer{margin-top:20px;color:var(--text-secondary);font-size:12px}</style><main><header><div><h1>Atlas TV · 10 个 IP 图标候选</h1><p>猫头鹰：观察判断 · 狐狸：敏捷操作 · 水豚：沉着耐心</p></div><a href="atlas-tv-ip-10-icons.zip" download>下载全部原图</a></header><div class="grid">${cards}</div><footer>10 张独立生成原图，均完整保留。点图查看原始尺寸；16 / 32px 为浏览器显示预览。本轮为 PNG 图片候选，尚未制作 SVG。</footer></main></html>\n`,'utf8')
const lines=results.map(c=>`| ${c.label} | ${c.subject} | ${c.rationale} | ${corners[c.corner]} | ${c.colors.subject.join(' / ')} | ${c.colors.background} | ${c.width} × ${c.height} | [原图](${c.relativePath}) |`)
await fs.writeFile(path.join(dir,'README.md'),`# Atlas TV · 10 个 IP 图标候选\n\n使用 ip-as-logo Skill 与内置 image_gen。每个候选单独一次生成，无参考图。完整保留所有返回结果，未筛选、排名、重新生成或修改像素。图像模型具体版本未在运行接口中提供；使用 main-prompt constraints，完整 prompt 和约束见 prompts.json。\n\n猫头鹰表达观察与判断；狐狸表达快捷操作；水豚表达沉着与耐心。10 张分配为 4/3/3，左下和右下各5张。\n\n| 标签 | 角色 | 产品联系 | 角落 | 角色色 | 背景色 | 原生尺寸 | 文件 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n${lines.join('\n')}\n\n配色为请求值，不将实际返回图像作为颜色合规检测。本轮交付 PNG 设计候选，未修改 Atlas 应用或 TradingView 插件，未制作 SVG。index.html 展示全部原图及 16/32px 浏览器缩放预览。\n`,'utf8')
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage({viewport:{width:1240,height:880},deviceScaleFactor:1})
 await page.goto(new URL(`file:///${dir.replaceAll('\\','/')}/index.html`).href)
 await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())))
 const check=await page.evaluate(()=>({images:document.images.length,broken:[...document.images].filter(i=>!i.naturalWidth).length,overflow:document.documentElement.scrollWidth>innerWidth}))
 await page.screenshot({path:path.join(dir,'preview.png'),fullPage:true})
 console.log(JSON.stringify(check))
}finally{await browser.close()}
const zip=new JSZip()
for(const c of results)zip.file(c.relativePath,await fs.readFile(c.path))
for(const filename of ['prompts.json','results.json','README.md','preview.png'])zip.file(filename,await fs.readFile(path.join(dir,filename)))
zip.file('index.html',(await fs.readFile(path.join(dir,'index.html'),'utf8')).replace('<link rel="stylesheet" href="../../src/styles/tokens.css">','<link rel="stylesheet" href="tokens.css">'))
zip.file('tokens.css',await fs.readFile(path.resolve(dir,'../../src/styles/tokens.css')))
await fs.writeFile(path.join(dir,'atlas-tv-ip-10-icons.zip'),await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}))
console.log(JSON.stringify({delivered:results.length,files:results.map(c=>c.relativePath)}))
