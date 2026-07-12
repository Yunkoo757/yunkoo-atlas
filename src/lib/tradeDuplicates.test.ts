import {
  buildContentSignature,
  duplicateReason,
  findObviousDuplicate,
  groupObviousDuplicates,
  noteContentFingerprint,
  stripNoteToPlainText,
} from '@/lib/tradeDuplicates'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testStripNoteIgnoresImagesAndHtml(): void {
  const text = stripNoteToPlainText(
    '<p>伦敦开盘突破</p><img src="journal-asset://abc"><p>继续观察</p>',
  )
  assert(text === '伦敦开盘突破 继续观察', '应去掉标签与图片后保留正文')
}

export function testSameDaySameSymbolNotDuplicateWithoutContent(): void {
  const a = buildContentSignature('', [])
  const b = buildContentSignature('', [])
  assert(duplicateReason(a, b) === null, '空内容不得判重复')

  const c = buildContentSignature('<p>短</p>', [])
  const d = buildContentSignature('<p>短</p>', [])
  assert(duplicateReason(c, d) === null, '过短正文不得单独判重复')
}

export function testMeaningfulNoteDetectsObviousDuplicate(): void {
  const html =
    '<p>这是一段足够长的复盘正文，用来识别 Notion 重复导入的明显抄重内容。</p>'
  const a = buildContentSignature(html, [])
  const b = buildContentSignature(html, [])
  assert(a.noteFp === b.noteFp && a.noteLen >= 24, '长正文应生成有效指纹')
  assert(duplicateReason(a, b) === 'note', '相同长正文应判为正文重复')

  const other = buildContentSignature(
    '<p>这是另一段足够长的复盘正文，内容和上一笔完全不同，不应误伤。</p>',
    [],
  )
  assert(duplicateReason(a, other) === null, '不同长正文不应判重复')
}

export function testImageSetDetectsObviousDuplicate(): void {
  const hashes = ['aa11', 'bb22']
  const a = buildContentSignature('', hashes)
  const b = buildContentSignature('<p>x</p>', ['bb22', 'aa11'])
  assert(duplicateReason(a, b) === 'images', '≥2 张相同截图应判重复，与短正文无关')

  const single = buildContentSignature('', ['aa11'])
  const single2 = buildContentSignature('', ['aa11'])
  assert(
    duplicateReason(single, single2) === null,
    '仅一张图且无有效正文时不判重复，避免误伤',
  )
}

export function testFindAndGroupDuplicates(): void {
  const html =
    '<p>案例笔记正文足够长，重复导入时应被识别为同一条内容指纹。</p>'
  const fp = noteContentFingerprint(html)
  assert(fp.len >= 24, '用例正文需达到强匹配长度')

  const library = [
    {
      id: 't1',
      ref: 'TRD-1',
      sig: buildContentSignature(html, ['img1']),
    },
  ]
  const hit = findObviousDuplicate(buildContentSignature(html, []), library)
  assert(hit?.tradeRef === 'TRD-1' && hit.reason === 'note', '导入候选应命中库内同正文')

  const groups = groupObviousDuplicates([
    {
      trade: { id: 'old', ref: 'TRD-1', recordedAt: '2026-01-01', openedAt: '2026-01-01' },
      sig: buildContentSignature(html, []),
    },
    {
      trade: { id: 'new', ref: 'TRD-2', recordedAt: '2026-06-01', openedAt: '2026-06-01' },
      sig: buildContentSignature(html, []),
    },
    {
      trade: { id: 'uniq', ref: 'TRD-3', recordedAt: '2026-06-02', openedAt: '2026-06-02' },
      sig: buildContentSignature('<p>完全不同的足够长正文，用于证明不会被扫进重复组。</p>', []),
    },
  ])
  assert(groups.length === 1, '应只产出一组重复')
  assert(groups[0]?.keepId === 'new', '应保留较新的一条')
  assert(groups[0]?.memberIds.includes('old'), '旧记录应在组内')
}
