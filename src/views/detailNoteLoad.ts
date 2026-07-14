export type DetailNoteLoadResult =
  | { status: 'ready'; html: string }
  | { status: 'error'; fallbackHtml: string; reason: 'prepare' | 'resolve' | 'incomplete' }

export type DetailNoteResolution = {
  html: string
  editable: boolean
}

type NoteResolver = (html: string) => Promise<string | DetailNoteResolution>
type NotePrepare = (html: string) => Promise<boolean | string>

/**
 * 读取附件失败时仍保留文字内容，但不继续请求任何未解析图片。
 * 该内容只用于只读恢复，不会写回交易记录。
 */
export function safeNoteFallback(html: string): string {
  return html.replace(
    /<img\b[^>]*>/gi,
    '<span class="editor-missing-image" data-note-load-fallback="true">图片暂未载入</span>',
  )
}

/** 将解析异常收敛为显式状态，避免详情页产生未处理的 Promise rejection。 */
export async function loadDetailNote(
  html: string,
  resolve: NoteResolver,
  prepare?: NotePrepare,
): Promise<DetailNoteLoadResult> {
  let sourceHtml = html
  try {
    if (prepare) {
      const prepared = await prepare(html)
      if (prepared === false) {
        return { status: 'error', fallbackHtml: safeNoteFallback(html), reason: 'prepare' }
      }
      if (typeof prepared === 'string') sourceHtml = prepared
    }
    const resolution = await resolve(sourceHtml)
    if (typeof resolution === 'string') return { status: 'ready', html: resolution }
    if (!resolution.editable) {
      return { status: 'error', fallbackHtml: resolution.html, reason: 'incomplete' }
    }
    return { status: 'ready', html: resolution.html }
  } catch {
    return { status: 'error', fallbackHtml: safeNoteFallback(sourceHtml), reason: 'resolve' }
  }
}
