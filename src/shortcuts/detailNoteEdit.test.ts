import { handleShortcutKeydown, registerShortcutHandlers, setShortcutHandlers } from './engine'
import { shouldYieldEnterToControl } from './chords'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'

function assert(value: unknown, message: string): void {
  if (!value) throw new Error(message)
}

function keyEvent(key: string, target: Partial<HTMLElement> & { tagName?: string } = { tagName: 'DIV' }) {
  const closest = typeof target.closest === 'function'
    ? target.closest
    : () => null
  const event = {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    target: {
      tagName: target.tagName ?? 'DIV',
      isContentEditable: Boolean(target.isContentEditable),
      closest,
    },
    preventDefault() {
      event.defaultPrevented = true
    },
  }
  return event as unknown as KeyboardEvent
}

export function testEnterOnControlsDoesNotStartNoteEdit(): void {
  assert(!shouldYieldEnterToControl(null), '页面级 Enter 应可用于编辑正文')
  assert(
    shouldYieldEnterToControl({ tagName: 'BUTTON', closest: () => null } as unknown as HTMLElement),
    '按钮 Enter 应留给原控件',
  )
  assert(
    shouldYieldEnterToControl({
      tagName: 'DIV',
      closest: (selector: string) => selector.includes('[role="dialog"]') ? {} : null,
    } as unknown as HTMLElement),
    '对话框内 Enter 应留给原控件',
  )
}

export function testDetailEnterAndEscapeSplitBrowseAndEdit(): void {
  const previousShortcuts = useShortcutStore.getState()
  const store = useStore.getState()
  let editing = 0
  let exited = 0
  let back = 0
  setShortcutHandlers({ 'trade.backToList': () => { back += 1 } })
  const unregister = registerShortcutHandlers({
    'trade.editNote': () => { editing += 1 },
    'trade.exitNoteEdit': () => { exited += 1 },
  })
  useShortcutStore.setState({
    bindings: {
      'trade.editNote': { key: 'enter' },
      'trade.backToList': { key: 'escape' },
    },
    cmdkOpen: false,
    lightbox: null,
    modalOverlayCount: 0,
  })
  useStore.setState({ composerOpen: false, closeTradeRequest: null })

  try {
    assert(handleShortcutKeydown(keyEvent('Enter'), '/trade/one') && editing === 1, '浏览态 Enter 应开始编辑正文')
    assert(
      !handleShortcutKeydown(keyEvent('Enter', { tagName: 'BUTTON' }), '/trade/one') && editing === 1,
      '按钮 Enter 不得开始编辑正文',
    )
    assert(!handleShortcutKeydown(keyEvent('Enter'), '/list') && editing === 1, '列表页 Enter 不得开始编辑正文')
    useShortcutStore.setState({ lightbox: { images: ['image'], index: 0 } })
    assert(!handleShortcutKeydown(keyEvent('Enter'), '/trade/one') && editing === 1, '灯箱打开时不得开始编辑正文')
    useShortcutStore.setState({ lightbox: null })

    const editorEscape = keyEvent('Escape', { tagName: 'DIV', isContentEditable: true })
    assert(handleShortcutKeydown(editorEscape, '/trade/one') && exited === 1 && back === 0, '编辑中 Esc 应先退出编辑')
  } finally {
    unregister()
    setShortcutHandlers({ 'trade.backToList': () => { back += 1 } })
    useShortcutStore.setState({ lightbox: null })
  }

  try {
    const stillEditing = keyEvent('Escape', { tagName: 'DIV', isContentEditable: true })
    assert(handleShortcutKeydown(stillEditing, '/trade/one') && back === 1, '未在编辑时，正文 Esc 仍返回列表')
  } finally {
    setShortcutHandlers({})
    useShortcutStore.setState({
      bindings: previousShortcuts.bindings,
      cmdkOpen: previousShortcuts.cmdkOpen,
      lightbox: previousShortcuts.lightbox,
      modalOverlayCount: previousShortcuts.modalOverlayCount,
    })
    useStore.setState({ composerOpen: store.composerOpen, closeTradeRequest: store.closeTradeRequest })
  }
}
