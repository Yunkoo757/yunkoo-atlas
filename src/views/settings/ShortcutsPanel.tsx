import { useMemo, useState, useEffect, useCallback } from 'react'
import { Ban, LockKeyhole, RotateCcw } from '@/icons/appIcons'
import { Tooltip } from '@/components/ui/Tooltip'
import type { WindowHotkeyState } from '@/lib/windowHotkeyBinding'
import { SHORTCUT_ACTIONS } from '@/shortcuts/actions'
import { formatBinding } from '@/shortcuts/format'
import { chordFromEvent, chordKey, chordsEqual, isSequence, parseChordKey } from '@/shortcuts/chords'
import type { KeyChord } from '@/shortcuts/types'
import { resolveBinding, useShortcutStore } from '@/store/shortcutStore'
import { toast } from '@/lib/toast'
import { ShortcutKeycaps } from '@/views/settings/ShortcutKeycaps'
import { WindowHotkeySetting } from '@/views/settings/WindowHotkeySetting'
import '@/views/ShortcutsView.css'

const WINDOW_HOTKEY_LOADING_COPY = '正在读取系统快捷键，请稍候'

export function ShortcutsPanel() {
  const bindings = useShortcutStore((s) => s.bindings)
  const assignBinding = useShortcutStore((s) => s.assignBinding)
  const setBinding = useShortcutStore((s) => s.setBinding)
  const resetBinding = useShortcutStore((s) => s.resetBinding)
  const resetAllBindings = useShortcutStore((s) => s.resetAllBindings)
  const resetAllBindingsForWindowHotkey = useShortcutStore(
    (s) => s.resetAllBindingsForWindowHotkey,
  )
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [windowHotkeyState, setWindowHotkeyState] = useState<WindowHotkeyState | null>(null)
  const isElectron = window.journalBridge?.isElectron === true
  const windowHotkeyLoading = isElectron && windowHotkeyState === null

  const categories = useMemo(() => {
    const map = new Map<string, typeof SHORTCUT_ACTIONS>()
    for (const action of SHORTCUT_ACTIONS) {
      if (!map.has(action.category)) map.set(action.category, [])
      map.get(action.category)!.push(action)
    }
    return [...map.entries()]
  }, [])

  const onRecordKey = useCallback(
    (e: KeyboardEvent) => {
      if (!recordingId) return
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()

      if (e.key === 'Escape') {
        setRecordingId(null)
        return
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        setBinding(recordingId, null)
        setRecordingId(null)
        toast('快捷键已禁用')
        return
      }

      if (e.repeat) return

      const chord = chordFromEvent(e)
      if (!chord.key) return

      if (windowHotkeyState && chordsEqual(chord, windowHotkeyState.binding)) {
        toast('该按键已用于显示/隐藏 Trader Atlas，请先修改系统快捷键')
        return
      }

      const result = assignBinding(recordingId, chord)
      if (!result.ok) {
        toast(result.error)
        return
      }

      setRecordingId(null)
      if (result.clearedLabels.length > 0) {
        toast(`已更新，并覆盖「${result.clearedLabels.join('、')}」`)
      } else {
        toast('快捷键已更新')
      }
    },
    [recordingId, assignBinding, setBinding, windowHotkeyState],
  )

  useEffect(() => {
    if (!recordingId) return
    window.addEventListener('keydown', onRecordKey, true)
    return () => window.removeEventListener('keydown', onRecordKey, true)
  }, [recordingId, onRecordKey])

  return (
    <div className="settings-page shortcuts-panel">
      <div className="settings-page-head shortcuts-panel-head">
        <h1 className="settings-page-title">键盘快捷键</h1>
        <button
          type="button"
          className="shortcuts-reset-all"
          aria-label={windowHotkeyLoading
            ? `恢复全部默认，${WINDOW_HOTKEY_LOADING_COPY}`
            : undefined}
          title={windowHotkeyLoading ? WINDOW_HOTKEY_LOADING_COPY : undefined}
          disabled={windowHotkeyLoading}
          onClick={() => {
            if (!windowHotkeyState) {
              resetAllBindings()
              toast('已恢复全部默认快捷键')
              return
            }
            const labels = resetAllBindingsForWindowHotkey(windowHotkeyState.binding)
            if (labels.length > 0) {
              toast(`已恢复全部默认；因系统快捷键占用，保留禁用「${labels.join('、')}」`)
            } else {
              toast('已恢复全部默认快捷键')
            }
          }}
        >
          <RotateCcw size={14} />
          恢复全部默认
        </button>
      </div>
      {isElectron ? <WindowHotkeySetting onStateChange={setWindowHotkeyState} /> : null}
      {categories.map(([category, actions]) => (
        <section key={category} className="shortcuts-section">
          <h2 className="shortcuts-group-label">{category}</h2>
          <div className="shortcuts-table">
            {actions.map((action) => {
              const binding = resolveBinding(action.id, bindings)
              const isRecording = recordingId === action.id
              const isDefault = !action.sequenceFixed && !(action.id in bindings)
              const bindingLabel = formatBinding(binding)
              return (
                <div
                  key={action.id}
                  className={`shortcuts-row${isRecording ? ' is-recording' : ''}`}
                >
                  <span className="shortcuts-label">{action.label}</span>
                  <div className="shortcuts-row-controls">
                    {action.sequenceFixed ? (
                      <Tooltip
                        label={`${action.label}为固定序列快捷键`}
                        content="固定序列快捷键"
                      >
                        <span
                          className="shortcuts-capture is-fixed"
                          aria-label={`${bindingLabel}，固定快捷键`}
                        >
                          <ShortcutKeycaps binding={binding} />
                          <LockKeyhole size={12} />
                        </span>
                      </Tooltip>
                    ) : (
                      <button
                        type="button"
                        className="shortcuts-capture"
                        aria-label={
                          windowHotkeyLoading
                            ? `${action.label}，${WINDOW_HOTKEY_LOADING_COPY}`
                            : isRecording
                            ? `${action.label}，等待输入新快捷键`
                            : `${action.label}，当前快捷键 ${bindingLabel}，点击修改`
                        }
                        aria-pressed={isRecording}
                        title={windowHotkeyLoading ? WINDOW_HOTKEY_LOADING_COPY : undefined}
                        disabled={windowHotkeyLoading}
                        onClick={() => setRecordingId(isRecording ? null : action.id)}
                        onBlur={() => {
                          if (isRecording) setRecordingId(null)
                        }}
                      >
                        {isRecording ? (
                          <span className="shortcuts-recording">
                            <span className="shortcuts-recording-dot" />
                            等待输入
                          </span>
                        ) : (
                          <ShortcutKeycaps binding={binding} />
                        )}
                      </button>
                    )}

                    <span className="shortcuts-actions">
                      {!isDefault && !action.sequenceFixed && (
                        <Tooltip label={`恢复${action.label}的默认快捷键`} content="恢复默认">
                          <button
                            type="button"
                            className="shortcuts-action"
                            aria-label={windowHotkeyLoading
                              ? `恢复${action.label}的默认快捷键，${WINDOW_HOTKEY_LOADING_COPY}`
                              : `恢复${action.label}的默认快捷键`}
                            title={windowHotkeyLoading ? WINDOW_HOTKEY_LOADING_COPY : undefined}
                            disabled={windowHotkeyLoading}
                            onClick={() => {
                              setRecordingId(null)
                              if (
                                windowHotkeyState &&
                                !isSequence(action.defaultBinding) &&
                                chordsEqual(action.defaultBinding, windowHotkeyState.binding)
                              ) {
                                setBinding(action.id, null)
                                toast('该按键已用于显示/隐藏 Trader Atlas，请先修改系统快捷键')
                                return
                              }
                              resetBinding(action.id)
                              toast('已恢复默认')
                            }}
                          >
                            <RotateCcw size={14} />
                          </button>
                        </Tooltip>
                      )}
                      {binding && !isSequence(binding) && !action.sequenceFixed && (
                        <Tooltip label={`禁用${action.label}快捷键`} content="禁用快捷键">
                          <button
                            type="button"
                            className="shortcuts-action"
                            aria-label={`禁用${action.label}快捷键`}
                            onClick={() => {
                              setRecordingId(null)
                              setBinding(action.id, null)
                              toast('已禁用')
                            }}
                          >
                            <Ban size={14} />
                          </button>
                        </Tooltip>
                      )}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

export function bindingFromChordKey(raw: string): KeyChord | null {
  return parseChordKey(raw)
}

export function exportChordKey(c: KeyChord): string {
  return chordKey(c)
}
