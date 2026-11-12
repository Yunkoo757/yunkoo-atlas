import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  CASE_CLIPBOARD_MAX_BYTES, CASE_CLIPBOARD_MAX_IMAGE_BYTES,
  type CaseClipboardContent, type CaseClipboardImage,
} from '../src/lib/caseClipboardContract'

const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' } as const
const DAY_MS = 24 * 60 * 60 * 1000
const MARKER = '.atlas-clipboard-export.json'
export const CASE_CLIPBOARD_CACHE_LIMITS = Object.freeze({ maxEntries: 32, maxBytes: 256 * 1024 * 1024 })

function imageBytes(image: CaseClipboardImage): Buffer {
  if (!image || !Object.prototype.hasOwnProperty.call(EXTENSIONS, image.mime) || typeof image.data !== 'string' || !image.data || image.data.length > Math.ceil(CASE_CLIPBOARD_MAX_IMAGE_BYTES / 3) * 4) throw new Error('图片无效或单张超过 20 MB，请检查图片后重试')
  const bytes = Buffer.from(image.data, 'base64')
  if (bytes.toString('base64') !== image.data || bytes.byteLength > CASE_CLIPBOARD_MAX_IMAGE_BYTES) throw new Error('图片字节无效，请重新载入正文后重试')
  const valid = image.mime === 'image/png' ? bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
    : image.mime === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : image.mime === 'image/gif' ? /^(GIF87a|GIF89a)$/.test(bytes.subarray(0, 6).toString('ascii'))
        : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  if (!valid) throw new Error('图片格式与文件内容不一致，请检查图片后重试')
  return bytes
}

export function validateCaseClipboardContent(content: unknown): asserts content is CaseClipboardContent {
  const value = content as Partial<CaseClipboardContent> | null
  if (!value || typeof value.html !== 'string' || typeof value.text !== 'string' || !value.text.trim() || !Array.isArray(value.images) || value.images.length > 100) throw new Error('复盘内容无效，请重新载入正文后重试')
  let bytes = Buffer.byteLength(value.html) + Buffer.byteLength(value.text)
  for (const image of value.images) {
    if (typeof image?.data !== 'string') throw new Error('图片数据无效，请重新载入正文后重试')
    bytes += image.data.length
    if (bytes > CASE_CLIPBOARD_MAX_BYTES) throw new Error('案例图文过大，请分批复制图片')
    imageBytes(image)
  }
  if (bytes > CASE_CLIPBOARD_MAX_BYTES) throw new Error('案例图文过大，请分批复制图片')
}

/** 仅向独立剪贴板缓存写入；验证全部附件后再准备文件，不接触资料库。 */
export async function prepareCaseClipboardFiles(content: CaseClipboardContent, root: string): Promise<{ directory: string; files: string[] }> {
  validateCaseClipboardContent(content)
  const images = content.images.map(imageBytes)
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  const directory = path.join(root, `copy-${randomUUID()}`)
  await fs.mkdir(directory, { mode: 0o700 })
  try {
    await fs.writeFile(path.join(directory, MARKER), JSON.stringify({ kind: 'atlas-clipboard-export', createdAt: Date.now() }), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    const files = [path.join(directory, '00-复盘正文.txt')]
    await fs.writeFile(files[0]!, content.text, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    for (const [index, bytes] of images.entries()) {
      const file = path.join(directory, `${String(index + 1).padStart(2, '0')}-图片.${EXTENSIONS[content.images[index]!.mime]}`)
      await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 })
      files.push(file)
    }
    return { directory, files }
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

/** 成功复制后按时间、份数与字节清理；当前剪贴板和未标识目录始终保留。 */
export async function cleanupCaseClipboardFiles(
  root: string,
  keep: string,
  now = Date.now(),
  limits: { maxEntries: number; maxBytes: number } = CASE_CLIPBOARD_CACHE_LIMITS,
): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const owned: { directory: string; createdAt: number; bytes: number }[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^copy-[0-9a-f-]{36}$/.test(entry.name)) continue
    const directory = path.join(root, entry.name)
    try {
      const marker = JSON.parse(await fs.readFile(path.join(directory, MARKER), 'utf8'))
      if (marker.kind !== 'atlas-clipboard-export' || !Number.isFinite(marker.createdAt)) continue
      let bytes = 0
      for (const file of await fs.readdir(directory)) {
        const info = await fs.lstat(path.join(directory, file))
        if (info.isFile()) bytes += info.size
      }
      owned.push({ directory, createdAt: marker.createdAt, bytes })
    } catch { /* 无法识别归属或读取大小时不擅自删除。 */ }
  }
  let count = owned.length
  let bytes = owned.reduce((sum, entry) => sum + entry.bytes, 0)
  owned.sort((a, b) => a.createdAt - b.createdAt || a.directory.localeCompare(b.directory))
  for (const entry of owned) {
    if (path.resolve(entry.directory) === path.resolve(keep)) continue
    if (now - entry.createdAt <= DAY_MS && count <= limits.maxEntries && bytes <= limits.maxBytes) continue
    try {
      await fs.rm(entry.directory, { recursive: true, force: true })
      count -= 1
      bytes -= entry.bytes
    } catch { /* 清理失败不影响已成功写入的当前剪贴板。 */ }
  }
}
