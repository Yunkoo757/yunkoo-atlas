export interface CaseClipboardImage {
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  /** 原始文件字节的 base64；复制不得缩放、重编码或合成图片。 */
  data: string
}

/** 含图案例复制为正文 TXT 和独立原图；纯文字仍可直接粘贴编辑。 */
export interface CaseClipboardContent {
  html: string
  text: string
  images: CaseClipboardImage[]
}

export type CaseClipboardResult = { ok: true } | { ok: false; error: string }

export const CASE_CLIPBOARD_MAX_BYTES = 96 * 1024 * 1024
export const CASE_CLIPBOARD_MAX_IMAGE_BYTES = 20 * 1024 * 1024
