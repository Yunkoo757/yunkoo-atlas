/**
 * Notion 导出 → Yunkoo Atlas Trade 转换器（完整版）
 *
 * 支持两种输入：
 * A. CSV 文件（快速，无图片）
 * B. Notion "Markdown & CSV" 导出的 .zip 包（含图片）
 *
 * Markdown 解析流程：
 * 1. 解压 zip → 找到所有 .md 文件
 * 2. 解析每个 .md 的 frontmatter（key: value）+ 正文文字 + 图片引用
 * 3. 从 zip 内的子目录匹配图片二进制
 * 4. 清洗 Notion URL，映射字段到 Trade；正文 Markdown 转为 note HTML
 * 5. 图片通过 ImageFile 接口传出，由调用方写入 storage
 */

import type { Trade, TradeStatus, TradeSide, Conviction } from '@/data/trades'
import { normalizeTimeframe, resolveTimeframe } from '@/data/trades'
import type { Strategy } from '@/data/strategies'
import type { CsvParseResult } from '@/lib/csvImport'
import { parseCsv } from '@/lib/csvImport'
import { normalizeSession, normalizeNarrative, normalizePsychology } from '@/lib/tradeView'
import JSZip from 'jszip'

/** Notion 网页导出常再包一层 ExportBlock-*-Part-N.zip */
const NOTION_NESTED_ZIP_LIMIT = 8

const NOTION_CONTENT_FILE_RE = /\.(md|csv|png|jpe?g|gif|webp|bmp|svg)$/i

function isNotionNestedZipPath(path: string): boolean {
  return /\.zip$/i.test(path)
}

/**
 * 展开 Notion 导出的嵌套 zip（外层仅含 Part-N.zip 的情况），合并为可解析的内容包。
 * 兼容：单层 Part zip、外层包装、多 Part 合并。
 */
export async function resolveNotionExportZip(zipBuffer: ArrayBuffer): Promise<JSZip> {
  const merged = new JSZip()
  const queue: ArrayBuffer[] = [zipBuffer]
  let steps = 0

  while (queue.length > 0 && steps < NOTION_NESTED_ZIP_LIMIT) {
    steps += 1
    const current = await JSZip.loadAsync(queue.shift()!)
    const nested: ArrayBuffer[] = []

    for (const [relativePath, entry] of Object.entries(current.files)) {
      if (entry.dir) continue
      if (isNotionNestedZipPath(relativePath)) {
        nested.push(await entry.async('arraybuffer'))
        continue
      }
      if (merged.file(relativePath)) continue
      merged.file(relativePath, await entry.async('uint8array'))
    }

    for (const part of nested) queue.push(part)
  }

  return merged
}

function notionZipHasImportableContent(zip: JSZip): boolean {
  return Object.keys(zip.files).some(
    (path) => !zip.files[path]?.dir && NOTION_CONTENT_FILE_RE.test(path),
  )
}

// ============================================================
// ① Notion URL 清洗
// ============================================================

function stripNotionUrl(val: string): string {
  let result = val.trim()
  const re = /\s*\(https?:\/\/[^)]*\)\s*/g
  while (re.test(result)) {
    result = result.replace(re, ' ').trim()
    re.lastIndex = 0
  }
  return result.replace(/\s+/g, ' ')
}

// ============================================================
// ② 值映射
// ============================================================

function mapNotionStatus(raw: string): TradeStatus {
  const v = raw.toLowerCase()
  if (v.includes('t/p') || v.includes('tp') || v.includes('take profit')) return 'win'
  if (v.includes('s/l') || v.includes('sl') || v.includes('stop loss')) return 'loss'
  if (v.includes('be') || v.includes('breakeven') || v.includes('保本')) return 'breakeven'
  if (v.includes('open') || v.includes('持仓') || v.includes('active')) return 'open'
  if (v.includes('plan') || v.includes('计划') || v.includes('pending')) return 'planned'
  if (v.includes('miss') || v.includes('错过')) return 'missed'
  return 'planned'
}

function mapProfitLossEmoji(raw: string): TradeStatus | null {
  const v = raw.toLowerCase().trim()
  if (v.includes('🟢') || v.includes('profit') || v.includes('盈利') || v.includes('win')) return 'win'
  if (v.includes('🔴') || v.includes('loss') || v.includes('亏损') || v.includes('lose')) return 'loss'
  if (v.includes('🟡') || v.includes('breakeven') || v.includes('保本') || v.includes('平')) return 'breakeven'
  return null
}

