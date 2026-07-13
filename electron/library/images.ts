export interface ProcessedImage {
  buffer: Buffer
  mime: string
  ext: string
}

/** 图片保持原文件，避免截图文字与细线因重编码损失清晰度。 */
export async function processImageBuffer(
  input: Buffer,
  mime: string,
): Promise<ProcessedImage> {
  const normalized = mime.toLowerCase()
  if (!normalized.startsWith('image/')) {
    return { buffer: input, mime: normalized || 'application/octet-stream', ext: 'bin' }
  }

  const ext = normalized.split('/')[1]?.replace('jpeg', 'jpg') || 'bin'
  return { buffer: input, mime: normalized, ext }
}

export function isImageMime(mime: string): boolean {
  return mime.toLowerCase().startsWith('image/')
}
