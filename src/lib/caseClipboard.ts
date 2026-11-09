import { resolveTimeframe, type Trade } from '@/data/trades'
import { fmtFullDateTime } from '@/lib/format'
import { parseAssetId } from '@/storage/assets'
import type { StorageAdapter } from '@/storage/adapter'
import { CASE_CLIPBOARD_MAX_BYTES, type CaseClipboardContent, type CaseClipboardImage } from './caseClipboardContract'

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'B', 'EM', 'I', 'U', 'S',
  'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'HR', 'IMG', 'A', 'SPAN', 'DIV',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
])
const DROP_TAGS = 'script,style,iframe,object,embed,form,input,button,svg,link,meta,base'

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

function plainText(element: Element): string {
  const copy = element.cloneNode(true) as Element
  copy.querySelectorAll('img').forEach(image => image.replaceWith('\n'))
  copy.querySelectorAll('br').forEach(br => br.replaceWith('\n'))
  copy.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,blockquote,pre,tr,hr').forEach(block => block.append('\n'))
  copy.querySelectorAll('td,th').forEach(cell => cell.append('\t'))
  return (copy.textContent ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** 只读导出：使用附件字节，不把应用内 blob 地址或资料库路径带到其他软件。 */
export async function prepareCaseClipboard(
  trade: Pick<Trade, 'symbol' | 'side' | 'openedAt' | 'timeframe' | 'tradeKind' | 'sourceNoteHtml'>,
  currentNoteHtml: string,
  storage: Pick<StorageAdapter, 'getAssetForExport'>,
): Promise<CaseClipboardContent> {
  const imageCache = new Map<string, Promise<string>>()
  const images: CaseClipboardImage[] = []
  let imageBytes = 0
  const portableImage = (image: Element): Promise<string> => {
    const src = image.getAttribute('src') ?? ''
    const id = parseAssetId(src) ?? image.getAttribute('data-asset-id')
    const key = id ? `asset:${id}` : src
    if (!imageCache.has(key)) imageCache.set(key, (async () => {
      let dataUrl: string
      if (id) {
        const asset = await storage.getAssetForExport(id)
        if (!asset) throw new Error('图片附件未完整载入，请重新载入正文后重试')
        dataUrl = `data:${asset.mime};base64,${asset.data}`
      } else if (src.startsWith('data:image/')) {
        dataUrl = src
      } else if (src.startsWith('blob:')) {
        const response = await fetch(src)
        if (!response.ok) throw new Error('图片读取失败，请重新载入正文后重试')
        const blob = await response.blob()
        if (blob.size > CASE_CLIPBOARD_MAX_BYTES) throw new Error('案例图片过大，请逐张复制图片')
        dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(new Error('图片读取失败，请重新载入正文后重试'))
          reader.readAsDataURL(blob)
        })
      } else {
        throw new Error('图片尚未保存到资料库，请重新插入图片后重试')
      }
      if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z\d+/=\s]+$/i.test(dataUrl)) {
        throw new Error('图片格式暂不支持图文复制，请将图片另存为 PNG 后重新插入')
      }
      imageBytes += dataUrl.length
      if (imageBytes > CASE_CLIPBOARD_MAX_BYTES) throw new Error('案例图片过大，请分段复制正文或逐张复制图片')
      return dataUrl
    })())
    return imageCache.get(key)!
  }

  const sections: { label: string; body: HTMLElement }[] = []
  const entries = trade.tradeKind === 'case'
    ? [{ label: '来源复盘', html: trade.sourceNoteHtml ?? '' }, { label: '案例沉淀', html: currentNoteHtml }]
    : [{ label: '复盘正文', html: currentNoteHtml }]
  for (const entry of entries) {
    const firstImageIndex = images.length
    const doc = new DOMParser().parseFromString(entry.html, 'text/html')
    if (doc.querySelector('[data-missing-asset-id],[data-unsaved-image]')) {
      throw new Error('图片附件未完整载入，请重新载入正文后重试')
    }
    doc.querySelectorAll(DROP_TAGS).forEach(node => node.remove())
    const elements = [...doc.body.querySelectorAll('*')]
    for (const node of elements) {
      if (!ALLOWED_TAGS.has(node.tagName)) { node.replaceWith(...node.childNodes); continue }
      if (node.tagName === 'IMG') {
        const src = await portableImage(node)
        const match = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([a-z\d+/=\s]+)$/i.exec(src)!
        images.push({ mime: (match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase()) as CaseClipboardImage['mime'], data: match[2].replace(/\s/g, '') })
        node.remove()
        continue
      }
      const href = node.tagName === 'A' ? node.getAttribute('href') : null
      const start = node.tagName === 'OL' ? node.getAttribute('start') : null
      const task = node.tagName === 'LI' ? node.getAttribute('data-checked') : null
      const taskList = node.tagName === 'UL' && node.getAttribute('data-type') === 'taskList'
      for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name)
      if (href && /^https?:\/\//i.test(href)) node.setAttribute('href', href)
      if (start && /^\d{1,6}$/.test(start)) node.setAttribute('start', start)
      if (taskList) node.setAttribute('style', 'list-style:none;padding-left:0')
      if (task === 'true' || task === 'false') (node.querySelector('p') ?? node).prepend(task === 'true' ? '☑ ' : '☐ ')
    }
    if ((doc.body.textContent ?? '').trim() || images.length > firstImageIndex || doc.body.querySelector('hr')) sections.push({ label: entry.label, body: doc.body })
  }
  if (!sections.length) throw new Error('暂无可复制的复盘内容，请先添加正文或截图')

  const title = `${trade.symbol} · ${trade.tradeKind === 'case' ? '复盘案例' : '交易复盘'}`
  const context = [fmtFullDateTime(trade.openedAt), trade.side === 'long' ? '做多' : '做空', trade.timeframe ? resolveTimeframe(trade.timeframe) : ''].filter(Boolean).join(' · ')
  const html = `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(context)}</p>` + sections.map(section => `<section><h2>${section.label}</h2>${section.body.innerHTML}</section>`).join('')
  const text = [title, context, ...sections.map(section => `${section.label}\n${plainText(section.body)}`)].join('\n\n')
  if (new TextEncoder().encode(html + text).byteLength + images.reduce((bytes, image) => bytes + image.data.length, 0) > CASE_CLIPBOARD_MAX_BYTES) throw new Error('案例图文过大，请分段复制正文或逐张复制图片')
  return { html, text, images }
}
