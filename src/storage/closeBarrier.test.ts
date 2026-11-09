import assert from 'node:assert/strict'
import { RendererCloseBarrier } from './closeBarrier'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

export async function testCloseWaitsForImageTailBeforeFinalFlushAndKeepsItsLease() {
  const image = deferred(), entered = deferred(), events: string[] = []
  const barrier = new RendererCloseBarrier({
    lockInteraction: () => { events.push('lock'); return () => { events.push('unlock') } },
    suspend: () => { events.push('suspend') }, resume: () => { events.push('resume') },
    drain: async () => { entered.resolve(); await image.promise; events.push('image-tail') },
    flush: async () => { events.push('flush') },
  })
  const generation = barrier.begin()
  const flushing = barrier.flush(generation)
  await entered.promise
  assert.deepEqual(events, ['lock', 'suspend'])
  image.resolve(); await flushing
  assert.deepEqual(events, ['lock', 'suspend', 'image-tail', 'flush'])
  assert(barrier.isHolding(), '保存回执期间及卸载前必须继续冻结，不允许再次自动补写')
  barrier.cancel(); barrier.cancel()
  assert.deepEqual(events.slice(-2), ['resume', 'unlock'], '取消只释放本轮一次租约')
}

export async function testCancelledCloseNeverFlushesAfterItsImageFinallyCompletes() {
  const image = deferred(), events: string[] = []
  const barrier = new RendererCloseBarrier({ lockInteraction: () => () => {}, suspend() {}, resume() {}, drain: () => image.promise, flush: async () => { events.push('flush') } })
  const old = barrier.flush(barrier.begin())
  barrier.cancel()
  const next = barrier.begin()
  image.resolve()
  await assert.rejects(old, /已取消/)
  assert(barrier.isHolding(), '旧任务不能释放后来一轮退出的交互锁')
  await barrier.flush(next)
  assert.deepEqual(events, ['flush'])
  barrier.cancel()
}

export async function testFailedCloseDrainReleasesTheWindowForRetry() {
  let releases = 0
  const barrier = new RendererCloseBarrier({ lockInteraction: () => () => { releases++ }, suspend() {}, resume() {}, drain: async () => { throw new Error('image failed') }, flush: async () => { assert.fail('失败附件不能越过最终保存') } })
  await assert.rejects(barrier.flush(barrier.begin()), /image failed/)
  assert.equal(barrier.isHolding(), false)
  assert.equal(releases, 1)
}
