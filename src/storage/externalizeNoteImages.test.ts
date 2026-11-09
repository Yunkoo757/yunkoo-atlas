import assert from 'node:assert/strict'
import type { StorageAdapter } from '@/storage/adapter'
import { externalizeNoteImages } from '@/storage/assets'
import { externalizeSnapshotNotes } from '@/storage/migrate'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => { resolve = complete })
  return { promise, resolve }
}

// 可识别的附件字节用于核对各调用的保存归属；此测试不调用图片解码或真实存储。
function inlineImage(label: string): string {
  return `<img alt="${label}" src="data:image/png;base64,${btoa(label)}" class="original-image">`
}

function savedImage(label: string, id: number): string {
  return `<img alt="${label}" src="journal-asset://isolated-asset-${id}" class="original-image">`
}

function memoryAdapter(beforeSave?: (index: number) => Promise<void>) {
  const calls: Array<{ blob: Blob; mime: string }> = []
  const unexpected = async (): Promise<never> => { throw new Error('此回归只允许内存 saveAsset') }
  const adapter: StorageAdapter = {
    open: unexpected,
    getManifest: unexpected,
    loadSnapshot: unexpected,
    saveSnapshot: unexpected,
    async saveAsset(blob, mime) {
      const index = calls.push({ blob, mime })
      await beforeSave?.(index)
      return `isolated-asset-${index}`
    },
    getAssetObjectUrl: unexpected,
    getAssetForExport: unexpected,
    getAssetStats: unexpected,
    importAssets: unexpected,
    commitImport: unexpected,
  }
  return {
    adapter,
    async savedBytes() {
      return Promise.all(calls.map(async ({ blob, mime }) => ({ bytes: await blob.text(), mime })))
    },
  }
}

export async function testConcurrentNotesDoNotRepeatImagesWhenTheSecondNoteFinishesFirst() {
  const firstSave = deferred()
  const memory = memoryAdapter(async (index) => { if (index === 1) await firstSave.promise })
  const first = externalizeNoteImages(`<p>甲 📈</p>${inlineImage('A1')}<hr>${inlineImage('A2')}<p>尾部</p>`, memory.adapter)
  try {
    // A1 的 saveAsset 尚未完成，B 完整扫描至 EOF；旧共享游标会在此被归零。
    const second = await externalizeNoteImages(`<p>乙</p>${inlineImage('B1')}`, memory.adapter)
    firstSave.resolve()
    const result = await first
    assert.equal(result, `<p>甲 📈</p>${savedImage('A1', 1)}<hr>${savedImage('A2', 3)}<p>尾部</p>`, 'A 的首图不得在 B 完成后被重复匹配')
    assert.equal(second, `<p>乙</p>${savedImage('B1', 2)}`)
    assert.deepEqual(await memory.savedBytes(), ['A1', 'B1', 'A2'].map(bytes => ({ bytes, mime: 'image/png' })), '三张输入图必须各保存一次，且归属正确')
  } finally {
    firstSave.resolve()
    await Promise.allSettled([first])
  }
}

export async function testConcurrentNotesDoNotSkipImagesWhenTheFirstNoteResumesBeforeALongerNote() {
  const firstSave = deferred()
  const secondSave = deferred()
  const memory = memoryAdapter(async (index) => {
    if (index === 1) await firstSave.promise
    if (index === 2) await secondSave.promise
  })
  const prefix = '<p>较长的另一份正文</p>'.repeat(30)
  const first = externalizeNoteImages(`${inlineImage('A1')}${inlineImage('A2')}`, memory.adapter)
  const second = externalizeNoteImages(`${prefix}${inlineImage('B1')}${inlineImage('B2')}${inlineImage('B3')}`, memory.adapter)
  try {
    // B1 的位置超过整份 A 的长度；若游标共享，恢复 A 时会直接跳到 EOF 而漏掉 A2。
    firstSave.resolve()
    const resultA = await first
    secondSave.resolve()
    const resultB = await second
    assert.equal(resultA, `${savedImage('A1', 1)}${savedImage('A2', 3)}`, '另一笔记的扫描位置不得跳过 A2')
    assert.equal(resultB, `${prefix}${savedImage('B1', 2)}${savedImage('B2', 4)}${savedImage('B3', 5)}`)
    assert.deepEqual(await memory.savedBytes(), ['A1', 'B1', 'A2', 'B2', 'B3'].map(bytes => ({ bytes, mime: 'image/png' })))
  } finally {
    firstSave.resolve()
    secondSave.resolve()
    await Promise.allSettled([first, second])
  }
}

export async function testSnapshotMigrationKeepsConcurrentImagesIndependentAcrossAllNoteDomains() {
  const snapshot = createFullPersistedSnapshotFixture()
  const source = snapshot.trades[0]!
  snapshot.trades = [
    { ...source, note: `${inlineImage('trade-A1')}${inlineImage('trade-A2')}` },
    { ...source, id: 'isolated-source-case', ref: 'CAS-ISOLATED', tradeKind: 'case', sourceTradeId: source.id,
      note: inlineImage('case-B1'), sourceNoteHtml: `${inlineImage('source-B1')}${inlineImage('source-B2')}` },
  ]
  snapshot.weeklyReviews = [1, 2].map(index => ({ ...snapshot.weeklyReviews![0]!, id: `isolated-weekly-${index}`, contentHtml: `${inlineImage(`weekly-${index}-1`)}${inlineImage(`weekly-${index}-2`)}` }))
  snapshot.quickNotes = [1, 2].map(index => ({ ...snapshot.quickNotes![0]!, id: `isolated-quick-${index}`, contentHtml: `${inlineImage(`quick-${index}-1`)}${inlineImage(`quick-${index}-2`)}` }))
  const before = JSON.stringify(snapshot)
  const memory = memoryAdapter()
  const migrated = await externalizeSnapshotNotes(snapshot, memory.adapter)
  const bytes = await memory.savedBytes()
  const htmls = [
    ...migrated.trades.flatMap(trade => [trade.note, ...(trade.sourceNoteHtml === undefined ? [] : [trade.sourceNoteHtml])]),
    ...migrated.weeklyReviews!.map(review => review.contentHtml),
    ...migrated.quickNotes!.map(note => note.contentHtml),
  ]
  const expected = [
    ['trade-A1', 'trade-A2'], ['case-B1'], ['source-B1', 'source-B2'],
    ['weekly-1-1', 'weekly-1-2'], ['weekly-2-1', 'weekly-2-2'],
    ['quick-1-1', 'quick-1-2'], ['quick-2-1', 'quick-2-2'],
  ]
  const usedIds: string[] = []
  htmls.forEach((html, index) => {
    assert(!html.includes('data:image/'), '迁移后不得残留漏扫的内嵌图片')
    assert.deepEqual([...html.matchAll(/alt="([^"]+)"/g)].map(match => match[1]), expected[index], '各正文的图片顺序与数量必须保持')
    const ids = [...html.matchAll(/journal-asset:\/\/isolated-asset-(\d+)/g)].map(match => match[1]!)
    usedIds.push(...ids)
    assert.deepEqual(ids.map(id => bytes[Number(id) - 1]?.bytes), expected[index], '附件引用必须绑定原正文自己的图片字节')
  })
  assert.equal(bytes.length, 13, '十三张输入图必须恰好保存十三次')
  assert.equal(new Set(usedIds).size, 13, '每张图应有独立且被正确引用的保存结果')
  assert.equal(JSON.stringify(snapshot), before, '迁移不得直接修改输入快照')
}
