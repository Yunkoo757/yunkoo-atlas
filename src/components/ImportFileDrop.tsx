import { useState, type RefObject } from 'react'
import { Upload } from '@/icons/appIcons'
import { ICON_MD } from '@/icons/iconSize'
import './ImportModal.css'

type ImportFileDropProps = {
  inputRef: RefObject<HTMLInputElement>
  label: string
  hint: string
  accept: string
  busy?: boolean
  onFile: (file: File) => Promise<void>
}

export function ImportFileDrop({ inputRef, label, hint, accept, busy = false, onFile }: ImportFileDropProps) {
  const [dragging, setDragging] = useState(false)

  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-busy={busy || undefined}
        disabled={busy}
        className={'import-file-drop' + (dragging && !busy ? ' is-drag' : '')}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault()
          if (!busy) setDragging(true)
        }}
        onDragLeave={(event) => {
          const next = event.relatedTarget
          if (!(next instanceof Node) || !event.currentTarget.contains(next)) setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          const file = event.dataTransfer.files[0]
          if (!busy && file) void onFile(file)
        }}
      >
        <span className="import-file-icon"><Upload size={ICON_MD} aria-hidden /></span>
        <span className="import-file-title">拖放或选择文件</span>
        <span className="import-file-hint">{hint}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={busy}
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void onFile(file)
        }}
      />
    </>
  )
}
