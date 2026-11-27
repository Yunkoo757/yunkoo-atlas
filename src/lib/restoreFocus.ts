/** A closing surface may be replaced by a dialog or by the next editor in the same frame. */
export function restoreFocusIfUnclaimed(target: HTMLElement | null | undefined): void {
  if (!target?.isConnected) return
  const active = document.activeElement
  if (active && active !== document.body && active.isConnected) return
  const modal = Array.from(document.querySelectorAll<HTMLElement>('[data-modal-shell-id]')).at(-1)
  if (!modal || modal.contains(target)) target.focus({ preventScroll: true })
}

export function restoreFocusAfterClose(opener: HTMLElement | null): void {
  requestAnimationFrame(() => restoreFocusIfUnclaimed(opener))
}
