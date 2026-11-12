import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { cleanupCaseClipboardFiles, prepareCaseClipboardFiles, validateCaseClipboardContent } from './caseClipboardFiles'
import type { CaseClipboardContent } from '../src/lib/caseClipboardContract'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const fixture = (): CaseClipboardContent => ({ html: '<p>原始正文 📈</p>', text: 'ETHUSDT · 复盘案例\n中文正文 📈\n保留换行。', images: [1, 2, 3].map(() => ({ mime: 'image/png', data: png })) })

export async function testClipboardFilesPreserveOriginalBytesAndUtf8Text() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-clipboard-unit-'))
  try {
    const input = fixture()
    const prepared = await prepareCaseClipboardFiles(input, root)
    assert.equal(prepared.files.length, 4)
    assert.equal(path.basename(prepared.files[0]), '00-复盘正文.txt')
    const text = await fs.readFile(prepared.files[0])
    assert.equal(text.toString('utf8'), input.text)
    assert.notEqual(text.subarray(0, 3).toString('hex'), 'efbbbf', 'TXT 必须是 UTF-8 无 BOM')
    for (const file of prepared.files.slice(1)) assert.deepEqual(await fs.readFile(file), Buffer.from(png, 'base64'), '原图不得缩放或重新编码')
    const next = await prepareCaseClipboardFiles({ ...input, text: '另一次复制' }, root)
    assert.notEqual(next.directory, prepared.directory, '后续复制不得覆盖仍可能被接收端读取的文件')
    assert.equal(await fs.readFile(prepared.files[0], 'utf8'), input.text)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
}

export async function testInvalidImageCreatesNoPartialClipboardExport() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-clipboard-invalid-'))
  try {
    for (const images of [undefined, [{ mime: 'image/png', data: 'invalid' }], [{ mime: 'image/jpeg', data: png }], [{ mime: '__proto__', data: png }]]) {
      const input = { ...fixture(), images }
      assert.throws(() => validateCaseClipboardContent(input))
      await assert.rejects(() => prepareCaseClipboardFiles(input as CaseClipboardContent, root))
    }
    assert.deepEqual(await fs.readdir(root), [], '附件验证失败不得落地部分文件')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
}

export async function testCleanupKeepsActiveClipboardAndUnrelatedDirectories() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-clipboard-cleanup-'))
  const now = Date.now()
  const make = async (name: string, marker?: unknown) => {
    const directory = path.join(root, name)
    await fs.mkdir(directory)
    await fs.writeFile(path.join(directory, 'original.png'), Buffer.from(png, 'base64'))
    if (marker) await fs.writeFile(path.join(directory, '.atlas-clipboard-export.json'), JSON.stringify(marker), 'utf8')
    return directory
  }
  try {
    const active = await make(`copy-${randomUUID()}`, { kind: 'atlas-clipboard-export', createdAt: now - 3 * 86400000 })
    const old = await make(`copy-${randomUUID()}`, { kind: 'atlas-clipboard-export', createdAt: now - 2 * 86400000 })
    const recent = await make(`copy-${randomUUID()}`, { kind: 'atlas-clipboard-export', createdAt: now })
    const unrelated = await make(`copy-${randomUUID()}`)
    const otherKind = await make(`copy-${randomUUID()}`, { kind: 'real-library', createdAt: 1 })
    await cleanupCaseClipboardFiles(root, active, now)
    await assert.rejects(() => fs.access(old))
    for (const keep of [active, recent, unrelated, otherKind]) await fs.access(path.join(keep, 'original.png'))
  } finally { await fs.rm(root, { recursive: true, force: true }) }
}

export async function testClipboardQuotaEvictsOldestRecentCopiesAndKeepsActiveAndUnowned() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-clipboard-quota-'))
  const now = Date.now()
  const make = async (age: number, marked = true) => {
    const directory = path.join(root, `copy-${randomUUID()}`)
    await fs.mkdir(directory)
    await fs.writeFile(path.join(directory, 'original.png'), Buffer.alloc(100))
    if (marked) await fs.writeFile(path.join(directory, '.atlas-clipboard-export.json'), JSON.stringify({ kind: 'atlas-clipboard-export', createdAt: now - age }))
    return directory
  }
  try {
    const active = await make(3 * 86400000)
    const oldest = await make(3000), middle = await make(2000), newest = await make(1000)
    const unrelated = await make(4000, false)
    await cleanupCaseClipboardFiles(root, active, now, { maxEntries: 2, maxBytes: 10_000 })
    for (const removed of [oldest, middle]) await assert.rejects(() => fs.access(removed))
    for (const kept of [active, newest, unrelated]) await fs.access(path.join(kept, 'original.png'))
  } finally { await fs.rm(root, { recursive: true, force: true }) }
}

export async function testClipboardByteQuotaDoesNotWaitForOneDayAndNeverRevokesTheActiveCopy() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-clipboard-byte-quota-'))
  try {
    const copies = []
    for (let i = 0; i < 3; i++) copies.push(await prepareCaseClipboardFiles(fixture(), root))
    const active = copies[2]!
    const size = (await Promise.all((await fs.readdir(active.directory)).map(async name => (await fs.stat(path.join(active.directory, name))).size))).reduce((a, b) => a + b, 0)
    await cleanupCaseClipboardFiles(root, active.directory, Date.now(), { maxEntries: 32, maxBytes: size + 1 })
    for (const copy of copies.slice(0, 2)) await assert.rejects(() => fs.access(copy.directory))
    for (const file of active.files) await fs.access(file)
    assert.equal(await fs.readFile(active.files[0]!, 'utf8'), fixture().text)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
}