function mapNotionSide(raw: string): TradeSide | null {
  const v = raw.toLowerCase().trim()
  if (['buy', 'long', 'l', '买', '买入', '做多', '多头', '多'].includes(v)) return 'long'
  if (['sell', 'short', 's', '空', '卖', '卖出', '做空', '空头'].includes(v)) return 'short'
  return null
}

function mapNotionConviction(raw: string): Conviction {
  const v = raw.trim().toUpperCase()
  if (['A', 'URGENT', '极高', '紧急'].includes(v)) return 'urgent'
  if (['B', 'HIGH', '高'].includes(v)) return 'high'
  if (['S', 'C', 'MEDIUM', 'MED', '中', '中等'].includes(v)) return 'medium'
  return 'medium'
}

function parseNotionMoney(raw: string): number | null {
  const v = raw.trim()
  if (!v || v === '—' || v === '-') return null
  const cleaned = v.replace(/^US\$/, '').replace(/^[$¥€£￥]/, '').replace(/[,，\s]/g, '')
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

function parseNotionDate(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  const slashMatch = v.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (slashMatch) {
    return `${slashMatch[1]}-${String(slashMatch[2]).padStart(2, '0')}-${String(slashMatch[3]).padStart(2, '0')}`
  }
  const cnMatch = v.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/)
  if (cnMatch) {
    return `${cnMatch[1]}-${String(cnMatch[2]).padStart(2, '0')}-${String(cnMatch[3]).padStart(2, '0')}`
  }
  const d = new Date(v)
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return null
}

// ============================================================
// ③ Markdown 解析
// ============================================================

interface MdFrontmatter {
  [key: string]: string
}

/**
 * 解析 Notion 导出的 .md 文件
 * 格式：每行 "Key: Value"，空行后是 Markdown 正文（含图片与复盘文字）
 */
export function parseNotionMd(text: string): {
  frontmatter: MdFrontmatter
  images: string[]
  bodyMarkdown: string
} {
  const lines = text.split('\n')
  const frontmatter: MdFrontmatter = {}
  const images: string[] = []
  const bodyLines: string[] = []
  let inFrontmatter = true
  let hasFrontmatterField = false

  for (const line of lines) {
    // 跳过标题行 (# Trade #)
    if (line.startsWith('# ')) continue

    if (inFrontmatter) {
      const kvMatch = line.match(/^(.+?):\s*(.*)$/)
      if (kvMatch) {
        const key = kvMatch[1]!.trim().toLowerCase()
        const val = kvMatch[2]!.trim()
        if (key && val) {
          frontmatter[key] = val
          hasFrontmatterField = true
        }
        continue
      }
      // 空行或非 KV 行 → 进入正文
      if (line.trim() === '') {
        if (hasFrontmatterField) {
          inFrontmatter = false
        }
        continue
      }
      inFrontmatter = false
    }

    // 正文：图片引用既入 images 列表，也保留在正文里以维持图文顺序
    const imgMatch = line.match(/^!\[.*\]\((.+)\)$/)
    if (imgMatch) {
      images.push(decodeURIComponent(imgMatch[1]!))
      bodyLines.push(line)
      continue
    }
    bodyLines.push(line)
  }

  return {
    frontmatter,
    images,
    bodyMarkdown: bodyLines.join('\n').trim(),
  }
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatInlineMarkdown(text: string): string {
  let out = escapeHtmlText(text)
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>')
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  return out
}

/**
 * 将 Notion 导出正文中的基础 Markdown 转成 TipTap 可用的 HTML。
 * 图片转为 `data-notion-img` 占位，导入落盘后再替换为 journal-asset://，以保持图文交错顺序。
 */
export function notionBodyMarkdownToHtml(markdown: string): string {
  const raw = markdown.replace(/\r\n/g, '\n').trim()
  if (!raw) return ''

  const lines = raw.split('\n')
  const blocks: string[] = []
  let paragraph: string[] = []
  let listItems: string[] = []
  let listTag: 'ul' | 'ol' | null = null
  let imageIndex = 0

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push(`<p>${formatInlineMarkdown(paragraph.join(' '))}</p>`)
    paragraph = []
  }

  const flushList = () => {
    if (!listTag || listItems.length === 0) {
      listItems = []
      listTag = null
      return
    }
    blocks.push(
      `<${listTag}>${listItems.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join('')}</${listTag}>`,
    )
    listItems = []
    listTag = null
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      flushParagraph()
      flushList()
      continue
    }

    const imgMatch = /^!\[([^\]]*)\]\((.+)\)$/.exec(trimmed)
    if (imgMatch) {
      flushParagraph()
      flushList()
      const alt = escapeHtmlText(imgMatch[1] ?? '')
      blocks.push(`<img data-notion-img="${imageIndex}" alt="${alt}" />`)
      imageIndex += 1
      continue
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed)
    if (heading) {
      flushParagraph()
      flushList()
      const level = heading[1]!.length
      blocks.push(`<h${level}>${formatInlineMarkdown(heading[2]!)}</h${level}>`)
      continue
    }

    const quote = /^>\s?(.*)$/.exec(trimmed)
    if (quote) {
      flushParagraph()
      flushList()
      blocks.push(`<blockquote><p>${formatInlineMarkdown(quote[1] ?? '')}</p></blockquote>`)
      continue
    }

    const ul = /^[-*+]\s+(.+)$/.exec(trimmed)
    if (ul) {
      flushParagraph()
      if (listTag && listTag !== 'ul') flushList()
      listTag = 'ul'
      listItems.push(ul[1]!)
      continue
    }

    const ol = /^\d+[.)]\s+(.+)$/.exec(trimmed)
    if (ol) {
      flushParagraph()
      if (listTag && listTag !== 'ol') flushList()
      listTag = 'ol'
      listItems.push(ol[1]!)
      continue
    }

    flushList()
    paragraph.push(trimmed)
  }

  flushParagraph()
  flushList()
  return blocks.join('\n')
}

