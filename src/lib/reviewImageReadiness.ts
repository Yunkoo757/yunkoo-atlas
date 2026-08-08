export type ReviewImageCandidate = { src: string; alt: string }
export type ReviewImageSlot = ReviewImageCandidate & { status: 'ready' | 'error' }
export type ReviewImageLoader = (src: string) => Promise<void>

export function decodeReviewImage(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    let finished = false
    let decodeStarted = false
    const settle = (operation: () => void) => {
      if (finished) return
      finished = true
      image.onload = null
      image.onerror = null
      operation()
    }
    const fail = (error: unknown) => settle(() => reject(error))
    const decode = () => {
      if (finished || decodeStarted) return
      if (image.naturalWidth === 0) {
        fail(new Error(`Unable to load review image: ${src}`))
        return
      }
      decodeStarted = true
      const decoded = typeof image.decode === 'function' ? image.decode() : Promise.resolve()
      void decoded.then(
        () => settle(resolve),
        fail,
      )
    }
    image.onerror = () => fail(new Error(`Unable to load review image: ${src}`))
    image.onload = decode
    image.src = src
    if (image.complete) queueMicrotask(decode)
  })
}

export async function settleReviewImageGroup(
  images: readonly ReviewImageCandidate[],
  loader: ReviewImageLoader = decodeReviewImage,
): Promise<ReviewImageSlot[]> {
  return Promise.all(images.map(async (image) => {
    try {
      await loader(image.src)
      return { ...image, status: 'ready' as const }
    } catch {
      return { ...image, status: 'error' as const }
    }
  }))
}
