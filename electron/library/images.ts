import sharp from 'sharp'

export interface ProcessedImage {
  buffer: Buffer
  mime: string
  ext: string
}

/** 高质量 WebP；带透明通道的 PNG 截图保留 PNG */
export async function processImageBuffer(
  input: Buffer,
  mime: string,
): Promise<ProcessedImage> {
  const normalized = mime.toLowerCase()
  if (!normalized.startsWith('image/')) {
    return { buffer: input, mime: normalized || 'application/octet-stream', ext: 'bin' }
  }

  try {
    const img = sharp(input)
    const meta = await img.metadata()
    const hasAlpha = meta.hasAlpha === true
    const isPng = normalized === 'image/png'

    if (isPng && hasAlpha) {
      const buffer = await img.png({ compressionLevel: 9, effort: 7 }).toBuffer()
      return { buffer, mime: 'image/png', ext: 'png' }
    }

    const buffer = await img.webp({ quality: 93, effort: 4 }).toBuffer()
    return { buffer, mime: 'image/webp', ext: 'webp' }
  } catch {
    const fallbackExt = normalized.split('/')[1]?.replace('jpeg', 'jpg') || 'bin'
    return { buffer: input, mime: normalized, ext: fallbackExt }
  }
}

export function isImageMime(mime: string): boolean {
  return mime.toLowerCase().startsWith('image/')
}
