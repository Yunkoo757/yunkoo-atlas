import type { ShortcutBinding, ShortcutScope } from '@/shortcuts/types'
import { SHORTCUT_ACTIONS } from '@/shortcuts/actions'
import {
  bindingKey,
  chordFromEvent,
  eventMatchesChord,
  isSequence,
  isTypingTarget,
} from '@/shortcuts/chords'
import { resolveBinding, useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'

export type ShortcutHandler = () => void

export type ShortcutHandlerMap = Partial<Record<string, ShortcutHandler>>

const SEQUENCE_TIMEOUT_MS = 1500

const SCOPE_PRIORITY: Record<ShortcutScope, number> = {
  lightbox: 100,
  overlay: 90,
  detail: 50,
  navigation: 30,
  global: 10,
}

let handlers: ShortcutHandlerMap = {}
let sequenceBuffer: string[] = []
let sequenceTimer: ReturnType<typeof setTimeout> | null = null

export function setShortcutHandlers(map: ShortcutHandlerMap): void {
  handlers = map
}

function clearSequence(): void {
  sequenceBuffer = []
  if (sequenceTimer) {
    clearTimeout(sequenceTimer)
    sequenceTimer = null
  }
}

function armSequenceTimer(): void {
  if (sequenceTimer) clearTimeout(sequenceTimer)
  sequenceTimer = setTimeout(clearSequence, SEQUENCE_TIMEOUT_MS)
}

function getActiveScopes(): Set<ShortcutScope> {
  const scopes = new Set<ShortcutScope>(['global', 'navigation'])
  const { lightbox, cmdkOpen, dataIOOpen } = useShortcutStore.getState()
  const composerOpen = useStore.getState().composerOpen

  if (lightbox) scopes.add('lightbox')
  if (cmdkOpen || dataIOOpen || composerOpen) scopes.add('overlay')

  if (typeof window !== 'undefined') {
    const path = window.location.pathname
    if (path.startsWith('/trade/')) scopes.add('detail')
  }

  return scopes
}

function bindingMatchesSequence(binding: ShortcutBinding, buffer: string[]): boolean {
  if (!isSequence(binding)) return false
  if (buffer.length !== binding.length) return false
  return binding.every((chord, i) => chord.key === buffer[i])
}

function hasSequencePrefix(buffer: string[]): boolean {
  if (buffer.length === 0) return false
  const { bindings } = useShortcutStore.getState()
  const scopes = getActiveScopes()

  for (const action of SHORTCUT_ACTIONS) {
    if (!scopes.has(action.scope)) continue
    const binding = resolveBinding(action.id, bindings)
    if (!binding || !isSequence(binding)) continue
    if (buffer.length > binding.length) continue
    const matches = binding
      .slice(0, buffer.length)
      .every((chord, i) => chord.key === buffer[i])
    if (matches) return true
  }
  return false
}

function findSequenceMatch(buffer: string[]): string | null {
  const { bindings } = useShortcutStore.getState()
  const scopes = getActiveScopes()

  for (const action of SHORTCUT_ACTIONS) {
    if (!scopes.has(action.scope)) continue
    const binding = resolveBinding(action.id, bindings)
    if (!binding || !isSequence(binding)) continue
    if (bindingMatchesSequence(binding, buffer)) return action.id
  }
  return null
}

function findChordMatch(e: KeyboardEvent): string | null {
  const { bindings, lightbox, cmdkOpen, dataIOOpen } = useShortcutStore.getState()
  const composerOpen = useStore.getState().composerOpen
  const typing = isTypingTarget(e.target)
  const scopes = getActiveScopes()

  const candidates: { id: string; priority: number }[] = []

  for (const action of SHORTCUT_ACTIONS) {
    if (!scopes.has(action.scope)) continue
    const meta = action
    const binding = resolveBinding(action.id, bindings)
    if (!binding || isSequence(binding)) continue
    if (typing && !meta.allowWhenTyping) continue

    if (meta.id === 'global.closeOverlay') {
      if (!lightbox && !cmdkOpen && !dataIOOpen && !composerOpen) continue
    }

    if (meta.scope === 'lightbox' && !lightbox) continue

    if (eventMatchesChord(e, binding)) {
      candidates.push({
        id: action.id,
        priority: SCOPE_PRIORITY[meta.scope],
      })
    }
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.priority - a.priority)
  return candidates[0]!.id
}

function runAction(id: string): boolean {
  const fn = handlers[id]
  if (!fn) return false
  fn()
  return true
}

export function handleShortcutKeydown(e: KeyboardEvent): boolean {
  // Guard against race: handlers map may be empty before first setShortcutHandlers call
  if (Object.keys(handlers).length === 0) return false

  const { cmdkOpen } = useShortcutStore.getState()
  if (cmdkOpen) return false

  const chord = chordFromEvent(e)
  if (!chord.key) return false

  const typing = isTypingTarget(e.target)
  const composerOpen = useStore.getState().composerOpen
  const { dataIOOpen, lightbox } = useShortcutStore.getState()

  if (typing && !lightbox) {
    clearSequence()
    return false
  }

  if (composerOpen && !lightbox) {
    clearSequence()
    return false
  }

  const matchedChord = findChordMatch(e)
  if (matchedChord) {
    if (runAction(matchedChord)) {
      e.preventDefault()
      clearSequence()
      return true
    }
  }

  if (chord.mod || chord.alt || chord.shift) {
    clearSequence()
    return false
  }

  const key = chord.key
  if (key.length !== 1 && !key.startsWith('arrow')) {
    clearSequence()
    return false
  }

  sequenceBuffer.push(key)
  armSequenceTimer()

  if (hasSequencePrefix(sequenceBuffer)) {
    e.preventDefault()
  }

  const seqMatch = findSequenceMatch(sequenceBuffer)
  if (seqMatch) {
    if (runAction(seqMatch)) {
      e.preventDefault()
      clearSequence()
      return true
    }
  }

  if (sequenceBuffer.length >= 2) {
    clearSequence()
  }

  return false
}

export function findBindingConflicts(
  actionId: string,
  binding: ShortcutBinding,
  bindings: Record<string, ShortcutBinding | null>,
): string[] {
  const key = bindingKey(binding)
  const conflicts: string[] = []
  for (const action of SHORTCUT_ACTIONS) {
    if (action.id === actionId) continue
    const other = resolveBinding(action.id, bindings)
    if (!other) continue
    if (bindingKey(other) === key) conflicts.push(action.label)
  }
  return conflicts
}
