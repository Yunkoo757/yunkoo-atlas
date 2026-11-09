/** 弹窗的离场快照仍会读取预览图；等快照退出后再释放本组件拥有的 URL。 */
export function revokeObjectUrlAfterExit(url: string): void {
  // useExitClone 在 React 清理后的 microtask 中挂载；先让它完成快照接管。
  window.setTimeout(() => {
    const clones = [...document.querySelectorAll('.ui-exit-clone')].filter(clone =>
      [...clone.querySelectorAll('img')].some(image => image.getAttribute('src') === url),
    )
    if (clones.length === 0) { URL.revokeObjectURL(url); return }
    const observer = new MutationObserver(() => {
      if (clones.some(clone => clone.isConnected)) return
      observer.disconnect()
      URL.revokeObjectURL(url)
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }, 0)
}
