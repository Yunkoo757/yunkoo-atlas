export const STORAGE_RECOVERY_REQUIRED_EVENT = 'atlas:storage-recovery-required'

export function notifyStorageRecoveryRequired(message: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(STORAGE_RECOVERY_REQUIRED_EVENT, { detail: message }))
}
