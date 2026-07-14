import JSZip from 'jszip'
import { parseNotionCsv, resolveNotionExportZip } from '@/lib/notionImport'
import { MAX_NOTION_IMAGE_BYTES } from '@/lib/notionImportLimits'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export async function testNotionResolverProcessesEveryPartBeyondLegacyEightStepLimit(): Promise<void> {
  const outer = new JSZip()
  for (let index = 0; index < 9; index += 1) {
    const part = new JSZip()
    part.file(`part-${index}/trade-${index}.md`, `---\nsymbol: TEST${index}\ndate: 2026-07-14\n---`)
    outer.file(`Export-Part-${index + 1}.zip`, await part.generateAsync({ type: 'uint8array' }))
  }
  const wrapped = await outer.generateAsync({ type: 'arraybuffer' })
  const resolved = await resolveNotionExportZip(wrapped)
  const markdownFiles = Object.keys(resolved.files).filter((name) => name.endsWith('.md'))
  assert(markdownFiles.length === 9, '多分卷 Notion 导出不得静默遗漏第 8 个之后的分卷')
}

export async function testNotionResolverRejectsOversizedImageBeforeDecompression(): Promise<void> {
  const originalLoadAsync = JSZip.loadAsync
  let decompressions = 0
  ;(JSZip as unknown as { loadAsync: typeof JSZip.loadAsync }).loadAsync = (async () => ({
    files: {
      'oversized.png': {
        dir: false,
        _data: { uncompressedSize: MAX_NOTION_IMAGE_BYTES + 1 },
        async: async () => {
          decompressions += 1
          return new Uint8Array(0)
        },
      },
    },
  })) as unknown as typeof JSZip.loadAsync

  let message = ''
  try {
    await resolveNotionExportZip(new ArrayBuffer(1))
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  } finally {
    ;(JSZip as unknown as { loadAsync: typeof JSZip.loadAsync }).loadAsync = originalLoadAsync
  }

  assert(message.includes('32 MB'), '超大图片必须给出明确的原图限制提示')
  assert(decompressions === 0, '必须利用 ZIP 元数据在分配超大 Uint8Array 前拒绝')
}

export function testNotionCsvRejectsTooManyRowsBeforeBuildingPreviews(): void {
  const rows = Array.from({ length: 20_001 }, () => ',X,,,').join('\n')
  const text = `Date,Symbol,Position,Status,Net PnL\n${rows}\n${'tail'.repeat(250_000)}`
  let message = ''
  try {
    parseNotionCsv(text, [])
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  assert(message.includes('20000'), '超限 CSV 必须在构建完整 rows/previews 前拒绝')
}

export async function testNotionResolverRejectsTooManyMarkdownEntriesBeforeExtraction(): Promise<void> {
  const originalLoadAsync = JSZip.loadAsync
  let extractions = 0
  const files = Object.fromEntries(
    Array.from({ length: 20_001 }, (_, index) => [
      `trade-${index}.md`,
      {
        dir: false,
        _data: { uncompressedSize: 1 },
        async: async () => {
          extractions += 1
          return new Uint8Array([1])
        },
      },
    ]),
  )
  ;(JSZip as unknown as { loadAsync: typeof JSZip.loadAsync }).loadAsync = (async () => ({ files })) as unknown as typeof JSZip.loadAsync

  let message = ''
  try {
    await resolveNotionExportZip(new ArrayBuffer(1))
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  } finally {
    ;(JSZip as unknown as { loadAsync: typeof JSZip.loadAsync }).loadAsync = originalLoadAsync
  }
  assert(message.includes('20000'), '超量 Markdown 条目必须在构建 merged ZIP 前拒绝')
  assert(extractions === 0, '条目超限时不得开始解压或构建 merged ZIP')
}
