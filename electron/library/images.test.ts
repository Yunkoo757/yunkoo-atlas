import sharp from 'sharp'
import { processImageBuffer } from './images'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export async function testImageProcessingPreservesOriginalFiles(): Promise<void> {
  const png = await sharp({
    create: {
      width: 32,
      height: 24,
      channels: 3,
      background: { r: 18, g: 31, b: 48 },
    },
  })
    .png()
    .toBuffer()
  const jpeg = await sharp(png).jpeg({ quality: 87 }).toBuffer()

  for (const source of [
    { buffer: png, mime: 'image/png', ext: 'png' },
    { buffer: jpeg, mime: 'image/jpeg', ext: 'jpg' },
  ]) {
    const processed = await processImageBuffer(source.buffer, source.mime)
    assert(processed.mime === source.mime, `${source.mime} 不应改变格式`)
    assert(processed.ext === source.ext, `${source.mime} 应保留原扩展名`)
    assert(processed.buffer.equals(source.buffer), `${source.mime} 应逐字节保留原文件`)
  }
}
