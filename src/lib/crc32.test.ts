import assert from 'node:assert/strict'
import { crc32 } from './crc32'

export function testZipCrc32AcrossChunkBoundaries() {
  const bytes = new TextEncoder().encode('123456789')
  assert.equal(crc32(new Uint8Array()), 0)
  assert.equal(crc32(bytes), 0xcbf43926)
  for (let split = 0; split <= bytes.length; split++) {
    const first = crc32(bytes.subarray(0, split))
    assert.equal(crc32(bytes.subarray(split), first), 0xcbf43926)
  }
}
