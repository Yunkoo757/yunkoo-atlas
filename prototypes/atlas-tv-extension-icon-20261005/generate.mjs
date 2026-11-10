import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { chromium } from 'playwright'
import JSZip from 'jszip'

const dir = path.dirname(fileURLToPath(import.meta.url))
const sizes = [16, 20, 24, 32, 48, 64, 128, 256, 512]
const defs = `<defs>
  <linearGradient id="plate" x1="12" y1="2" x2="52" y2="62" gradientUnits="userSpaceOnUse"><stop stop-color="#E7E7EB"/><stop offset=".2" stop-color="#121318"/><stop offset="1" stop-color="#121318"/></linearGradient>
  <linearGradient id="porcelain" x1="15" y1="13" x2="43" y2="54" gradientUnits="userSpaceOnUse"><stop stop-color="#FFFFFF"/><stop offset=".55" stop-color="#E7E7EB"/><stop offset="1" stop-color="#E7E7EB" stop-opacity=".85"/></linearGradient>
  <linearGradient id="locator" x1="44" y1="12" x2="52" y2="23" gradientUnits="userSpaceOnUse"><stop stop-color="#E7E7EB"/><stop offset=".22" stop-color="#737BDD"/><stop offset="1" stop-color="#5e6ad2"/></linearGradient>
</defs>`
// The shell uses the existing build/icon.svg palette, with a restrained white highlight.
const shell = `<rect x="2" y="2" width="60" height="60" rx="14" fill="#121318"/>
<rect x="2" y="2" width="60" height="60" rx="14" fill="url(#plate)" opacity=".055"/>
<rect x="2.25" y="2.25" width="59.5" height="59.5" rx="13.75" stroke="#FFFFFF" stroke-opacity=".12" stroke-width=".5"/>`
const geometry = `<circle cx="29" cy="34" r="18" stroke="url(#porcelain)" stroke-width="7"/>
<path d="M25 30v15M33 24v16" stroke="#E7E7EB" stroke-width="2" stroke-linecap="round"/>
<rect x="22.5" y="34" width="5" height="8" rx="1.5" fill="url(#porcelain)"/>
<rect x="30.5" y="27" width="5" height="10" rx="1.5" fill="url(#porcelain)"/>
<circle cx="48" cy="17" r="5.5" fill="url(#locator)"/>`
const master = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 64 64" fill="none" role="img" aria-labelledby="title"><title id="title">Atlas TV · 环形图表</title>${defs}${shell}${geometry}</svg>\n`
const glyph = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 64 64" fill="none" role="img" aria-labelledby="title"><title id="title">Atlas TV · 透明图形</title>${defs}${geometry}</svg>\n`

