import { isSafeAssetId } from './assetId'

const retiredNavId = (value: unknown) => value === 'judgmentDesk' || value === 'reviewComposer'
const retiredPath = (value: unknown) => typeof value === 'string' && /^\/(?:judgment-desk|review-composer|settings\/composer-rules)(?:\/|\?|#|$)/.test(value)

/** Retired state and navigation overrides are ignored without changing active journal data or files. */
export function stripRetiredSnapshotDomains<T extends object>(value: T): Omit<T, 'judgmentDesk' | 'reviewComposer'> {
  const { judgmentDesk: _judgmentDesk, reviewComposer: _reviewComposer, ...active } = value as T & {
    judgmentDesk?: unknown
    reviewComposer?: unknown
  }
  const source = value as Record<string, unknown>
  const cleaned = active as Record<string, unknown>
  if (isRecord(source.shortcuts)) {
    const entries = Object.entries(source.shortcuts)
    const retained = entries.filter(([key]) => key !== 'nav.judgmentDesk' && key !== 'nav.reviewComposer' && !key.startsWith('judgment.'))
    if (retained.length !== entries.length) cleaned.shortcuts = Object.fromEntries(retained)
  }
  if (isRecord(source.display)) {
    const display = { ...source.display }
    let changed = false
    for (const key of ['sidebarPrimaryOrder', 'sidebarPins']) {
      const original = display[key]
      if (!Array.isArray(original)) continue
      const retained = original.filter(id => !retiredNavId(id))
      if (retained.length !== original.length) { display[key] = retained; changed = true }
    }
    if (Array.isArray(display.sidebarWorkspaceItems)) {
      const original = display.sidebarWorkspaceItems
      const retained = original.filter(item => !(isRecord(item) && isRecord(item.target)
        && item.target.kind === 'system' && retiredNavId(item.target.id)))
      if (retained.length !== original.length) { display.sidebarWorkspaceItems = retained; changed = true }
    }
    if (isRecord(display.workspaceMemory)) {
      const entries = Object.entries(display.workspaceMemory)
      const retained = entries.filter(([key, entry]) => !retiredNavId(key)
        && !(['today', 'trade', 'case'].includes(key) && isRecord(entry) && retiredPath(entry.pathname)))
      if (retained.length !== entries.length) { display.workspaceMemory = Object.fromEntries(retained); changed = true }
    }
    if (changed) cleaned.display = display
  }
  return cleaned as Omit<T, 'judgmentDesk' | 'reviewComposer'>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Only the two known legacy image-reference paths can excuse an otherwise unused imported asset. */
export function collectRetiredSnapshotAssetIds(raw: unknown): Set<string> {
  const ids = new Set<string>()
  if (!isRecord(raw) || !isRecord(raw.judgmentDesk)) return ids
  const images = (value: unknown): void => {
    if (!Array.isArray(value)) return
    for (const image of value) {
      if (isRecord(image) && isSafeAssetId(image.assetId)) ids.add(image.assetId)
    }
  }
  if (Array.isArray(raw.judgmentDesk.samples)) {
    for (const sample of raw.judgmentDesk.samples) {
      if (isRecord(sample)) images(sample.images)
    }
  }
  if (Array.isArray(raw.judgmentDesk.attempts)) {
    for (const attempt of raw.judgmentDesk.attempts) {
      if (isRecord(attempt) && isRecord(attempt.evidence)) images(attempt.evidence.images)
    }
  }
  return ids
}
