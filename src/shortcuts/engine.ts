import type { ShortcutBinding, ShortcutScope } from '@/shortcuts/types'
import { getActionMeta, SHORTCUT_ACTIONS } from '@/shortcuts/actions'
import {
  bindingKey,
  chordFromEvent,
  eventMatchesChord,
  isSequence,
  isTypingTarget,
} from '@/shortcuts/chords'
import { resolveBinding } from '@/shortcuts/bindingRules'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'

export type ShortcutHandler = () => void

export type ShortcutHandlerMap = Partial<Record<string, ShortcutHandler>>

/**
 * 可通过 Esc 直接退出到交易日志的桌面一级工作区。
 * 设置页包含嵌套路由；回收站保留旧入口别名，避免重定向期间出现行为缺口。
 */
export function isTradeLogEscapePage(pathname: string): boolean {
  return (
    ['/dashboard', '/weekly-review', '/review-session', '/trade-trash', '/trash'].includes(pathname) ||
    pathname === '/notes' ||
    pathname.startsWith('/notes/') ||
    pathname === '/settings' ||
    pathname.startsWith('/settings/')
  )
}

const SEQUENCE_TIMEOUT_MS = 1500

const SCOPE_PRIORITY: Record<ShortcutScope, number> = {
  lightbox: 100,
  overlay: 90,
  detail: 50,
  reviewSession: 50,
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
  const { lightbox, cmdkOpen, modalOverlayCount } = useShortcutStore.getState()
  const { composerOpen, closeTradeRequest } = useStore.getState()
  const modalOpen = modalOverlayCount > 0
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : undefined)

  if (lightbox && p === '/review-session') return new Set<ShortcutScope>(['lightbox'])

  const scopes = new Set<ShortcutScope>(['global', 'navigation'])
  if (lightbox) scopes.add('lightbox')
  if (cmdkOpen || modalOpen || composerOpen || closeTradeRequest) scopes.add('overlay')

  if (p) {
    if (p.startsWith('/trade/')) scopes.add('detail')
    if (p === '/review-session') scopes.add('reviewSession')
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
  const { bindings, lightbox, cmdkOpen, modalOverlayCount } = useShortcutStore.getState()
  const { composerOpen, closeTradeRequest } = useStore.getState()
  const modalOpen = modalOverlayCount > 0
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
      if (!lightbox && !cmdkOpen && !modalOpen && !composerOpen && !closeTradeRequest) continue
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
  if (e.defaultPrevented || e.repeat || e.isComposing || e.keyCode === 229) {
    clearSequence()
    return false
  }

  // Guard against race: host 与当前页面都还没注册动作。
  if (Object.keys(handlers).length === 0 && registeredHandlerMaps.length === 0) return false

  const { cmdkOpen } = useShortcutStore.getState()
  if (cmdkOpen) return false

  const chord = chordFromEvent(e)
  if (!chord.key) return false

  const typing = isTypingTarget(e.target)
  const { composerOpen, closeTradeRequest } = useStore.getState()
  const { modalOverlayCount, lightbox } = useShortcutStore.getState()
  const modalOpen = modalOverlayCount > 0

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

  // ModalShell / 新建 / 平仓弹层打开时屏蔽全局单键；Esc 由各弹层自行处理。
  if ((composerOpen || closeTradeRequest || modalOpen) && !lightbox) {
    clearSequence()
    return false
  }

  const activePathname = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '')
  if (
    chord.key === 'escape' &&
    !lightbox &&
    isTradeLogEscapePage(activePathname) &&
    runAction('global.closeOverlay')
  ) {
    e.preventDefault()
    clearSequence()
    return true
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

export {
  buildBindingOverwritePatch,
  findBindingConflicts,
} from '@/shortcuts/bindingRules'