/** 把正文中的 Notion 图片占位替换为已落盘的 journal-asset 地址；无占位时回退为末尾追加 */
export function applyNotionImageAssetsToNote(noteHtml: string, assetIds: string[]): string {
  if (assetIds.length === 0) return noteHtml

  const hasPlaceholders = /data-notion-img="\d+"/.test(noteHtml)
  if (!hasPlaceholders) {
    const imgTags = assetIds.map((aid) => `<img src="journal-asset://${aid}" />`).join('\n')
    return noteHtml ? `${noteHtml}\n${imgTags}` : imgTags
  }

  const used = new Set<number>()
  const replaced = noteHtml.replace(
    /<img\b[^>]*\bdata-notion-img="(\d+)"[^>]*>/gi,
    (_match, rawIndex: string) => {
      const index = Number(rawIndex)
      const assetId = assetIds[index]
      if (!assetId) return ''
      used.add(index)
      return `<img src="journal-asset://${assetId}" />`
    },
  )

  const leftovers = assetIds
    .map((assetId, index) => (used.has(index) ? '' : `<img src="journal-asset://${assetId}" />`))
    .filter(Boolean)
  if (leftovers.length === 0) return replaced
  return replaced ? `${replaced}\n${leftovers.join('\n')}` : leftovers.join('\n')
}

// ============================================================
// ④ 预览类型
// ============================================================

export interface ImageFile {
  /** zip 内路径，如 "Trade # 38d1-f42e/image.png" */
  zipPath: string
  /** 文件名 */
  name: string
  /** 二进制数据 */
  data: Uint8Array
  /** MIME 类型 */
  mime: string
  /** 文件大小 (bytes) */
  size: number
}

export interface NotionTradePreview {
  /** Notion 行 ID，用于把 CSV 行和 Markdown/图片资源稳定配对 */
  sourceId?: string
  trade: Partial<Trade>
  newStrategyName?: string
  collectedTags: string[]
  mistakeTags: string[]
  /** 富文本笔记（含 journal-asset:// 占位，待图片写入后替换） */
  noteHtml: string
  /** 该交易关联的图片文件 */
  images: ImageFile[]
  /** 图片数量（用于预览） */
  imageCount: number
  errors: string[]
  warnings: string[]
  rowIndex: number
}

export interface NotionImportResult {
  previews: NotionTradePreview[]
  newStrategies: string[]
  totalRows: number
  validRows: number
  errorRows: number
  totalImages: number
}

// ============================================================
// ⑤ 从 Markdown frontmatter 构建 Trade
// ============================================================

