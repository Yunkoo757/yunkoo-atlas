import type { EventEmitter } from 'node:events'

export type RendererDocumentEvents = Pick<EventEmitter, 'once' | 'removeListener'>

/** did-navigate 只在主框架提交新文档时触发，同文档路由仍属于当前窗口会话。 */
export function onRendererDocumentEnd(renderer: RendererDocumentEvents, release: () => void) {
  const events = ['did-navigate', 'render-process-gone', 'destroyed'] as const
  for (const event of events) renderer.once(event, release)
  return () => {
    for (const event of events) renderer.removeListener(event, release)
  }
}
