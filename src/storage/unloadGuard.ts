export function shouldPreventAppUnload(
  hasPendingPersistedChanges: boolean,
  hasPendingDrafts: boolean,
): boolean {
  return hasPendingPersistedChanges || hasPendingDrafts
}