function buildTradeFromFrontmatter(
  fm: MdFrontmatter,
  index: number,
  existingStrategies: Strategy[],
): Omit<NotionTradePreview, 'images' | 'imageCount'> {
  const errors: string[] = []
  const warnings: string[] = []
  const collectedTags: string[] = []
  const mistakeTags: string[] = []

  // Symbol
  const symbol = stripNotionUrl(fm['symbol'] ?? '').toUpperCase()
  if (!symbol) errors.push('标的行为空')

  // Date
  const dateStr = stripNotionUrl(fm['date'] ?? '')
  const openedAt = parseNotionDate(dateStr)
  if (!openedAt) errors.push(`日期无法解析: "${dateStr}"`)

  // Position
  const posRaw = stripNotionUrl(fm['position'] ?? '')
  const side = mapNotionSide(posRaw)
  if (!side) errors.push(`方向无法识别: "${posRaw}"`)

  // Status
  const statusRaw = stripNotionUrl(fm['status'] ?? '')
  const plRaw = stripNotionUrl(fm['profit/loss'] ?? '')
  let status = mapNotionStatus(statusRaw)
  const plStatus = mapProfitLossEmoji(plRaw)
  if ((status === 'planned' || status === 'open') && plStatus) status = plStatus

  // PnL
  const pnl = parseNotionMoney(stripNotionUrl(fm['net pnl'] ?? '')) ?? 0

  // R
  const rMultiple = parseFloat(stripNotionUrl(fm['max r/r'] ?? '')) || 0

  // Stop Loss
  const stopLoss = parseFloat(stripNotionUrl(fm['s/l pips'] ?? '')) || null

  // Strategy
  const modelRaw = stripNotionUrl(fm['model'] ?? '')
  let strategyId = ''
  let newStrategyName: string | undefined
  if (modelRaw) {
    const found = existingStrategies.find((s) => s.name.toLowerCase() === modelRaw.toLowerCase())
    if (found) {
      strategyId = found.id
    } else {
      newStrategyName = modelRaw
      strategyId = modelRaw.toLowerCase().replace(/\s+/g, '-')
    }
  }

  // Conviction
  const conviction = mapNotionConviction(stripNotionUrl(fm['weight'] ?? ''))

  // === Tags ===
  const confluences = stripNotionUrl(fm['confluences'] ?? '')
  if (confluences) collectedTags.push(confluences)

  const entrySignal = stripNotionUrl(fm['entry signal'] ?? '')
  if (entrySignal) collectedTags.push(entrySignal)

  const timeFrame = stripNotionUrl(
    fm['time frame'] ?? fm['timeframe'] ?? fm['timeFrame'] ?? '',
  )
  const timeframe = normalizeTimeframe(timeFrame)

  const session = stripNotionUrl(fm['session'] ?? '')

  const orderType = stripNotionUrl(fm['order type'] ?? '')
  if (orderType) collectedTags.push(orderType)

  const tradeType = stripNotionUrl(fm['type of trade'] ?? '')
  if (tradeType) collectedTags.push(tradeType)

  // === Mistakes ===
  const mistakesRaw = stripNotionUrl(fm['mistakes'] ?? '')
  if (mistakesRaw) {
    mistakesRaw.split(/[,;，；、]/).forEach((m) => {
      const t = m.trim()
      if (t) mistakeTags.push(t)
    })
  }

  // 市场叙事 / 心理状态写入独立属性，不再塞进复盘正文
  const narrative = normalizeNarrative(stripNotionUrl(fm['narrative'] ?? ''))
  const psychology = normalizePsychology(stripNotionUrl(fm['psychology'] ?? ''))

  // Missing price warning
  warnings.push('Notion 数据缺少入场价/出场价/仓位，已默认设为 0')

  return {
    sourceId: stripNotionUrl(fm['id'] ?? '') || undefined,
    trade: {
      symbol,
      side: side ?? 'long',
      status,
      conviction,
      strategyId,
      session: normalizeSession(session),
      timeframe: resolveTimeframe(timeframe),
      narrative,
      psychology,
      tradeKind: 'live',
      entry: 0,
      exit: null,
      size: 0,
      pnl,
      rMultiple,
      stopLoss,
      openedAt: openedAt ?? '',
      closedAt: status === 'win' || status === 'loss' || status === 'breakeven' ? openedAt : null,
      tags: collectedTags,
      mistakeTags,
      reviewStatus: 'unreviewed',
      reviewCategory: mistakeTags.length > 0 || status === 'missed' ? 'mistake' : 'normal',
    },
    newStrategyName,
    collectedTags,
    mistakeTags,
    noteHtml: '',
    errors,
    warnings,
    rowIndex: index,
  }
}

// ============================================================
// ⑥ 从 ZIP 解析（主力入口）
// ============================================================

/**
 * 解析 Notion "Markdown & CSV" 导出的 .zip 文件
 * 自动识别 .md 文件、匹配对应图片；兼容外层再包一层 ExportBlock Part zip。
 */
