import JSZip from 'jszip'
import type { Strategy } from '@/data/strategies'
import {
  applyNotionImageAssetsToNote,
  parseNotionZip,
} from '@/lib/notionImport'
import { prepareNotionAssetsForCommit } from '@/lib/notionImportCommit'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const strategy: Strategy = {
  id: 'slot-strategy',
  name: 'Slot strategy',
  icon: 'target',
  color: '#5e6ad2',
}

async function zipWithMissingMiddleImage(middleRef = 'b.png'): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file('a.png', new Uint8Array([1, 2, 3]))
  zip.file('c.png', new Uint8Array([7, 8, 9]))
  zip.file('slot-trade.md', [
    '# Trade #',
    'Date: 2026/07/22',
    'Symbol: BTCUSDT',
    'Position: Buy',
    'Status: Closed by T/P',
    'Net PnL: US$20.00',
    '',
    '![A](a.png)',
    `![坏 B](${middleRef})`,
    '![C](c.png)',
  ].join('\n'))
  return zip.generateAsync({ type: 'arraybuffer' })
}

export async function testNotionMalformedMiddleImageUriIsAnIssueNotAWholeImportFailure(): Promise<void> {
  const parsed = await parseNotionZip(
    await zipWithMissingMiddleImage('%E0%A4%A'),
    [strategy],
  )
  const preview = parsed.previews.find((item) => item.trade.symbol === 'BTCUSDT')
  assert(preview, '畸形 URI 不得阻断整个交易预览')
  assert(preview.images.map((image) => image.slotId).join(',') === '0,2', '畸形 B 后的 C 必须保持原第 2 槽')
  assert(
    preview.imageIssues?.[0]?.slotId === 1 && preview.imageIssues[0].error === '图片路径编码损坏',
    '畸形 URI 必须成为第 1 槽的逐图 issue',
  )
}

export async function testNotionMissingMiddleImageKeepsOriginalSlotsAndVisibleIssue(): Promise<void> {
  const parsed = await parseNotionZip(await zipWithMissingMiddleImage(), [strategy])
  const preview = parsed.previews.find((item) => item.trade.symbol === 'BTCUSDT')
  assert(preview, '测试 ZIP 必须生成交易预览')
  assert(preview.images.map((image) => image.slotId).join(',') === '0,2', 'A、缺失 B、C 必须保留槽位 0、缺失 1、2')
  assert(preview.images.map((image) => image.name).join(',') === 'a.png,c.png', 'C 不得因 B 失败而前移')
  assert(preview.imageIssues?.length === 1, '失败图片必须产生一条逐图 issue')
  assert(
    preview.imageIssues[0]?.slotId === 1 && preview.imageIssues[0]?.ref === 'b.png',
    'issue 必须携带原始 B 槽位与引用，供预览逐图片展示',
  )

  let nextId = 0
  const prepared = prepareNotionAssetsForCommit([preview], () => `slot-asset-${++nextId}`)
  const ids = prepared.assetIdsByRow.get(preview.rowIndex)
  assert(ids?.[0] === 'slot-asset-1', 'A 必须映射到第 0 槽')
  assert(ids?.[1] === undefined, '失败 B 的第 1 槽必须保持缺失')
  assert(ids?.[2] === 'slot-asset-2', 'C 必须映射回原第 2 槽')

  const note = applyNotionImageAssetsToNote(preview.noteHtml, ids ?? [])
  const aIndex = note.indexOf('journal-asset://slot-asset-1')
  const cIndex = note.indexOf('journal-asset://slot-asset-2')
  assert(aIndex >= 0 && cIndex > aIndex, '提交后的正文必须保持 A、C 顺序')
  assert(!note.includes('data-notion-img="1"'), '失败 B 的占位必须移除，不能残留不可恢复引用')
  assert(
    note.match(/journal-asset:\/\//g)?.length === 2,
    'C 不得复制到 B 槽，最终正文只能有 A、C 两张图片',
  )
}

export function testNotionDuplicateOrInvalidSlotsFailBeforeAnyCommitPayload(): void {
  const base = {
    trade: { symbol: 'BTCUSDT', openedAt: '2026-07-22' },
    collectedTags: [],
    mistakeTags: [],
    noteHtml: '<img data-notion-img="0"><img data-notion-img="1">',
    imageCount: 2,
    errors: [],
    warnings: [],
    rowIndex: 7,
  }
  const image = (slotId: number, name: string) => ({
    slotId,
    zipPath: name,
    name,
    data: new Uint8Array([1]),
    mime: 'image/png',
    size: 1,
  })
  let message = ''
  try {
    prepareNotionAssetsForCommit([{
      ...base,
      images: [image(0, 'a.png'), image(0, 'b.png')],
    }])
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  assert(message.includes('槽位无效或重复'), '重复槽位必须在生成可提交批次前 fail-closed')
}

export async function testNotionPreviewRendersEveryImageIssueInsteadOfOnlyAGroupCount(): Promise<void> {
  const fs = await import('node:fs/promises')
  const source = await fs.readFile('src/components/NotionImportModal.tsx', 'utf8')
  assert(source.includes('preview.imageIssues!.map((issue)'), '预览必须逐项渲染图片 issue')
  assert(source.includes('issue.slotId + 1'), '逐图错误必须展示原始槽位编号')
  assert(source.includes('issue.ref'), '逐图错误必须展示原图片引用')
  assert(source.includes('issue.error'), '逐图错误必须展示具体失败原因')
  assert(
    !source.includes('!hasError && !duplicate && (preview.imageIssues'),
    '字段错误或重复标记不得隐藏逐图片 issue',
  )
}
// Quality-Scenario: I-NOTION-SLOT
