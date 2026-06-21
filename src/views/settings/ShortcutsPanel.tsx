import { useMemo, useState, useEffect, useCallback } from 'react'
import { RotateCcw } from 'lucide-react'
import { SHORTCUT_ACTIONS } from '@/shortcuts/actions'
import { formatBinding } from '@/shortcuts/format'
import { chordFromEvent, chordKey, isSequence, parseChordKey } from '@/shortcuts/chords'
import type { KeyChord, ShortcutBinding } from '@/shortcuts/types'
import { findBindingConflicts } from '@/shortcuts/engine'
import { resolveBinding, useShortcutStore } from '@/store/shortcutStore'
import { toast } from '@/lib/toast'
import '@/views/ShortcutsView.css'

export function ShortcutsPanel() {
  const bindings = useShortcutStore((s) => s.bindings)
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

      if (e.key === 'Escape') {
        setRecordingId(null)
        return
      }

      const chord = chordFromEvent(e)
      if (!chord.key) return

      const binding: ShortcutBinding = chord
      const conflicts = findBindingConflicts(recordingId, binding, {
        ...bindings,
        [recordingId]: binding,
      })
      if (conflicts.length > 0) {
        toast(`与「${conflicts[0]}」冲突`)
        return
      }

      setBinding(recordingId, binding)
      setRecordingId(null)
      toast('快捷键已更新')
    },
    [recordingId, bindings, setBinding],
  )

  useEffect(() => {
    if (!recordingId) return
    window.addEventListener('keydown', onRecordKey, true)
    return () => window.removeEventListener('keydown', onRecordKey, true)
  }, [recordingId, onRecordKey])

  return (
    <div className="settings-page shortcuts-panel">
      <div className="settings-page-head shortcuts-panel-head">
        <div>
          <h1 className="settings-page-title">键盘快捷键</h1>
          <p className="settings-page-desc">
            点击「录制」可自定义任意快捷键（单键或 Ctrl/Alt/Shift 组合键）。
          </p>
        </div>
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
              return (
                <div key={action.id} className="shortcuts-row">
                  <span className="shortcuts-label">{action.label}</span>
                  <span className="shortcuts-keys">
                    {isRecording ? (
                      <span className="shortcuts-recording">按下新快捷键…</span>
                    ) : (
                      <kbd>{formatBinding(binding)}</kbd>
                    )}
                  </span>
                  <span className="shortcuts-actions">
                    <button
                      type="button"
                      className="shortcuts-btn"
                      onClick={() => setRecordingId(action.id)}
                    >
                      录制
                    </button>
                    {!isDefault && (
                      <button
                        type="button"
                        className="shortcuts-btn shortcuts-btn--ghost"
                        onClick={() => {
                          resetBinding(action.id)
                          toast('已恢复默认')
                        }}
                      >
                        重置
                      </button>
                    )}
                    {binding && !isSequence(binding) && (
                      <button
                        type="button"
                        className="shortcuts-btn shortcuts-btn--ghost"
                        onClick={() => {
                          setBinding(action.id, null)
                          toast('已禁用')
                        }}
                      >
                        禁用
                      </button>
                    )}
                  </span>
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
