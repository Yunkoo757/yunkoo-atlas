// 探针 v3：正文段落、属性分组头、编辑器内部、侧栏分组与项。
import { chromium } from 'playwright'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const FILE = process.argv[2]
const url = pathToFileURL(resolve(FILE)).href
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(600)

const result = await page.evaluate(() => {
  const PROPS = ['display','width','height','minHeight','padding','margin','marginTop','marginBottom',
    'borderRadius','fontSize','fontWeight','lineHeight','letterSpacing','color','backgroundColor',
    'gap','textTransform','listStyleType','paddingLeft']
  const pick = (el) => {
    if (!el) return null
    const cs = getComputedStyle(el)
    const o = { tag: el.tagName.toLowerCase(), txt: (el.textContent||'').trim().slice(0,24) }
    for (const p of PROPS) {
      const v = cs[p]
      if (v && !['normal','none','auto','0px','rgba(0, 0, 0, 0)','outside'].includes(v)) o[p] = v
    }
    return o
  }
  const leaf = (txt) => {
    const e = [...document.querySelectorAll('*')].filter(x=>x.children.length===0 && x.textContent.trim()===txt)
    return e[e.length-1] || null
  }
  const out = {}

  // 正文段落：ProseMirror 里文字较长的 p
  const ps = [...document.querySelectorAll('.ProseMirror p, [contenteditable] p')]
    .filter(p => p.textContent.trim().length > 20)
  out.bodyParagraph = pick(ps[0])
  out.bodyParagraphMargins = ps.slice(0,3).map(p => ({txt:p.textContent.trim().slice(0,18), m: getComputedStyle(p).margin, fs: getComputedStyle(p).fontSize, lh: getComputedStyle(p).lineHeight}))

  // 列表项 / 引用 / 任务清单
  out.listItem = pick(document.querySelector('.ProseMirror li'))
  out.ul = pick(document.querySelector('.ProseMirror ul'))
  out.blockquote = pick(document.querySelector('.ProseMirror blockquote'))
  const cb = document.querySelector('.ProseMirror input[type=checkbox]')
  out.checkbox = cb ? (()=>{const cs=getComputedStyle(cb);return{w:cs.width,h:cs.height,br:cs.borderRadius,bg:cs.backgroundColor}})() : null

  // 属性分组头
  const ph = leaf('Properties')
  out.propertiesHeader = ph ? { el: pick(ph), parent: pick(ph.parentElement) } : null

  // 侧栏分组标题
  for (const g of ['Workspace','Favorites','Your teams','Teams']) {
    const el = leaf(g)
    if (el) { out.sidebarGroup = { text:g, el:pick(el), parent:pick(el.parentElement) }; break }
  }
  return out
})
console.log(JSON.stringify(result, null, 2))
await browser.close()
