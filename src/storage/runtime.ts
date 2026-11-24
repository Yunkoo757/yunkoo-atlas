export function isElectron(): boolean {
  return typeof window !== 'undefined' && window.journalBridge?.isElectron === true
}

export function getJournalBridge() {
  if (!isElectron()) return null
  return window.journalBridge!
}

export function getDesktopPlatform() {
  const platform = getJournalBridge()?.platform
  return platform === 'darwin' || platform === 'win32' ? platform : undefined
}
