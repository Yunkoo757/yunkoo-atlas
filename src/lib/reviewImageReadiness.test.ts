import {
  decodeReviewImage,
  settleReviewImageGroup,
} from '@/lib/reviewImageReadiness'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export async function testReviewImageGroupWaitsForEveryCandidate(): Promise<void> {
  const pending = new Map<string, ReturnType<typeof deferred<void>>>()
  const images = [
    { src: 'first.png', alt: '第一张' },
    { src: 'second.png', alt: '第二张' },
  ]
  let settled = false
  const resultPromise = settleReviewImageGroup(images, (src) => {
    const gate = deferred<void>()
    pending.set(src, gate)
    return gate.promise
  }).then((result) => { settled = true; return result })

  pending.get('first.png')?.resolve()
  await Promise.resolve()
  assert(!settled, '任一图片未完成时整组不得提前提交')
  pending.get('second.png')?.resolve()
  assert((await resultPromise).every((slot) => slot.status === 'ready'), '全部成功后整组应就绪')
}

export async function testReviewImageGroupKeepsFailedSlotsInInputOrder(): Promise<void> {
  const result = await settleReviewImageGroup([
    { src: 'ok.png', alt: '成功图' },
    { src: 'bad.png', alt: '失败图' },
  ], async (src) => { if (src === 'bad.png') throw new Error('decode failed') })
  assert(result.map((slot) => `${slot.src}:${slot.status}`).join(',') === 'ok.png:ready,bad.png:error',
    '失败图片必须保留原槽位且不得拒绝整组')
}

export async function testDecodeReviewImageDecodesAlreadyCachedImages(): Promise<void> {
  const originalImage = globalThis.Image
  let decodeCalls = 0

  class CachedImage {
    complete = true
    naturalWidth = 640
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    src = ''

    decode(): Promise<void> {
      decodeCalls += 1
      return Promise.resolve()
    }
  }

  Object.defineProperty(globalThis, 'Image', {
    configurable: true,
    writable: true,
    value: CachedImage,
  })
  try {
    await decodeReviewImage('cached.png')
    assert(decodeCalls === 1, '已缓存图片必须进入 decode 且只能执行一次')
  } finally {
    if (originalImage) {
      Object.defineProperty(globalThis, 'Image', {
        configurable: true,
        writable: true,
        value: originalImage,
      })
    } else {
      Reflect.deleteProperty(globalThis, 'Image')
    }
  }
}
