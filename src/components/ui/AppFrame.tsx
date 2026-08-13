import { useEffect, useRef, type ReactNode } from 'react'
import { useStore } from '@/store/useStore'
import './AppFrame.css'

type AppFrameProps = {
  sidebar: ReactNode
  children: ReactNode
}

type FocusRingState = 'on' | 'off'

type DocumentFocusRingOwner = {
  value: FocusRingState
}

type DocumentFocusRingOwnership = {
  documentRoot: HTMLElement
  initialValue: string | undefined
  owners: DocumentFocusRingOwner[]
}

let documentFocusRingOwnership: DocumentFocusRingOwnership | null = null

function writeDocumentFocusRingState(
  documentRoot: HTMLElement,
  value: string | undefined,
): void {
  if (value === undefined) {
    delete documentRoot.dataset.keyboardFocusRings
  } else {
    documentRoot.dataset.keyboardFocusRings = value
  }
}

function syncActiveDocumentFocusRingOwner(): void {
  const ownership = documentFocusRingOwnership
  if (!ownership) return
  const activeOwner = ownership.owners.at(-1)
  if (activeOwner) writeDocumentFocusRingState(ownership.documentRoot, activeOwner.value)
}

function registerDocumentFocusRingOwner(owner: DocumentFocusRingOwner): () => void {
  const documentRoot = document.documentElement
  if (!documentFocusRingOwnership) {
    documentFocusRingOwnership = {
      documentRoot,
      initialValue: documentRoot.dataset.keyboardFocusRings,
      owners: [],
    }
  }
  const ownership = documentFocusRingOwnership
  ownership.owners.push(owner)
  syncActiveDocumentFocusRingOwner()

  return () => {
    const currentOwnership = documentFocusRingOwnership
    if (!currentOwnership) return
    const ownerIndex = currentOwnership.owners.indexOf(owner)
    if (ownerIndex < 0) return
    currentOwnership.owners.splice(ownerIndex, 1)
    if (currentOwnership.owners.length > 0) {
      syncActiveDocumentFocusRingOwner()
      return
    }
    writeDocumentFocusRingState(
      currentOwnership.documentRoot,
      currentOwnership.initialValue,
    )
    documentFocusRingOwnership = null
  }
}

function updateDocumentFocusRingOwner(
  owner: DocumentFocusRingOwner,
  value: FocusRingState,
): void {
  owner.value = value
  if (documentFocusRingOwnership?.owners.at(-1) === owner) {
    syncActiveDocumentFocusRingOwner()
  }
}

export function AppFrame({ sidebar, children }: AppFrameProps) {
  const showKeyboardFocusRings = useStore(
    (state) => state.display.showKeyboardFocusRings,
  )
  const focusRingState: FocusRingState = showKeyboardFocusRings ? 'on' : 'off'
  const focusRingOwnerRef = useRef<DocumentFocusRingOwner | null>(null)
  if (!focusRingOwnerRef.current) {
    focusRingOwnerRef.current = { value: focusRingState }
  }
  const focusRingOwner = focusRingOwnerRef.current

  useEffect(() => {
    return registerDocumentFocusRingOwner(focusRingOwner)
  }, [focusRingOwner])

  useEffect(() => {
    updateDocumentFocusRingOwner(focusRingOwner, focusRingState)
  }, [focusRingOwner, focusRingState])

  return (
    <div
      className="ui-app-frame"
      data-keyboard-focus-rings={focusRingState}
    >
      <a className="skip-link" href="#main-content">跳到主内容</a>
      <div className="ui-desktop-sidebar">{sidebar}</div>
      <main id="main-content" className="ui-main-frame" tabIndex={-1}>{children}</main>
    </div>
  )
}
