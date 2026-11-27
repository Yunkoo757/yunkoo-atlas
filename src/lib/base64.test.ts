import assert from 'node:assert/strict'
import { base64ToBytes, bytesToBase64 } from '@/lib/base64'

export function testAssetBytesMatchStandardBase64AcrossChunkBoundaries() {
  const input = Uint8Array.from({ length: 70_000 }, (_, index) => index % 256)
  for (const length of [0, 1, 2, 3, 32767, 32768, 32769, 65537]) {
    const bytes = input.subarray(3, 3 + length)
    const expected = Buffer.from(bytes).toString('base64')
    assert.equal(bytesToBase64(bytes), expected)
    assert.deepEqual(base64ToBytes(expected), bytes)
  }
  assert.throws(() => base64ToBytes('!'))
}