// Small masters use their own pixel grids: full-pixel candle widths, thicker ring,
// and no subpixel wicks below 24px. These are not downscaled 512px PNGs.
const grids = {
  16: { inset: 0, cr: 4, cx: 7.5, cy: 8.5, r: 5, stroke: 2, dx: 12, dy: 4, dr: 2, candles: [[6,8,1,3],[8,6,1,4]] },
  20: { inset: .5, cr: 4.5, cx: 9, cy: 10.5, r: 5.5, stroke: 2, dx: 15, dy: 5, dr: 2, candles: [[7,10,2,3],[10,8,2,4]] },
  24: { inset: .5, cr: 5.5, cx: 11, cy: 13, r: 7, stroke: 3, dx: 18, dy: 6, dr: 2.5, candles: [[9,13,2,3],[12,10,2,4]], wicks: [[10,12,18],[13,9,16]] },
  32: { inset: 1, cr: 7, cx: 14.5, cy: 17, r: 9, stroke: 4, dx: 24, dy: 8.5, dr: 3, candles: [[11,17,3,4],[15,13,3,6]], wicks: [[12.5,15,22],[16.5,12,21]] },
}
function optical(size) {
  const g = grids[size]
  const side = size - g.inset * 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none"><title>Atlas TV · ${size}px 光学校正版</title>
<rect x="${g.inset}" y="${g.inset}" width="${side}" height="${side}" rx="${g.cr}" fill="#121318"/>
<rect x="${g.inset+.25}" y="${g.inset+.25}" width="${side-.5}" height="${side-.5}" rx="${g.cr-.25}" stroke="#FFFFFF" stroke-opacity=".12" stroke-width=".5"/>
<circle cx="${g.cx}" cy="${g.cy}" r="${g.r}" stroke="#E7E7EB" stroke-width="${g.stroke}"/>
${(g.wicks || []).map(([x,y,end])=>`<path d="M${x} ${y}V${end}" stroke="#E7E7EB" stroke-width="1" stroke-linecap="round"/>`).join('')}
${g.candles.map(([x,y,w,h])=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${size<=20 ? .5 : .75}" fill="#E7E7EB"/>`).join('')}
<circle cx="${g.dx}" cy="${g.dy}" r="${g.dr}" fill="#737BDD"/></svg>\n`
}
await fs.mkdir(path.join(dir, 'icons'), { recursive: true })
await fs.mkdir(path.join(dir, 'svg'), { recursive: true })
await fs.writeFile(path.join(dir, 'atlas-tv.svg'), master, 'utf8')
await fs.writeFile(path.join(dir, 'atlas-tv-glyph.svg'), glyph, 'utf8')
for (const size of sizes) {
  const svg = grids[size] ? optical(size) : master
  await fs.writeFile(path.join(dir, 'svg', `atlas-tv-${size}.svg`), svg, 'utf8')
  await sharp(Buffer.from(svg)).resize(size,size).png().toFile(path.join(dir, 'icons', `atlas-tv-${size}.png`))
}
const manifest = {
  icons: Object.fromEntries([16,32,48,128].map(s=>[s,`icons/atlas-tv-${s}.png`])),
  action: { default_icon: Object.fromEntries([16,24,32].map(s=>[s,`icons/atlas-tv-${s}.png`])) },
}
await fs.writeFile(path.join(dir, 'manifest-icons.json'), JSON.stringify(manifest,null,2)+'\n', 'utf8')
const row = () => [16,20,24,32,48,128].map(s=>`<div class="size"><img src="icons/atlas-tv-${s}.png" width="${s}" height="${s}" alt="${s} 像素图标"><span>${s}px</span></div>`).join('')
await fs.writeFile(path.join(dir, 'index.html'), `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><title>Atlas TV · 扩展图标</title><link rel="stylesheet" href="../../src/styles/tokens.css">
<style>*{box-sizing:border-box}body{margin:0;background:var(--surface-app);color:var(--text-primary);font:13px/1.5 var(--font-ui-base)}main{max-width:var(--page-rail-reading);margin:auto;padding:32px}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}h1{font-size:var(--font-size-title3);font-weight:600;margin:0 0 4px}p{margin:0;color:var(--text-secondary)}.hero{display:flex;align-items:center;gap:40px;margin-bottom:24px}.hero>img{width:208px;height:208px}.hero h2{font-size:15px;margin:0 0 8px;font-weight:600}.hero p{max-width:400px}.links{display:flex;gap:16px;margin-top:16px}a{color:var(--text-primary);text-underline-offset:4px}a:focus-visible{outline:2px solid var(--accent);outline-offset:4px}.strip{border-radius:12px;padding:20px 24px;margin:12px 0;border:1px solid var(--color-border-secondary)}.strip h2{font-size:12px;font-weight:500;margin:0 0 16px;color:inherit}.dark{background:var(--surface-pane)}.light{background:#FFFFFF;color:#121318}.sizes{display:flex;align-items:end;gap:32px}.size{display:flex;flex-direction:column;align-items:center;gap:12px;min-width:32px}.size span{font-size:11px;opacity:.65}.toolbar{height:44px;display:flex;align-items:center;gap:16px}.toolbar .address{height:28px;border-radius:8px;background:var(--surface-inset);flex:1;display:flex;align-items:center;padding:0 12px;color:var(--text-secondary);font-size:12px}.toolbar img{flex:none}.label{font-size:12px;color:var(--text-secondary);margin-top:20px}footer{margin-top:20px;color:var(--text-secondary);font-size:12px}</style>
<main><header><div><h1>Atlas TV · 环形图表</h1><p>Chrome 扩展图标 · 小尺寸光学校正</p></div><img src="../../build/icon.svg" width="40" height="40" alt="Atlas 品牌参考"></header>
<div class="hero"><img src="atlas-tv.svg" alt="Atlas TV 图标"><div><h2>圆环聚焦，双 K 线识别。</h2><p>沿用 Atlas 深色底板、柔白主体与靛紫定位点。轻微表面高光保留材质，主体轮廓承担小尺寸辨识。</p><div class="links"><a href="atlas-tv.svg" download>SVG 源文件</a><a href="atlas-tv-icon-pack.zip" download>完整图标包</a></div></div></div>
<section class="strip dark"><h2>深色背景 · 实际像素尺寸</h2><div class="sizes">${row()}</div></section>
<section class="strip light"><h2>浅色背景 · 实际像素尺寸</h2><div class="sizes">${row()}</div></section>
<p class="label">工具栏情境预览 · 16px / 24px</p><div class="toolbar"><span>‹</span><span>›</span><div class="address">tradingview.com/chart/</div><img src="icons/atlas-tv-16.png" width="16" height="16" alt="工具栏 16px"><img src="icons/atlas-tv-24.png" width="24" height="24" alt="工具栏 24px"><span>⋮</span></div>
<footer>16 / 20 / 24 / 32px 使用独立 SVG 网格。PNG 可直接用于扩展 manifest；SVG 用于编辑与页面展示。</footer></main></html>`, 'utf8')
await fs.writeFile(path.join(dir, 'README.md'), `# Atlas TV 扩展图标\n\n方向：Atlas 环形品牌标记 + 双 K 线。\n\n配色来自当前 build/icon.svg（#121318、#E7E7EB、#737BDD），渐变末端采用 tokens.css 的 #5e6ad2；浅高光是现有颜色与白色的叠加。未使用外部字体、位图、滤镜或脚本。\n\n- atlas-tv.svg：512 × 512 矢量母版。\n- atlas-tv-glyph.svg：透明主体，适用于深色背景。\n- svg/：各尺寸 SVG，16/20/24/32 为单独光学校正。\n- icons/：16/20/24/32/48/64/128/256/512px PNG。\n- manifest-icons.json：icons 与 action.default_icon 的合并片段，保留现有 action 其他字段。\n- index.html：明暗背景、实际尺寸、工具栏情境预览。\n\nChrome 不支持在 manifest 图标字段中直接使用 SVG。官方文档：https://developer.chrome.com/docs/extensions/develop/ui/configure-icons\n\n此交付为独立设计资产，未替换 Atlas 正式应用图标或修改 TradingView 插件。\n\n重新生成：在仓库根目录运行 node prototypes/atlas-tv-extension-icon-20261005/generate.mjs\n`, 'utf8')
const browser = await chromium.launch({ headless:true })
try {
  const page = await browser.newPage({ viewport:{width:920,height:820},deviceScaleFactor:1 })
  await page.goto(new URL(`file:///${dir.replaceAll('\\','/')}/index.html`).href)
  await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())))
  const check = await page.evaluate(()=>({images:document.images.length,broken:[...document.images].filter(i=>!i.naturalWidth).length,overflow:document.documentElement.scrollWidth>innerWidth}))
  await page.screenshot({path:path.join(dir,'preview.png'),fullPage:true})
  console.log(JSON.stringify(check))
} finally { await browser.close() }
const zip = new JSZip()
for (const f of ['atlas-tv.svg','atlas-tv-glyph.svg','README.md','manifest-icons.json','preview.png']) zip.file(f,await fs.readFile(path.join(dir,f)))
for (const folder of ['icons','svg']) for (const f of await fs.readdir(path.join(dir,folder))) zip.file(`${folder}/${f}`,await fs.readFile(path.join(dir,folder,f)))
await fs.writeFile(path.join(dir,'atlas-tv-icon-pack.zip'),await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}))
