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
const registeredHandlerMaps: Array<{ token: symbol; handlers: ShortcutHandlerMap }> = []
let sequenceBuffer: string[] = []
let sequenceTimer: ReturnType<typeof setTimeout> | null = null

export function setShortcutHandlers(map: ShortcutHandlerMap): void {
  handlers = map
}

/**
 * 为当前挂载的界面注册局部动作。后注册者优先，清理时只移除自己的处理器，
 * 避免路由切换期间旧组件的 cleanup 覆盖新组件。
 */
export function registerShortcutHandlers(map: ShortcutHandlerMap): () => void {
  const registration = { token: Symbol('shortcut-handlers'), handlers: map }
  registeredHandlerMaps.push(registration)
  return () => {
    const index = registeredHandlerMaps.findIndex((item) => item.token === registration.token)
    if (index >= 0) registeredHandlerMaps.splice(index, 1)
  }
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

function getActiveScopes(pathname?: string): Set<ShortcutScope> {
  const scopes = new Set<ShortcutScope>(['global', 'navigation'])
  const { lightbox, cmdkOpen, dataIOOpen } = useShortcutStore.getState()
  const { composerOpen, closeTradeRequest } = useStore.getState()

  if (lightbox) scopes.add('lightbox')
  if (cmdkOpen || dataIOOpen || composerOpen || closeTradeRequest) scopes.add('overlay')

  if (typeof window !== 'undefined') {
    const p = pathname ?? window.location.pathname
    if (p.startsWith('/trade/')) scopes.add('detail')
  }

  return scopes
}

function bindingMatchesSequence(binding: ShortcutBinding, buffer: string[]): boolean {
  if (!isSequence(binding)) return false
  if (buffer.length !== binding.length) return false
  return binding.every((chord, i) => chord.key === buffer[i])
}

function hasSequencePrefix(buffer: string[], pathname?: string): boolean {
  if (buffer.length === 0) return false
  const { bindings } = useShortcutStore.getState()
  const scopes = getActiveScopes(pathname)

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

function findSequenceMatch(buffer: string[], pathname?: string): string | null {
  const { bindings } = useShortcutStore.getState()
  const scopes = getActiveScopes(pathname)

  for (const action of SHORTCUT_ACTIONS) {
    if (!scopes.has(action.scope)) continue
    const binding = resolveBinding(action.id, bindings)
    if (!binding || !isSequence(binding)) continue
    if (bindingMatchesSequence(binding, buffer)) return action.id
  }
  return null
}

function findChordMatch(e: KeyboardEvent, pathname?: string): string | null {
  const { bindings, lightbox, cmdkOpen, dataIOOpen } = useShortcutStore.getState()
  const { composerOpen, closeTradeRequest } = useStore.getState()
  const typing = isTypingTarget(e.target)
  const scopes = getActiveScopes(pathname)

  const candidates: { id: string; priority: number }[] = []

  for (const action of SHORTCUT_ACTIONS) {
    if (!scopes.has(action.scope)) continue
    const meta = action
    const binding = resolveBinding(action.id, bindings)
    if (!binding || isSequence(binding)) continue
    if (typing && !meta.allowWhenTyping) continue

    if (meta.id === 'global.closeOverlay') {
      if (!lightbox && !cmdkOpen && !dataIOOpen && !composerOpen && !closeTradeRequest) continue
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
  for (let index = registeredHandlerMaps.length - 1; index >= 0; index -= 1) {
    const registered = registeredHandlerMaps[index]?.handlers[id]
    if (!registered) continue
    registered()
    return true
  }
  const fn = handlers[id]
  if (!fn) return false
  fn()
  return true
}

export function handleShortcutKeydown(e: KeyboardEvent, pathname?: string): boolean {
  // Guard against race: host 与当前页面都还没注册动作。
  if (Object.keys(handlers).length === 0 && registeredHandlerMaps.length === 0) return false

  const { cmdkOpen } = useShortcutStore.getState()
  if (cmdkOpen) return false

  const chord = chordFromEvent(e)
  if (!chord.key) return false

  const typing = isTypingTarget(e.target)
  const { composerOpen, closeTradeRequest } = useStore.getState()
  const { dataIOOpen, lightbox } = useShortcutStore.getState()

  if (typing && !lightbox) {
    clearSequence()
    // 详情正文编辑器（contenteditable）按 Esc 仍可返回记忆中的列表；
    // 普通 input/textarea 不抢，避免打断标签/评论输入。
    const el = e.target as HTMLElement | null
    const inFormField =
      el?.tagName === 'INPUT' ||
      el?.tagName === 'TEXTAREA' ||
      !!el?.closest?.('input, textarea, [role="combobox"]')
    if (
      !inFormField &&
      chord.key === 'escape' &&
      (pathname ?? window.location.pathname).startsWith('/trade/')
    ) {
      if (runAction('trade.backToList')) {
        e.preventDefault()
        return true
      }
    }
    return false
  }

  if ((composerOpen || closeTradeRequest) && !lightbox) {
    clearSequence()
    return false
  }

  const matchedChord = findChordMatch(e, pathname)
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

  if (hasSequencePrefix(sequenceBuffer, pathname)) {
    e.preventDefault()
  }

  const seqMatch = findSequenceMatch(sequenceBuffer, pathname)
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
): Array<{ id: string; label: string; sequenceFixed?: boolean }> {
  const key = bindingKey(binding)
  const conflicts: Array<{ id: string; label: string; sequenceFixed?: boolean }> = []
  for (const action of SHORTCUT_ACTIONS) {
    if (action.id === actionId) continue
    const other = resolveBinding(action.id, bindings)
    if (!other) continue
    if (bindingKey(other) === key) {
      conflicts.push({
        id: action.id,
        label: action.label,
        sequenceFixed: action.sequenceFixed,
      })
    }
  }
  return conflicts
}

/** 计算覆写后的 bindings patch；固定序列冲突返回 null。 */
export function buildBindingOverwritePatch(
  actionId: string,
  binding: ShortcutBinding | null,
  bindings: Record<string, ShortcutBinding | null>,
): { patch: Record<string, ShortcutBinding | null>; clearedLabels: string[] } | { error: string } {
  if (binding === null) {
    return { patch: { [actionId]: null }, clearedLabels: [] }
  }
  const conflicts = findBindingConflicts(actionId, binding, {
    ...bindings,
    [actionId]: binding,
  })
  const fixed = conflicts.find((c) => c.sequenceFixed)
  if (fixed) {
    return { error: `与固定快捷键「${fixed.label}」冲突，无法覆盖` }
  }
  const patch: Record<string, ShortcutBinding | null> = { [actionId]: binding }
  const clearedLabels: string[] = []
  for (const conflict of conflicts) {
    patch[conflict.id] = null
    clearedLabels.push(conflict.label)
  }
  return { patch, clearedLabels }
}