export async function parseNotionZip(
  zipBuffer: ArrayBuffer,
  existingStrategies: Strategy[],
): Promise<NotionImportResult> {
  const zip = await resolveNotionExportZip(zipBuffer)
  if (!notionZipHasImportableContent(zip)) {
    return {
      previews: [],
      newStrategies: [],
      totalRows: 0,
      validRows: 0,
      errorRows: 0,
      totalImages: 0,
    }
  }

  // ---- 建立图片索引 + 收集 md 文件 ----
  const imageIndex = new Map<string, JSZip.JSZipObject>()
  const mdEntries: { path: string; entry: JSZip.JSZipObject }[] = []

  zip.forEach((relativePath, entry) => {
    if (entry.dir) return
    if (relativePath.endsWith('.md')) {
      mdEntries.push({ path: relativePath, entry })
    } else if (/\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(relativePath)) {
      imageIndex.set(relativePath, entry)
    }
  })

  // ---- 辅助：读取图片二进制 ----
  async function readImage(entry: JSZip.JSZipObject, zipPath: string): Promise<ImageFile | null> {
    try {
      const data = await entry.async('uint8array')
      const name = zipPath.split('/').pop() ?? 'image.png'
      const ext = name.split('.').pop()?.toLowerCase() ?? 'png'
      const m: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
      }
      return { zipPath, name, data, mime: m[ext] ?? 'image/png', size: data.length }
    } catch { return null }
  }

  // ---- 辅助：给定 md 文件目录 + 图片相对路径列表，匹配图片 ----
  async function matchImages(mdDir: string, refs: string[]): Promise<ImageFile[]> {
    const result: ImageFile[] = []
    for (const ref of refs) {
      const decoded = decodeURIComponent(ref)
      // 候选路径
      const candidates = [
        ref,
        decoded,
        mdDir + ref,
        mdDir + decoded,
      ]
      let found = false
      for (const c of candidates) {
        const entry = imageIndex.get(c)
        if (entry) {
          const img = await readImage(entry, c)
          if (img) { result.push(img); found = true }
          break
        }
      }
      // 文件名模糊匹配
      if (!found) {
        const targetName = (decoded.split('/').pop() ?? '').toLowerCase()
        for (const [path, entry] of imageIndex.entries()) {
          const fname = (path.split('/').pop() ?? '').toLowerCase()
          if (fname === targetName && path.includes(mdDir.split('/').slice(-3, -1).join('/'))) {
            const img = await readImage(entry, path)
            if (img) { result.push(img); found = true }
            break
          }
        }
      }
    }
    return result
  }

  async function collectMdImageGroups(): Promise<NotionImageGroup[]> {
    const groups: NotionImageGroup[] = []
    for (const md of mdEntries) {
      const text = await md.entry.async('string')
      const { frontmatter, images: mdImageRefs, bodyMarkdown } = parseNotionMd(text)
      const sourceId = stripNotionUrl(frontmatter['id'] ?? '') || undefined
      if (!sourceId) continue
      const mdDir = md.path.substring(0, md.path.lastIndexOf('/') + 1)
      const matched = await matchImages(mdDir, mdImageRefs)
      groups.push({
        sourceId,
        images: matched,
        noteHtml: notionBodyMarkdownToHtml(bodyMarkdown),
      })
    }
    return groups
  }

  // ================================================================
  // 路径 A：从 .md 文件解析（优先，有 frontmatter 时最准确）
  // ================================================================
  const previews: NotionTradePreview[] = []
  const newStrategySet = new Set<string>()

  console.log('[NotionImport] .md=' + mdEntries.length + ', images=' + imageIndex.size)

  let mdTradeCount = 0
  for (const md of mdEntries) {
    const text = await md.entry.async('string')
    const { frontmatter, images: mdImageRefs, bodyMarkdown } = parseNotionMd(text)

    const sym = stripNotionUrl(frontmatter['symbol'] ?? '')
    const date = stripNotionUrl(frontmatter['date'] ?? '')
    if (!sym || !date) {
      console.log('[NotionImport] SKIP .md (no sym/date):', md.path.split('/').pop())
      continue
    }

    const preview = buildTradeFromFrontmatter(frontmatter, mdTradeCount++, existingStrategies)
    if (preview.newStrategyName) newStrategySet.add(preview.newStrategyName)
    preview.noteHtml = notionBodyMarkdownToHtml(bodyMarkdown)

    const mdDir = md.path.substring(0, md.path.lastIndexOf('/') + 1)
    const matched = await matchImages(mdDir, mdImageRefs)
    console.log('[NotionImport] .md trade #' + mdTradeCount + ': ' + sym + ' | imgs ' + mdImageRefs.length + '→' + matched.length)

    previews.push({ ...preview, images: matched, imageCount: matched.length })
  }

  // ================================================================
  // 路径 B：从 CSV 解析（.md 无数据时的后备）
  // ================================================================
  console.log('[NotionImport] .md produced ' + previews.length + ' trades, falling back to CSV? ' + (previews.length === 0))
  if (previews.length === 0) {
    const csvFiles = zip.file(/\.csv$/i)
    let csvText = ''
    if (csvFiles.length > 0) {
      const fullCsv = csvFiles.find((f) => f.name.includes('_all')) ?? csvFiles[0]!
      csvText = await fullCsv.async('string')
    }
    // 也尝试从 zip 根目录直接读 CSV
    if (!csvText) {
      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue
        if (path.endsWith('.csv')) {
          csvText = await entry.async('string')
          break
        }
      }
    }

    if (csvText) {
      const csvResult = parseNotionCsvFromText(csvText, existingStrategies)
      console.log('[NotionImport] CSV fallback: ' + csvResult.totalRows + ' rows, ' + csvResult.validRows + ' valid')
      newStrategySet.forEach((s) => csvResult.newStrategies.push(s))

      const imageGroups = await collectMdImageGroups()
      const withImages = attachImagesToPreviewsBySourceId(csvResult.previews, imageGroups)
      for (const p of withImages) {
        console.log('[NotionImport] CSV row ' + p.rowIndex + ': ' + (p.trade.symbol || '?') + ' | imgs: ' + p.imageCount)
        previews.push(p)
      }
    }
  }

  // ================================================================
  // 路径 C：彻底没数据，纯图片
  // ================================================================
  if (previews.length === 0 && imageIndex.size > 0) {
    const allImgs: ImageFile[] = []
    for (const [path, entry] of imageIndex.entries()) {
      const img = await readImage(entry, path)
      if (img) allImgs.push(img)
    }
    previews.push({
      trade: {
        symbol: 'NOTION-IMPORT', side: 'long', status: 'planned', conviction: 'medium',
        strategyId: existingStrategies[0]?.id ?? '', tradeKind: 'live',
        entry: 0, exit: null, size: 0, pnl: 0, rMultiple: 0,
        openedAt: new Date().toISOString().slice(0, 10), closedAt: null,
        tags: ['notion-import'], mistakeTags: [], reviewStatus: 'unreviewed', reviewCategory: 'normal',
      },
      collectedTags: [], mistakeTags: [],
      noteHtml: '<p><em>📸 Notion 截图（' + allImgs.length + ' 张）</em></p>',
      images: allImgs, imageCount: allImgs.length,
      errors: [], warnings: ['无 CSV/.md 交易数据，请手动补全'],
      rowIndex: 0,
    })
  }

  return {
    previews,
    newStrategies: [...newStrategySet],
    totalRows: previews.length,
    validRows: previews.filter((p) => p.errors.length === 0).length,
    errorRows: previews.filter((p) => p.errors.length > 0).length,
    totalImages: previews.reduce((sum, p) => sum + p.imageCount, 0),
  }
}

