import type { JudgmentImage } from './model'

/** Selection follows the source document, not the order of clicks. */
export function toggleSourceImage(chosen: JudgmentImage[], assetId: string, sourceTradeId: string | null, sourceOrder: string[]): JudgmentImage[] {
  if (chosen.some(image => image.assetId === assetId)) return chosen.filter(image => image.assetId !== assetId)
  const next = [...chosen, { assetId, sourceTradeId }]
  const ordered = next.filter(image => image.sourceTradeId === sourceTradeId)
    .sort((a, b) => sourceOrder.indexOf(a.assetId) - sourceOrder.indexOf(b.assetId))
  let index = 0
  return next.map(image => image.sourceTradeId === sourceTradeId ? ordered[index++] : image)
}

export function moveImage<T>(images: T[], index: number, step: number): T[] {
  const target = index + step
  if (index < 0 || index >= images.length || target < 0 || target >= images.length) return images
  const next = [...images]
  const [image] = next.splice(index, 1)
  next.splice(target, 0, image)
  return next
}
