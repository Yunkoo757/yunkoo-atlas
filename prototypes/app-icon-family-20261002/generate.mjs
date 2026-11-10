import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const dir = path.dirname(fileURLToPath(import.meta.url))
const icons = [
  { id: '01-focus', name: '聚焦 · Focus', use: '专注、计时、轻量工作台', shape: '<path d="M312 132a136 136 0 1 0 68 176" stroke="#E7E7EB" stroke-width="56" stroke-linecap="round"/><circle cx="244" cy="268" r="32" fill="#737BDD"/>' },
  { id: '02-stack', name: '层叠 · Stack', use: '知识库、资料管理、笔记', shape: '<path d="m128 184 128-64 128 64-128 64-128-64Z" fill="#E7E7EB"/><path d="m128 260 128 64 128-64M128 336l128 64 128-64" stroke="#E7E7EB" stroke-width="40" stroke-linejoin="round" stroke-linecap="round"/><circle cx="384" cy="112" r="32" fill="#737BDD"/>' },
  { id: '03-link', name: '联结 · Link', use: '同步、连接、协作工具', shape: '<path d="m236 300-18 18a68 68 0 0 1-96-96l48-48a68 68 0 0 1 96 0M276 212l18-18a68 68 0 0 1 96 96l-48 48a68 68 0 0 1-96 0" stroke="#E7E7EB" stroke-width="48" stroke-linecap="round"/><path d="m218 294 76-76" stroke="#737BDD" stroke-width="48" stroke-linecap="round"/>' },
  { id: '04-frame', name: '取景 · Frame', use: '截图、视觉素材、创作工具', shape: '<path d="M204 132h-44a28 28 0 0 0-28 28v192a28 28 0 0 0 28 28h192a28 28 0 0 0 28-28v-44M380 208v-48a28 28 0 0 0-28-28h-44" stroke="#E7E7EB" stroke-width="48" stroke-linecap="round"/><circle cx="256" cy="256" r="42" fill="#737BDD"/>' },
  { id: '05-flow', name: '流转 · Flow', use: '自动化、任务编排、流程工具', shape: '<path d="M128 348v-64a56 56 0 0 1 56-56h144a56 56 0 0 0 56-56v-12" stroke="#E7E7EB" stroke-width="48" stroke-linecap="round"/><path d="m328 176 56-56 56 56" stroke="#E7E7EB" stroke-width="40" stroke-linejoin="round" stroke-linecap="round"/><circle cx="128" cy="376" r="36" fill="#737BDD"/>' },
  { id: '06-vault', name: '归藏 · Vault', use: '文件归档、本地备份、安全存储', shape: '<rect x="128" y="128" width="256" height="256" rx="64" stroke="#E7E7EB" stroke-width="48"/><circle cx="256" cy="256" r="44" stroke="#E7E7EB" stroke-width="32"/><path d="M256 192v-28M256 348v-28M192 256h-28M348 256h-28" stroke="#E7E7EB" stroke-width="28" stroke-linecap="round"/><circle cx="388" cy="124" r="36" fill="#737BDD"/>' },
]
const shell = '<rect x="16" y="16" width="480" height="480" rx="112" fill="#121318"/><rect x="17" y="17" width="478" height="478" rx="111" stroke="#FFFFFF" stroke-opacity="0.08" stroke-width="2"/>'
const svg = (item, tile) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" fill="none" role="img" aria-labelledby="title"><title id="title">${item.name}</title>${tile ? shell : ''}${item.shape}</svg>\n`
await fs.mkdir(path.join(dir, 'svg'), { recursive: true })
await fs.mkdir(path.join(dir, 'glyph'), { recursive: true })
for (const item of icons) {
  await fs.writeFile(path.join(dir, 'svg', `${item.id}.svg`), svg(item, true), 'utf8')
  await fs.writeFile(path.join(dir, 'glyph', `${item.id}.svg`), svg(item, false), 'utf8')
}
const cards = icons.map(item => `<article><div class="hero"><img src="svg/${item.id}.svg" width="176" height="176" alt="${item.name}"></div><h2>${item.name}</h2><p>${item.use}</p><div class="sizes">${[16,24,32,48].map(s => `<div><img src="svg/${item.id}.svg" width="${s}" height="${s}" alt="${s} 像素"><small>${s}</small></div>`).join('')}</div><div class="links"><a href="svg/${item.id}.svg" download>下载 SVG</a><a href="glyph/${item.id}.svg" download>透明主体</a></div></article>`).join('')
await fs.writeFile(path.join(dir, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Atlas · 应用图标系列</title><link rel="stylesheet" href="../../src/styles/tokens.css"><style>*{box-sizing:border-box}body{margin:0;background:var(--surface-app);color:var(--text-primary);font:13px/1.5 var(--font-ui-base)}main{max-width:1180px;margin:0 auto;padding:40px 32px}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}h1{font-size:24px;font-weight:600;margin:0 0 6px}p{color:var(--text-secondary);margin:0}header img{width:56px;height:56px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}article{padding:20px;border:1px solid var(--color-border-secondary);border-radius:12px;background:var(--surface-pane)}.hero{display:grid;place-items:center;height:184px}h2{font-size:15px;font-weight:500;margin:16px 0 4px}.sizes{height:72px;display:flex;gap:24px;align-items:end;padding:12px 0}.sizes>div{display:flex;flex-direction:column;align-items:center;gap:4px}small{font-size:11px;color:var(--text-tertiary)}.links{display:flex;gap:16px;margin-top:16px}a{color:var(--text-secondary);text-decoration:none}a:hover{color:var(--text-primary)}a:focus-visible{outline:2px solid var(--accent);outline-offset:4px}footer{margin-top:20px;color:var(--text-tertiary)}@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}}</style><main><header><div><h1>Atlas · 应用图标系列</h1><p>相同材质，不同轮廓。为同一设计语言下的软件家族而作。</p></div><img src="../../build/icon.svg" alt="当前 Atlas 图标参考"></header><div class="grid">${cards}</div><footer>512 × 512 矢量母版 · 深靛黑底板 · 柔白主体 · 紫色定位细节</footer></main></html>`, 'utf8')
await fs.writeFile(path.join(dir, 'README.md'), `# Atlas 应用图标系列\n\n设计基线为当前 build/icon.svg：底板 #121318，主体 #E7E7EB，图标强调色 #737BDD，512 网格、16 外留白、112 底板圆角和 8% 白色边框。图标强调色采用实际品牌资源；应用控件强调色仍为 tokens.css 的 #5e6ad2。\n\n${icons.map(i => `- ${i.name}：${i.use}。`).join('\n')}\n\nsvg/ 是带底板的应用图标；glyph/ 是透明背景的同版主体。所有文件都是独立 SVG，无字体、外部图片、脚本、滤镜或外部依赖。主体色需在白色背景使用时替换为深色。\n\nindex.html 提供下载与 16/24/32/48 像素缩放预览；preview.png 为实际浏览器截图。小尺寸目前是同母版缩放，正式打包时应另做 16/20/24/32 像素光学校正，并生成目标软件的 ICO/ICNS。当前交付为 SVG 设计资产，未替换 Atlas 图标。\n\n重新生成：node prototypes/app-icon-family-20261002/generate.mjs\n`, 'utf8')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 1040 }, deviceScaleFactor: 1 })
  await page.goto(new URL(`file:///${dir.replaceAll('\\', '/')}/index.html`).href)
  await page.evaluate(() => Promise.all([...document.images].map(img => img.decode())))
  const result = await page.evaluate(() => ({ images: document.images.length, broken: [...document.images].filter(i => !i.naturalWidth).length, overflow: document.documentElement.scrollWidth > innerWidth }))
  await page.screenshot({ path: path.join(dir, 'preview.png'), fullPage: true })
  console.log(JSON.stringify(result))
} finally { await browser.close() }