// ============================================================
// ⑦ 从 CSV 文本解析（降级方案，无图片）
// ============================================================

type NotionField =
  | 'id' | 'symbol' | 'date' | 'position' | 'status' | 'profitLoss'
  | 'pnl' | 'rMultiple' | 'stopLoss' | 'model' | 'weight'
  | 'confluences' | 'entrySignal' | 'timeFrame' | 'session'
  | 'mistakes' | 'narrative' | 'psychology' | 'orderType'
  | 'tradeType' | 'entryPerformance' | 'newsImpact'

const NOTION_FIELD_PATTERNS: [RegExp, NotionField][] = [
  [/^ID$/i, 'id'],
  [/^Symbol$/i, 'symbol'], [/^Date$/i, 'date'], [/^Position$/i, 'position'],
  [/^Status$/i, 'status'], [/^Profit\/Loss$/i, 'profitLoss'],
  [/^Net PnL$/i, 'pnl'], [/^Max R\/R$/i, 'rMultiple'],
  [/^S\/L Pips$/i, 'stopLoss'], [/^Model$/i, 'model'],
  [/^Weight$/i, 'weight'], [/^Confluences$/i, 'confluences'],
  [/^Entry Signal$/i, 'entrySignal'], [/^Time Frame$/i, 'timeFrame'],
  [/^Session$/i, 'session'], [/^Mistakes$/i, 'mistakes'],
  [/^Narrative$/i, 'narrative'], [/^Psychology$/i, 'psychology'],
  [/^Order Type$/i, 'orderType'], [/^Type of Trade$/i, 'tradeType'],
  [/^Entry Performance$/i, 'entryPerformance'], [/^News Impact$/i, 'newsImpact'],
]

