import { handleShortcutKeydown, setShortcutHandlers } from '@/shortcuts/engine'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function keyEvent(key: string): KeyboardEvent {
  return {
    key,
    code: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    keyCode: 0,
    defaultPrevented: false,
    preventDefault() {},
    target: { tagName: 'BUTTON', isContentEditable: false, closest: () => null },
  } as unknown as KeyboardEvent
}

export function testModalOverlayBlocksGlobalSingleKeyShortcuts(): void {
  const previousShortcuts = useShortcutStore.getState()
  const previousStore = useStore.getState()
  let newTradeCalls = 0

  setShortcutHandlers({
    'global.newTrade': () => {
      newTradeCalls += 1
    },
  })
  useStore.setState({ composerOpen: false, closeTradeRequest: null })
  useShortcutStore.setState({
    cmdkOpen: false,
    lightbox: null,
    modalOverlayCount: 0,
  })

  try {
    assert(handleShortcutKeydown(keyEvent('n'), '/list'), '无弹层时应触发新建交易')
    assert(newTradeCalls === 1, '无弹层时新建应执行一次')

    useShortcutStore.getState().acquireModalOverlay()
    assert(
      !handleShortcutKeydown(keyEvent('n'), '/list'),
      'ModalShell 打开时不得触发全局单键新建',
    )
    assert(newTradeCalls === 1, '弹层打开期间不得增加新建调用')
  } finally {
    useShortcutStore.setState({
      modalOverlayCount: previousShortcuts.modalOverlayCount,
      cmdkOpen: previousShortcuts.cmdkOpen,
      lightbox: previousShortcuts.lightbox,
    })
    useStore.setState({
      composerOpen: previousStore.composerOpen,
      closeTradeRequest: previousStore.closeTradeRequest,
    })
    setShortcutHandlers({})
  }
}
