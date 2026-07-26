export const BROWSER_DATABASE_NAME = 'trader-atlas-v3'
export const LOCAL_STORAGE_KEY = 'trader-atlas'

export function webChannelName(
  libraryId: string,
  kind: 'events' | 'writer',
): string {
  return `trader-atlas:${libraryId}:${kind}`
}
