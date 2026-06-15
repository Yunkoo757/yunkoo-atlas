// 精确探针 v2：取标题叶子元素、正文段落、属性行、侧边栏的计算样式。
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
  const PROPS = ['display','width','height','minHeight','maxWidth','padding','margin',
    'borderRadius','fontSize','fontWeight','lineHeight','letterSpacing','color',
    'backgroundColor','gap','textTransform','opacity']
  const pick = (el) => {
    if (!el) return null
    const cs = getComputedStyle(el)
    const o = { tag: el.tagName.toLowerCase() }
    for (const p of PROPS) {
      const v = cs[p]
      if (v && !['normal','none','auto','0px','rgba(0, 0, 0, 0)'].includes(v)) o[p] = v
    }
    const r = el.getBoundingClientRect()
    o.box = `${Math.round(r.width)}x${Math.round(r.height)}`
    return o
  }
  const leafWithText = (txt) => {
    const els = [...document.querySelectorAll('*')].filter(
      (e) => e.children.length === 0 && e.textContent.trim() === txt,
    )
    return els[els.length - 1] || null
  }

  const out = {}
  // 标题叶子
  const t = leafWithText('Import your data')
  out.titleLeaf = pick(t)

  // 正文第一段（ProseMirror 内首个 p）
  const pm = document.querySelector('.ProseMirror, [contenteditable="true"]')
  out.editorRoot = pick(pm)
  out.firstParagraph = pick(pm ? pm.querySelector('p') : null)

  // 属性面板的值按钮（找含 Backlog/Todo/Done 等状态文字的叶子）
  for (const v of ['Backlog','Todo','In Progress','Done','Low','Medium','High','Urgent','No priority']) {
    const el = leafWithText(v)
    if (el) { out.propValueExample = { text: v, el: pick(el), parent: pick(el.parentElement), grand: pick(el.parentElement?.parentElement) }; break }
  }

  // 侧边栏首个导航项
  const navItem = [...document.querySelectorAll('a,button')].find(
    (e) => /Inbox|My issues|My Issues|收件箱/.test(e.textContent) && e.getBoundingClientRect().width < 280,
  )
  out.navItem = pick(navItem)

  return out
})

console.log(JSON.stringify(result, null, 2))
await browser.close()
