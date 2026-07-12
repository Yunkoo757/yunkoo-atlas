/** 虚拟列表内行可能不在 DOM；返回锚点通过注册的 scroll handler 定位。 */

type ScrollHandler = (tradeId: string) => boolean

const handlers = new Set<ScrollHandler>()

export function registerTradeScrollTarget(handler: ScrollHandler): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

/** @returns 是否已有 handler 成功滚动到该交易 */
export function requestScrollToTrade(tradeId: string): boolean {
  for (const handler of handlers) {
    if (handler(tradeId)) return true
  }
  return false
}
