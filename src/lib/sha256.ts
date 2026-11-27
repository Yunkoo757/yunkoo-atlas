/** Lowercase SHA-256 over the selected bytes, including subviews of a larger buffer. */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = ArrayBuffer.isView(data) ? data : new Uint8Array(data)
  // Web Crypto accepts ordinary ArrayBuffers. Copy only shared or cross-realm backing stores.
  const input = bytes.buffer instanceof ArrayBuffer
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes)
  const digest = await crypto.subtle.digest('SHA-256', input)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
