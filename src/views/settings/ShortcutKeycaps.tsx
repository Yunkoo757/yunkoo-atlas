import { ICON_SM } from '@/icons/iconSize'
import { Fragment } from 'react'
import { ArrowRight } from '@/icons/appIcons'
import { chordKey, isSequence } from '@/shortcuts/chords'
import { formatBinding } from '@/shortcuts/format'
import type { KeyChord, ShortcutBinding } from '@/shortcuts/types'

export function splitChordLabel(chord: KeyChord): string[] {
  const formatted = formatBinding(chord)
  if (formatted.includes('+')) return formatted.split('+')
  return formatted.match(/[⌘⌥⇧]|[^⌘⌥⇧]+/g) ?? [formatted]
}

export function ShortcutKeycaps({ binding }: { binding: ShortcutBinding | null }) {
  if (!binding) return <span className="shortcuts-unassigned">未设置</span>

  const chords = isSequence(binding) ? binding : [binding]
  return (
    <span className="shortcuts-keycap-list" aria-hidden="true">
      {chords.map((chord, chordIndex) => (
        <Fragment key={chordKey(chord)}>
          {chordIndex > 0 && <ArrowRight className="shortcuts-sequence-arrow" size={ICON_SM} />}
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
