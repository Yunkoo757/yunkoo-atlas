import { Fragment, useMemo, useState, useEffect, useCallback } from 'react'
import { ArrowRight, Ban, LockKeyhole, RotateCcw } from '@/icons/appIcons'
import { Tooltip } from '@/components/ui/Tooltip'
import { SHORTCUT_ACTIONS } from '@/shortcuts/actions'
import { formatBinding } from '@/shortcuts/format'
import { chordFromEvent, chordKey, isSequence, parseChordKey } from '@/shortcuts/chords'
import type { KeyChord, ShortcutBinding } from '@/shortcuts/types'
import { resolveBinding, useShortcutStore } from '@/store/shortcutStore'
import { toast } from '@/lib/toast'
import '@/views/ShortcutsView.css'

function splitChordLabel(chord: KeyChord): string[] {
  const formatted = formatBinding(chord)
  if (formatted.includes('+')) return formatted.split('+')
  return formatted.match(/[⌘⌥⇧]|[^⌘⌥⇧]+/g) ?? [formatted]
}

function ShortcutKeycaps({ binding }: { binding: ShortcutBinding | null }) {
  if (!binding) return <span className="shortcuts-unassigned">未设置</span>

  const chords = isSequence(binding) ? binding : [binding]
  return (
    <span className="shortcuts-keycap-list" aria-hidden="true">
      {chords.map((chord, chordIndex) => (
        <Fragment key={chordKey(chord)}>
          {chordIndex > 0 && <ArrowRight className="shortcuts-sequence-arrow" size={12} />}
          <span className="shortcuts-chord">
            {splitChordLabel(chord).map((label) => (
              <kbd key={label} className="shortcuts-keycap">
                {label}
              </kbd>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  )
}

export function ShortcutsPanel() {
  const bindings = useShortcutStore((s) => s.bindings)
  const assignBinding = useShortcutStore((s) => s.assignBinding)
  const setBinding = useShortcutStore((s) => s.setBinding)
  const resetBinding = useShortcutStore((s) => s.resetBinding)
  const resetAllBindings = useShortcutStore((s) => s.resetAllBindings)
  const [recordingId, setRecordingId] = useState<string | null>(null)

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

      const binding: ShortcutBinding = chord
      const result = assignBinding(recordingId, binding)
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
    [recordingId, assignBinding, setBinding],
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
          onClick={() => {
            resetAllBindings()
            toast('已恢复全部默认快捷键')
          }}
        >
          <RotateCcw size={14} />
          恢复全部默认
        </button>
      </div>
      {categories.map(([category, actions]) => (
        <section key={category} className="shortcuts-section">
          <h2 className="shortcuts-section-title">{category}</h2>
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
                          isRecording
                            ? `${action.label}，等待输入新快捷键`
                            : `${action.label}，当前快捷键 ${bindingLabel}，点击修改`
                        }
                        aria-pressed={isRecording}
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
                            aria-label={`恢复${action.label}的默认快捷键`}
                            onClick={() => {
                              setRecordingId(null)
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
