import { useCallback, useEffect, useId, useState } from 'react'
import { ModalShell } from '@/components/ui/ModalShell'
import {
  DEFAULT_WINDOW_HOTKEY,
  normalizeWindowHotkeyBinding,
  isWindowHotkeyModifierAllowed,
  type WindowHotkeyState,
} from '@/lib/windowHotkeyBinding'
import { toast } from '@/lib/toast'
import { chordFromEvent } from '@/shortcuts/chords'
import { formatBinding } from '@/shortcuts/format'
import type { KeyChord } from '@/shortcuts/types'
import { findWindowHotkeyConflicts } from '@/shortcuts/windowHotkeyConflicts'
import { useShortcutStore } from '@/store/shortcutStore'
import { ShortcutKeycaps } from '@/views/settings/ShortcutKeycaps'

type PendingConflict = {
  candidate: KeyChord
  conflicts: Array<{ id: string; label: string }>
  operation: 'set' | 'reset'
}

export function WindowHotkeySetting({
  onStateChange,
}: {
  onStateChange: (state: WindowHotkeyState) => void
}) {
  const headingId = useId()
  const [state, setState] = useState<WindowHotkeyState | null>(null)
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingConflict | null>(null)
  const [loadError, setLoadError] = useState(false)

  const publishState = useCallback((nextState: WindowHotkeyState, reconcile = false) => {
    setState(nextState)
    const shortcuts = useShortcutStore.getState()
    shortcuts.setWindowHotkeyBinding(nextState.binding)
    if (reconcile) {
      shortcuts.disableConflictsWithWindowHotkey(nextState.binding)
    }
    onStateChange(nextState)
  }, [onStateChange])

  const loadState = useCallback(async (): Promise<void> => {
    const bridge = window.journalBridge
    if (!bridge) return
    setLoadError(false)
    try {
      publishState(await bridge.getWindowHotkey(), true)
    } catch {
      setLoadError(true)
      toast('系统快捷键状态读取失败，请重试')
    }
  }, [publishState])

  useEffect(() => {
    let active = true
    void loadState().catch(() => { if (active) setLoadError(true) })
    return () => { active = false }
  }, [loadState])

  const commitCandidate = useCallback(async (candidate: KeyChord): Promise<void> => {
    const bridge = window.journalBridge
    if (!bridge) return
    setBusy(true)
    try {
      const result = await bridge.setWindowHotkey(candidate)
      publishState(result.state)
      if (!result.ok) {
        toast(result.message)
        return
      }
      const labels = useShortcutStore.getState().disableConflictsWithWindowHotkey(candidate)
      if (labels.length > 0) toast(`已更新，并覆盖「${labels.join('、')}」`)
      else toast('系统快捷键已更新')
    } finally {
      setBusy(false)
    }
  }, [publishState])

  const applyCandidate = useCallback(async (candidate: KeyChord): Promise<void> => {
    const conflicts = findWindowHotkeyConflicts(
      candidate,
      useShortcutStore.getState().bindings,
    )
    if (conflicts.length > 0) {
      setPending({ candidate, conflicts, operation: 'set' })
      return
    }
    await commitCandidate(candidate)
  }, [commitCandidate])

  const resetCandidate = useCallback(async (): Promise<void> => {
    const bridge = window.journalBridge
    if (!bridge) return
    setBusy(true)
    try {
      const result = await bridge.resetWindowHotkey()
      publishState(result.state)
      if (!result.ok) {
        toast(result.message)
        return
      }
      const labels = useShortcutStore.getState()
        .disableConflictsWithWindowHotkey(DEFAULT_WINDOW_HOTKEY)
      if (labels.length > 0) toast(`已恢复默认，并覆盖「${labels.join('、')}」`)
      else toast('已恢复系统快捷键默认值')
    } finally {
      setBusy(false)
    }
  }, [publishState])

  const applyResetCandidate = useCallback(async (): Promise<void> => {
    const candidate = { ...DEFAULT_WINDOW_HOTKEY }
    const conflicts = findWindowHotkeyConflicts(
      candidate,
      useShortcutStore.getState().bindings,
    )
    if (conflicts.length > 0) {
      setPending({ candidate, conflicts, operation: 'reset' })
      return
    }
    await resetCandidate()
  }, [resetCandidate])

  useEffect(() => {
    if (!recording || busy) return
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      if (event.key === 'Escape') {
        setRecording(false)
        return
      }
      if (event.repeat) return
      const platform = /Mac/i.test(navigator.platform) ? 'darwin' : 'win32'
      if (!isWindowHotkeyModifierAllowed(event, platform)) {
        toast(platform === 'darwin' ? 'macOS 系统快捷键请使用 Command' : 'Windows 系统快捷键请使用 Ctrl')
        return
      }
      const candidate = normalizeWindowHotkeyBinding(chordFromEvent(event))
      if (!candidate) {
        toast('不支持这个系统级快捷键')
        return
      }
      setRecording(false)
      void applyCandidate(candidate)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [applyCandidate, busy, recording])

  const bindingLabel = formatBinding(state?.binding)
  return (
    <section
      className="window-hotkey-setting"
      data-window-hotkey-setting
      aria-labelledby={headingId}
    >
      <div className="window-hotkey-heading">
        <div>
          <h2 id={headingId} className="settings-section-title">显示/隐藏应用</h2>
          <p className="settings-section-desc">系统级，会在其他软件中生效。</p>
        </div>
        <span
          className={`window-hotkey-status${state?.registered ? ' is-registered' : ''}`}
          role="status"
          aria-live="polite"
        >
          <span className="window-hotkey-status-dot" aria-hidden="true" />
          {loadError
            ? '读取失败'
            : state
              ? state.errorCode === 'invalid-config'
                ? '配置无效，已回退 F2'
                : state.errorCode === 'registration-unavailable'
                  ? '快捷键当前不可用'
                  : state.registered ? '已注册' : '当前未注册'
              : '正在读取'}
        </span>
      </div>
      {loadError ? (
        <button type="button" className="ui-btn ui-btn-bordered" onClick={() => { void loadState() }}>
          重试读取
        </button>
      ) : null}
      <div className="window-hotkey-row">
        <span className="window-hotkey-label">系统快捷键</span>
        <div className="window-hotkey-controls">
          <button
            type="button"
            className="shortcuts-capture window-hotkey-capture"
            data-window-hotkey-capture
            aria-label={recording
              ? '显示/隐藏应用，等待输入新系统快捷键'
              : `显示/隐藏应用，当前系统快捷键 ${bindingLabel}，点击修改`}
            aria-pressed={recording}
            disabled={busy || !state}
            onClick={() => setRecording((current) => !current)}
            onBlur={() => {
              if (recording) setRecording(false)
            }}
          >
            {recording ? (
              <span className="shortcuts-recording">
                <span className="shortcuts-recording-dot" />
                等待输入
              </span>
            ) : (
              <ShortcutKeycaps binding={state?.binding ?? null} />
            )}
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-bordered window-hotkey-reset"
            disabled={busy || !state}
            onClick={() => {
              setRecording(false)
              void applyResetCandidate()
            }}
          >
            恢复默认
          </button>
        </div>
      </div>

      {pending ? (
        <ModalShell
          title="覆盖现有快捷键？"
          description="系统快捷键与以下应用内快捷键冲突。"
          busy={busy}
          onClose={() => setPending(null)}
          footer={(
            <>
              <button
                type="button"
                className="ui-btn ui-btn-bordered"
                data-autofocus
                disabled={busy}
                onClick={() => setPending(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-primary"
                disabled={busy}
                onClick={() => {
                  const operation = pending.operation === 'reset'
                    ? resetCandidate()
                    : commitCandidate(pending.candidate)
                  void operation.finally(() => setPending(null))
                }}
              >
                确认覆盖
              </button>
            </>
          )}
        >
          <div className="window-hotkey-conflict-summary">
            <span>新的系统快捷键</span>
            <span className="window-hotkey-conflict-key" aria-label={formatBinding(pending.candidate)}>
              <ShortcutKeycaps binding={pending.candidate} />
            </span>
          </div>
          <ul className="window-hotkey-conflict-list">
            {pending.conflicts.map((conflict) => (
              <li key={conflict.id}>{conflict.label}</li>
            ))}
          </ul>
          <p className="window-hotkey-conflict-note">
            只有系统注册成功后，以上应用内快捷键才会被禁用。
          </p>
        </ModalShell>
      ) : null}
    </section>
  )
}