function detectNotionFields(headers: string[]): Map<NotionField, number> {
  const map = new Map<NotionField, number>()
  for (let i = 0; i < headers.length; i++) {
    const h = stripNotionUrl(headers[i] ?? '').trim()
    for (const [re, field] of NOTION_FIELD_PATTERNS) {
      if (re.test(h) && !map.has(field)) { map.set(field, i); break }
    }
  }
  return map
}

function getCell(row: string[], colIdx: number | undefined): string {
  if (colIdx === undefined || colIdx >= row.length) return ''
  return stripNotionUrl(row[colIdx] ?? '')
}

function mapCsvRowToPreview(
  row: string[],
  fields: Map<NotionField, number>,
  rowIndex: number,
): Omit<NotionTradePreview, 'images' | 'imageCount'> {
  // Build a synthetic frontmatter from CSV fields
  const fm: MdFrontmatter = {}
  for (const [field, colIdx] of fields.entries()) {
    fm[field] = getCell(row, colIdx)
  }
  return buildTradeFromFrontmatter(fm, rowIndex, [])
}

function parseNotionCsvFromText(
  text: string,
  existingStrategies: Strategy[],
): NotionImportResult {
  const csv: CsvParseResult = parseCsv(text)
  const cleanHeaders = csv.headers.map(stripNotionUrl)
  const fields = detectNotionFields(cleanHeaders)

  const previews: NotionTradePreview[] = []
  const newStrategySet = new Set<string>()

  for (let i = 0; i < csv.rows.length; i++) {
    const row = csv.rows[i] ?? []
    if (row.every((c) => !c.trim())) continue

    const preview = mapCsvRowToPreview(row, fields, i)
    // Override strategy detection with actual existing strategies
    if (preview.newStrategyName) {
      const found = existingStrategies.find(
        (s) => s.name.toLowerCase() === preview.newStrategyName!.toLowerCase(),
      )
      if (found) {
        preview.newStrategyName = undefined
        preview.trade.strategyId = found.id
      } else {
        newStrategySet.add(preview.newStrategyName)
      }
    }

    previews.push({ ...preview, images: [], imageCount: 0 })
  }

  return {
    previews,
    newStrategies: [...newStrategySet],
    totalRows: previews.length,
    validRows: previews.filter((p) => p.errors.length === 0).length,
    errorRows: previews.filter((p) => p.errors.length > 0).length,
    totalImages: 0,
  }
}

/** 公开的 CSV 解析入口（保持向后兼容） */
export function parseNotionCsv(
  text: string,
  existingStrategies: Strategy[],
): NotionImportResult {
  return parseNotionCsvFromText(text, existingStrategies)
}

// ============================================================
// ⑧ 导入执行
// ============================================================

const STRATEGY_COLORS = ['#5e6ad2', '#27ae60', '#bb6bd9', '#f2994a', '#56ccf2', '#eb5757', '#f2c94c', '#6fcf97', '#9b51e0', '#2f80ed', '#e67e22', '#1abc9c']
const STRATEGY_ICONS: string[] = ['trending-up', 'target', 'zap', 'crosshair', 'activity', 'bar-chart-2', 'rocket', 'flame', 'layers', 'shield', 'gauge', 'line-chart']

export interface NotionImportOptions {
  defaultIcon?: string
  defaultColor?: string
}

export interface NotionImageGroup {
  sourceId?: string
  images: ImageFile[]
  /** 对应 .md 正文转成的 HTML（不含图片） */
  noteHtml?: string
}

export function attachImagesToPreviewsBySourceId(
  previews: NotionTradePreview[],
  imageGroups: NotionImageGroup[],
): NotionTradePreview[] {
  const imagesById = new Map(
    imageGroups
      .filter((group): group is NotionImageGroup & { sourceId: string } => !!group.sourceId)
      .map((group) => [group.sourceId, group]),
  )

  return previews.map((preview) => {
    if (!preview.sourceId) return preview
    const group = imagesById.get(preview.sourceId)
    if (!group) return preview
    const images = group.images
    return {
      ...preview,
      noteHtml: preview.noteHtml || group.noteHtml || '',
      images,
      imageCount: images.length,
    }
  })
}

