/** 只有成功交给下载器的文件才需要保留临时 URL；异常时立即释放。 */
export function downloadBlob(blob: Blob, filename: string, retainUrlMs = 0): void {
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  let handedOff = false
  try {
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    handedOff = true
  } finally {
    link.remove()
    if (handedOff && retainUrlMs > 0) {
      setTimeout(() => URL.revokeObjectURL(url), retainUrlMs)
    } else {
      URL.revokeObjectURL(url)
    }
  }
}
