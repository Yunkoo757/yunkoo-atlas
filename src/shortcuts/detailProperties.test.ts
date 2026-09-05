import { handleShortcutKeydown, setShortcutHandlers } from './engine'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

export function testPropertiesTabRespectsPageAndInputContext(): void {
  const previous = useShortcutStore.getState()
  const store = useStore.getState()
  let calls = 0
  setShortcutHandlers({ 'trade.toggleProperties': () => { calls += 1 }, 'list.focusNext': () => { calls += 10 } })
  useShortcutStore.setState({ bindings: { 'list.focusNext': { key: 'tab' } }, cmdkOpen: false, lightbox: null, modalOverlayCount: 0 })
  useStore.setState({ composerOpen: false, closeTradeRequest: null })
  const event = (tagName = 'DIV', shiftKey = false, dialog = false) => ({
    key: 'Tab', ctrlKey: false, metaKey: false, altKey: false, shiftKey,
    target: { tagName, isContentEditable: tagName === 'EDITOR', closest: () => dialog ? {} : null },
    preventDefault() {},
  } as unknown as KeyboardEvent)
  try {
    assert(handleShortcutKeydown(event(), '/trade/one') && calls === 1, '详情 Tab 应只切换属性')
    assert(handleShortcutKeydown(event(), '/list') && Number(calls) === 11, '列表可独立复用 Tab')
    assert(!handleShortcutKeydown(event(), '/dashboard'), '统计页不得触发详情或列表动作')
    assert(!handleShortcutKeydown(event('INPUT'), '/trade/one'), '输入框 Tab 应保持原行为')
    assert(!handleShortcutKeydown(event('EDITOR'), '/trade/one'), '编辑器 Tab 应保持原行为')
    assert(!handleShortcutKeydown(event('BUTTON', false, true), '/trade/one'), '抽屉内 Tab 应用于焦点导航')
    assert(!handleShortcutKeydown(event('DIV', true), '/trade/one'), 'Shift+Tab 应保留反向焦点导航')
    useShortcutStore.setState({ modalOverlayCount: 1 })
    assert(!handleShortcutKeydown(event(), '/trade/one'), '弹窗打开时不得切换属性')
    useShortcutStore.setState({ modalOverlayCount: 0, lightbox: { images: ['image'], index: 0 } })
    assert(!handleShortcutKeydown(event(), '/trade/one'), '图片查看器打开时不得切换背景属性')
  } finally {
    useShortcutStore.setState({ bindings: previous.bindings, cmdkOpen: previous.cmdkOpen, lightbox: previous.lightbox, modalOverlayCount: previous.modalOverlayCount })
    useStore.setState({ composerOpen: store.composerOpen, closeTradeRequest: store.closeTradeRequest })
    setShortcutHandlers({})
  }
}
