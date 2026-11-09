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

/** 下一次成功复制后清理超过一天的旧缓存；保留当前剪贴板引用及其他目录。 */
export async function cleanupCaseClipboardFiles(root: string, keep: string, now = Date.now()): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^copy-[0-9a-f-]{36}$/.test(entry.name)) continue
    const directory = path.join(root, entry.name)
    if (directory === keep) continue
    try {
      const marker = JSON.parse(await fs.readFile(path.join(directory, MARKER), 'utf8'))
      if (marker.kind !== 'atlas-clipboard-export' || typeof marker.createdAt !== 'number' || now - marker.createdAt <= DAY_MS) continue
      await fs.rm(directory, { recursive: true, force: true })
    } catch { /* 未标识目录不属于本功能，不作清理。 */ }
  }
}
