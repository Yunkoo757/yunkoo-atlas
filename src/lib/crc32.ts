const CRC32_TABLE = new Uint32Array(256)

for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  CRC32_TABLE[index] = value >>> 0
}

/** ZIP CRC-32。连续分块可直接传入上一块的校验值，空输入的校验值为 0。 */
export function crc32(bytes: Uint8Array, previous = 0): number {
  let value = previous ^ 0xffffffff
  for (const byte of bytes) {
    value = CRC32_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}
