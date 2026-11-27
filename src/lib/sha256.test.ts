import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { sha256Hex } from './sha256'

export async function testSha256HashesOnlyTheRequestedBytesAndRetainsThePublishedHexFormat() {
  const bytes = new Uint8Array([240, 144, 141, 136, 0, 13, 10, 255])
  const shared = new Uint8Array(new SharedArrayBuffer(bytes.length))
  shared.set(bytes)
  for (const view of [new Uint8Array(), bytes, bytes.subarray(1, 6), shared.subarray(2, 5)]) {
    assert.equal(await sha256Hex(view), createHash('sha256').update(view).digest('hex'))
  }
  assert.equal(await sha256Hex(bytes.buffer), createHash('sha256').update(bytes).digest('hex'))
}
