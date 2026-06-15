export function isElectron(): boolean {
  return typeof window !== 'undefined' && window.journalBridge?.isElectron === true
}

export function getJournalBridge() {
  if (!isElectron()) return null
  return window.journalBridge!
}
