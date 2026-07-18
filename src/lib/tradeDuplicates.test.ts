import {
  buildContentSignature,
  buildLibraryContentIndex,
  createDuplicateLookupIndex,
  duplicateReason,
  findObviousDuplicate,
  findObviousDuplicateIndexed,
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
      trade: { id: 'old', ref: 'TRD-1', recordedAt: '2026-01-01', openedAt: '2026-01-01', tradeKind: 'live' },
      sig: buildContentSignature(html, []),
    },
    {
      trade: { id: 'new', ref: 'TRD-2', recordedAt: '2026-06-01', openedAt: '2026-06-01', tradeKind: 'live' },
      sig: buildContentSignature(html, []),
    },
    {
      trade: { id: 'uniq', ref: 'TRD-3', recordedAt: '2026-06-02', openedAt: '2026-06-02', tradeKind: 'live' },
      sig: buildContentSignature('<p>完全不同的足够长正文，用于证明不会被扫进重复组。</p>', []),
    },
  ])
  assert(groups.length === 1, '应只产出一组重复')
  assert(groups[0]?.keepId === 'new', '应保留较新的一条')
  assert(groups[0]?.memberIds.includes('old'), '旧记录应在组内')
}

export function testDuplicateGroupingNeverCrossesRecordDomains(): void {
  const signature = buildContentSignature(
    '<p>这是一段从交易日志沉淀到案例记录的完整复盘正文。</p>',
    ['shared-image-a', 'shared-image-b'],
  )
  const sourceTrade = {
    id: 'live-1',
    ref: 'TRD-7',
    recordedAt: '2026-07-17',
    openedAt: '2026-07-17',
    tradeKind: 'live' as const,
  }
  const derivedCase = {
    id: 'case-1',
    ref: 'CAS-3',
    recordedAt: '2026-07-18',
    openedAt: '2026-07-17',
    tradeKind: 'case' as const,
    sourceTradeId: sourceTrade.id,
  }

  const groups = groupObviousDuplicates([
    { trade: sourceTrade, sig: signature },
    { trade: derivedCase, sig: signature },
  ])

  assert(groups.length === 0, '交易日志沉淀出的案例不得与来源交易互判为重复')
}

export function testNoteHashCollisionNeverSkipsDistinctContent(): void {
  const first = 'pmzozazsvwpebirclwfmlslapupgrwng'
  const second = 'pcxczmnqzsdidsfuvojuvydihcjglkro'
  const library = [{ id: 'collision-a', ref: 'TRD-A', sig: buildContentSignature(first, []) }]
  const candidate = buildContentSignature(second, [])
  assert(library[0]!.sig.noteFp === candidate.noteFp, '回归样本必须保持 32-bit 指纹碰撞')
  assert(duplicateReason(library[0]!.sig, candidate) === null, '指纹碰撞的不同全文不得判为重复')
  assert(findObviousDuplicate(candidate, library) === null, '线性查找不得误跳过碰撞正文')
  assert(
    findObviousDuplicateIndexed(candidate, createDuplicateLookupIndex(library)) === null,
    '索引查找必须用规范化全文消除哈希碰撞',
  )
}

export function testIndexedDuplicateLookupMatchesLinearSemantics(): void {
  const sharedNote = '<p>这是一段足够长的复盘正文，用于验证索引查找仍保持原始命中顺序。</p>'
  const mediumNote = '<p>单图需要正文联合匹配</p>'
  const library = [
    {
      id: 'image-first',
      ref: 'TRD-1',
      sig: buildContentSignature('<p>另一段足够长的正文，确保这里只通过截图命中。</p>', ['a', 'b']),
    },
    {
      id: 'note-second',
      ref: 'TRD-2',
      sig: buildContentSignature(sharedNote, []),
    },
    {
      id: 'single-image-note',
      ref: 'TRD-3',
      sig: buildContentSignature(mediumNote, ['single']),
    },
  ]
  const candidates = [
    buildContentSignature(sharedNote, ['b', 'a']),
    buildContentSignature(sharedNote, []),
    buildContentSignature(mediumNote, ['single']),
    buildContentSignature('', ['single']),
    buildContentSignature('<p>完全不同且没有匹配内容的复盘正文。</p>', ['other']),
  ]
  const index = createDuplicateLookupIndex(library)

  candidates.forEach((candidate, candidateIndex) => {
    const linear = findObviousDuplicate(candidate, library)
    const indexed = findObviousDuplicateIndexed(candidate, index)
    assert(
      JSON.stringify(indexed) === JSON.stringify(linear),
      `索引查找必须保持线性判定语义与首个命中顺序（候选 ${candidateIndex + 1}）`,
    )
  })
}

export function testDuplicateLookupIndexScalesToTenThousandRecords(): void {
  const library = Array.from({ length: 10_000 }, (_, index) => ({
    id: `trade-${index}`,
    ref: `TRD-${index}`,
    sig: buildContentSignature(
      `<p>库内复盘正文 ${index}，长度足够且每一条内容都保持唯一用于性能门禁。</p>`,
      [`image-${index}-a`, `image-${index}-b`],
    ),
  }))

  const buildStartedAt = performance.now()
  const index = createDuplicateLookupIndex(library)
  const buildElapsed = performance.now() - buildStartedAt
  const candidates = Array.from({ length: 10_000 }, (_, candidateIndex) =>
    buildContentSignature(
      `<p>待导入复盘正文 ${candidateIndex + 20_000}，与库内记录不同且必须快速判定。</p>`,
      [`candidate-${candidateIndex}-a`, `candidate-${candidateIndex}-b`],
    ),
  )

  const lookupStartedAt = performance.now()
  let hits = 0
  for (const candidate of candidates) {
    if (findObviousDuplicateIndexed(candidate, index)) hits += 1
  }
  const lookupElapsed = performance.now() - lookupStartedAt

  assert(hits === 0, '10k 性能样本不得产生误判')
  assert(buildElapsed < 750, `10k 库索引构建应低于 750ms（实际 ${buildElapsed.toFixed(1)}ms）`)
  assert(lookupElapsed < 750, `10k×10k 未命中查找应低于 750ms（实际 ${lookupElapsed.toFixed(1)}ms）`)
}

export async function testNoteOnlyLibraryIndexNeverLoadsAttachments(): Promise<void> {
  const trades = [
    {
      id: 'trade-with-assets',
      ref: 'TRD-1',
      note: [
        '<p>这是一段足够长的正文，CSV 重复检测仍应使用正文指纹。</p>',
        '<img src="journal-asset://asset-one">',
        '<img src="journal-asset://asset-two">',
      ].join(''),
      deletedAt: undefined,
    },
  ]
  let loaderCalls = 0
  const loader = async () => {
    loaderCalls += 1
    return 'AA=='
  }

  const noteOnly = await buildLibraryContentIndex(trades, loader, { includeImages: false })
  assert(loaderCalls === 0, 'note-only 库索引不得读取任何附件')
  assert(Boolean(noteOnly[0]?.sig.noteFp), 'note-only 库索引仍需保留正文指纹')
  assert(noteOnly[0]?.sig.imageHashes.length === 0, 'note-only 库索引不得生成图片指纹')

  await buildLibraryContentIndex(trades, loader)
  assert(loaderCalls === 2, '默认完整索引仍应读取全部引用附件，保留 Notion 图片判重语义')
}