export function getImportableNotionPreviews(
  previews: NotionTradePreview[],
): NotionTradePreview[] {
  return previews.filter((p) => p.errors.length === 0)
}

export function executeNotionImport(
  previews: NotionTradePreview[],
  existingStrategies: Strategy[],
  existingTrades: Trade[],
  opts: NotionImportOptions = {},
): { trades: Trade[]; strategies: Strategy[] } {
  const validPreviews = getImportableNotionPreviews(previews)
  if (validPreviews.length === 0) return { trades: [], strategies: [] }

  const newStrategyNames = [...new Set(
    validPreviews.map((p) => p.newStrategyName).filter(Boolean) as string[],
  )]

  const strategies = [...existingStrategies]
  const strategyMap = new Map(existingStrategies.map((s) => [s.name.toLowerCase(), s]))

  newStrategyNames.forEach((name, i) => {
    const id = name.toLowerCase().replace(/\s+/g, '-')
    if (!strategyMap.has(name.toLowerCase())) {
      strategies.push({
        id,
        name,
        icon: (opts.defaultIcon || STRATEGY_ICONS[i % STRATEGY_ICONS.length]) as Strategy['icon'],
        color: opts.defaultColor || STRATEGY_COLORS[i % STRATEGY_COLORS.length],
      })
      strategyMap.set(name.toLowerCase(), strategies[strategies.length - 1]!)
    }
  })

  let maxNum = 0
  for (const t of existingTrades) {
    const n = parseInt(t.ref.replace('TRD-', ''), 10)
    if (!isNaN(n) && n > maxNum) maxNum = n
  }

  const now = new Date().toISOString()
  const newTrades: Trade[] = []

  for (const preview of validPreviews) {
    maxNum++
    const ref = `TRD-${maxNum}`
    const id = `trade-${Date.now()}-${maxNum}`

    let strategyId = preview.trade.strategyId || ''
    if (preview.newStrategyName) {
      const found = strategyMap.get(preview.newStrategyName.toLowerCase())
      if (found) strategyId = found.id
    }
    if (!strategyId && strategies.length > 0) strategyId = strategies[0]!.id

    const tradeStatus = preview.trade.status ?? 'planned'
    const isTerminalStatus = tradeStatus === 'win' || tradeStatus === 'loss' || tradeStatus === 'breakeven'

    const trade: Trade = {
      id,
      ref,
      symbol: preview.trade.symbol || '???',
      side: preview.trade.side ?? 'long',
      status: tradeStatus,
      conviction: preview.trade.conviction ?? 'medium',
      strategyId,
      session: preview.trade.session,
      timeframe: resolveTimeframe(preview.trade.timeframe),
      narrative: preview.trade.narrative,
      psychology: preview.trade.psychology,
      tags: preview.trade.tags ?? [],
      mistakeTags: preview.trade.mistakeTags ?? [],
      reviewStatus: 'unreviewed',
      reviewCategory: preview.trade.reviewCategory ?? 'normal',
      tradeKind: 'live',
      entry: preview.trade.entry ?? 0,
      exit: null,
      stopLoss: preview.trade.stopLoss ?? null,
      size: 0,
      pnl: preview.trade.pnl ?? 0,
      rMultiple: preview.trade.rMultiple ?? 0,
      openedAt: preview.trade.openedAt ?? now.slice(0, 10),
      closedAt: isTerminalStatus ? preview.trade.openedAt ?? null : null,
      note: preview.noteHtml || '',
    }

    newTrades.push(trade)
  }

  return { trades: newTrades, strategies }
}

// ============================================================
// ⑨ 诊断工具
// ============================================================

export interface ColumnProfile {
  header: string
  cleanName: string
  uniqueCount: number
  uniqueValues: string[]
  nullCount: number
  detectedField?: NotionField
}

export function profileNotionCsv(text: string): ColumnProfile[] {
  const csv = parseCsv(text)
  const cleanHeaders = csv.headers.map(stripNotionUrl)
  const detected = detectNotionFields(cleanHeaders)

  return cleanHeaders.map((header, i) => {
    const values = csv.rows.map((row) => stripNotionUrl(row[i] ?? '')).filter((v) => v !== '')
    const unique = [...new Set(values)]
    let detectedField: NotionField | undefined
    for (const [field, idx] of detected.entries()) {
      if (idx === i) { detectedField = field; break }
    }
    return { header, cleanName: header, uniqueCount: unique.length, uniqueValues: unique.slice(0, 10), nullCount: csv.rows.length - values.length, detectedField }
  })
}
