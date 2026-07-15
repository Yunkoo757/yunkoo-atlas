export type LibraryIdentityChangeReason = 'switch' | 'restore' | 'import'

let handler: ((reason: LibraryIdentityChangeReason) => void) | null = null

export function setLibraryIdentityChangeHandler(
  next: ((reason: LibraryIdentityChangeReason) => void) | null,
): void {
  handler = next
}

export function notifyLibraryIdentityChanged(reason: LibraryIdentityChangeReason): void {
  handler?.(reason)
}
