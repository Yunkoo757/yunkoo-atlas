import assert from 'node:assert/strict'
import { AssetPurgePreviews } from './assetPurgePreviews'

export function testRecoveryGrantExpiresAndEachCommitAttemptConsumesIt(): void {
  const now = Date.now
  let elapsed = 0
  Date.now = () => elapsed
  try {
    const previews = new AssetPurgePreviews<void>()
    const archived = previews.create(1, [], undefined)
    let verified = 0
    const first = previews.authorize(archived, 1)
    const replacement = previews.authorize(archived, 1, () => { verified++ })
    assert.notEqual(first, replacement)
    assert.throws(() => previews.take(archived, first), /归档授权/)
    assert.throws(() => previews.take(archived, replacement), /归档授权/)
    assert.equal(verified, 0)
    const timed = previews.authorize(archived, 1, () => { verified++ })
    elapsed = 15 * 60_000 + 1
    assert.throws(() => previews.take(archived, timed), /归档授权/)
    const valid = previews.authorize(archived, 1, () => { verified++ })
    elapsed += 15 * 60_000
    previews.take(archived, valid)
    assert.equal(verified, 1)
    assert.throws(() => previews.take(archived), /预览无效/)
  } finally {
    Date.now = now
  }
}
